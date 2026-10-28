import { useEffect, useState } from 'react';
import { Pause, Play, SkipForward } from 'lucide-react';
import type { ClientMessage, Feature, FeatureStep, StudioState } from '../src/shared/types';
import { featureStateKey } from '../src/shared/collaboration';
import { optionalChoiceAvailable, skippedSteps } from '../src/shared/optionalSteps';
import { subscribe } from './bridge';
import { StudioDialog } from './ExecutionUI';

type Dispatch = (message: ClientMessage) => void;

export function SkippedInterventions({ feature }: { feature: Feature }) {
  const steps = skippedSteps(feature);
  if (!steps.length) return null;
  return (
    <section className="optional-notice skipped-notice" aria-label="Interventions passées">
      <SkipForward size={22} aria-hidden="true" />
      <div>
        <strong>
          {steps.length} intervention{steps.length > 1 ? 's' : ''} passée
          {steps.length > 1 ? 's' : ''} — sans validation de résultat
        </strong>
        <p>{steps.map((step) => step.name).join(' · ')}</p>
        <small>
          Choix humain conservé dans le parcours. Aucun livrable ni test réussi n’est attribué à ces
          interventions.
        </small>
      </div>
    </section>
  );
}

export function OptionalStepChoice({
  feature,
  step,
  state,
  dispatch,
  busy = false,
  automatic = false,
}: {
  feature: Feature;
  step: FeatureStep;
  state: StudioState;
  dispatch: Dispatch;
  busy?: boolean;
  automatic?: boolean;
}) {
  const key = featureStateKey(feature);
  const [pending, setPending] = useState<{ id: string; key: string }>();
  const [error, setError] = useState('');
  const [deferred, setDeferred] = useState(false);
  const [skipKey, setSkipKey] = useState<string>();
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'optionalStepResult' || message.requestId !== pending?.id) return;
        setPending(undefined);
        setError(message.error ?? '');
      }),
    [pending?.id],
  );
  if (!optionalChoiceAvailable(feature, step) || step.optionalDecision?.action === 'skip')
    return null;
  const blocked =
    busy ||
    pending?.key === key ||
    !state.workspace.trusted ||
    Boolean(state.workspaceOperation) ||
    state.features.some(
      (f) => f.steps.some((s) => s.status === 'running') || f.autopilot?.status === 'running',
    );
  const choose = (choice: 'run' | 'skip', expectedStateKey = key) => {
    const requestId = crypto.randomUUID();
    setPending({ id: requestId, key });
    setError('');
    dispatch({
      type: 'resolveOptionalStep',
      requestId,
      featureId: feature.id,
      stepId: step.id,
      expectedStateKey,
      choice,
      ...(automatic ? { decisionId: feature.optionalRequest?.id, continueAutopilot: true } : {}),
    });
  };
  return (
    <section
      className="optional-notice optional-choice"
      aria-label={automatic ? 'Décision facultative attendue' : 'Intervention facultative'}
    >
      {skipKey && (
        <StudioDialog title="Passer cette intervention ?" onClose={() => setSkipKey(undefined)}>
          <p>
            La tentative et ses échanges restent dans l’historique. Les modifications déjà faites
            dans le projet sont conservées. Son résultat ne sera pas validé et tu pourras passer à
            la suite.
          </p>
          <div className="modal-actions">
            <button onClick={() => setSkipKey(undefined)}>Annuler</button>
            <button
              className="button primary"
              disabled={blocked}
              onClick={() => {
                choose('skip', skipKey);
                setSkipKey(undefined);
              }}
            >
              Passer et continuer
            </button>
          </div>
        </StudioDialog>
      )}
      <Pause size={22} aria-hidden="true" />
      <div>
        <strong>
          {automatic ? 'Le pilote attend ton choix' : 'Cette intervention est facultative'} :{' '}
          {step.name}
        </strong>
        <p>
          {deferred
            ? 'Le pilote reste en pause. Tu peux décider ici quand tu le souhaites.'
            : step.attempts.length
              ? 'Tu peux reprendre cette intervention ou la passer en conservant sa tentative.'
              : 'Exécute cette intervention ou passe-la sans produire de livrable.'}
        </p>
        <div className="optional-actions">
          {automatic && (
            <button
              className="button primary small"
              disabled={blocked || state.runtime.state !== 'ready'}
              onClick={() => choose('run')}
            >
              <Play size={15} /> Exécuter et continuer
            </button>
          )}
          <button
            className="button secondary small"
            disabled={blocked}
            onClick={() => (step.attempts.length ? setSkipKey(key) : choose('skip'))}
          >
            <SkipForward size={15} />{' '}
            {automatic ? 'Passer et continuer' : 'Passer cette intervention'}
          </button>
          {automatic && (
            <button className="text-button" disabled={blocked} onClick={() => setDeferred(true)}>
              Décider plus tard
            </button>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}
