import { navigationEvaluationCommandSchema } from './navigationEvaluationSchemas';
import { z } from 'zod';
import { NAVIGATION_LIMITS } from '../shared/navigation';

const text = z.string().max(NAVIGATION_LIMITS.stringChars);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const timestamp = z.string().datetime();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
/** Detect credential-bearing URLs before they enter storage, prompts or exports. No value is logged. */
export function hasSensitiveNavigationUrl(value: string): boolean {
  const decode = (input: string): string => {
    let result = input;
    for (let count = 0; count < 3; count++) {
      try {
        const next = decodeURIComponent(result.replace(/\+/g, ' '));
        if (next === result) break;
        result = next;
      } catch {
        break;
      }
    }
    return result;
  };
  const sensitiveKey = (key: string) => {
    const normalized = decode(key)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    return (
      /^(?:password|passwd|pwd|passphrase|token|accesstoken|refreshtoken|idtoken|apikey|authorization|auth|secret|clientsecret|code|oauthcode|sessionid|sessiontoken|jwt|bearer|credential|credentials|samlresponse|samlrequest)$/.test(
        normalized,
      ) || /(?:password|passwd|secret|token|apikey|authorization|credential)$/.test(normalized)
    );
  };
  const containsPairs = (input: string) => {
    const decoded = decode(input);
    return decoded.split(/[?&#;]+/).some((part) => {
      const equal = part.indexOf('=');
      if (equal >= 0 && sensitiveKey(part.slice(0, equal))) return true;
      const match = /^(?:\/?)([^:=/\s]+)[:/\s]+(.+)$/.exec(part);
      return Boolean(match && sensitiveKey(match[1]));
    });
  };
  try {
    if (!value || value.length > NAVIGATION_LIMITS.stringChars) return true;
    const url = new URL(value, 'http://localhost');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return true;
    if (containsPairs(url.search) || containsPairs(url.hash)) return true;
    for (const [key, raw] of url.searchParams) {
      if (sensitiveKey(key)) return true;
      // Nested redirect URLs may themselves contain a callback credential.
      if (/[?&#=]/.test(decode(raw)) && containsPairs(raw)) return true;
    }
    const fragment = decode(url.hash.slice(1));
    if (
      /^(?:Bearer\s+|(?:access[_-]?token|id[_-]?token|token|password|secret)[_:-])/i.test(fragment)
    )
      return true;
    if (/^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(fragment)) return true;
    // Opaque credentials in a bare fragment cannot be safely classified as a display anchor.
    if (
      /^[A-Za-z0-9_-]{32,}$/.test(fragment) &&
      /[A-Za-z]/.test(fragment) &&
      /[0-9]/.test(fragment)
    )
      return true;
    return false;
  } catch {
    return true;
  }
}
export function isNavigationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      Boolean(url.hostname) &&
      !url.hostname.includes('*')
    );
  } catch {
    return false;
  }
}
export const navigationOriginSchema = text
  .trim()
  .refine((value) => {
    if (!isNavigationUrl(value)) return false;
    const url = new URL(value);
    return url.pathname === '/' && !url.search && !url.hash;
  }, 'Une adresse HTTP ou HTTPS sans chemin, paramètres ni identifiants est requise (ex. https://mon-application.fr).')
  .transform((value) => new URL(value).origin);
const origin = text.refine(
  (value) => isNavigationUrl(value) && new URL(value).origin === value,
  'Une origine HTTP ou HTTPS explicite sans chemin est requise.',
);
const applicationUrl = text
  .trim()
  .refine(isNavigationUrl, 'Une URL HTTP ou HTTPS complète est requise.')
  .refine(
    (value) => !hasSensitiveNavigationUrl(value),
    'URL sensible ou invalide : utiliser la connexion manuelle.',
  );
export const navigationActorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('human') }).strict(),
  z
    .object({ kind: z.literal('navigator'), agentId: id, attemptId: id, applicationId: id })
    .strict(),
]);
export const navigationLocatorSchema = z
  .object({
    strategy: z.enum(['testId', 'role', 'label', 'text', 'css']),
    value: text.min(1),
    name: text.optional(),
    frame: text.optional(),
    tab: z.number().int().min(0).max(20).optional(),
  })
  .strict();
export const navigationConditionSchema = z
  .object({
    kind: z.enum(['visible', 'hidden', 'text', 'url']),
    target: navigationLocatorSchema.optional(),
    value: text.optional(),
  })
  .strict()
  .superRefine((condition, ctx) => {
    if (condition.kind !== 'url' && !condition.target)
      ctx.addIssue({ code: 'custom', message: 'La condition exige une cible.' });
    if (['text', 'url'].includes(condition.kind) && !condition.value)
      ctx.addIssue({ code: 'custom', message: 'La condition exige une valeur.' });
    if (condition.kind === 'url' && condition.value && hasSensitiveNavigationUrl(condition.value))
      ctx.addIssue({
        code: 'custom',
        message: 'URL de condition sensible ou invalide : utiliser la connexion manuelle.',
      });
  });
export const navigationValueSchema = z.union([
  z.object({ literal: text }).strict(),
  z.object({ parameter: id }).strict(),
]);
export const navigationStepSchema = z
  .object({
    id,
    action: z.enum([
      'navigate',
      'click',
      'fill',
      'select',
      'check',
      'press',
      'scroll',
      'viewport',
      'wait',
      'manual',
    ]),
    target: navigationLocatorSchema.optional(),
    url: text.optional(),
    value: navigationValueSchema.optional(),
    key: text.optional(),
    checked: z.boolean().optional(),
    x: z.number().finite().min(-100000).max(100000).optional(),
    y: z.number().finite().min(-100000).max(100000).optional(),
    width: z.number().int().min(240).max(7680).optional(),
    height: z.number().int().min(200).max(4320).optional(),
    note: text.optional(),
    timeoutMs: z.number().int().min(1).max(NAVIGATION_LIMITS.stepTimeoutMs).optional(),
    postconditions: z.array(navigationConditionSchema).max(20).optional(),
    effect: z.enum(['read', 'write', 'unknown']).optional(),
  })
  .strict()
  .superRefine((step, ctx) => {
    const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (['click', 'fill', 'select', 'check', 'press'].includes(step.action) && !step.target)
      invalid('Action sans cible.');
    if (
      step.action === 'navigate' &&
      (!step.url ||
        !((step.url.startsWith('/') && !step.url.startsWith('//')) || isNavigationUrl(step.url)))
    )
      invalid('La navigation exige une URL HTTP ou HTTPS ou un chemin relatif à l’origine.');
    if (step.url && hasSensitiveNavigationUrl(step.url))
      invalid('URL sensible ou invalide : utiliser la connexion manuelle.');
    if (['fill', 'select'].includes(step.action) && !step.value)
      invalid('Valeur ou paramètre requis.');
    if (step.action === 'check' && step.checked === undefined) invalid('État de case requis.');
    if (
      step.action === 'press' &&
      (!step.key ||
        !/^(Enter|Tab|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Backspace|Delete|Space)$/.test(
          step.key,
        ))
    )
      invalid('Touche non prise en charge.');
    if (step.action === 'viewport' && (!step.width || !step.height))
      invalid('Dimensions requises.');
    if (step.action === 'scroll' && step.x === undefined && step.y === undefined)
      invalid('Déplacement requis.');
    if (step.action === 'wait' && !step.postconditions?.length) invalid('Attente sans condition.');
    if (step.action === 'manual' && !step.note) invalid('Étape manuelle sans explication.');
  });
export const applicationProfileSchema = z
  .object({
    id,
    name: text.min(1),
    projectIds: z.array(id).max(30),
    origin: applicationUrl,
    startUrl: applicationUrl.optional(),
    allowedOrigins: z
      .array(applicationUrl.transform((value) => new URL(value).origin))
      .min(1)
      .max(20),
    authenticationOrigins: z
      .array(
        text.url().refine((value) => {
          const url = new URL(value);
          return (
            url.protocol === 'https:' && !url.username && !url.password && url.origin === value
          );
        }, 'Origine HTTPS explicite requise.'),
      )
      .max(10)
      .optional(),
    ownerNavigatorId: id.optional(),
    role: text.optional(),
    authInstructions: text.optional(),
    interactionPolicy: z.enum(['inspect', 'confirm', 'authorized']),
    browserExecutable: text.optional(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
  .transform((app) => {
    const origin = new URL(app.origin).origin;
    const startUrl = app.startUrl ?? (app.origin !== origin ? app.origin : undefined);
    return {
      ...app,
      origin,
      allowedOrigins: [...new Set(app.allowedOrigins)],
      ...(startUrl ? { startUrl: new URL(startUrl).href } : {}),
    };
  })
  .refine(
    (app) => app.allowedOrigins.includes(app.origin),
    'L’origine de l’application doit être autorisée.',
  )
  .refine(
    (app) => !app.startUrl || new URL(app.startUrl).origin === app.origin,
    'L’URL de démarrage doit appartenir au site de l’application.',
  );
export const navigationParameterSchema = z
  .object({
    name: id,
    label: text.min(1),
    type: z.enum(['string', 'number', 'boolean']),
    required: z.boolean(),
    sensitive: z.boolean().optional(),
    defaultValue: text.optional(),
  })
  .strict()
  .refine(
    (parameter) => !parameter.sensitive || parameter.defaultValue === undefined,
    'Un paramètre sensible ne peut avoir de valeur persistée.',
  );
export const navigationJourneySchema = z
  .object({
    id,
    applicationId: id,
    revision: z.number().int().min(0),
    hash: hash.optional(),
    parentHash: hash.optional(),
    title: text.min(1),
    intent: text.min(1),
    tags: z.array(text).max(40),
    prerequisites: z.array(text.min(1)).max(40),
    parameters: z.array(navigationParameterSchema).max(40),
    steps: z.array(navigationStepSchema).max(NAVIGATION_LIMITS.steps),
    arrival: z.array(navigationConditionSchema).max(30),
    status: z.enum(['draft', 'available', 'archived']),
    provenance: z
      .object({
        mode: z.enum(['description', 'import', 'demonstration', 'human']),
        source: text.optional(),
        notes: text.optional(),
        author: navigationActorSchema.optional(),
        verifiedRunId: id.optional(),
      })
      .strict(),
    variantOf: id.optional(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
  .superRefine((journey, ctx) => {
    if (new Set(journey.steps.map((step) => step.id)).size !== journey.steps.length)
      ctx.addIssue({ code: 'custom', message: 'Identifiants d’étapes dupliqués.' });
    const parameters = new Set(journey.parameters.map((parameter) => parameter.name));
    if (parameters.size !== journey.parameters.length)
      ctx.addIssue({ code: 'custom', message: 'Paramètres dupliqués.' });
    for (const step of journey.steps)
      if (step.value && 'parameter' in step.value && !parameters.has(step.value.parameter))
        ctx.addIssue({ code: 'custom', message: `Paramètre inconnu : ${step.value.parameter}` });
    if (
      journey.status === 'available' &&
      (!journey.steps.length ||
        !journey.arrival.length ||
        journey.steps.some((step) => step.action === 'manual'))
    )
      ctx.addIssue({ code: 'custom', message: 'Parcours disponible incomplet ou manuel.' });
  });
export const executionBindingSchema = z
  .object({
    applicationId: id,
    origin,
    projectIds: z.array(id).max(30),
    roots: z.array(text).max(30),
    worktree: text.optional(),
    commit: text.optional(),
    dirty: z.boolean().optional(),
    verification: z.enum(['declared', 'verified', 'unknown']),
    reason: text,
    build: text.optional(),
  })
  .strict();
export const navigationRunSchema = z
  .object({
    id,
    journeyId: id,
    revision: z.number().int().min(1),
    definitionHash: hash,
    applicationId: id,
    mode: z.enum(['reach', 'reproduce', 'verify']),
    status: z.enum(['running', 'succeeded', 'failed', 'interrupted']),
    startedAt: timestamp,
    finishedAt: timestamp.optional(),
    arrivalVerified: z.boolean(),
    prerequisitesConfirmed: z.boolean(),
    binding: executionBindingSchema,
    events: z
      .array(
        z
          .object({
            stepId: id,
            status: z.enum(['succeeded', 'failed', 'interrupted']),
            message: text.optional(),
            at: timestamp,
          })
          .strict(),
      )
      .max(200),
    evidencePaths: z.array(text).max(80),
    error: text.optional(),
    metrics: z
      .object({
        actions: z.number().int().min(0),
        durationMs: z.number().min(0),
        outputChars: z.number().int().min(0),
        providerCalls: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();
export const navigationContributionSchema = z
  .object({
    id,
    journeyId: id,
    revision: z.number().int().min(1),
    observation: text.min(1),
    proposal: text.optional(),
    attemptId: id.optional(),
    author: text.min(1),
    status: z.enum(['pending', 'accepted', 'dismissed']),
    createdAt: timestamp,
  })
  .strict();
export const navigationSelectionSchema = z
  .object({
    applicationId: id,
    journeyId: id.optional(),
    revision: z.number().int().min(1).optional(),
    parameters: z.record(id, text),
    intent: z.enum(['reach-state', 'reproduce']),
    allowInteractions: z.boolean(),
    prerequisitesConfirmed: z.boolean().optional(),
  })
  .strict();
const command = <T extends string>(action: T) => z.object({ action: z.literal(action) }).strict();
export const navigationCommandSchema = z.discriminatedUnion('action', [
  ...navigationEvaluationCommandSchema.options,
  command('load'),
  command('authenticate'),
  command('resumeControl'),
  command('exportMetrics'),
  z.object({ action: z.literal('history'), journeyId: id }).strict(),
  z
    .object({
      action: z.literal('sourceSearch'),
      query: text.min(1),
      projectId: id.optional(),
      directory: text.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('resolveContribution'),
      id,
      status: z.enum(['accepted', 'dismissed']),
    })
    .strict(),
  command('recordPause'),
  command('recordResume'),
  command('recordCancel'),
  command('takeControl'),
  command('stop'),
  command('closeBrowser'),
  command('capture'),
  z
    .object({ action: z.literal('saveApplication'), application: applicationProfileSchema })
    .strict(),
  z
    .object({
      action: z.literal('saveDraft'),
      journey: navigationJourneySchema,
      expectedRevision: z.number().int().min(0),
    })
    .strict(),
  ...(['commit', 'archive'] as const).map((action) =>
    z
      .object({
        action: z.literal(action),
        journeyId: id,
        expectedRevision: z.number().int().min(1),
        runId: id.optional(),
      })
      .strict(),
  ),
  z
    .object({
      action: z.literal('import'),
      applicationId: id,
      json: z.string().max(NAVIGATION_LIMITS.importBytes),
    })
    .strict(),
  z
    .object({
      action: z.literal('describe'),
      applicationId: id,
      description: text.min(1),
      title: text.optional(),
    })
    .strict(),
  ...(['prepare', 'recordStart'] as const).map((action) =>
    z.object({ action: z.literal(action), applicationId: id }).strict(),
  ),
  z
    .object({
      action: z.literal('replay'),
      journeyId: id,
      parameters: z.record(id, text),
      mode: z.enum(['reach', 'reproduce', 'verify']),
      confirmInteractions: z.boolean(),
      prerequisitesConfirmed: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal('recordFinish'),
      title: text.min(1),
      intent: text.min(1),
      arrival: z.array(navigationConditionSchema).max(30),
    })
    .strict(),
  z.object({ action: z.literal('inspect'), target: navigationLocatorSchema.optional() }).strict(),
  z
    .object({ action: z.literal('contribute'), contribution: navigationContributionSchema })
    .strict(),
  z.object({ action: z.literal('export'), journeyId: id }).strict(),
  z.object({ action: z.literal('openSource'), relativePath: text.min(1), projectId: id }).strict(),
]);
/** Reject oversized/deep JSON before walking it; imported values never execute code. */
export function parseNavigationJson(input: string): unknown {
  if (Buffer.byteLength(input, 'utf8') > NAVIGATION_LIMITS.importBytes)
    throw new Error('Import trop volumineux (2 Mio maximum).');
  const value: unknown = JSON.parse(input);
  let nodes = 0;
  const inspect = (entry: unknown, depth: number): void => {
    if (++nodes > 20000 || depth > NAVIGATION_LIMITS.depth)
      throw new Error('Structure JSON trop complexe.');
    if (typeof entry === 'string' && entry.length > NAVIGATION_LIMITS.stringChars)
      throw new Error('Chaîne JSON trop longue.');
    if (entry && typeof entry === 'object')
      for (const [key, child] of Object.entries(entry)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key))
          throw new Error('Clé JSON interdite.');
        inspect(child, depth + 1);
      }
  };
  inspect(value, 0);
  return value;
}

export const navigationContextSnapshotSchema = z
  .object({
    selection: navigationSelectionSchema,
    journey: navigationJourneySchema.optional(),
    application: applicationProfileSchema,
    binding: executionBindingSchema.optional(),
    contextText: z.string().max(NAVIGATION_LIMITS.contextChars),
    digest: hash,
  })
  .strict();
export const navigationCaptureSchema = z
  .object({
    role: text.optional(),
    binding: executionBindingSchema.optional(),
    browser: text.optional(),
    id,
    path: text.min(1),
    sha256: hash,
    bytes: z
      .number()
      .int()
      .min(1)
      .max(16 * 1024 * 1024),
    url: text,
    createdAt: timestamp,
    applicationId: id,
    journeyId: id.optional(),
    revision: z.number().int().min(1).optional(),
    attemptId: id.optional(),
    viewport: z
      .object({ width: z.number().int().positive(), height: z.number().int().positive() })
      .strict()
      .optional(),
  })
  .strict();
