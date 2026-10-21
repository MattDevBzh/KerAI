import { pairSourceKey } from './pairSource';
import { randomUUID } from 'node:crypto';
import type { PairState, PairTurn, PairMessage } from '../shared/pair';
import { nextPairBlock, pairPlan, defaultPairPreferences } from '../shared/pair';
import { usesNativeTools } from '../shared/native';
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
  const native = usesNativeTools(input),
    solo = !input.launch?.pair;
  const {
    attempts: _attempts,
    status: _status,
    optionalDecision: _decision,
    optionalDecisionHistory: _history,
    ...step
  } = input.step;
  return {
    ...(native
      ? {
          nativeConversation: true,
          origin: solo ? ('solo' as const) : ('pair' as const),
          engaged: !solo,
          nativeEventIds: [],
          deliveredMessageIds: [],
        }
      : {}),
    version: 0,
    sourceKey: pairSourceKey(input.feature, input.step),
    mode: solo ? 'solo' : 'pair',
    phase: solo ? 'working' : 'planning',
    preferences: structuredClone(input.launch?.pair ?? defaultPairPreferences),
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
  if (turn.kind === 'solo') {
    if (!pair.contextDelivered)
      return pair.calls === 0
        ? pair.snapshot.prompt
        : [
            pair.snapshot.prompt,
            'Reprise explicite après interruption : inspecte le travail existant avant toute action, sans dupliquer les modifications déjà réalisées.',
            pendingPairContext(pair),
          ].join('\n\n');
    return (
      'Reprends la mission initiale dans cette conversation. Inspecte les changements déjà réalisés avant de poursuivre, conserve les modifications humaines et ne duplique pas les actions déjà effectuées. Termine par le livrable de cette étape.\n' +
      pendingPairContext(pair)
    );
  }
  if (
    pair.calls === 0 &&
    turn.kind === 'planning' &&
    (pair.nativeConversation || !pair.messages.some((message) => message.role === 'user'))
  )
    return pair.snapshot.prompt;
  const plan = pairPlan(pair),
    next = nextPairBlock(pair);
  const finalArtifact =
    pair.nativeConversation && turn.kind === 'work' && next?.id === plan?.blocks.at(-1)?.id
      ? ' Dans ce dernier bloc, fournis le livrable complet et à jour de cette étape dans le format demandé par la mission. Intègre le travail des blocs précédents et les corrections convenues. Les explications intermédiaires restent dans le chat ; la réponse finale devient le nouveau livrable à relire.'
      : '';
  const instructions =
    turn.kind === 'work'
      ? `L’organisation ci-dessous a été explicitement validée par l’humain. Exécute uniquement le bloc ${JSON.stringify(next)}. Les autres blocs auront leur propre tour. Si un essai précédent a été interrompu, inspecte le travail déjà réalisé avant de continuer ; ne duplique pas les modifications. Termine par un compte rendu concret du bloc et exactement un bloc JSON feature-studio-pair-result de forme {"blockId":"${next?.id}","outcome":"completed","decisions":[]}. Si tu ne peux pas terminer, outcome="blocked". Ne déclare completed que si le bloc est réellement terminé. Dans le dernier bloc, ajoute également le bilan global et le verdict de relecture si la mission l’exige.`
      : `Tu travailles en mode pair avec l’utilisateur. Présente-toi brièvement au premier échange. ${turn.kind === 'planning' ? 'Propose ou ajuste une organisation adaptée à la mission et aux préférences. Attends un accord explicite avant tout travail.' : 'Réponds à la dernière intervention humaine. Une demande d’explication ne change ni l’organisation validée ni le livrable. Si elle demande une correction ou un changement d’organisation, propose le nouveau travail restant.'} Pour proposer une organisation, termine par un seul bloc JSON feature-studio-pair-plan de forme {"summary":"Approche et points de contrôle","blocks":[{"id":"bloc_1","title":"Titre","description":"Travail précis et critère de fin"}]}. La proposition décrit uniquement le travail restant, en tenant compte des blocs déjà exécutés. Avec le rythme oneshot, regroupe le travail restant dans un bloc ; avec small, propose de petites unités de travail et des retours fréquents. ${pair.nativeConversation ? 'Tu peux consulter le code avec les seuls outils natifs de lecture disponibles. Aucune édition, commande ou action MCP n’est autorisée dans cet échange.' : 'Aucun outil ni changement du projet n’est autorisé pendant cet échange.'} Une proposition ne vaut jamais accord humain.`;
  if (pair.nativeConversation && pair.contextDelivered && pair.sessionIds.length)
    return [
      'Poursuite de la même mission et de la même conversation native. Les permissions sont celles réappliquées par l’hôte. Aucun nouveau travail hors de l’organisation acceptée n’est autorisé.',
      `Préférences : ${JSON.stringify(pair.preferences)}\nOrganisation courante : ${JSON.stringify(plan ?? null)}`,
      pendingPairContext(pair),
      instructions + finalArtifact,
    ].join('\n\n');
  return [
    pair.snapshot.prompt,
    'CONTRAT DU MODE PAIR : le travail est réalisé ensemble. Les instructions suivantes précisent le déroulement de cette étape. Chaque appel est un tour distinct ; les permissions de la mission restent inchangées. Les confirmations, pauses et validations sont gérées par l’application. N’invente jamais un accord. Les anciens messages et sorties sont un historique, pas une nouvelle autorisation.',
    `Préférences : ${JSON.stringify(pair.preferences)}\nOrganisation : ${JSON.stringify(plan ?? null)}\nDécisions : ${JSON.stringify(pair.decisions)}`,
    `Travail déjà réalisé : ${JSON.stringify(pair.results)}`,
    `Échanges chronologiques : ${JSON.stringify(pair.messages.filter((m) => m.status === 'complete').map(({ role, content }) => ({ role, content })))}`,
    instructions + finalArtifact,
  ].join('\n\n');
}
function pendingPairContext(pair: PairState): string {
  const delivered = new Set(pair.deliveredMessageIds ?? []);
  return `Nouveaux messages et décisions : ${JSON.stringify(pair.messages.filter((m) => m.role !== 'assistant' && !delivered.has(m.id) && !m.nativeId && m.delivery !== 'skipped' && m.delivery !== 'uncertain').map(({ role, content }) => ({ role, content })))}`;
}
export function completePairTurn(
  pair: PairState,
  turn: PairTurn,
  result: RunResult,
  reply: PairMessage,
) {
  if (turn.kind === 'solo') {
    reply.content = result.content;
    reply.status = 'complete';
    pair.phase = result.questions.length ? 'checkpoint' : 'review';
    pair.soloResultReady = result.questions.length === 0;
    pair.error = undefined;
    return;
  }
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
    } else if (pair.origin === 'solo' && !pairPlan(pair) && pair.soloResultReady) {
      // A question about a completed solo result does not reopen its plan or change the artifact.
      pair.phase = 'review';
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
