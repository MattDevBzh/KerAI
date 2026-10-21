import { z } from 'zod';
import { createPair } from './pair';
import { digest, readPrivate, sessionDirectory } from '../host/SessionFiles';
import type { RunInput } from '../shared/types';

const legacyPairSchema = z.object({
  pace: z.enum(['guided', 'batches', 'autonomous']),
  phase: z.enum(['planning', 'paused', 'working', 'review']),
  revision: z.number().int().nonnegative(),
  turns: z.number().int().positive(),
  organizationApproved: z.boolean(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceKey: z.string().max(1000000),
  sessionIds: z.array(z.string()),
  messages: z.array(
    z.object({
      id: z.string(),
      at: z.string(),
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string(),
    }),
  ),
});

/** Read the v1.19 frozen context before validating or rewriting its v6 session. */
export async function migrateLegacyPairs(value: unknown, rootPath: string): Promise<unknown> {
  const session = z
    .object({
      id: z.string(),
      steps: z.array(
        z
          .object({
            id: z.string(),
            attempts: z.array(
              z.object({ id: z.string(), pair: z.unknown().optional() }).passthrough(),
            ),
          })
          .passthrough(),
      ),
    })
    .passthrough()
    .parse(value);
  for (const step of session.steps)
    for (const attempt of step.attempts) {
      if (!attempt.pair || typeof attempt.pair !== 'object' || !('inputHash' in attempt.pair))
        continue;
      const old = legacyPairSchema.parse(attempt.pair);
      const encoded = await readPrivate(
        rootPath,
        `${sessionDirectory(session.id)}/pair-${digest(attempt.id)}.json`,
        20000000,
      );
      if (digest(encoded) !== old.inputHash)
        throw new Error('Contexte pair altéré. Original conservé.');
      const input = JSON.parse(encoded) as RunInput;
      if (
        input.feature?.id !== session.id ||
        input.step?.id !== step.id ||
        input.attempt?.id !== attempt.id
      )
        throw new Error('Identité du contexte pair incohérente. Original conservé.');
      const preferences = {
        pace: ({ guided: 'small', batches: 'blocks', autonomous: 'oneshot' } as const)[old.pace],
        explanation: 'detailed' as const,
        instructions: '',
      };
      const { pairPace: _pace, ...launch } = z
        .object({ pairPace: z.unknown().optional() })
        .passthrough()
        .parse(input.launch);
      input.launch = { ...launch, pair: preferences } as RunInput['launch'];
      const pair = createPair(input);
      pair.sourceKey = old.sourceKey;
      pair.version = old.revision + 1;
      pair.calls = old.turns;
      pair.sessionIds = old.sessionIds;
      pair.messages = old.messages.map((message) => ({ ...message, status: 'complete' }));
      // A prose agreement cannot authorize new structured blocks. Keep history and ask
      // for a fresh plan on explicit resume; completed deliverables stay reviewable.
      pair.phase = old.phase === 'review' ? 'review' : 'interrupted';
      if (pair.phase === 'interrupted')
        pair.error =
          'Conversation conservée après mise à jour. Reprends le cadrage pour convenir des blocs restants.';
      attempt.pair = pair;
      if (attempt.launch && typeof attempt.launch === 'object') {
        const { pairPace: _oldPace, ...savedLaunch } = attempt.launch as Record<string, unknown>;
        attempt.launch = { ...savedLaunch, pair: preferences };
      }
    }
  return session;
}
