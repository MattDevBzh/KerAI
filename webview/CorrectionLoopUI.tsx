import { useEffect, useRef, useState } from 'react';
import type { Feature } from '../src/shared/types';
import type { CorrectionLoopState } from '../src/shared/correctionLoop';
import { featureStateKey } from '../src/shared/collaboration';
import { subscribe } from './bridge';
import { StudioDialog, type Dispatch } from './ExecutionUI';
import './correction-loop.css';

const pauseLabels = {
  contract_changed: 'Le cadre a changé. Un nouveau contrat humain est nécessaire pour poursuivre.',
  stagnation: 'Arrêt : les derniers cycles comparables ne montrent plus de progrès.',
  oscillation: 'Arrêt : des problèmes déjà résolus réapparaissent en alternance.',
  history_limit:
    'Limite de 80 observations atteinte. Relis le bilan et renouvelle le contrat pour poursuivre.',
};

export function CorrectionLoopContract({
  feature,
  loop,
}: {
  feature: Feature;
  loop?: CorrectionLoopState;
}) {
  const criteria = loop?.contract.criteria ?? feature.criteria ?? [];
  return (
    <div className="correction-loop-contract">
      <p>
        <strong>{loop ? 'Objectif figé' : 'Objectif à figer'}</strong>
        <br />
        {loop?.contract.description ?? feature.description}
      </p>
      <strong>{loop ? 'Critères figés' : 'Critères à figer'}</strong>
      {criteria.length ? (
        <ul>
          {criteria.map((criterion) => (
            <li key={criterion.id}>{criterion.text}</li>
          ))}
        </ul>
      ) : (
        <p>Ajoute au moins un critère d’acceptation à la session avant le démarrage.</p>
      )}
      {loop && (
        <p>
          <small>
            Contrat établi le {new Date(loop.contract.createdAt).toLocaleString('fr-FR')}.
          </small>
        </p>
      )}
      {!!loop?.contract.commands.length && (
        <p>
          Vérifications prévues : {loop.contract.commands.map((command) => command.name).join(', ')}
          .
        </p>
      )}
    </div>
  );
}

function Observations({
  feature,
  loop,
  selectStep,
}: {
  feature: Feature;
  loop: CorrectionLoopState;
  selectStep?: (id: string) => void;
}) {
  const names = new Map(
    loop.observations.flatMap((observation) =>
      observation.problems.map((problem) => [problem.key, problem.message] as const),
    ),
  );
  return !loop.observations.length ? (
    <p>Aucune observation enregistrée pour ce contrat.</p>
  ) : (
    <ol className="correction-loop-observations">
      {loop.observations.map((observation, index) => {
        const step = feature.steps.find((item) => item.id === observation.stepId);
        const attempt = step?.attempts.find((item) => item.id === observation.attemptId);
        const evidence =
          attempt?.evidence?.filter((item) => observation.evidenceIds.includes(item.id)) ?? [];
        const comparable = loop.observations
          .slice(0, index)
          .some((item) => item.checkKey === observation.checkKey);
        return (
          <li key={observation.id}>
            <strong>
              Observation {index + 1} · {observation.kind === 'review' ? 'Revue' : 'Vérification'}
              {step ? ` · ${step.name}` : ''}
            </strong>
            <p className="field-help">
              {comparable
                ? `${observation.stagnantCycles} cycle(s) comparable(s) sans progrès.`
                : 'Première observation de cette vérification : point de départ de la comparaison.'}
            </p>
            <div className="correction-loop-counts" aria-label="Bilan comparatif">
              <span>
                {observation.introduced.length}{' '}
                {observation.introduced.length === 1 ? 'nouveau' : 'nouveaux'}
              </span>
              <span>
                {observation.persistent.length}{' '}
                {observation.persistent.length === 1 ? 'persistant' : 'persistants'}
              </span>
              <span>
                {observation.resolved.length}{' '}
                {observation.resolved.length === 1 ? 'résolu' : 'résolus'}
              </span>
            </div>
            {(
              [
                ['Nouveaux problèmes', observation.introduced],
                ['Problèmes persistants', observation.persistent],
                ['Problèmes résolus', observation.resolved],
              ] as const
            ).map(
              ([label, keys]) =>
                keys.length > 0 && (
                  <details key={label}>
                    <summary>
                      {label} · {keys.length}
                    </summary>
                    <ul>
                      {keys.map((key) => (
                        <li key={key}>
                          {names.get(key) ?? 'Problème d’une observation antérieure'}
                        </li>
                      ))}
                    </ul>
                  </details>
                ),
            )}
            {!observation.problems.length && <p>Aucun problème relevé par cette vérification.</p>}
            <details>
              <summary>Consulter la tentative et les preuves</summary>
              {attempt ? (
                <>
                  <p>
                    Tentative {step!.attempts.indexOf(attempt) + 1} ·{' '}
                    {new Date(attempt.startedAt).toLocaleString('fr-FR')}
                  </p>
                  {attempt.review && <p>{attempt.review.summary}</p>}
                  {evidence.map((item) => (
                    <div key={item.id}>
                      <strong>{item.name}</strong>
                      <p>
                        {item.error ??
                          (item.exitCode === 0
                            ? 'Vérification réussie.'
                            : 'Vérification en échec ou incomplète.')}
                      </p>
                      <pre>
                        {[item.stdout, item.stderr].filter(Boolean).join('\n') ||
                          'Aucune sortie conservée.'}
                      </pre>
                    </div>
                  ))}
                  {!evidence.length && <p>Aucune preuve de test associée à cette observation.</p>}
                </>
              ) : (
                <p>
                  Cette tentative n’est plus disponible dans la session. Le bilan reste conservé.
                </p>
              )}
              {step && selectStep && (
                <button className="text-button" onClick={() => selectStep(step.id)}>
                  Ouvrir l’étape {step.name}
                </button>
              )}
            </details>
          </li>
        );
      })}
    </ol>
  );
}

export function CorrectionLoopPanel({
  feature,
  dispatch,
  selectStep,
  renewalDisabled,
}: {
  feature: Feature;
  dispatch: Dispatch;
  selectStep?: (id: string) => void;
  renewalDisabled: boolean;
}) {
  const [renewing, setRenewing] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const request = useRef<string | undefined>(undefined);
  const auto = feature.autopilot;
  const loop = auto?.correctionLoopState;
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'correctionLoopRenewed' || message.requestId !== request.current)
          return;
        setSaving(false);
        if (message.error) setError(message.error);
        else setRenewing(false);
      }),
    [],
  );
  if (!auto?.correctionLoop && !loop && !auto?.correctionLoopHistory?.length) return null;
  return (
    <section className="correction-loop-panel" aria-label="Suivi de la boucle de correction">
      <div className="correction-loop-heading">
        <h4>Boucle de correction</h4>
        <strong>
          {loop?.pause
            ? 'Intervention humaine nécessaire'
            : loop?.readiness === 'ready_for_human'
              ? 'Prête pour ta revue'
              : loop?.readiness === 'issues'
                ? 'Corrections à vérifier'
                : 'En attente de vérification'}
        </strong>
      </div>
      {loop?.pause && <p role="status">{pauseLabels[loop.pause]}</p>}
      <p className="field-help">
        Ce suivi ne vaut pas validation finale. Les points de contrôle et les validations humaines
        restent applicables.
      </p>
      {!loop && (
        <p>
          Les critères seront figés au démarrage. Une seule tentative s’exécute à la fois dans le
          cockpit.
        </p>
      )}
      {auto.correctionLoop && (
        <p>
          Arrêt après {auto.correctionLoop.maxStagnantCycles}{' '}
          {auto.correctionLoop.maxStagnantCycles === 1 ? 'cycle comparable' : 'cycles comparables'}{' '}
          sans progrès. {loop?.stagnantCycles ?? 0} actuellement.
        </p>
      )}
      <details>
        <summary>
          {loop ? 'Lire le contrat de cette boucle' : 'Voir le cadre du prochain démarrage'}
        </summary>
        <CorrectionLoopContract feature={feature} loop={loop} />
      </details>
      {loop && (
        <>
          <details open>
            <summary>Observations et progrès · {loop.observations.length}</summary>
            <Observations feature={feature} loop={loop} selectStep={selectStep} />
          </details>
          {auto.correctionLoop && (
            <button
              className="button secondary small"
              disabled={renewalDisabled}
              onClick={() => {
                setError('');
                setRenewing(true);
              }}
            >
              Démarrer une nouvelle boucle
            </button>
          )}
        </>
      )}
      {!!auto.correctionLoopHistory?.length && (
        <details>
          <summary>Boucles précédentes · {auto.correctionLoopHistory.length}</summary>
          {auto.correctionLoopHistory.map((previous, index) => (
            <details key={previous.contract.id}>
              <summary>Boucle précédente {index + 1}</summary>
              <CorrectionLoopContract feature={feature} loop={previous} />
              <Observations feature={feature} loop={previous} selectStep={selectStep} />
            </details>
          ))}
        </details>
      )}
      {renewing && loop && (
        <StudioDialog
          title="Démarrer une nouvelle boucle"
          subtitle="Valide le cadre actualisé avant de poursuivre les corrections."
          onClose={() => {
            if (!saving) setRenewing(false);
          }}
        >
          <CorrectionLoopContract feature={feature} />
          <p>
            L’historique des boucles précédentes est conservé. Les compteurs globaux restent à{' '}
            {auto.runs} / {auto.maxRuns} exécutions et {auto.correctionCycles} /{' '}
            {auto.maxCorrectionCycles} cycles de correction.
          </p>
          <p>
            Cette action fige un nouveau contrat sans lancer d’agent. Tu pourras ensuite reprendre
            l’autopilot avec ses validations humaines.
          </p>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={saving}
              onClick={() => setRenewing(false)}
            >
              Annuler
            </button>
            <button
              className="button primary"
              disabled={saving || renewalDisabled || !feature.criteria?.length}
              onClick={() => {
                request.current = crypto.randomUUID();
                setSaving(true);
                setError('');
                dispatch({
                  type: 'renewCorrectionLoop',
                  featureId: feature.id,
                  expectedContractId: loop.contract.id,
                  expectedStateKey: featureStateKey(feature),
                  requestId: request.current,
                });
              }}
            >
              {saving ? 'Création du contrat…' : 'Confirmer le nouveau contrat'}
            </button>
          </div>
        </StudioDialog>
      )}
    </section>
  );
}
