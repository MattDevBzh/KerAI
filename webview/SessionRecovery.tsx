import type { Attempt, Feature, FeatureStep, ClientMessage } from '../src/shared/types';
import { pairPlan } from '../src/shared/pair';
import { currentTestEvidence, evidenceIsCurrent } from '../src/core/validation';
export function SessionRecovery({
  feature,
  step,
  attempt,
  dispatch,
}: {
  feature: Feature;
  step: FeatureStep;
  attempt: Attempt;
  dispatch: (message: ClientMessage) => void;
}) {
  const pair = attempt.pair;
  if (!pair || !['paused', 'interrupted'].includes(pair.phase)) return null;
  const plan = pairPlan(pair);
  const done = pair.results.filter((r) => r.planRevision === plan?.revision);
  const remaining = plan?.blocks.filter((b) => !done.some((r) => r.blockId === b.id)) ?? [];
  const checks = currentTestEvidence(attempt).filter((e) => evidenceIsCurrent(attempt, e));
  const direction = pair.messages.filter(
    (m) => pair.pendingMessages.includes(m.id) && m.role === 'user',
  );
  return (
    <section className="session-recovery" aria-label="Reprendre le travail">
      <h3>Le point avant de reprendre</h3>
      <p>
        {step.name} · {pair.busy ? 'Arrêt en cours de confirmation' : 'Travail conservé'}
      </p>
      {done.length > 0 && <p>Blocs terminés : {done.map((r) => r.title).join(' · ')}</p>}
      <p>
        {remaining.length
          ? `À poursuivre : ${remaining.map((b) => b.title).join(' · ')}`
          : 'La prochaine reprise examinera le travail conservé et les consignes en attente.'}
      </p>
      <p>
        {checks.length
          ? `${checks.length} vérification(s) rattachée(s) à cette version ; consulte le résultat pour leur verdict.`
          : 'Aucune vérification à jour enregistrée pour cette tentative.'}
      </p>
      {!!direction.length && (
        <details open>
          <summary>Consignes en attente</summary>
          {direction.map((m) => (
            <p key={m.id}>{m.content}</p>
          ))}
        </details>
      )}
      {!!attempt.changedFiles.length && (
        <details>
          <summary>{attempt.changedFiles.length} fichiers modifiés</summary>
          {attempt.changedFiles.map((path) => (
            <button
              className="text-button"
              key={path}
              onClick={() => dispatch({ type: 'openFile', path, featureId: feature.id })}
            >
              {path}
            </button>
          ))}
        </details>
      )}
    </section>
  );
}
