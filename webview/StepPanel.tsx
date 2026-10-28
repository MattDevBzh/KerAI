import { ReviewApprovalDialog } from './ReviewApprovalDialog';
import {
  acceptedReviewRemarks,
  reviewApprovalRequest,
  type ReviewApprovalRequest,
} from '../src/shared/reviewApproval';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Circle,
  Code2,
  ExternalLink,
  FileCode2,
  FileText,
  LoaderCircle,
  MessageSquare,
  Play,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Square,
  TriangleAlert,
  Workflow,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { approvalBlockers, featureCompletionBlockers } from '../src/core/validation';
import { agentPolicy } from '../src/shared/agentInheritance';
import { featureStateKey } from '../src/shared/collaboration';
import { usageCredits } from '../src/shared/credits';
import { permissionLabels } from '../src/shared/native';
import { stepResolved } from '../src/shared/optionalSteps';
import { allFeatures, subplanIssues } from '../src/shared/subplans';
import type { ClientMessage, Feature, FeatureStep, StudioState } from '../src/shared/types';
import { AgentReportDownload } from './AgentReportDownload';
import { NavigationInterventionCard } from './ApplicationsUI';
import { Avatar } from './Avatar';
import { isHosted, subscribe } from './bridge';
import { ReportEditor } from './CollaborationUI';
import { HumanRequests, LaunchDialog } from './ExecutionUI';
import { AttemptCheckpointLinks, hasActiveRun } from './GitWorkspaceUI';
import { PermissionPicker } from './NativeExecutionUI';
import { TraceJournal } from './ObservationUI';
import { OptionalStepChoice } from './OptionalStepsUI';
import { ProofDossierPanel } from './ProofDossier';
import { SessionConversation } from './SessionConversation';
import { EvidencePanel, ReviewWorkspace } from './StudioUI';

import { Badge, Empty, date, policyLabels, statuses } from './SessionPrimitives';
import { StepConfig } from './StepConfig';

export function StepPanel({
  configureTeam,
  openPair,
  reportTarget,
  feature,
  step,
  state,
  dispatch,
  selectStep,
  confirm,
  onDirtyChange,
  onCorrection,
}: {
  openPair: () => void;
  configureTeam: () => void;
  reportTarget?: { attemptId: string; edit: boolean };
  onDirtyChange: (dirty: boolean) => void;
  onCorrection: (
    sourceStepId: string,
    feedback?: string,
    findingIds?: string[],
    commentIds?: string[],
    rootStepIds?: string[],
  ) => void;
  feature: Feature;
  step: FeatureStep;
  state: StudioState;
  dispatch: (m: ClientMessage) => void;
  selectStep: (id: string) => void;
  confirm: (title: string, description: string, action: () => void) => void;
}) {
  const latest = step.attempts.at(-1);
  const [attemptId, setAttemptId] = useState(reportTarget?.attemptId ?? '');
  const attempt = step.attempts.find((a) => a.id === attemptId) ?? latest;
  const historic = Boolean(attempt && latest && attempt.id !== latest.id);
  const [tab, setTab] = useState<
    'conversation' | 'artifact' | 'activity' | 'diffs' | 'evidence' | 'review'
  >(reportTarget ? 'artifact' : latest?.pair?.nativeConversation ? 'conversation' : 'artifact');
  const conversationAttempt = useRef(latest?.id);
  useEffect(() => {
    if (conversationAttempt.current !== latest?.id && latest?.pair?.nativeConversation)
      setTab('conversation');
    conversationAttempt.current = latest?.id;
  }, [latest?.id, latest?.pair?.nativeConversation]);
  useEffect(() => {
    if (tab === 'conversation' && !attempt?.pair?.nativeConversation) setTab('artifact');
  }, [attempt?.id, attempt?.pair?.nativeConversation, tab]);
  const [edit, setEdit] = useState(Boolean(reportTarget?.edit && !historic));
  const [discussionPending, setDiscussionPending] = useState<string>();
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === 'reportDiscussionOpened' && message.requestId === discussionPending)
          setDiscussionPending(undefined);
      }),
    [discussionPending],
  );
  const [content, setContent] = useState(latest?.artifact?.content ?? '');
  const [savedContent, setSavedContent] = useState(latest?.artifact?.content ?? '');
  const [reason, setReason] = useState(''),
    [description, setDescription] = useState(feature.description),
    [descriptionChanged, setDescriptionChanged] = useState(false);
  const editStateKey = useRef(featureStateKey(feature));
  const editAttemptId = useRef(latest?.id);
  const editRevision = useRef(latest?.revision ?? 0);
  const dirty =
    content !== savedContent || (descriptionChanged && description !== feature.description);
  const [savePending, setSavePending] = useState(false),
    [saveError, setSaveError] = useState('');
  const [saveAck, setSaveAck] = useState<{
    revision: number;
    action: 'approve' | 'review';
  } | null>(null);
  const saveAction = useRef<'approve' | 'review' | null>(null);
  const savedBriefChanged = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  useEffect(() => {
    onDirtyChange(dirty || savePending);
    return () => onDirtyChange(false);
  }, [dirty, savePending]);
  useEffect(
    () =>
      subscribe((message) => {
        if (
          message.type !== 'artifactSaveResult' ||
          message.featureId !== feature.id ||
          message.stepId !== step.id ||
          !saveAction.current
        )
          return;
        const action = saveAction.current;
        saveAction.current = null;
        if (message.error) {
          setSavePending(false);
          setSaveError(message.error);
        } else if (message.attemptId === latest?.id && message.revision !== undefined)
          setSaveAck({ revision: message.revision, action });
      }),
    [feature.id, step.id, latest?.id],
  );
  useEffect(() => {
    if (!saveAck || latest?.revision !== saveAck.revision) return;
    setSavePending(false);
    setSaveAck(null);
    setSavedContent(latest.artifact?.content ?? '');
    setDescriptionChanged(false);
    setEdit(false);
    if (saveAck.action === 'review')
      onCorrection(
        step.id,
        reason.trim() || 'Relire et prendre en compte le compte rendu corrigé par Matt.',
        [],
        [],
        savedBriefChanged.current
          ? feature.steps.filter((item) => item.dependsOn.length === 0).map((item) => item.id)
          : [step.id],
      );
    else requestApproval(false);
  }, [saveAck, latest?.revision]);
  const saveReport = (action: 'approve' | 'review') => {
    if (!latest) return;
    setSavePending(true);
    setSaveError('');
    saveAction.current = action;
    savedBriefChanged.current = descriptionChanged && description !== feature.description;
    dispatch({
      type: 'saveArtifact',
      featureId: feature.id,
      stepId: step.id,
      content,
      expectedAttemptId: editAttemptId.current,
      expectedRevision: editRevision.current,
      expectedStateKey: editStateKey.current,
      ...(descriptionChanged ? { description } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
  };
  const [feedback, setFeedback] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [config, setConfig] = useState(false);
  const [launchResume, setLaunchResume] = useState<boolean | null>(null);
  const [launchPair, setLaunchPair] = useState(false);
  const [approvalPending, setApprovalPending] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const [reviewWarning, setReviewWarning] = useState<ReviewApprovalRequest | null>(null);
  function approveCurrent(warning?: ReviewApprovalRequest) {
    setApprovalError('');
    setApprovalPending(true);
    dispatch({
      type: 'approveStep',
      featureId: feature.id,
      stepId: step.id,
      expectedAttemptId: warning?.attemptId ?? latest?.id,
      expectedRevision: warning?.revision ?? latest?.revision ?? 0,
      ...(warning ? { expectedReviewWarningsKey: warning.key } : {}),
    });
  }
  function requestApproval(confirmClean = true) {
    const warning = reviewApprovalRequest(feature, step);
    if (warning) setReviewWarning(warning);
    else if (confirmClean)
      confirm(
        'Valider cette étape ?',
        'Cette décision approuve le livrable actuel et débloque les étapes qui en dépendent.',
        () => approveCurrent(),
      );
    else approveCurrent();
  }
  const approvalReasons =
    step.status === 'awaiting_review' ? approvalBlockers(feature, step, 'human') : [];
  useEffect(
    () =>
      subscribe((message) => {
        if (
          message.type === 'stepApprovalResult' &&
          message.featureId === feature.id &&
          message.stepId === step.id &&
          message.attemptId === latest?.id
        ) {
          setApprovalPending(false);
          setApprovalError(message.error ?? '');
        }
      }),
    [feature.id, step.id, latest?.id],
  );
  useEffect(() => {
    setApprovalError('');
    setApprovalPending(false);
  }, [latest?.id, latest?.revision]);
  useEffect(() => {
    const received = latest?.artifact?.content ?? '';
    if (received === content) setSavedContent(received);
    else if (!dirty) {
      setContent(received);
      setSavedContent(received);
    }
  }, [latest?.artifact?.content, dirty, content]);
  const running =
    hasActiveRun(state) ||
    Boolean(state.workspaceOperation) ||
    allFeatures(state.features).some((item) => item.autopilot?.status === 'running');
  const unlocked = step.dependsOn.every((id) =>
    stepResolved(feature.steps.find((s) => s.id === id)),
  );
  const canRun =
    state.workspace.trusted &&
    state.runtime.state === 'ready' &&
    !running &&
    unlocked &&
    !step.awaitsCorrection &&
    !subplanIssues(feature.steps).length &&
    !(feature.parent && feature.status === 'completed') &&
    !feature.archived &&
    (step.maxAttempts === 0 || step.attempts.length < step.maxAttempts);
  const next = feature.steps.find((s) => s.dependsOn.includes(step.id) && !stepResolved(s));
  const agent = state.agents.find((a) => a.id === step.agentId);
  const displayPolicy = step.inheritAgent && agent ? agentPolicy(agent) : step.policy;
  const unanswered = latest?.questions.filter((q) => !latest.answers[q.id]) ?? [];
  const blocked = step.awaitsCorrection
    ? 'Intervention ajoutée avant du travail réalisé : utilisez une route de correction.'
    : subplanIssues(feature.steps).length
      ? subplanIssues(feature.steps).join(' ')
      : !state.workspace.trusted
        ? 'Le projet doit être approuvé dans VS Code.'
        : state.runtime.state !== 'ready'
          ? 'Vérifiez la connexion Copilot avant de lancer une étape.'
          : !unlocked
            ? 'Validez les étapes précédentes pour débloquer celle-ci.'
            : step.maxAttempts > 0 && step.attempts.length >= step.maxAttempts
              ? `La limite de ${step.maxAttempts} tentative${step.maxAttempts > 1 ? 's' : ''} est atteinte.`
              : feature.archived
                ? 'Restaurez la session pour poursuivre.'
                : '';
  const run = (resume = false, pairMode = false) => {
    const action = () => {
      setLaunchPair(pairMode);
      setLaunchResume(resume);
    };
    if ((latest || stepResolved(step)) && !resume)
      confirm(
        step.status === 'skipped'
          ? 'Exécuter cette intervention passée ?'
          : step.status === 'approved'
            ? 'Rejouer une étape validée ?'
            : 'Relancer cette étape ?',
        stepResolved(step)
          ? 'Une nouvelle tentative sera créée. Les étapes suivantes deviennent à actualiser et devront être validées à nouveau. Les fichiers déjà modifiés restent présents.'
          : 'Une nouvelle tentative sera ajoutée à l’historique. Les modifications éventuelles du projet restent présentes.',
        action,
      );
    else action();
  };
  return (
    <div className="step-layout">
      {launchResume !== null && (
        <LaunchDialog
          pairMode={launchPair}
          onPairStarted={feature.execution ? () => setTab('conversation') : openPair}
          feature={feature}
          step={step}
          state={state}
          resume={launchResume}
          feedback={feedback}
          dispatch={dispatch}
          onClose={() => setLaunchResume(null)}
        />
      )}
      {reviewWarning && (
        <ReviewApprovalDialog
          warning={reviewWarning}
          disabled={
            running ||
            approvalPending ||
            approvalReasons.length > 0 ||
            Boolean(feature.archived) ||
            !state.workspace.trusted
          }
          onClose={() => setReviewWarning(null)}
          onConfirm={() => {
            approveCurrent(reviewWarning);
            setReviewWarning(null);
          }}
        />
      )}
      <section className="workbench">
        {step.status === 'skipped' && (
          <div className="optional-notice skipped-notice" role="status">
            <strong>
              {step.attempts.length
                ? 'Passée après tentative — non validée'
                : 'Passée par décision humaine — non exécutée'}
            </strong>
            <p>
              {step.attempts.length
                ? 'Tentatives et modifications conservées ; aucun résultat validé.'
                : 'Aucun livrable ni preuve de test.'}{' '}
              {step.optionalDecision?.at ? date(step.optionalDecision.at) : ''}
            </p>
          </div>
        )}
        {!feature.optionalRequest && (
          <OptionalStepChoice
            feature={feature}
            step={step}
            state={state}
            dispatch={dispatch}
            busy={running || dirty}
          />
        )}
        <div className="workbench-heading">
          <div>
            <span className="eyebrow">
              ÉTAPE {String(feature.steps.indexOf(step) + 1).padStart(2, '0')}
            </span>
            <h2>{step.name}</h2>
            <p>{step.description}</p>
            {acceptedReviewRemarks(step) && (
              <p role="status">Validée avec remarques — confirmation humaine enregistrée.</p>
            )}
          </div>
          <Badge {...statuses[step.status]} />
        </div>
        <div className="agent-strip">
          <Avatar agent={agent} status={step.status} small />
          <div>
            <strong>{agent?.nickname || agent?.name || step.agentId}</strong>
            <span>
              {(step.model ?? agent?.model) || state.settings.defaultModel || 'Modèle automatique'}
              <span className="inline-dot" />
              {feature.execution
                ? `Copilot natif · ${permissionLabels[feature.execution.permissionMode]}`
                : policyLabels[displayPolicy]}
            </span>
          </div>
          <button
            className="text-button"
            disabled={running || dirty || Boolean(feature.archived)}
            onClick={() => (step.subplan ? configureTeam() : setConfig(!config))}
            aria-expanded={config}
          >
            <Settings2 size={14} />
            {config ? 'Fermer' : 'Configurer'}
          </button>
        </div>
        {config && (
          <StepConfig
            native={Boolean(feature.execution)}
            key={`${step.agentId}-${step.model}-${step.skills.join(',')}`}
            step={step}
            state={state}
            save={(values) => {
              const action = () => {
                dispatch({
                  type: 'configureStep',
                  featureId: feature.id,
                  stepId: step.id,
                  ...values,
                });
                setConfig(false);
              };
              const contextChanged =
                values.agentId !== step.agentId ||
                (values.model ?? '') !== (step.model ?? '') ||
                (values.reasoning ?? '') !== (step.reasoning ?? '') ||
                JSON.stringify(values.skills) !== JSON.stringify(step.skills) ||
                (values.initialContext ?? '') !== (step.initialContext ?? '') ||
                JSON.stringify(values.mcpServerIds ?? []) !==
                  JSON.stringify(step.mcpServerIds ?? []) ||
                Boolean(values.askBeforeRun) !== Boolean(step.askBeforeRun);
              if (step.status === 'approved' && contextChanged)
                confirm(
                  'Modifier une étape validée ?',
                  'La configuration change le contexte du livrable. Les étapes suivantes deviennent à actualiser et devront être validées à nouveau.',
                  action,
                );
              else action();
            }}
          />
        )}
        <div className="workbench-tabs" role="tablist" aria-label="Contenu de l’étape">
          {attempt?.pair?.nativeConversation && (
            <button
              role="tab"
              id="tab-conversation"
              aria-controls="step-content"
              aria-selected={tab === 'conversation'}
              onClick={() => setTab('conversation')}
            >
              <MessageSquare size={15} /> Conversation
            </button>
          )}
          <button
            role="tab"
            id="tab-artifact"
            aria-controls="step-content"
            aria-selected={tab === 'artifact'}
            onClick={() => setTab('artifact')}
          >
            <FileText size={15} /> Livrable
          </button>
          <button
            role="tab"
            id="tab-activity"
            aria-controls="step-content"
            aria-selected={tab === 'activity'}
            onClick={() => setTab('activity')}
          >
            <Workflow size={15} /> Activité{' '}
            {attempt?.logs.length ? <span>{attempt.logs.length}</span> : null}
          </button>
          <button
            role="tab"
            id="tab-diffs"
            aria-controls="step-content"
            aria-selected={tab === 'diffs'}
            onClick={() => setTab('diffs')}
          >
            <FileCode2 size={15} /> Fichiers <span>{attempt?.changedFiles.length ?? 0}</span>
          </button>
          <button
            role="tab"
            id="tab-evidence"
            aria-controls="step-content"
            aria-selected={tab === 'evidence'}
            onClick={() => setTab('evidence')}
          >
            <ShieldCheck size={15} /> Preuves{' '}
            <span>{(attempt?.evidence?.length ?? 0) + (attempt?.nativeActivity?.length ?? 0)}</span>
          </button>
          <button
            role="tab"
            id="tab-review"
            aria-controls="step-content"
            aria-selected={tab === 'review'}
            onClick={() => setTab('review')}
          >
            <MessageSquare size={15} /> Relecture
          </button>
        </div>
        {attempt?.navigationRequest && (
          <NavigationInterventionCard
            featureId={feature.id}
            stepId={step.id}
            attempt={attempt}
            disabled={running || Boolean(feature.archived) || !state.workspace.trusted}
            dispatch={dispatch}
          />
        )}
        <div
          id="step-content"
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          className="workbench-content"
        >
          {tab === 'conversation' && attempt?.pair?.nativeConversation && (
            <SessionConversation
              key={attempt.id}
              feature={feature}
              step={step}
              attempt={attempt}
              state={state}
              dispatch={dispatch}
              showArtifact={() => setTab('artifact')}
            />
          )}
          {tab === 'evidence' && (
            <>
              <ProofDossierPanel
                key={attempt?.id ?? step.id}
                feature={feature}
                step={step}
                attempt={attempt}
                disabled={running || Boolean(feature.archived) || !state.workspace.trusted}
                dispatch={dispatch}
              />
              <details>
                <summary>Détails des outils et tests de cette tentative</summary>
                <EvidencePanel attempt={attempt} featureId={feature.id} dispatch={dispatch} />
              </details>
            </>
          )}
          {tab === 'review' && (
            <ReviewWorkspace
              key={`${attempt?.id}-${JSON.stringify(feature.criteria)}`}
              feature={feature}
              step={step}
              attempt={attempt}
              state={state}
              dispatch={dispatch}
              onCorrection={(text, commentId, findingId) =>
                onCorrection(
                  step.id,
                  text,
                  findingId ? [findingId] : [],
                  commentId ? [commentId] : [],
                )
              }
              correctionDisabled={running || dirty || historic || Boolean(feature.archived)}
            />
          )}
          {tab === 'artifact' &&
            (attempt?.artifact ? (
              <>
                <div className="artifact-toolbar">
                  <span>
                    <FileText size={13} />
                    {attempt.artifact.name}
                    {historic && <em>Tentative précédente</em>}
                  </span>
                  <AgentReportDownload
                    key={attempt.id}
                    featureId={feature.id}
                    stepId={step.id}
                    attempt={attempt}
                    unsaved={dirty || savePending}
                    dispatch={dispatch}
                  />
                  <button
                    className="text-button"
                    disabled={
                      dirty ||
                      savePending ||
                      Boolean(discussionPending) ||
                      attempt.status === 'running' ||
                      !state.workspace.trusted
                    }
                    onClick={() => {
                      if (attempt.pair?.nativeConversation) {
                        setTab('conversation');
                        return;
                      }
                      const requestId = crypto.randomUUID();
                      if (isHosted) setDiscussionPending(requestId);
                      dispatch({
                        type: 'openReportDiscussion',
                        requestId,
                        featureId: feature.id,
                        stepId: step.id,
                        attemptId: attempt.id,
                        revision: attempt.revision ?? 0,
                      });
                    }}
                  >
                    <MessageSquare size={14} />{' '}
                    {attempt.pair?.nativeConversation
                      ? 'Revenir à la conversation'
                      : discussionPending
                        ? 'Ouverture…'
                        : 'Discuter avec l’agent'}
                  </button>
                  {!historic && (
                    <button
                      className="text-button"
                      disabled={running || savePending || Boolean(feature.archived)}
                      onClick={() => {
                        if (!edit && !dirty) {
                          editStateKey.current = featureStateKey(feature);
                          editAttemptId.current = latest?.id;
                          editRevision.current = latest?.revision ?? 0;
                          setDescription(feature.description);
                          setSaveError('');
                        }
                        setEdit(!edit);
                      }}
                    >
                      {edit ? 'Fermer l’éditeur' : 'Modifier le compte rendu'} <Code2 size={13} />
                    </button>
                  )}
                </div>
                {!historic && (
                  <button
                    className="text-button report-correction-button"
                    disabled={
                      running ||
                      dirty ||
                      Boolean(feature.archived) ||
                      !['approved', 'awaiting_review', 'stale'].includes(step.status)
                    }
                    onClick={() => onCorrection(step.id, feedback || latest?.review?.summary || '')}
                  >
                    <RefreshCw size={14} />
                    Demander une correction
                  </button>
                )}
                {edit && !historic ? (
                  <ReportEditor
                    content={content}
                    onChange={setContent}
                    reason={reason}
                    onReason={setReason}
                    original={
                      latest?.artifactVersions?.find((v) => v.author === 'agent')?.content ??
                      latest?.artifact?.content ??
                      ''
                    }
                    descriptionVersions={feature.descriptionVersions}
                    description={description}
                    onDescription={setDescription}
                    descriptionChanged={descriptionChanged}
                    onDescriptionChanged={setDescriptionChanged}
                    versions={(latest?.artifactVersions ?? [])
                      .filter((v) => v.author === 'human')
                      .map((version) => {
                        const previous = latest?.artifactVersions
                          ?.filter((v) => v.revision < version.revision)
                          .at(-1);
                        return {
                          id: String(version.revision),
                          label: `Version ${version.revision + 1} · ${date(version.at)}`,
                          before: previous?.content ?? '',
                          after: version.content,
                          reason: version.reason,
                        };
                      })}
                    busy={running || savePending}
                    error={saveError}
                    dirty={dirty}
                    currentContent={latest?.artifact?.content ?? ''}
                    refreshBaseline={() => {
                      editStateKey.current = featureStateKey(feature);
                      editAttemptId.current = latest?.id;
                      editRevision.current = latest?.revision ?? 0;
                      setSavedContent(latest?.artifact?.content ?? '');
                      setSaveError('');
                    }}
                    discard={() =>
                      confirm(
                        'Abandonner ce brouillon ?',
                        'Les modifications non enregistrées de ce compte rendu et du besoin seront abandonnées.',
                        () => {
                          setContent(latest?.artifact?.content ?? '');
                          setSavedContent(latest?.artifact?.content ?? '');
                          setDescription(feature.description);
                          setDescriptionChanged(false);
                          setSaveError('');
                          setEdit(false);
                        },
                      )
                    }
                    blockers={[
                      ...approvalBlockers(feature, { ...step, status: 'awaiting_review' }, 'human'),
                      ...(running
                        ? [
                            state.workspaceOperation?.label ??
                              (allFeatures(state.features).some(
                                (item) => item.autopilot?.status === 'running',
                              )
                                ? 'Arrêtez le pilote avant de modifier le compte rendu.'
                                : 'Attendez la fin de l’exécution en cours.'),
                          ]
                        : []),
                      ...(!content.trim() ? ['Un compte rendu non vide est nécessaire.'] : []),
                      ...(descriptionChanged && description !== feature.description
                        ? [
                            'Le besoin modifié rend les étapes précédentes à revoir. Faites réviser par l’agent pour reprendre le parcours depuis le début.',
                          ]
                        : []),
                    ]}
                    save={() => saveReport('approve')}
                    review={() => saveReport('review')}
                  />
                ) : (
                  <article className="markdown">
                    <Markdown
                      remarkPlugins={[remarkGfm]}
                      urlTransform={(url) =>
                        /^feature-studio-review:[a-f0-9-]{36}$/.test(url)
                          ? url
                          : defaultUrlTransform(url)
                      }
                      components={{
                        a: ({ href, children }) =>
                          /^feature-studio-review:[a-f0-9-]{36}$/.test(href ?? '') ? (
                            <button
                              type="button"
                              className="text-button"
                              onClick={() =>
                                dispatch({
                                  type: 'openPersonalReviewReport',
                                  sessionId: href!.slice('feature-studio-review:'.length),
                                })
                              }
                            >
                              {children}
                            </button>
                          ) : (
                            <a href={href} target="_blank" rel="noreferrer">
                              {children}
                              <ExternalLink size={11} />
                            </a>
                          ),
                      }}
                    >
                      {historic ? attempt.artifact.content : content}
                    </Markdown>
                  </article>
                )}
              </>
            ) : (
              <Empty
                title={
                  step.status === 'running'
                    ? 'Votre agent est à l’œuvre'
                    : 'Un espace pour le prochain livrable'
                }
                icon={step.status === 'running' ? <LoaderCircle className="spin" /> : <FileText />}
              >
                {step.status === 'running'
                  ? 'Suivez sa progression dans l’activité. Le résultat apparaîtra ici à la fin de la tentative.'
                  : 'Lancez cette étape pour obtenir un premier livrable. Vous pourrez ensuite le lire, l’ajuster et le valider.'}
              </Empty>
            ))}
          {tab === 'activity' && (
            <div className="activity-list" aria-live={step.status === 'running' ? 'polite' : 'off'}>
              {attempt?.traceArchive && (
                <TraceJournal featureId={feature.id} attemptId={attempt.id} dispatch={dispatch} />
              )}
              {attempt?.logs.map((log) => (
                <div key={log.id} className={`activity-event ${log.kind}`}>
                  <span className="event-marker">
                    {log.kind === 'error' ? (
                      <X size={12} />
                    ) : log.kind === 'tool' ? (
                      <Code2 size={12} />
                    ) : log.kind === 'warning' ? (
                      <TriangleAlert size={12} />
                    ) : (
                      <Circle size={9} />
                    )}
                  </span>
                  <div>
                    <time>
                      {new Intl.DateTimeFormat('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      }).format(new Date(log.at))}
                    </time>
                    <p>{log.message}</p>
                  </div>
                </div>
              ))}
              {!attempt?.logs.length && (
                <Empty title="L’histoire commence à la première exécution" icon={<Workflow />}>
                  Les messages et les appels d’outils de l’agent apparaîtront ici.
                </Empty>
              )}
              {step.status === 'running' && (
                <div className="stream-indicator">
                  <LoaderCircle className="spin" size={14} /> Exécution en cours…
                </div>
              )}
            </div>
          )}
          {tab === 'diffs' &&
            (attempt?.changedFiles.length ? (
              <div className="changed-files">
                <p>
                  Fichiers signalés par cette tentative. Ouvrez leur diff dans VS Code pour relire
                  les changements.
                </p>
                {attempt.changedFiles.map((path) => (
                  <div key={path}>
                    <FileCode2 size={16} />
                    <span title={path}>{path}</span>
                    <button
                      className="text-button"
                      onClick={() =>
                        dispatch({
                          type: 'openFile',
                          path,
                          featureId: feature.id,
                        })
                      }
                    >
                      Ouvrir
                    </button>
                    <button
                      className="button secondary small"
                      onClick={() =>
                        dispatch({
                          type: 'openDiff',
                          path,
                          featureId: feature.id,
                        })
                      }
                    >
                      Voir le diff <ArrowUpRight size={13} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="Aucun fichier signalé" icon={<FileCode2 />}>
                Cette tentative ne déclare aucun fichier modifié. L’historique Git du projet reste
                la référence.
              </Empty>
            ))}
        </div>
      </section>
      <aside className="step-aside">
        {tab !== 'conversation' && (
          <HumanRequests
            requests={(state.humanRequests ?? []).filter(
              (r) => r.featureId === feature.id && r.stepId === step.id,
            )}
            dispatch={dispatch}
          />
        )}
        <div className="decision-card">
          <span className="eyebrow">À VOUS DE DONNER LE CAP</span>
          <h3>
            {step.status === 'approved'
              ? 'Une étape de plus.'
              : step.status === 'running'
                ? 'Ça prend forme.'
                : step.status === 'waiting_input'
                  ? 'Votre regard est nécessaire.'
                  : step.status === 'awaiting_review'
                    ? 'Prêt pour votre regard.'
                    : 'Faisons le prochain pas.'}
          </h3>
          <p>
            {step.status === 'approved'
              ? 'Le livrable a été validé. Vous pouvez ouvrir la suite du parcours.'
              : step.status === 'running'
                ? 'L’agent travaille dans le cadre des permissions de cette étape.'
                : step.status === 'awaiting_review'
                  ? 'Lisez le livrable, affinez-le si nécessaire, puis validez pour avancer.'
                  : 'Votre retour accompagne l’agent dans sa prochaine tentative.'}
          </p>
          {latest?.error && (
            <div className="inline-error">
              <TriangleAlert size={15} />
              <span>{latest.error}</span>
            </div>
          )}
          {unanswered.length > 0 && tab !== 'conversation' && (
            <form
              className="questions-form"
              onSubmit={(e) => {
                e.preventDefault();
                dispatch({
                  type: 'answerQuestions',
                  featureId: feature.id,
                  stepId: step.id,
                  answers,
                });
              }}
            >
              {unanswered.map((q) => (
                <label className="field" key={q.id}>
                  <span>{q.text}</span>
                  {q.choices?.length ? (
                    <select
                      required
                      value={answers[q.id] ?? ''}
                      onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    >
                      <option value="">Choisir une réponse…</option>
                      {q.choices.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      required
                      rows={2}
                      value={answers[q.id] ?? ''}
                      onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    />
                  )}
                </label>
              ))}
              <button
                className="button primary"
                disabled={
                  !state.workspace.trusted ||
                  Boolean(feature.archived) ||
                  !unanswered.every((q) => answers[q.id]?.trim())
                }
              >
                <Send size={15} /> Transmettre les réponses
              </button>
            </form>
          )}
          {!latest?.pair?.nativeConversation &&
            !['running', 'waiting_input'].includes(step.status) && (
              <label className="field feedback-field">
                <span>
                  Votre retour <small>facultatif</small>
                </span>
                <textarea
                  rows={4}
                  placeholder="Un détail à préciser, une autre direction à explorer…"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                />
              </label>
            )}
          <div className="decision-actions">
            {step.attempts.some((a) => a.pair) && (
              <button
                className="button secondary"
                disabled={dirty}
                onClick={latest?.pair?.nativeConversation ? () => setTab('conversation') : openPair}
              >
                <MessageSquare size={14} />{' '}
                {latest?.pair?.nativeConversation
                  ? 'Ouvrir la conversation'
                  : !latest?.pair
                    ? 'Consulter les échanges en pair'
                    : latest.pair.busy
                      ? 'Rejoindre le travail en pair'
                      : 'Ouvrir le travail en pair'}
              </button>
            )}
            {!latest?.pair && step.status !== 'running' && (
              <button
                className="button secondary"
                disabled={!canRun || dirty}
                onClick={() => run(false, true)}
              >
                <MessageSquare size={14} /> Démarrer en mode pair
              </button>
            )}
            {latest?.pair && step.status !== 'running' && (
              <button
                className="button secondary"
                disabled={!canRun || dirty}
                onClick={() => run(false, true)}
              >
                <MessageSquare size={14} /> Nouvelle tentative en pair
              </button>
            )}
            {step.status === 'running' ? (
              <button
                className="button secondary"
                onClick={() =>
                  confirm(
                    'Arrêter cette exécution ?',
                    'La tentative sera annulée. Les modifications déjà effectuées dans le projet seront conservées.',
                    () => dispatch({ type: 'cancelRun', featureId: feature.id }),
                  )
                }
              >
                <Square size={14} /> Arrêter l’exécution
              </button>
            ) : step.status === 'approved' ? (
              <>
                {next ? (
                  <button className="button primary" onClick={() => selectStep(next.id)}>
                    Continuer vers {next.name}
                    <ArrowRight size={15} />
                  </button>
                ) : (
                  <div className="completion-note">
                    <CheckCircle2 size={18} />{' '}
                    {feature.status === 'completed'
                      ? 'Décision finale enregistrée — session terminée'
                      : `Étape validée. ${featureCompletionBlockers(feature).join(' ') || (feature.steps.every(stepResolved) ? 'Le bilan final attend votre décision.' : 'D’autres étapes restent à valider.')}`}
                  </div>
                )}
                <button
                  className="button secondary"
                  disabled={!canRun || dirty}
                  onClick={() => run()}
                >
                  <RefreshCw size={14} /> Rejouer cette étape
                </button>
              </>
            ) : (
              <>
                {step.status === 'awaiting_review' && (
                  <>
                    {approvalReasons.length > 0 && (
                      <div className="approval-blockers" role="status">
                        <strong>Validation bloquée</strong>
                        <ul>
                          {approvalReasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                        <button className="button secondary" onClick={() => setTab('review')}>
                          Voir les critères et commentaires
                        </button>
                      </div>
                    )}
                    {approvalError && (
                      <div className="approval-blockers" role="alert">
                        <strong>La validation n’a pas été enregistrée</strong>
                        <p>{approvalError}</p>
                      </div>
                    )}
                    <button
                      className="button primary"
                      disabled={
                        approvalPending ||
                        approvalReasons.length > 0 ||
                        running ||
                        dirty ||
                        Boolean(feature.archived) ||
                        !state.workspace.trusted ||
                        Boolean(state.workspaceOperation)
                      }
                      onClick={() => requestApproval()}
                    >
                      {approvalPending ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <Check size={16} />
                      )}{' '}
                      {approvalPending
                        ? 'Validation en cours…'
                        : step.subplan
                          ? 'Valider l’ensemble des sous-tâches'
                          : 'Valider cette étape'}
                    </button>
                  </>
                )}
                {latest?.sessionId &&
                  !latest.pair &&
                  ['failed', 'cancelled', 'interrupted', 'waiting_input'].includes(step.status) && (
                    <button
                      className="button secondary"
                      disabled={!canRun || dirty || unanswered.length > 0}
                      onClick={() => run(true)}
                    >
                      <RefreshCw size={15} /> Reprendre la session
                    </button>
                  )}
                {step.status !== 'waiting_input' && (
                  <button
                    className={`button ${step.status === 'awaiting_review' ? 'secondary' : 'primary'}`}
                    disabled={!canRun || dirty}
                    onClick={() => run()}
                  >
                    <Play size={14} />
                    {step.status === 'skipped'
                      ? 'Exécuter finalement cette étape'
                      : latest
                        ? 'Nouvelle tentative'
                        : 'Exécuter cette étape'}
                  </button>
                )}
              </>
            )}
          </div>
          {dirty && (
            <p className="action-help">
              Enregistrez vos modifications avant de valider ou relancer.
            </p>
          )}
          {blocked && step.status !== 'running' && (
            <p className="action-help">
              {blocked}
              {step.maxAttempts > 0 && step.attempts.length >= step.maxAttempts && (
                <button
                  className="text-button"
                  disabled={running || Boolean(feature.archived)}
                  onClick={() => setConfig(true)}
                >
                  Modifier la limite <Settings2 size={12} />
                </button>
              )}
              {state.runtime.state !== 'ready' && (
                <button className="text-button" onClick={() => dispatch({ type: 'checkRuntime' })}>
                  Vérifier Copilot <RefreshCw size={12} />
                </button>
              )}
            </p>
          )}
        </div>
        <div className="history-card">
          <div className="section-heading">
            <h3>Les tentatives</h3>
            <span className="count-pill">{step.attempts.length}</span>
          </div>
          {step.attempts.length ? (
            <div className="attempt-list">
              {[...step.attempts].reverse().map((a, i) => (
                <button
                  key={a.id}
                  className={a.id === attempt?.id ? 'active' : ''}
                  disabled={dirty || savePending}
                  onClick={() => {
                    setAttemptId(a.id);
                    setEdit(false);
                  }}
                >
                  <span className="attempt-dot">
                    <Circle size={10} />
                  </span>
                  <span>
                    <strong>Tentative {step.attempts.length - i}</strong>
                    <small>{date(a.startedAt)}</small>
                  </span>
                  <span className={`attempt-state ${statuses[a.status].tone}`}>
                    {statuses[a.status].label}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted history-empty">
              Une trace de chaque essai,
              <br />
              dès le premier lancement.
            </p>
          )}
          <AttemptCheckpointLinks
            feature={feature}
            attempt={attempt}
            state={state}
            dispatch={dispatch}
          />
          {attempt?.usage && (
            <div className="usage-note">
              <span>Consommation mesurée</span>
              {attempt.usage.inputTokens !== undefined && (
                <span>Entrée : {attempt.usage.inputTokens.toLocaleString('fr-FR')} tokens</span>
              )}
              {attempt.usage.outputTokens !== undefined && (
                <span>Sortie : {attempt.usage.outputTokens.toLocaleString('fr-FR')} tokens</span>
              )}
              {<span>{usageCredits(attempt.usage)}</span>}
            </div>
          )}
        </div>
        <div className="step-policy">
          <ShieldCheck size={16} />
          <div>
            {feature.execution ? (
              <PermissionPicker
                state={state}
                value={feature.execution.permissionMode}
                disabled={
                  Boolean(feature.archived) ||
                  Boolean(
                    state.humanRequests?.some((request) => request.featureId === feature.id),
                  ) ||
                  Boolean(
                    attempt?.pair?.busy &&
                      !['work', 'solo'].includes(attempt.pair.turn?.kind ?? ''),
                  )
                }
                onChange={(mode) =>
                  dispatch({ type: 'setPermissionMode', featureId: feature.id, mode })
                }
              />
            ) : (
              <>
                <strong>{policyLabels[displayPolicy]}</strong>
                <p>
                  {displayPolicy === 'read-only'
                    ? 'Cette étape est destinée à analyser et proposer.'
                    : displayPolicy === 'tests'
                      ? 'Seules les commandes de test configurées sont autorisées.'
                      : 'L’agent peut modifier les fichiers du projet pendant cette étape.'}
                </p>
              </>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
