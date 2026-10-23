import { createHash } from 'node:crypto';
import type {
  NavigationContextPacket,
  NavigationJourney,
  NavigationSearchResult,
  NavigationSnapshot,
} from '../shared/navigation';
import { NAVIGATION_LIMITS } from '../shared/navigation';
import { navigationDefinitionHash } from './NavigationStore';
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
/** Deterministic lexical retrieval: no provider, embeddings or browser side effects. */
export function searchNavigation(
  snapshot: NavigationSnapshot,
  query: string,
  applicationId?: string,
): NavigationSearchResult[] {
  const terms = [
    ...new Set(
      normalize(query)
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    ),
  ].slice(0, 30);
  const ranked = snapshot.journeys
    .filter(
      (journey) =>
        (!applicationId || journey.applicationId === applicationId) &&
        journey.status !== 'archived',
    )
    .map((journey) => {
      const title = normalize(journey.title),
        intent = normalize(journey.intent),
        tags = normalize(journey.tags.join(' '));
      const rest = normalize(
        [
          ...journey.prerequisites,
          ...journey.arrival.map((condition) => condition.value ?? condition.target?.value ?? ''),
          ...journey.steps
            .filter((step) => step.action === 'navigate')
            .map((step) => step.url ?? ''),
        ].join(' '),
      );
      const reasons: string[] = [];
      let score = journey.status === 'available' ? 2 : 0;
      for (const term of terms) {
        const weight = title.includes(term)
          ? 8
          : tags.includes(term)
            ? 6
            : intent.includes(term)
              ? 4
              : rest.includes(term)
                ? 1
                : 0;
        if (weight) {
          score += weight;
          reasons.push(`Correspondance : ${term}`);
        }
      }
      if (journey.status === 'available')
        reasons.push('Disponible après rejeu ; fraîcheur à contrôler pour le binding courant.');
      else reasons.push('Brouillon : vérification explicite nécessaire.');
      return {
        id: journey.id,
        revision: journey.revision,
        title: journey.title,
        intent: journey.intent,
        status: journey.status,
        score,
        reasons,
        prerequisites: journey.prerequisites,
      };
    })
    .filter(
      (result) =>
        !terms.length || result.reasons.some((reason) => reason.startsWith('Correspondance')),
    )
    .sort(
      (a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
    );
  const results: NavigationSearchResult[] = [];
  for (const candidate of ranked.slice(0, 5)) {
    const bounded = {
      ...candidate,
      title: candidate.title.slice(0, 200),
      intent: candidate.intent.slice(0, 500),
      reasons: candidate.reasons.slice(0, 6),
      prerequisites: candidate.prerequisites.slice(0, 4).map((value) => value.slice(0, 160)),
    };
    if (JSON.stringify([...results, bounded]).length > NAVIGATION_LIMITS.searchChars) break;
    results.push(bounded);
  }
  return results;
}
export function navigationContext(
  journeys: NavigationJourney[],
  maxChars: number = NAVIGATION_LIMITS.contextChars,
): NavigationContextPacket {
  const limit = Math.max(0, Math.min(NAVIGATION_LIMITS.contextChars, Math.floor(maxChars)));
  const refs: NavigationContextPacket['refs'] = [];
  const blocks: string[] = [];
  let omitted = 0;
  for (const journey of journeys) {
    const block = JSON.stringify({
      id: journey.id,
      revision: journey.revision,
      applicationId: journey.applicationId,
      title: journey.title,
      intent: journey.intent,
      status: journey.status,
      prerequisites: journey.prerequisites,
      parameters: journey.parameters.map(({ defaultValue: _default, ...parameter }) => parameter),
      arrival: journey.arrival,
      freshness: 'À contrôler sur le binding courant',
    });
    if ([...blocks, block].join('\n').length > limit) {
      omitted++;
      continue;
    }
    blocks.push(block);
    refs.push({
      id: journey.id,
      revision: journey.revision,
      hash: journey.hash ?? navigationDefinitionHash(journey),
    });
  }
  const text = blocks.join('\n');
  return {
    refs,
    text,
    chars: text.length,
    omitted,
    hash: createHash('sha256').update(JSON.stringify({ refs, text, omitted })).digest('hex'),
  };
}
export class NavigationSearch {
  search(
    snapshot: NavigationSnapshot,
    query: string,
    applicationId?: string,
  ): NavigationSearchResult[] {
    return searchNavigation(snapshot, query, applicationId);
  }
  context(journeys: NavigationJourney[], maxChars?: number): NavigationContextPacket {
    return navigationContext(journeys, maxChars);
  }
}
