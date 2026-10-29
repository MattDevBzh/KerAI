import './work-focus.css';
import {
  Archive,
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  Clock3,
  Eye,
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { featureStateKey, finalValidationReady } from '../src/shared/collaboration';
import type { DevOpsState } from '../src/shared/devops';
import { progressLabel, stepResolved } from '../src/shared/optionalSteps';
import { allFeatures, subplanIssues, subplanProgressLabel } from '../src/shared/subplans';
import type { ClientMessage, Feature, StudioState } from '../src/shared/types';
import { Avatar } from './Avatar';
import { subscribe } from './bridge';
import { CorrectionPanel, FinalSummary } from './CollaborationUI';
import { DevOpsFeatureLinks } from './DevOpsUI';
import { GitWorkspacePanel, hasActiveRun } from './GitWorkspaceUI';
import { useHqContextTransfer } from './HqContextTransfer';
import { ObservationPanel, ObservationScan } from './ObservationUI';
import { OptionalStepChoice, SkippedInterventions } from './OptionalStepsUI';
import { PairWorkspace } from './PairWorkspace';
import { SessionHq } from './SessionHq';
import { SessionViewToggle, useSessionView } from './SessionViewPreference';
import { AutopilotBar, BudgetMeter } from './StudioUI';
import { FeatureBrief, SubplanCardVisual, SubplanNavigation, SubplanOverview } from './SubplanUI';
import { TeamComposer } from './TeamComposer';
import { TicketSourceCard } from './TicketsUI';

import { Badge, Modal, date, featureStatus, statuses } from './SessionPrimitives';
import { StepPanel } from './StepPanel';
import {
  SessionLayoutEditor,
  SessionModule,
  SessionModules,
  useSessionLayout,
} from './SessionLayout';
import type { SessionModuleId } from '../src/shared/sessionLayout';

export function FeatureDetail({
  onExpandHq,
  navigate,
  pairOpen,
  onPairOpenChange,
  openDiscussion,
  observerRequested,
  reportTarget,
  feature,
  state,
  devops,
  openDevOps,
  stepId,
  selectStep,
  dispatch,
  back,
  confirm,
  onDirtyChange,
}: {
  onExpandHq: () => void;
  navigate: (id: string, stepId?: string) => void;
  pairOpen: boolean;
  onPairOpenChange: (open: boolean) => void;
  openDiscussion: (id: string) => void;
  observerRequested?: boolean;
  reportTarget?: { stepId: string; attemptId: string; edit: boolean };
  onDirtyChange: (dirty: boolean) => void;
  feature: Feature;
  state: StudioState;
  devops: DevOpsState;
  openDevOps: () => void;
  stepId: string;
  selectStep: (id: string) => void;
  dispatch: (m: ClientMessage) => void;
  back: () => void;
  confirm: (title: string, description: string, action: () => void) => void;
}) {
  const step =
    feature.steps.find((s) => s.id === stepId) ??
    feature.steps.find((s) => s.id === feature.activeStepId) ??
    feature.steps[0];
  const workbench = useRef<HTMLElement>(null);
  const { layout } = useSessionLayout();
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [revealed, setRevealed] = useState<SessionModuleId[]>([]);
  const reveal = (id: SessionModuleId) =>
    setRevealed((current) => (current.includes(id) ? current : [...current, id]));
  const showModule = (id: SessionModuleId) => {
    reveal(id);
    requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(`[data-session-module="${id}"]`);
      const details = element?.querySelector('details');
      if (details) details.open = true;
      element?.scrollIntoView({ block: 'start' });
      element?.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    setRevealed([]);
    setLayoutOpen(false);
  }, [feature.id]);
  useEffect(() => {
    if (reportTarget) reveal('work');
    if (observerRequested) showModule('workspace');
  }, [feature.id, reportTarget?.stepId, reportTarget?.attemptId, observerRequested]);
  const [focusRequest, setFocusRequest] = useState(0);
  const selectCard = (id: string) => {
    reveal('work');
    selectStep(id);
    setFocusRequest((request) => request + 1);
  };
  useEffect(() => {
    if (!focusRequest) return;
    workbench.current?.scrollIntoView({ block: 'start' });
    workbench.current?.focus({ preventScroll: true });
  }, [focusRequest]);
  const [composing, setComposing] = useState(false),
    [teamPending, setTeamPending] = useState(false);
  const { enabled: livingHq } = useSessionView();
  const hqTransfer = useHqContextTransfer(feature, livingHq);
  const closeTeam = () => {
    if (!teamPending) {
      setComposing(false);
      onDirtyChange(false);
    }
  };
  const [correction, setCorrection] = useState<{
    sourceStepId: string;
    feedback: string;
    findingIds?: string[];
    commentIds?: string[];
    rootStepIds?: string[];
  } | null>(null);
  const [finalPending, setFinalPending] = useState(false),
    [finalError, setFinalError] = useState(''),
    [finalAck, setFinalAck] = useState('');
  const finalRequested = useRef(false);
  const [celebrationToken, setCelebrationToken] = useState('');
  const [detailDirty, setDetailDirty] = useState(false);
  const [observerOpen, setObserverOpen] = useState(Boolean(observerRequested));
  useEffect(() => {
    if (observerRequested) setObserverOpen(true);
  }, [observerRequested]);
  const finalKey = useRef('');
  const busy =
    hasActiveRun(state) ||
    Boolean(state.workspaceOperation) ||
    allFeatures(state.features).some((item) => item.autopilot?.status === 'running');
  const isHidden = (id: SessionModuleId) => layout.hidden.includes(id) && !revealed.includes(id);
  const questionStepId =
    state.humanRequests?.find((request) => request.featureId === feature.id)?.stepId ??
    feature.steps.find((item) => item.status === 'waiting_input')?.id;
  useEffect(
    () =>
      subscribe((message) => {
        if (
          message.type !== 'featureFinalizationResult' ||
          message.featureId !== feature.id ||
          !finalRequested.current
        )
          return;
        finalRequested.current = false;
        if (message.error) {
          setFinalPending(false);
          setFinalError(message.error);
        } else if (message.finalizationId) setFinalAck(message.finalizationId);
      }),
    [feature.id],
  );
  useEffect(() => {
    if (finalAck && feature.finalValidation?.id === finalAck) {
      setFinalPending(false);
      setCelebrationToken(finalAck);
      setFinalAck('');
    }
  }, [finalAck, feature.finalValidation?.id]);
  const openCorrection = (
    sourceStepId: string,
    feedback = '',
    findingIds?: string[],
    commentIds?: string[],
    rootStepIds?: string[],
  ) =>
    setCorrection({
      sourceStepId,
      feedback,
      findingIds,
      commentIds,
      rootStepIds,
    });

  if (pairOpen && step && !step.attempts.at(-1)?.pair?.nativeConversation)
    return (
      <div className="feature-pair-page">
        {livingHq && (
          <SessionHq
            onExpand={onExpandHq}
            feature={feature}
            state={state}
            transfer={hqTransfer}
            selectedStepId={step.id}
            disabled={false}
            selectStep={(id) => {
              selectStep(id);
              onPairOpenChange(false);
            }}
          />
        )}
        <PairWorkspace
          key={`${feature.id}:${step.id}:${step.attempts.at(-1)?.id ?? 'pending'}`}
          feature={feature}
          step={step}
          state={state}
          dispatch={dispatch}
          back={() => onPairOpenChange(false)}
        />
      </div>
    );
  return (
    <div className="page feature-page">
      {layoutOpen && (
        <SessionLayoutEditor onClose={() => setLayoutOpen(false)} onSaved={() => setRevealed([])} />
      )}
      {feature.pendingTeam && (
        <p className="subplan-warning" role="status">
          Nouvelle composition enregistrée. Elle sera appliquée à la fin de l’appel en cours.
        </p>
      )}
      {composing && (
        <Modal
          title="Composer mon équipe"
          subtitle="Ajoutez des équipes et des agents, puis ajustez chaque intervention."
          wide
          onClose={closeTeam}
        >
          <TeamComposer
            feature={feature}
            state={state}
            dispatch={dispatch}
            onPendingChange={setTeamPending}
            onClose={() => {
              setComposing(false);
              setTeamPending(false);
              onDirtyChange(false);
            }}
          />
        </Modal>
      )}
      {correction && (
        <Modal
          title="Demander une correction"
          subtitle="Choisissez les étapes et le contexte pour guider l’équipe."
          wide
          onClose={() => setCorrection(null)}
        >
          <CorrectionPanel
            feature={feature}
            state={state}
            {...correction}
            initialFeedback={correction.feedback}
            dispatch={dispatch}
            onClose={() => setCorrection(null)}
          />
        </Modal>
      )}
      <div className="breadcrumb">
        <button onClick={back} disabled={detailDirty}>
          <ArrowLeft size={14} /> Vos sessions
        </button>
        <ChevronRight size={12} />
        <span>{feature.workflowName}</span>
        {feature.discussionId && (
          <button disabled={detailDirty} onClick={() => openDiscussion(feature.discussionId!)}>
            <MessageSquare size={14} /> Discussion d’origine
          </button>
        )}
      </div>
      <div className="feature-heading">
        <div>
          <Badge {...featureStatus[feature.status]} />
          <h1>{feature.title}</h1>
          <details className="feature-brief-disclosure">
            <summary>Objectif et contexte de la session</summary>
            <FeatureBrief feature={feature} state={state} />
          </details>
          <div className="feature-meta">
            <span>
              <GitBranch size={14} />
              {feature.branch || 'Branche courante'}
            </span>
            <span>
              <Clock3 size={13} />
              {date(feature.updatedAt)}
            </span>
          </div>
        </div>
        <div className="session-heading-actions">
          <button
            className="button secondary small"
            disabled={detailDirty}
            onClick={() => setLayoutOpen(true)}
          >
            <LayoutDashboard size={15} /> Personnaliser l’affichage
          </button>
          {step && (
            <button
              className="button secondary small feature-jump-to-work"
              disabled={detailDirty}
              onClick={() => selectCard(feature.activeStepId || step.id)}
            >
              <ArrowDown size={15} />
              {feature.status === 'completed' ? 'Voir le résultat' : 'Aller à l’étape en cours'}
            </button>
          )}
        </div>
      </div>
      {questionStepId && isHidden('work') && (
        <div className="session-layout-attention" role="status">
          <span>Une réponse est attendue.</span>
          <button
            className="button secondary small"
            disabled={detailDirty}
            onClick={() => selectCard(questionStepId)}
          >
            Afficher l’étape à débloquer
          </button>
        </div>
      )}
      {feature.status === 'awaiting_final_validation' && isHidden('summary') && (
        <div className="session-layout-attention" role="status">
          <span>La session attend ta validation finale.</span>
          <button
            className="button secondary small"
            disabled={detailDirty}
            onClick={() => showModule('summary')}
          >
            Afficher le bilan
          </button>
        </div>
      )}
      {layout.hidden.length === layout.order.length && !revealed.length && (
        <p className="field-help">
          Tous les modules sont masqués. Utilise « Personnaliser l’affichage » pour les retrouver.
        </p>
      )}
      <SubplanNavigation
        feature={feature}
        state={state}
        navigate={navigate}
        disabled={detailDirty}
      />
      {feature.optionalRequest &&
        (() => {
          const optionalStep = feature.steps.find(
            (item) => item.id === feature.optionalRequest!.stepId,
          );
          return optionalStep ? (
            <OptionalStepChoice
              key={feature.optionalRequest!.id}
              feature={feature}
              step={optionalStep}
              state={state}
              dispatch={dispatch}
              automatic
              busy={busy || detailDirty}
            />
          ) : null;
        })()}
      <SessionModules revealed={revealed}>
        <SessionModule id="summary">
          {feature.steps.length > 0 && feature.steps.every(stepResolved) && (
            <FinalSummary
              feature={feature}
              state={state}
              busy={busy || finalPending || detailDirty}
              error={finalError}
              finalized={feature.status === 'completed' && Boolean(feature.finalValidation)}
              token={feature.finalValidation?.id === celebrationToken ? celebrationToken : ''}
              onFinalize={() => {
                if (!finalValidationReady(feature)) return;
                finalKey.current = featureStateKey(feature);
                finalRequested.current = true;
                setFinalPending(true);
                setFinalError('');
                dispatch({
                  type: 'finalizeFeature',
                  featureId: feature.id,
                  expectedStateKey: finalKey.current,
                });
              }}
              onCorrection={() => {
                const source = [...feature.steps]
                  .reverse()
                  .find((item) => item.attempts.at(-1)?.artifact);
                if (source) openCorrection(source.id);
                else
                  setFinalError(
                    'Aucun compte rendu conservé dans cette ancienne session. Ouvrez une nouvelle session pour poursuivre.',
                  );
              }}
            />
          )}
        </SessionModule>
        <SessionModule id="work">
          {step ? (
            <section
              ref={workbench}
              tabIndex={-1}
              className="feature-step-detail"
              aria-label={`Détail de l’étape : ${step.name}`}
            >
              {step.subplan && (
                <SubplanOverview
                  key={step.id}
                  step={step}
                  navigate={navigate}
                  disabled={detailDirty}
                />
              )}
              <StepPanel
                configureTeam={() => {
                  setComposing(true);
                  onDirtyChange(true);
                }}
                openPair={() => onPairOpenChange(true)}
                reportTarget={reportTarget?.stepId === step.id ? reportTarget : undefined}
                key={`${feature.id}-${step.id}`}
                feature={feature}
                step={step}
                state={state}
                dispatch={dispatch}
                selectStep={selectCard}
                onDirtyChange={(value) => {
                  setDetailDirty(value);
                  onDirtyChange(value);
                }}
                onCorrection={openCorrection}
                confirm={confirm}
              />
            </section>
          ) : (
            <section className="feature-empty-team">
              <Bot size={32} />
              <h2>Aucune équipe constituée</h2>
              <p className="muted">
                Votre feature est enregistrée. Ajoutez les agents qui vont intervenir.
              </p>
              <button
                className="button primary"
                disabled={busy || Boolean(feature.archived)}
                onClick={() => {
                  setComposing(true);
                  onDirtyChange(true);
                }}
              >
                <Plus size={16} />
                Composer mon équipe
              </button>
            </section>
          )}
        </SessionModule>
        <SessionModule id="devops">
          <DevOpsFeatureLinks state={devops} featureId={feature.id} onOpenDashboard={openDevOps} />
        </SessionModule>
        <SessionModule id="ticket">
          <TicketSourceCard feature={feature} />
        </SessionModule>
        <SessionModule id="workspace">
          <details className="work-secondary">
            <summary>Projet, Git et outils de la session</summary>
            <div className="feature-toolbar">
              <GitWorkspacePanel feature={feature} state={state} dispatch={dispatch} />
              <div className="feature-tools">
                <button
                  className="button secondary small"
                  disabled={detailDirty}
                  onClick={() => setObserverOpen(!observerOpen)}
                >
                  <Eye size={15} /> Analyser cette session
                </button>
                <button
                  className="icon-button"
                  disabled={busy || detailDirty || Boolean(feature.parent)}
                  aria-label="Supprimer la session"
                  onClick={() => dispatch({ type: 'deleteFeature', featureId: feature.id })}
                >
                  <Trash2 size={16} />
                </button>
                <button
                  className="button secondary small"
                  onClick={() => dispatch({ type: 'exportFeature', featureId: feature.id })}
                >
                  <ArrowDownToLine size={15} /> Exporter
                </button>
                <button
                  className="icon-button"
                  aria-label={feature.archived ? 'Restaurer la session' : 'Archiver la session'}
                  onClick={() =>
                    confirm(
                      feature.archived ? 'Restaurer cette session ?' : 'Archiver cette session ?',
                      feature.archived
                        ? 'La session retrouvera sa place dans votre atelier.'
                        : 'La session restera consultable dans les archives. Son historique et ses livrables seront conservés.',
                      () =>
                        dispatch({
                          type: 'archiveFeature',
                          featureId: feature.id,
                          archived: !feature.archived,
                        }),
                    )
                  }
                >
                  <Archive size={17} />
                </button>
              </div>
            </div>
            <ObservationScan
              feature={feature}
              state={state}
              dispatch={dispatch}
              open={() => setObserverOpen(true)}
            />
            {observerOpen && (
              <ObservationPanel
                feature={feature}
                state={state}
                dispatch={dispatch}
                close={() => setObserverOpen(false)}
              />
            )}
            {!!feature.projects?.length && (
              <div className="feature-projects" aria-label="Projets de cette session">
                {feature.projects.map((project) => (
                  <span key={project.id} title={project.path}>
                    {project.name} ·{' '}
                    {project.id === feature.projects![0].id ? feature.branch : project.branch}
                  </span>
                ))}
              </div>
            )}
          </details>
        </SessionModule>
        <SessionModule id="skipped">
          <SkippedInterventions feature={feature} />
        </SessionModule>
        <SessionModule id="autopilot">
          <details className="work-secondary">
            <summary>Pilotage automatique et budget</summary>
            <div className="feature-control-band">
              {!!feature.steps.length && (
                <AutopilotBar
                  feature={feature}
                  state={state}
                  dispatch={dispatch}
                  selectStep={selectCard}
                />
              )}
              <BudgetMeter feature={feature} state={state} dispatch={dispatch} />
            </div>
          </details>
        </SessionModule>
        <SessionModule id="team">
          <details className="work-secondary">
            <summary>Équipe et parcours · {progressLabel(feature)}</summary>
            {!!feature.steps.length && (
              <div className="feature-team-heading">
                <h2>Votre équipe</h2>
                <button
                  className="button secondary small"
                  disabled={
                    detailDirty ||
                    Boolean(feature.archived) ||
                    Boolean(feature.pendingTeam) ||
                    Boolean(feature.parent && feature.status === 'completed')
                  }
                  onClick={() => {
                    setComposing(true);
                    onDirtyChange(true);
                  }}
                >
                  <Settings2 size={14} />
                  Modifier l’équipe
                </button>
              </div>
            )}
            <div className="journey-heading">
              <span className="eyebrow">LE PARCOURS</span>
              <SessionViewToggle />
              <span>{progressLabel(feature)}</span>
            </div>
            {livingHq && feature.steps.length > 0 ? (
              <SessionHq
                onExpand={onExpandHq}
                feature={feature}
                state={state}
                transfer={hqTransfer}
                selectedStepId={step?.id}
                disabled={detailDirty}
                selectStep={selectCard}
              />
            ) : (
              <div className="journey" role="navigation" aria-label="Étapes du parcours">
                {feature.steps.map((s, i) => (
                  <button
                    key={s.id}
                    disabled={detailDirty}
                    onClick={() => selectCard(s.id)}
                    className={`journey-step ${s.subplan ? 'subplan-card' : ''} ${s.status} ${s.id === step?.id ? 'current' : ''}`}
                    aria-current={s.id === step?.id ? 'step' : undefined}
                  >
                    <span className="journey-node">
                      {s.subplan ? (
                        <SubplanCardVisual step={s} />
                      ) : (
                        <Avatar
                          agent={state.agents.find((a) => a.id === s.agentId)}
                          status={s.status}
                          small
                        />
                      )}
                      {s.status === 'approved' && (
                        <span className="journey-check">
                          <Check size={9} />
                        </span>
                      )}
                    </span>
                    <span>
                      <strong>
                        <span className="step-index">{String(i + 1).padStart(2, '0')} </span>
                        {s.name}
                      </strong>
                      <small>
                        {s.awaitsCorrection
                          ? 'Reprise par correctif'
                          : s.subplan && subplanIssues([s]).length
                            ? 'À configurer'
                            : subplanProgressLabel(s) || statuses[s.status].label}
                        {s.subplanState
                          ? ` · ${s.subplanState.iterations.filter((i) => i.feature.status === 'completed' && !i.cancelled && !i.requiresRecheck).length}/${s.subplanState.iterations.filter((i) => !i.cancelled).length} tâches validées`
                          : s.subplan
                            ? ' · Sous-équipe'
                            : ''}
                        {s.optional && s.status !== 'skipped' ? ' · Facultative' : ''}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </details>
        </SessionModule>
      </SessionModules>
    </div>
  );
}
