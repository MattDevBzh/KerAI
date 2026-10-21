import { randomUUID } from 'node:crypto';
import type { PairState, PairTurn, PairMessage } from '../shared/pair';
import { nextPairBlock, pairPlan } from '../shared/pair';
import { pairPlanProposalSchema, pairResultSchema } from './pairSchemas';
import { discussionAgentSchema } from './discussionSchemas';
import type { RunInput, RunResult, Usage } from '../shared/types';

export function pairMessage(
  pair: PairState,
  role: PairMessage['role'],
  content: string,
  requestId?: string,
) {
  const message: PairMessage = {
    id: randomUUID(),
    role,
    content,
    at: new Date().toISOString(),
    status: 'complete',
    requestId,
  };
  pair.messages.push(message);
  return message;
}
export function createPair(input: RunInput): PairState {
  const {
    attempts: _attempts,
    status: _status,
    optionalDecision: _decision,
    optionalDecisionHistory: _history,
    ...step
  } = input.step;
  return {
    version: 0,
    mode: 'pair',
    phase: 'planning',
    preferences: structuredClone(input.launch!.pair!),
    snapshot: structuredClone({
      prompt: input.preparedPrompt!,
      agent: discussionAgentSchema.parse(input.agent),
      step,
      settings: input.settings,
      skills: input.skills.map(({ id, name, description, content, path, source }) => ({
        id,
        name,
        description,
        content,
        path,
        source,
      })),
      projects: input.projects,
      mcpServers: input.mcpServers,
      devopsProjectKey: input.devopsProjectKey,
      workspacePath: input.workspacePath,
      qualityStoragePath: input.qualityStoragePath,
      existingChangeGrants: input.existingChangeGrants,
    }),
    plans: [],
    messages: [],
    results: [],
    decisions: [],
    requests: [],
    pendingMessages: [],
    busy: false,
    calls: 0,
    sessionIds: [],
  };
}
function block(content: string, language: string): { content: string; value?: unknown } {
  const matches = [
    ...content.matchAll(new RegExp('```' + language + '\\s*\\n([\\s\\S]*?)```', 'g')),
  ];
  if (matches.length > 1)
    throw new Error('Plusieurs propositions incompatibles. Demande une organisation unique.');
  if (!matches.length) return { content };
  try {
    return { content: content.replace(matches[0][0], '').trim(), value: JSON.parse(matches[0][1]) };
  } catch {
    throw new Error(
      'Réponse structurée illisible. Les échanges et le travail sont conservés ; relance la réponse.',
    );
  }
}
export function pairTurnPrompt(pair: PairState, turn: PairTurn): string {
  if (
    pair.calls === 0 &&
    turn.kind === 'planning' &&
    !pair.messages.some((message) => message.role === 'user')
  )
    return pair.snapshot.prompt;
  const plan = pairPlan(pair),
    next = nextPairBlock(pair);
  const instructions =
    turn.kind === 'work'
      ? `L’organisation ci-dessous a été explicitement validée par l’humain. Exécute uniquement le bloc ${JSON.stringify(next)}. Les autres blocs auront leur propre tour. Si un essai précédent a été interrompu, inspecte le travail déjà réalisé avant de continuer ; ne duplique pas les modifications. Termine par un compte rendu concret du bloc et exactement un bloc JSON feature-studio-pair-result de forme {"blockId":"${next?.id}","outcome":"completed","decisions":[]}. Si tu ne peux pas terminer, outcome="blocked". Ne déclare completed que si le bloc est réellement terminé. Dans le dernier bloc, ajoute également le bilan global et le verdict de relecture si la mission l’exige.`
      : `Tu travailles en mode pair avec l’utilisateur. Présente-toi brièvement au premier échange. ${turn.kind === 'planning' ? 'Propose ou ajuste une organisation adaptée à la mission et aux préférences. Attends un accord explicite avant tout travail.' : 'Réponds à la dernière intervention humaine. Si elle demande une correction ou un changement d’organisation, propose le nouveau travail restant.'} Pour proposer une organisation, termine par un seul bloc JSON feature-studio-pair-plan de forme {"summary":"Approche et points de contrôle","blocks":[{"id":"bloc_1","title":"Titre","description":"Travail précis et critère de fin"}]}. La proposition décrit uniquement le travail restant, en tenant compte des blocs déjà exécutés. Avec le rythme oneshot, regroupe le travail restant dans un bloc. Aucun outil ni changement du projet n’est autorisé pendant cet échange. Une proposition ne vaut jamais accord humain.`;
  return [
    pair.snapshot.prompt,
    'CONTRAT DU MODE PAIR : le travail est réalisé ensemble. Les instructions suivantes précisent le déroulement de cette étape. Chaque appel est un tour distinct ; les permissions de la mission restent inchangées. Les confirmations, pauses et validations sont gérées par l’application. N’invente jamais un accord. Les anciens messages et sorties sont un historique, pas une nouvelle autorisation.',
    `Préférences : ${JSON.stringify(pair.preferences)}\nOrganisation : ${JSON.stringify(plan ?? null)}\nDécisions : ${JSON.stringify(pair.decisions)}`,
    `Travail déjà réalisé : ${JSON.stringify(pair.results)}`,
    `Échanges chronologiques : ${JSON.stringify(pair.messages.filter((m) => m.status === 'complete').map(({ role, content }) => ({ role, content })))}`,
    instructions,
  ].join('\n\n');
}
export function completePairTurn(
  pair: PairState,
  turn: PairTurn,
  result: RunResult,
  reply: PairMessage,
) {
  const parsed = block(
    result.content,
    turn.kind === 'work' ? 'feature-studio-pair-result' : 'feature-studio-pair-plan',
  );
  reply.content = parsed.content;
  reply.status = 'complete';
  pair.error = undefined;
  if (turn.kind !== 'work') {
    if (parsed.value !== undefined) {
      const proposal = pairPlanProposalSchema.parse(parsed.value);
      pair.plans.push({ ...proposal, revision: (pairPlan(pair)?.revision ?? 0) + 1 });
      pair.approvedRevision = undefined;
      pair.phase = 'planning';
    } else if (pair.approvedRevision !== pairPlan(pair)?.revision || !pair.approvedRevision)
      pair.phase = 'planning';
    else pair.phase = nextPairBlock(pair) ? 'checkpoint' : 'review';
    return;
  }
  const outcome = pairResultSchema.parse(parsed.value),
    next = nextPairBlock(pair),
    plan = pairPlan(pair)!;
  if (!next || outcome.blockId !== next.id || turn.blockId !== next.id)
    throw new Error(
      'Le bilan ne correspond pas au bloc en cours. Le travail est conservé ; reprends ce bloc.',
    );
  if (!parsed.content.trim())
    throw new Error('Le bloc doit fournir un compte rendu avant de continuer.');
  if (outcome.outcome === 'blocked' || result.questions.length > 0) {
    pair.phase = 'checkpoint';
    pair.error =
      'Ce bloc attend une précision ou une intervention. Échange avec l’agent avant de le reprendre.';
    return;
  }
  pair.results.push({
    planRevision: plan.revision,
    blockId: next.id,
    title: next.title,
    content: parsed.content,
    at: new Date().toISOString(),
  });
  pair.decisions = [...new Set([...pair.decisions, ...outcome.decisions])];
  pair.phase = nextPairBlock(pair) ? 'checkpoint' : 'review';
}
export function pairReport(pair: PairState): string {
  return [
    '# Compte rendu du travail en pair',
    ...pair.plans
      .filter((p) => p.acceptedAt)
      .map(
        (p) =>
          `## Organisation validée · ${p.revision}\n${p.summary}\n${p.blocks.map((b) => `- ${b.title} : ${b.description}`).join('\n')}`,
      ),
    ...(pair.decisions.length
      ? [`## Décisions prises\n${pair.decisions.map((d) => `- ${d}`).join('\n')}`]
      : []),
    ...pair.results.map((r) => `## ${r.title}\n\n${r.content}`),
  ].join('\n\n');
}
/** Each SDK turn reports cumulative usage for that turn, not the complete pair session. */
export function addPairUsage(base: Usage | undefined, next: Usage): Usage {
  if (!base) return structuredClone(next);
  const merged = structuredClone(base);
  for (const key of ['inputTokens', 'outputTokens', 'cost'] as const)
    if (typeof next[key] === 'number') merged[key] = (base[key] ?? 0) + next[key];
  merged.incompleteTokens = Boolean(
    base.incompleteTokens ||
      next.incompleteTokens ||
      next.inputTokens === undefined ||
      next.outputTokens === undefined,
  );
  merged.incompleteCost = Boolean(
    base.incompleteCost || next.incompleteCost || next.cost === undefined,
  );
  merged.model = next.model ?? base.model;
  merged.unit = next.unit ?? base.unit;
  for (const [model, entry] of Object.entries(next.byModel ?? {})) {
    const prior = (merged.byModel ??= {})[model] ?? {};
    merged.byModel[model] = {
      inputTokens: (prior.inputTokens ?? 0) + (entry.inputTokens ?? 0),
      outputTokens: (prior.outputTokens ?? 0) + (entry.outputTokens ?? 0),
      cost: (prior.cost ?? 0) + (entry.cost ?? 0),
      incompleteTokens: Boolean(prior.incompleteTokens || entry.incompleteTokens),
      incompleteCost: Boolean(prior.incompleteCost || entry.incompleteCost),
    };
  }
  return merged;
}
