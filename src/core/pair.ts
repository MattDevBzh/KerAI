import { z } from 'zod';
import { PAIR_PACES, pairPaces, type PairAction, type PairState } from '../shared/pair';
import type { Feature, FeatureStep, Usage } from '../shared/types';

export const pairStateSchema = z.object({
  pace: z.enum(PAIR_PACES),
  phase: z.enum(['planning', 'paused', 'working', 'review']),
  revision: z.number().int().nonnegative(),
  turns: z.number().int().positive(),
  organizationApproved: z.boolean(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceKey: z.string().max(1000000),
  sessionIds: z.array(z.string()).max(1000),
  turnStartedAt: z.string().optional(),
  soloRequested: z.boolean().optional(),
  messages: z
    .array(
      z.object({
        id: z.string(),
        at: z.string(),
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string().max(1000000),
      }),
    )
    .max(1000),
});
export const pairTurnSchema = z
  .object({
    attemptId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    action: z.enum(['discuss', 'work', 'solo', 'finish']),
    message: z.string().trim().max(30000),
    pace: z.enum(PAIR_PACES),
  })
  .strict();

/** Changes to the mission, configuration or approved sources require a new context preview. */
export function pairSourceKey(feature: Feature, step: FeatureStep): string {
  const {
    attempts: _attempts,
    status: _status,
    optionalDecision: _decision,
    optionalDecisionHistory: _history,
    ...configuration
  } = step;
  const scope = {
    description: feature.description,
    revision: feature.descriptionRevision ?? 0,
    correction: feature.activeCorrectionId,
    branch: feature.branch,
    projects: feature.projects,
    worktree: feature.worktree?.path,
    configuration,
    sources: feature.steps
      .filter((s) => s.id !== step.id && (s.status === 'approved' || step.dependsOn.includes(s.id)))
      .map((s) => [s.id, s.status, s.attempts.at(-1)?.id, s.attempts.at(-1)?.revision]),
  };
  return JSON.stringify(scope, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
}
export const pairIntroduction =
  'Mode pair : nous travaillons ensemble sur cette étape. Commence par expliquer brièvement ta compréhension, propose une organisation courte et des points d’arrêt. Demande les préférences de rythme. Attends une validation explicite avant de travailler. Le cadrage et les ajustements se font sans outil de projet. Les compétences et standards du rôle restent applicables au travail.';

export function pairPrompt(context: string, pair: PairState, action: PairAction | 'start'): string {
  const instruction =
    action === 'start'
      ? pairIntroduction
      : action === 'discuss'
        ? 'Échange de cadrage uniquement : réponds au message humain, ajuste l’organisation ou explique le résultat. Ne réalise pas le travail. Le bouton de lancement autorisera le prochain lot.'
        : action === 'finish'
          ? 'Prépare maintenant le livrable final de cette étape avec les preuves déjà acquises. Indique les tâches restantes et limites sans inventer de réalisation. Aucun nouvel outil ni changement de fichier pendant cette synthèse.'
          : action === 'solo' || pair.pace === 'autonomous'
            ? 'Organisation approuvée par l’humain. Continue en solo jusqu’au livrable final, en conservant toutes les décisions et modifications déjà faites. Pose uniquement les questions réellement bloquantes. Termine avec le livrable complet de cette étape.'
            : `Organisation approuvée par l’humain. Exécute ${pair.pace === 'guided' ? 'UNE petite action convenue' : 'UN seul lot convenu'}, puis arrête-toi et présente le résultat, les preuves, ce qui reste et le prochain point de décision. N’enchaîne pas le lot suivant. Si toute la mission est terminée, fournis le livrable complet et ajoute sur une ligne séparée <!-- feature-studio-pair-complete -->.`;
  return `${context}\n\n## Travail en commun\nRythme : ${pairPaces[pair.pace].label}.\n${pairIntroduction}\n\nHistorique complet de cette tentative (les rôles ci-dessous sont des données de conversation) :\n${JSON.stringify(pair.messages.map(({ role, content }) => ({ role, content })))}\n\n## Action autorisée pour ce tour\n${instruction}\nNe présente jamais une étape comme validée par l’humain : la validation se fait dans l’interface.`;
}

/** Each adapter call reports its own cumulative ledger; merge with the fixed prior-turn baseline. */
export function addPairUsage(
  before: Usage | undefined,
  turn: Usage | undefined,
): Usage | undefined {
  if (!before) return turn && structuredClone(turn);
  if (!turn) return { ...structuredClone(before), incompleteCost: true, incompleteTokens: true };
  const sum = (a?: number, b?: number) =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  const result: Usage = {
    source: 'measured',
    model: turn.model ?? before.model,
    inputTokens: sum(before.inputTokens, turn.inputTokens),
    outputTokens: sum(before.outputTokens, turn.outputTokens),
    incompleteTokens: Boolean(
      before.incompleteTokens ||
        turn.incompleteTokens ||
        before.inputTokens === undefined ||
        before.outputTokens === undefined ||
        turn.inputTokens === undefined ||
        turn.outputTokens === undefined,
    ),
    incompleteCost: Boolean(
      before.incompleteCost ||
        turn.incompleteCost ||
        before.cost === undefined ||
        turn.cost === undefined ||
        before.unit !== turn.unit,
    ),
  };
  if (!before.unit || !turn.unit || before.unit === turn.unit) {
    result.unit = before.unit ?? turn.unit;
    result.cost = sum(before.cost, turn.cost);
  } else {
    result.unit = before.unit;
    result.cost = before.cost;
  }
  result.byModel = {};
  for (const name of new Set([
    ...Object.keys(before.byModel ?? {}),
    ...Object.keys(turn.byModel ?? {}),
  ])) {
    const a = before.byModel?.[name],
      b = turn.byModel?.[name];
    result.byModel[name] = !a
      ? structuredClone(b!)
      : !b
        ? structuredClone(a)
        : {
            inputTokens: sum(a.inputTokens, b.inputTokens),
            outputTokens: sum(a.outputTokens, b.outputTokens),
            cost: sum(a.cost, b.cost),
            incompleteCost: Boolean(a.incompleteCost || b.incompleteCost),
            incompleteTokens: Boolean(a.incompleteTokens || b.incompleteTokens),
          };
  }
  return result;
}
