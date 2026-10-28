import type { DevOpsState } from './devops';
import type { Feature } from './types';
import { proofDossier } from './proofs';

export type DeliveryFeature = Pick<Feature, 'id' | 'title'> & Partial<Feature>;
export interface DeliveryDraft {
  selected: string[];
  intent: string;
  commitTitle: string;
  prTitle: string;
  description: string;
  target: string;
  ticketId: string;
  featureId: string;
  remote: string;
}
export function deliveryScope(state?: DevOpsState): string {
  return state?.config
    ? `${state.config.organization}/${state.config.project}/${state.config.repository}`.toLowerCase()
    : '';
}
/** Only unambiguous persisted associations in this repository may preselect a ticket. */
export function deliveryTicket(featureId: string, state: DevOpsState): string {
  const ids = [
    ...new Set(
      state.links
        .filter((link) => link.projectKey === deliveryScope(state) && link.featureId === featureId)
        .flatMap((link) => (link.ticketId ? [link.ticketId] : [])),
    ),
  ];
  return ids.length === 1 ? String(ids[0]) : '';
}
export function suggestedDeliveryFeature(features: DeliveryFeature[], state?: DevOpsState): string {
  const matches = features.filter(
    (feature) => !feature.archived && feature.branch && feature.branch === state?.snapshot?.branch,
  );
  return matches.length === 1 ? matches[0].id : '';
}
const excerpt = (text: string, limit: number) => text.trim().slice(0, limit);
/** Deterministic local drafting. Declared acceptance and runtime observations stay distinct. */
export function prepareSessionPullRequest(feature: DeliveryFeature, state: DevOpsState) {
  const ticketId = deliveryTicket(feature.id, state);
  const link = state.links.find(
    (item) =>
      item.projectKey === deliveryScope(state) &&
      item.featureId === feature.id &&
      String(item.ticketId) === ticketId,
  );
  const steps = feature.steps ?? [];
  const dossier = proofDossier({ ...feature, steps } as Feature);
  const latest = new Set(steps.map((step) => step.attempts.at(-1)?.id));
  const tests = dossier.sources.filter(
    (proof) => proof.kind === 'test' && latest.has(proof.attemptId),
  );
  const files = [...new Set(steps.flatMap((step) => step.attempts.at(-1)?.changedFiles ?? []))];
  const status = {
    observed: 'exécution réussie enregistrée ; version des fichiers à vérifier',
    failed: 'échec ou exécution incomplète',
    pending: 'en attente',
    recheck: 'à revérifier (preuve historique ou fichiers modifiés)',
  };
  const result = [...steps]
    .reverse()
    .find((step) => step.attempts.at(-1)?.artifact)
    ?.attempts.at(-1)?.artifact?.content;
  const description = [
    `## Changement\n\n${excerpt(feature.description || feature.title, 3500)}`,
    result ? `## Résultat de la session (compte rendu)\n\n${excerpt(result, 3500)}` : '',
    `## Validation\n\n${tests.length ? tests.map((proof) => `- ${proof.title} : ${status[proof.state]} (${proof.at}).`).join('\n') : '- Aucun test exécuté par le host n’est attesté dans cette session.'}`,
    `## Critères d’acceptation déclarés\n\n${feature.criteria?.length ? feature.criteria.map((criterion) => `- [${criterion.status === 'passed' ? 'x' : ' '}] ${criterion.text} — ${criterion.status === 'failed' ? 'en échec' : criterion.status === 'passed' ? 'validé dans la session' : 'à vérifier'}${criterion.evidence ? ` ; justification : ${excerpt(criterion.evidence, 500)}` : ''}`).join('\n') : '- Aucun critère renseigné.'}\n\nCes déclarations ne prouvent pas à elles seules une exécution de test.`,
    files.length
      ? `## Fichiers signalés par la session\n\n${files
          .slice(0, 40)
          .map((file) => `- ${file}`)
          .join('\n')}\n\nPérimètre à comparer avec le diff Git avant publication.`
      : '',
    `## Références\n\n- Session KerAI : ${feature.title} (${feature.id})${ticketId ? `\n- Ticket : #${ticketId}${link?.ticketUrl ? ` — ${link.ticketUrl}` : ''}` : ''}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    prTitle: feature.title.slice(0, 200),
    description: description.slice(0, 20000),
    featureId: feature.id,
    ticketId,
  };
}
