import type { Tool } from '@github/copilot-sdk';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { RunCallbacks, RunInput } from '../shared/types';
import type { NavigationJourney, NavigationStep } from '../shared/navigation';
import {
  navigationJourneySchema,
  navigationLocatorSchema,
  navigationStepSchema,
} from '../core/navigationSchemas';
import { navigationContext, searchNavigation } from './NavigationSearch';
import type { NavigationService } from './NavigationService';
import { validateImages } from './Images';
import { IMAGE_LIMITS } from '../shared/images';

async function withinOperation<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let aborted: () => void = () => {};
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        aborted = () => reject(signal.reason ?? new Error('Opération annulée.'));
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) aborted();
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', aborted);
  }
}

/** Closed host tools: no evaluate, arbitrary script, path authority or caller-supplied role. */
export function navigationTools(
  service: NavigationService,
  input: RunInput,
  callbacks: RunCallbacks,
  signal: AbortSignal,
): Tool[] {
  if (
    !input.navigation ||
    input.nativeReadOnly ||
    input.observation ||
    input.mode === 'discussion' ||
    !input.agent.tools.includes('navigation')
  )
    return [];
  service.beginAgent(input.attempt.id, input.navigation);
  const appId = input.navigation.application.id;
  let actions = 0;
  let imagesSent = 0;
  const repeats = new Map<string, number>();
  const guard = (operationSignal: AbortSignal = signal) => {
    operationSignal.throwIfAborted();
    signal.throwIfAborted();
    return service.assertAgent(input.attempt.id);
  };
  const tool = <T>(
    name: string,
    description: string,
    schema: z.ZodType<T>,
    action: (args: T, operationSignal: AbortSignal) => Promise<unknown> | unknown,
  ): Tool => ({
    name,
    description,
    parameters: z.toJSONSchema(schema),
    skipPermission: true,
    defer: 'never',
    handler: async (raw, invocation) => {
      const requestSignal = invocation.signal
        ? AbortSignal.any([signal, invocation.signal])
        : signal;
      let stopping: Promise<void> | undefined;
      const interrupt = () => {
        stopping ??= service.interruptAgentBrowser(input.attempt.id).catch(() => undefined);
      };
      const controlsBrowser = [
        'studio_navigation_replay',
        'studio_browser_inspect',
        'studio_browser_act',
        'studio_browser_capture',
      ].includes(name);
      try {
        requestSignal.throwIfAborted();
        guard();
        if (callbacks.navigationBlocked?.())
          throw new Error(
            'Contexte de navigation à compléter. Termine le compte rendu pour permettre l’intervention humaine.',
          );
        const args = schema.parse(raw);
        const id = randomUUID();
        if (controlsBrowser) requestSignal.addEventListener('abort', interrupt, { once: true });
        callbacks.onEvent({ id, at: new Date().toISOString(), kind: 'tool', message: name });
        const result = await withinOperation(
          Promise.resolve(action(args, requestSignal)),
          requestSignal,
        );
        requestSignal.throwIfAborted();
        guard();
        const text = JSON.stringify(result);
        return {
          resultType: 'success',
          textResultForLlm:
            text.length <= 16000
              ? text
              : JSON.stringify({
                  truncated: true,
                  content: text.slice(0, 15000),
                  notice: 'Demande une cible ou une projection plus précise.',
                }),
        };
      } catch (error) {
        return { resultType: 'failure', textResultForLlm: (error as Error).message };
      } finally {
        requestSignal.removeEventListener('abort', interrupt);
        await stopping;
      }
    },
  });
  const interaction = async (description: string, operationSignal: AbortSignal) => {
    const context = guard(operationSignal);
    service.assertBrowser(appId);
    if (!context.selection.allowInteractions || context.application.interactionPolicy === 'inspect')
      throw new Error(
        'Interactions non autorisées dans le contexte figé. Prépare une nouvelle tentative avec les droits adaptés.',
      );
    if (++actions > 30)
      throw new Error(
        'Budget d’exploration atteint (30 opérations). Transmets le résultat ou demande une reprise explicite.',
      );
    if (context.application.interactionPolicy === 'confirm') {
      const answer = await callbacks.onQuestion?.({
        question: `Autoriser cette interaction dans ${context.application.name} ?\n${description.slice(0, 1800)}`,
        choices: ['Autoriser', 'Refuser'],
        allowFreeform: false,
      });
      guard(operationSignal);
      if (answer !== 'Autoriser') throw new Error('Interaction non autorisée.');
    }
  };
  const resolve = async (id: string, revision: number): Promise<NavigationJourney> => {
    const context = guard();
    if (
      context.application.ownerNavigatorId !== input.agent.id &&
      (id !== context.journey?.id || revision !== context.journey.revision)
    )
      throw new Error(
        'Le consommateur doit rejouer la révision figée dans sa tentative. Sélectionne un autre parcours dans une nouvelle tentative.',
      );
    const journey = await service.store.revision(id, revision);
    if (!journey || journey.applicationId !== appId || journey.status === 'archived')
      throw new Error('Parcours hors contexte ou archivé.');
    return journey;
  };
  const tools: Tool[] = [
    tool(
      'studio_navigation_request',
      'Request missing navigation context from the Navigator. Suspends further tools; the human chooses the intervention and a new attempt.',
      z
        .object({ reason: z.string().min(1).max(2000), observations: z.string().max(4000) })
        .strict(),
      async (args) => {
        if (!callbacks.onNavigationRequest) throw new Error('Relais Navigateur indisponible.');
        await callbacks.onNavigationRequest(args);
        return {
          status: 'context-required',
          message:
            'Termine ton compte rendu avec le blocage et le travail préservé. L’humain peut ouvrir l’intervention Navigateur depuis la session ; aucune nouvelle révision n’est substituée à cette tentative.',
        };
      },
    ),
    tool(
      'studio_navigation_search',
      'Find a few relevant journey summaries in the selected application; no model or browser call.',
      z.object({ query: z.string().max(500) }).strict(),
      ({ query }) => searchNavigation(service.store.snapshot(), query, appId),
    ),
    tool(
      'studio_navigation_context',
      'Read one journey revision without changing the frozen execution context.',
      z.object({ id: z.string(), revision: z.number().int().positive() }).strict(),
      async ({ id, revision }) => {
        const journey = await service.store.revision(id, revision);
        if (!journey || journey.applicationId !== appId) throw new Error('Parcours hors contexte.');
        return navigationContext([journey]);
      },
    ),
    tool(
      'studio_navigation_replay',
      'Replay a declared revision and verify arrival. Uses frozen parameters and prerequisites; no internal AI call.',
      z
        .object({
          id: z.string(),
          revision: z.number().int().positive(),
          verify: z.boolean().optional(),
        })
        .strict(),
      async ({ id, revision, verify }, requestSignal) => {
        const journey = await resolve(id, revision);
        const context = guard();
        if (journey.status !== 'available') {
          service.actor(input.attempt.id, input.agent.id);
          if (!verify) throw new Error('Un brouillon exige verify:true.');
        }
        await interaction(
          `Rejouer ${journey.title} r${journey.revision}, ${journey.steps.length} étapes.`,
          requestSignal,
        );
        guard(requestSignal);
        const run = await service.replay(journey, context.selection.parameters, {
          mode: verify
            ? 'verify'
            : context.selection.intent === 'reproduce'
              ? 'reproduce'
              : 'reach',
          prerequisitesConfirmed: context.selection.prerequisitesConfirmed,
          binding: context.binding,
        });
        await callbacks.onNavigationRun?.(run);
        return run;
      },
    ),
    tool(
      'studio_navigation_contribute',
      'Submit an observation to the Navigator; never edits the canonical journey.',
      z
        .object({
          journeyId: z.string(),
          revision: z.number().int().positive(),
          observation: z.string().min(1).max(4000),
          proposal: z.string().max(4000).optional(),
        })
        .strict(),
      async (args) => {
        const journey = await service.store.revision(args.journeyId, args.revision);
        if (journey?.applicationId !== appId) throw new Error('Parcours hors contexte.');
        await service.store.contribute({
          ...args,
          id: randomUUID(),
          attemptId: input.attempt.id,
          author: input.agent.id,
          status: 'pending',
          createdAt: new Date().toISOString(),
        });
        service.publish();
        return { saved: true };
      },
    ),
    tool(
      'studio_browser_inspect',
      'Read a bounded DOM, styles, network metadata or source inspection. No response bodies or arbitrary JavaScript.',
      z
        .object({
          target: navigationLocatorSchema.optional(),
          category: z.enum(['dom', 'styles', 'network', 'sources']).optional(),
          offset: z.number().int().nonnegative().optional(),
        })
        .strict(),
      async (args) => {
        service.assertBrowser(appId);
        return service.inspect(args, guard());
      },
    ),
    tool(
      'studio_browser_act',
      'Execute one declarative browser action in the selected application. All interactions require host authority; effect labels grant no permission.',
      navigationStepSchema,
      async (step: NavigationStep, requestSignal) => {
        await interaction(JSON.stringify(step), requestSignal);
        guard(requestSignal);
        const key = JSON.stringify(step);
        const count = (repeats.get(key) ?? 0) + 1;
        repeats.set(key, count);
        if (count > 2)
          throw new Error(
            'Même action répétée sans nouvelle information. Inspecte l’état et demande une précision.',
          );
        return service.browser.act(step, guard().selection.parameters);
      },
    ),
    tool(
      'studio_browser_capture',
      'Collect a verified private screenshot receipt. Does not infer success or transmit image pixels to the model.',
      z.object({}).strict(),
      async () => {
        service.assertBrowser(appId);
        const capture = await service.capture(guard(), input.attempt.id);
        const { previewUrl: _, ...receipt } = capture;
        await callbacks.onNavigationCapture?.(receipt);
        return receipt;
      },
    ),
    tool(
      'studio_browser_sources',
      'Search a targeted literal hint in an authorized repository and retain hashed candidate anchors.',
      z
        .object({
          query: z.string().min(2).max(200),
          projectId: z.string(),
          directory: z.string().max(1000).optional(),
        })
        .strict(),
      async ({ query, projectId, directory }) => {
        const context = guard();
        const project =
          input.projects?.find((p) => p.id === projectId) ??
          (context.binding?.projectIds.includes(projectId)
            ? { id: projectId, path: input.workspacePath }
            : undefined);
        if (!project || !context.application.projectIds.includes(projectId))
          throw new Error('Dépôt hors contexte.');
        const result = await service.anchors.search(appId, project, query, directory, signal);
        service.publish();
        return result;
      },
    ),
  ];
  const viewSchema = z.object({ captureId: z.string().min(1).max(200) }).strict();
  tools.push({
    name: 'studio_browser_view_capture',
    description:
      'Explicitly send one already captured image to the selected vision model for visual analysis. Maximum four per attempt; prefer bounded DOM/style inspection when enough. This is separate from collecting a proof receipt.',
    parameters: z.toJSONSchema(viewSchema),
    skipPermission: true,
    defer: 'never',
    handler: async (raw, invocation) => {
      try {
        const requestSignal = invocation.signal
          ? AbortSignal.any([signal, invocation.signal])
          : signal;
        requestSignal.throwIfAborted();
        guard();
        if (callbacks.navigationBlocked?.()) throw new Error('Contexte de navigation à compléter.');
        if (!callbacks.validateModelImages)
          throw new Error('La compatibilité visuelle du modèle doit être vérifiée par le runtime.');
        if (imagesSent >= IMAGE_LIMITS.count)
          throw new Error('Budget de captures envoyées au modèle atteint (4 par tentative).');
        const { captureId } = viewSchema.parse(raw);
        const capture = service
          .snapshot()
          .captures?.find(
            (item) =>
              item.id === captureId &&
              item.applicationId === appId &&
              item.attemptId === input.attempt.id,
          );
        if (!capture) throw new Error('Capture introuvable dans cette tentative.');
        if (capture.bytes > IMAGE_LIMITS.bytes)
          throw new Error(
            'Capture trop volumineuse pour le modèle (2 Mio maximum). Réduis le viewport puis reprends une capture.',
          );
        const bytes = await service.verifiedCapture(capture);
        const images = validateImages([
          {
            id: capture.id,
            name: 'navigation.png',
            mimeType: 'image/png',
            data: bytes.toString('base64'),
          },
        ]);
        callbacks.validateModelImages(images);
        requestSignal.throwIfAborted();
        guard();
        imagesSent++;
        callbacks.onEvent({
          id: randomUUID(),
          at: new Date().toISOString(),
          kind: 'tool',
          message: `studio_browser_view_capture : capture ${capture.id} envoyée à la demande (${imagesSent}/${IMAGE_LIMITS.count}).`,
        });
        return {
          resultType: 'success',
          textResultForLlm: JSON.stringify({
            captureId: capture.id,
            sha256: capture.sha256,
            observationOnly: true,
          }),
          binaryResultsForLlm: [
            {
              type: 'image',
              mimeType: 'image/png',
              data: images[0].data,
              description: 'Observation privée de l’application, sans validation implicite.',
            },
          ],
        };
      } catch (error) {
        return { resultType: 'failure', textResultForLlm: (error as Error).message };
      }
    },
  });
  if (input.navigation.application.ownerNavigatorId === input.agent.id)
    tools.push(
      tool(
        'studio_navigation_propose',
        'Navigator only: save a draft revision. Imported/page authorship is ignored.',
        z
          .object({
            journey: navigationJourneySchema,
            expectedRevision: z.number().int().nonnegative(),
          })
          .strict(),
        async ({ journey, expectedRevision }) => {
          if (journey.applicationId !== appId) throw new Error('Application hors contexte.');
          const result = await service.store.saveDraft(
            journey,
            expectedRevision,
            service.actor(input.attempt.id, input.agent.id),
          );
          service.publish();
          return result;
        },
      ),
      tool(
        'studio_navigation_commit',
        'Navigator only: publish a draft using a successful host replay of the same definition.',
        z
          .object({
            journeyId: z.string(),
            expectedRevision: z.number().int().positive(),
            runId: z.string(),
          })
          .strict(),
        async ({ journeyId, expectedRevision, runId }) => {
          const result = await service.store.commit(
            journeyId,
            expectedRevision,
            runId,
            service.actor(input.attempt.id, input.agent.id),
          );
          service.publish();
          return result;
        },
      ),
    );
  return tools;
}
