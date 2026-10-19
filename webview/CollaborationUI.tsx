import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import type {
  AgentProfile,
  ClientMessage,
  Feature,
  FeatureStep,
  StudioState,
} from '../src/shared/types';
import { featureCompletionBlockers } from '../src/core/validation';
import { featureStateKey, previewCorrection } from '../src/shared/collaboration';
import { hasActiveRun } from './GitWorkspaceUI';
import { subscribe, celebrationEnabled, saveCelebrationEnabled } from './bridge';
import { useRewards } from './RewardProvider';
import { EiffelCelebration } from './RewardEffects';
import './collaboration.css';

import { AgentImage } from './Avatar';

function Portrait({ agent, approved = false }: { agent?: AgentProfile; approved?: boolean }) {
  return (
    <AgentImage
      className="collaboration-portrait"
      avatar={agent?.avatar}
      agentId={agent?.id}
      pose={approved ? 'approved.png' : 'idle.png'}
    />
  );
}
export function StepChoice({
  step,
  state,
  selected,
  onToggle,
}: {
  step: FeatureStep;
  state: StudioState;
  selected: boolean;
  onToggle: () => void;
}) {
  const agent = state.agents.find((item) => item.id === step.agentId);
  return (
    <label className={`correction-step-choice ${selected ? 'selected' : ''}`}>
      <input type="checkbox" checked={selected} onChange={onToggle} />
      <Portrait agent={agent} />
      <span>
        <strong>{step.name}</strong>
        <small>{agent?.nickname || agent?.name || step.agentId}</small>
      </span>
    </label>
  );
}
export function ReplayRoute({ steps, state }: { steps: FeatureStep[]; state: StudioState }) {
  return (
    <ol className="correction-route" aria-label="Étapes à rejouer">
      {steps.map((step) => (
        <li key={step.id}>
          <Portrait agent={state.agents.find((a) => a.id === step.agentId)} />
          <span>{step.name}</span>
        </li>
      ))}
    </ol>
  );
}
export function ReportDiff({ before, after }: { before: string; after: string }) {
  return (
    <div className="report-diff">
      <section>
        <h4>Avant</h4>
        <pre>{before}</pre>
      </section>
      <section>
        <h4>Après</h4>
        <pre>{after}</pre>
      </section>
    </div>
  );
}
export function ReportEditor({
  content,
  onChange,
  reason,
  onReason,
  original,
  description,
  onDescription,
  descriptionChanged,
  onDescriptionChanged,
  versions,
  busy,
  error,
  save,
  review,
  blockers,
  dirty,
  descriptionVersions = [],
  discard,
  currentContent,
  refreshBaseline,
}: {
  content: string;
  onChange: (value: string) => void;
  reason: string;
  onReason: (value: string) => void;
  original: string;
  description: string;
  onDescription: (value: string) => void;
  descriptionChanged: boolean;
  onDescriptionChanged: (value: boolean) => void;
  versions: { id: string; label: string; before: string; after: string; reason?: string }[];
  descriptionVersions?: { revision: number; content: string; at: string; author: string }[];
  currentContent: string;
  refreshBaseline: () => void;
  discard: () => void;
  busy: boolean;
  error: string;
  save: () => void;
  review: () => void;
  blockers: string[];
  dirty: boolean;
}) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="report-editor">
      <div className="report-editor-tabs">
        <button
          className="button secondary small"
          aria-pressed={!preview}
          onClick={() => setPreview(false)}
        >
          Éditeur
        </button>
        <button
          className="button secondary small"
          aria-pressed={preview}
          onClick={() => setPreview(true)}
        >
          Aperçu du compte rendu
        </button>
      </div>
      {preview ? (
        <article className="markdown report-preview">
          <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
        </article>
      ) : (
        <label className="field">
          <span>Compte rendu modifié</span>
          <textarea
            className="report-content"
            value={content}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
          />
        </label>
      )}
      <label className="field">
        <span>
          Raison de la modification <small>facultatif</small>
        </span>
        <input value={reason} onChange={(e) => onReason(e.target.value)} />
      </label>
      <details className="report-context">
        <summary>Corriger le besoin initial</summary>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={descriptionChanged}
            onChange={(e) => onDescriptionChanged(e.target.checked)}
          />
          <span>Appliquer aussi ce besoin à la session</span>
        </label>
        <label className="field">
          <span>Besoin initial de la session</span>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => {
              onDescription(e.target.value);
              onDescriptionChanged(true);
            }}
          />
        </label>
        <details>
          <summary>Historique du besoin initial ({descriptionVersions.length})</summary>
          {descriptionVersions.map((version) => (
            <div key={version.revision}>
              <p>
                Version {version.revision + 1} ·{' '}
                {version.author === 'human' ? 'Modification humaine' : 'Besoin initial'}
              </p>
              <pre>{version.content}</pre>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  onDescription(version.content);
                  onDescriptionChanged(true);
                }}
              >
                Utiliser cette version du besoin
              </button>
            </div>
          ))}
        </details>
        <p className="field-help">
          Le compte rendu et le besoin seront enregistrés ensemble. Les validations concernées
          devront être revérifiées.
        </p>
      </details>
      <details>
        <summary>Original produit par l’agent</summary>
        <article className="markdown">
          <Markdown remarkPlugins={[remarkGfm]}>{original}</Markdown>
        </article>
        <button className="text-button" disabled={busy} onClick={() => onChange(original)}>
          Utiliser l’original de l’agent
        </button>
      </details>
      <details>
        <summary>Historique des versions ({versions.length})</summary>
        {versions.length ? (
          versions.map((version) => (
            <details key={version.id}>
              <summary>{version.label}</summary>
              {version.reason && <p>{version.reason}</p>}
              <ReportDiff before={version.before} after={version.after} />
              <button
                className="text-button"
                disabled={busy}
                onClick={() => onChange(version.after)}
              >
                Utiliser cette version du compte rendu
              </button>
            </details>
          ))
        ) : (
          <p className="field-help">Aucune modification humaine enregistrée.</p>
        )}
      </details>
      {dirty && <ReportDiff before={versions.at(-1)?.after ?? original} after={content} />}
      {error && (
        <div className="approval-blockers" role="alert">
          <strong>Modification non enregistrée</strong>
          <p>{error}</p>
          <p>Votre brouillon est conservé. Vous pouvez le corriger et réessayer.</p>
          <details>
            <summary>Comparer avec la version actuelle</summary>
            <ReportDiff before={currentContent} after={content} />
            <button className="button secondary small" disabled={busy} onClick={refreshBaseline}>
              Reprendre sur cette version actuelle
            </button>
          </details>
        </div>
      )}
      {blockers.length > 0 && (
        <div className="approval-blockers" role="status">
          <strong>Enregistrer et valider est bloqué</strong>
          <ul>
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="report-editor-actions">
        <button className="text-button" disabled={busy || !dirty} onClick={discard}>
          Abandonner ce brouillon
        </button>
        <span className="field-help">
          {busy
            ? 'Enregistrement en cours…'
            : dirty
              ? 'Brouillon non enregistré'
              : 'Compte rendu enregistré'}
        </span>
        <button className="button secondary" disabled={busy || !dirty} onClick={review}>
          <RefreshCw size={15} />
          Faire réviser par l’agent
        </button>
        <button
          className="button primary"
          disabled={busy || !dirty || blockers.length > 0}
          onClick={save}
        >
          {busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}Enregistrer et
          valider
        </button>
      </div>
    </div>
  );
}
export function Celebration({
  state,
  feature,
  active,
}: {
  state: StudioState;
  feature: Feature;
  active: boolean;
}) {
  const participants = new Set(feature.steps.map((step) => step.agentId));
  const agents = state.agents
    .filter((agent) => participants.has(agent.id))
    .sort((a, b) => Number(participants.has(b.id)) - Number(participants.has(a.id)));
  return (
    <div
      className={`celebration-team ${active ? 'celebrating' : ''}`}
      data-testid="celebration-team"
    >
      {active && (
        <div className="celebration-confetti" aria-hidden="true">
          {Array.from({ length: 36 }, (_, i) => (
            <i
              key={i}
              style={{
                left: `${(i * 37) % 100}%`,
                animationDelay: `${(i % 6) * 0.08}s`,
                background: ['var(--coral)', 'var(--green)', 'var(--lavender)', 'var(--apricot)'][
                  i % 4
                ],
              }}
            />
          ))}
        </div>
      )}
      <div className="celebration-portraits">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className={`celebration-card ${participants.has(agent.id) ? 'participant' : ''}`}
          >
            <Portrait agent={agent} approved />
            <strong>{agent.nickname || agent.name}</strong>
            <small>
              {participants.has(agent.id) ? 'A participé à ce parcours' : 'Votre équipe'}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}
export function CelebrationControls({
  token,
  state,
  feature,
}: {
  token: string;
  state: StudioState;
  feature: Feature;
}) {
  const { state: rewardState } = useRewards();
  const eiffel =
    !rewardState?.error &&
    rewardState?.selection.celebration === 'eiffel' &&
    rewardState.unlocked.includes('eiffel');
  const [sceneDismissed, setSceneDismissed] = useState(false);
  const [enabled, setEnabled] = useState(celebrationEnabled),
    [active, setActive] = useState(false);
  const previous = useRef('');
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      setReduced(query.matches);
      if (query.matches) setActive(false);
    };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!token || token === previous.current) return;
    previous.current = token;
    if (enabled && !reduced) {
      setSceneDismissed(false);
      setActive(true);
    }
  }, [token, enabled, reduced]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setActive(false), eiffel ? 6500 : 2400);
    return () => window.clearTimeout(timer);
  }, [active, eiffel]);
  return (
    <>
      <Celebration
        state={state}
        feature={feature}
        active={active && enabled && !reduced && !eiffel}
      />
      {eiffel && enabled && !sceneDismissed && (active || reduced) && (
        <EiffelCelebration
          animated={active && !reduced}
          onClose={() => {
            setSceneDismissed(true);
            setActive(false);
          }}
        />
      )}
      <div className="celebration-controls">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              saveCelebrationEnabled(e.target.checked);
              setActive(false);
            }}
          />
          <span>Activer la célébration</span>
        </label>
        <button
          className="text-button"
          disabled={!enabled || reduced}
          onClick={() => {
            setSceneDismissed(false);
            setActive(false);
            window.requestAnimationFrame(() => setActive(true));
          }}
        >
          <Sparkles size={14} />
          Rejouer la célébration
        </button>
        {reduced && (
          <span className="field-help">
            Animations désactivées par votre préférence de mouvement réduit.
          </span>
        )}
      </div>
    </>
  );
}

export function FinalSummary({
  feature,
  state,
  busy,
  error,
  finalized,
  onFinalize,
  onCorrection,
  token,
}: {
  feature: Feature;
  state: StudioState;
  busy: boolean;
  error: string;
  finalized: boolean;
  onFinalize: () => void;
  onCorrection: () => void;
  token: string;
}) {
  const reasons = [
    ...featureCompletionBlockers(feature),
    ...feature.steps
      .filter((step) => !step.attempts.at(-1)?.artifact)
      .map((step) => `${step.name} : compte rendu absent de l’historique conservé.`),
  ];
  if (state.workspaceOperation)
    reasons.push(state.workspaceOperation.label + ' : attendez la fin de cette opération.');
  else if (hasActiveRun(state))
    reasons.push('Une exécution est en cours. Attendez sa fin avant la décision finale.');
  else if (state.features.some((item) => item.autopilot?.status === 'running'))
    reasons.push('Arrêtez le pilote avant de confirmer cette version de la session.');
  return (
    <section className="final-panel" aria-label="Bilan final du parcours">
      <span className="eyebrow">BILAN DU PARCOURS</span>
      <h2>
        {finalized ? 'Parcours validé définitivement' : 'Tout est prêt pour votre dernier regard'}
      </h2>
      <p>
        {finalized
          ? 'Votre décision finale est enregistrée pour cette version de la session.'
          : 'Toutes les étapes sont validées. Relisez le bilan, puis confirmez cette version ou demandez une correction.'}
      </p>
      <div className="final-summary">
        <span>{feature.steps.length} étapes validées</span>
        <span>
          {feature.steps.reduce((sum, s) => sum + s.attempts.length, 0)} tentatives conservées
        </span>
        <span>{feature.criteria?.length ?? 0} critères</span>
      </div>
      <details>
        <summary>Comptes rendus et décisions de cette version</summary>
        <ul>
          {feature.steps.map((step) => (
            <li key={step.id}>
              {step.name} ·{' '}
              {state.agents.find((a) => a.id === step.agentId)?.nickname || step.agentId} · version{' '}
              {(step.attempts.at(-1)?.revision ?? 0) + 1}
            </li>
          ))}
        </ul>
      </details>
      {reasons.length > 0 && (
        <div className="approval-blockers" role="status">
          <strong>Décision finale bloquée</strong>
          <ul>
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <div className="approval-blockers" role="alert">
          <strong>La décision finale n’a pas été enregistrée</strong>
          <p>{error}</p>
        </div>
      )}
      <div className="final-actions">
        <button
          className="button secondary"
          disabled={busy || Boolean(feature.archived)}
          onClick={onCorrection}
        >
          <RefreshCw size={15} />
          Faire une correction
        </button>
        {!finalized && (
          <button
            className="button primary"
            disabled={busy || reasons.length > 0 || !state.workspace.trusted || feature.archived}
            onClick={onFinalize}
          >
            {busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}
            {busy ? 'Validation finale en cours…' : 'Valider définitivement'}
          </button>
        )}
      </div>
      {finalized && <CelebrationControls state={state} feature={feature} token={token} />}
    </section>
  );
}

export function CorrectionPanel({
  feature,
  state,
  sourceStepId,
  initialFeedback,
  rootStepIds,
  findingIds: initialFindings = [],
  commentIds: initialComments = [],
  dispatch,
  onClose,
}: {
  feature: Feature;
  state: StudioState;
  sourceStepId: string;
  initialFeedback: string;
  rootStepIds?: string[];
  findingIds?: string[];
  commentIds?: string[];
  dispatch: (message: ClientMessage) => void;
  onClose: () => void;
}) {
  const [expectedStateKey, setExpectedStateKey] = useState(() => featureStateKey(feature));
  const [roots, setRoots] = useState(rootStepIds ?? [sourceStepId]),
    [feedback, setFeedback] = useState(initialFeedback);
  const [findingIds, setFindingIds] = useState(initialFindings),
    [commentIds, setCommentIds] = useState(initialComments);
  const [initialContext, setInitialContext] = useState('');
  const [artifactContext, setArtifactContext] = useState<
    Record<string, { enabled?: boolean; content?: string }>
  >({});
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const request = {
    expectedStateKey,
    sourceStepId,
    rootStepIds: roots,
    feedback,
    findingIds,
    commentIds,
    initialContext,
    artifactContext,
  };
  const preview = previewCorrection(feature, request);
  const source = feature.steps.find((step) => step.id === sourceStepId)?.attempts.at(-1);
  const busy =
    hasActiveRun(state) ||
    Boolean(state.workspaceOperation) ||
    state.features.some((item) => item.autopilot?.status === 'running');
  const blockers = [
    ...preview.errors,
    ...(!state.workspace.trusted ? ['Approuvez le projet dans VS Code avant de lancer.'] : []),
    ...(state.runtime.state !== 'ready' ? ['Vérifiez la connexion Copilot avant de lancer.'] : []),
    ...(busy ? ['Arrêtez le pilote et attendez la fin de l’exécution en cours.'] : []),
  ];
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'correctionResult' || message.featureId !== feature.id) return;
        setPending(false);
        if (message.error) setError(message.error);
        else onClose();
      }),
    [feature.id, onClose],
  );
  return (
    <div className="correction-panel">
      <label className="field">
        <span>Correction attendue</span>
        <textarea
          autoFocus
          rows={4}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Le problème observé et le résultat attendu…"
        />
      </label>
      <fieldset>
        <legend>Étapes à corriger en premier</legend>
        <div className="correction-roots">
          {feature.steps.map((step) => (
            <StepChoice
              key={step.id}
              step={step}
              state={state}
              selected={roots.includes(step.id)}
              onToggle={() =>
                setRoots(
                  roots.includes(step.id)
                    ? roots.filter((id) => id !== step.id)
                    : [...roots, step.id],
                )
              }
            />
          ))}
        </div>
      </fieldset>
      <section>
        <h3>Le parcours à rejouer</h3>
        <p className="field-help">
          Les étapes qui dépendent de votre sélection seront reprises jusqu’à la relecture. Chaque
          validation habituelle reste nécessaire.
        </p>
        <ReplayRoute
          state={state}
          steps={preview.routeStepIds
            .map((id) => feature.steps.find((step) => step.id === id)!)
            .filter(Boolean)}
        />
        {preview.preservedStepIds.length > 0 && (
          <p className="field-help">
            Étapes conservées :{' '}
            {preview.preservedStepIds
              .map((id) => feature.steps.find((step) => step.id === id)?.name)
              .join(', ')}
            .
          </p>
        )}
      </section>
      {source?.review?.findings.length || feature.reviewComments?.some((c) => !c.resolved) ? (
        <fieldset>
          <legend>Remarques transmises à l’équipe</legend>
          {source?.review?.findings.map((finding) => (
            <label className="inline-check" key={finding.id}>
              <input
                type="checkbox"
                checked={findingIds.includes(finding.id)}
                onChange={() =>
                  setFindingIds(
                    findingIds.includes(finding.id)
                      ? findingIds.filter((id) => id !== finding.id)
                      : [...findingIds, finding.id],
                  )
                }
              />
              <span>{finding.message}</span>
            </label>
          ))}
          {feature.reviewComments
            ?.filter((c) => !c.resolved)
            .map((comment) => (
              <label className="inline-check" key={comment.id}>
                <input
                  type="checkbox"
                  checked={commentIds.includes(comment.id)}
                  onChange={() =>
                    setCommentIds(
                      commentIds.includes(comment.id)
                        ? commentIds.filter((id) => id !== comment.id)
                        : [...commentIds, comment.id],
                    )
                  }
                />
                <span>{comment.text}</span>
              </label>
            ))}
        </fieldset>
      ) : null}
      <details>
        <summary>Inspecter et ajuster le contexte transmis</summary>
        <p className="field-help">
          Vous pouvez retirer un compte rendu ou ajuster sa copie pour cette correction. L’original
          reste dans l’historique.
        </p>
        {feature.steps
          .filter((step) => step.attempts.at(-1)?.artifact)
          .map((step) => (
            <details className="correction-context-block" key={step.id}>
              <summary>{step.name} · compte rendu actuel</summary>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={artifactContext[step.id]?.enabled !== false}
                  onChange={(e) =>
                    setArtifactContext({
                      ...artifactContext,
                      [step.id]: { ...artifactContext[step.id], enabled: e.target.checked },
                    })
                  }
                />
                <span>Transmettre ce compte rendu</span>
              </label>
              <label className="field">
                <span>Copie transmise · {step.name}</span>
                <textarea
                  rows={5}
                  disabled={artifactContext[step.id]?.enabled === false}
                  value={
                    artifactContext[step.id]?.content ?? step.attempts.at(-1)!.artifact!.content
                  }
                  onChange={(e) =>
                    setArtifactContext({
                      ...artifactContext,
                      [step.id]: { ...artifactContext[step.id], content: e.target.value },
                    })
                  }
                />
              </label>
            </details>
          ))}
        <label className="field">
          <span>Contexte complémentaire</span>
          <textarea
            rows={3}
            value={initialContext}
            onChange={(e) => setInitialContext(e.target.value)}
          />
        </label>
        <details className="correction-context-block">
          <summary>Aperçu du contexte de correction</summary>
          <pre>{preview.context}</pre>
        </details>
      </details>
      {error && (
        <div className="approval-blockers" role="alert">
          {error}
        </div>
      )}
      {blockers.length > 0 && (
        <div className="approval-blockers" role="status">
          <strong>Correction bloquée</strong>
          <ul>
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
          {expectedStateKey !== featureStateKey(feature) && (
            <button
              className="button secondary small"
              onClick={() => setExpectedStateKey(featureStateKey(feature))}
            >
              Actualiser le parcours
            </button>
          )}
        </div>
      )}
      <div className="modal-actions">
        <button className="button secondary" disabled={pending} onClick={onClose}>
          Annuler
        </button>
        <button
          className="button primary"
          disabled={pending || blockers.length > 0}
          onClick={() => {
            setPending(true);
            setError('');
            dispatch({ type: 'requestCorrection', featureId: feature.id, ...request });
          }}
        >
          {pending ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}Lancer la
          correction
        </button>
      </div>
    </div>
  );
}
