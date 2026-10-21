import { allFeatures } from '../src/shared/subplans';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  Clock3,
  FileCode2,
  FolderOpen,
  GitBranch,
  History,
  Layers,
  LoaderCircle,
  Plus,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import type {
  CheckpointComparison,
  Attempt,
  Feature,
  FeatureCheckpoint,
  StudioState,
} from '../src/shared/types';
import { isDemo, subscribe } from './bridge';
import { StudioDialog, type Dispatch } from './ExecutionUI';
import './workspaces.css';
const kinds: Record<FeatureCheckpoint['kind'], string> = {
  'before-run': 'Avant la tentative',
  'after-run': 'Après la tentative',
  manual: 'Point manuel',
  recovery: 'Sauvegarde de restauration',
};
const stamp = (value: string) =>
  new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
const size = (value: number) =>
  value < 1024
    ? `${value} o`
    : value < 1024 * 1024
      ? `${(value / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Ko`
      : `${(value / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
export const hasActiveRun = (state: StudioState) =>
  allFeatures(state.features).some((f) => f.steps.some((s) => s.status === 'running'));
export function WorkspaceChoice({
  state,
  isolated,
  onChange,
}: {
  state: StudioState;
  isolated: boolean;
  onChange: (isolated: boolean) => void;
}) {
  return (
    <fieldset className="workspace-choice">
      <legend>
        <GitBranch size={14} /> L’espace de cette session
      </legend>
      <div className="workspace-choice-options">
        <label className={!isolated ? 'selected' : ''}>
          <input
            type="radio"
            name="feature-space"
            value="current"
            checked={!isolated}
            onChange={() => onChange(false)}
          />
          <span>
            <strong>Dossier courant</strong>
            <small>
              Travailler sur les fichiers et les changements déjà présents dans le projet.
            </small>
          </span>
        </label>
        <label
          className={`${isolated ? 'selected' : ''} ${!state.workspace.canIsolate ? 'unavailable' : ''}`}
        >
          <input
            type="radio"
            name="feature-space"
            value="isolated"
            checked={isolated}
            disabled={!state.workspace.canIsolate}
            onChange={() => onChange(true)}
          />
          <span>
            <strong>Worktree isolé</strong>
            <small>Une branche et un dossier Git dédiés à cette nouvelle session.</small>
          </span>
        </label>
      </div>
      <p className="workspace-choice-note">
        {isolated ? (
          <>
            <ShieldCheck size={13} /> Départ du dernier commit de la branche courante uniquement.
            Les changements non commités restent dans le dossier source ; ils ne sont pas copiés.
          </>
        ) : (
          <>
            <FolderOpen size={13} /> Le dossier courant convient à la relecture des changements
            existants. Les autres sessions qui l’utilisent partagent ses fichiers.
          </>
        )}
      </p>
      {!state.workspace.canIsolate && (
        <p className="workspace-unavailable">
          <TriangleAlert size={13} />
          {state.workspace.isolationReason ??
            'La création d’un worktree n’est pas disponible dans ce projet.'}
        </p>
      )}
    </fieldset>
  );
}
export function GitWorkspacePanel({
  feature,
  state,
  dispatch,
}: {
  feature: Feature;
  state: StudioState;
  dispatch: Dispatch;
}) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(feature.projects?.[0]?.id ?? '');
  const project = feature.projects?.find((item) => item.id === projectId);
  const multi = (feature.projects?.length ?? 0) > 1;
  const path = feature.worktree?.path ?? project?.path ?? state.workspace.path;
  const branch =
    feature.worktree?.branch ?? project?.branch ?? feature.branch ?? state.workspace.branch;
  const count = feature.checkpoints?.length ?? 0;
  return (
    <>
      <section className={`git-workspace-band ${feature.worktree ? 'isolated' : 'shared'}`}>
        <span className="workspace-band-symbol">
          {feature.worktree ? <GitBranch size={20} /> : <FolderOpen size={20} />}
        </span>
        <div className="workspace-band-info">
          <div>
            <span className="eyebrow">ESPACE GIT</span>
            <span className="workspace-mode">
              {feature.worktree
                ? 'Worktree isolé'
                : multi
                  ? 'Projets de la session'
                  : 'Dossier courant'}
            </span>
          </div>
          {multi && (
            <select
              aria-label="Projet Git"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {feature.projects!.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
          <strong title={path}>{path}</strong>
          <span className="workspace-band-meta">
            <GitBranch size={12} />
            {branch || 'Branche non disponible'}
            {feature.worktree && (
              <>
                <span>·</span>
                <span title={feature.worktree.baseCommit}>
                  Créé depuis {feature.worktree.baseBranch} ·{' '}
                  {feature.worktree.baseCommit.slice(0, 8)}
                </span>
              </>
            )}
          </span>
        </div>
        <div className="workspace-band-actions">
          <button
            className="text-button"
            onClick={() =>
              dispatch({
                type: 'openFeatureWorkspace',
                featureId: feature.id,
                ...(multi ? { projectId } : {}),
              })
            }
          >
            <FolderOpen size={13} /> Ouvrir le dossier <ArrowRight size={12} />
          </button>
          <button className="button secondary small" onClick={() => setOpen(true)}>
            <History size={14} /> Points de restauration <span className="count-pill">{count}</span>
          </button>
        </div>
      </section>
      {open && (
        <CheckpointPanel
          feature={feature}
          state={state}
          dispatch={dispatch}
          onClose={() => setOpen(false)}
          initialProjectId={multi ? projectId : undefined}
        />
      )}
    </>
  );
}
function CheckpointPanel({
  feature,
  state,
  dispatch,
  onClose,
  initialCheckpointId,
  initialTargetCheckpointId,
  initialProjectId,
}: {
  feature: Feature;
  state: StudioState;
  dispatch: Dispatch;
  onClose: () => void;
  initialCheckpointId?: string;
  initialTargetCheckpointId?: string;
  initialProjectId?: string;
}) {
  const multi = (feature.projects?.length ?? 0) > 1;
  const [projectId, setProjectId] = useState(
    initialProjectId ??
      feature.checkpoints?.find((point) => point.id === initialCheckpointId)?.projectId ??
      feature.projects?.[0]?.id ??
      '',
  );
  const snapshots = [...(feature.checkpoints ?? [])]
    .filter((point) => !multi || point.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const attemptLabel = (snapshot: FeatureCheckpoint) => {
    const index =
      feature.steps
        .find((s) => s.id === snapshot.stepId)
        ?.attempts.findIndex((a) => a.id === snapshot.attemptId) ?? -1;
    return index >= 0 ? `tentative ${index + 1}` : `tentative ${snapshot.attemptId}`;
  };
  const [sourceId, setSourceId] = useState(initialCheckpointId ?? snapshots[0]?.id ?? '');
  const [targetId, setTargetId] = useState(initialTargetCheckpointId ?? '');
  const [comparison, setComparison] = useState<CheckpointComparison | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(false);
  const request = useRef('');
  const mutationPending = useRef(false);
  const expected = useRef<{ checkpointId: string; targetCheckpointId?: string } | null>(null);
  const [resultNotice, setResultNotice] = useState('');
  const busy = Boolean(state.workspaceOperation) || hasActiveRun(state);
  const canMutate = state.workspace.trusted && !busy && !feature.archived;
  const source = snapshots.find((s) => s.id === sourceId);
  const target = snapshots.find((s) => s.id === targetId);
  const invalidate = () => {
    request.current = '';
    expected.current = null;
    setComparison(null);
    setSelected([]);
    setPending(false);
    setError('');
    setConfirmRestore(false);
  };
  const revision = JSON.stringify({
    projectId,
    path: feature.worktree?.path ?? state.workspace.path,
    checkpoints: feature.checkpoints,
    operation: state.workspaceOperation?.readOnly ? undefined : state.workspaceOperation,
    steps: feature.steps.map((s) => ({
      id: s.id,
      status: s.status,
      last: s.attempts.at(-1)?.id,
      finished: s.attempts.at(-1)?.finishedAt,
      revision: s.attempts.at(-1)?.revision,
    })),
  });
  const previousRevision = useRef(revision);
  useEffect(() => {
    if (previousRevision.current !== revision) {
      previousRevision.current = revision;
      invalidate();
    }
    if (!snapshots.some((s) => s.id === sourceId)) setSourceId(snapshots[0]?.id ?? '');
    if (targetId && !snapshots.some((s) => s.id === targetId)) setTargetId('');
  }, [revision, sourceId, targetId]);
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === 'checkpointComparison' && message.requestId === request.current) {
          setPending(false);
          if (
            message.comparison.featureId !== feature.id ||
            message.comparison.checkpointId !== expected.current?.checkpointId ||
            (message.comparison.targetCheckpointId ?? '') !==
              (expected.current?.targetCheckpointId ?? '')
          ) {
            setError('La comparaison ne correspond pas à cette session.');
            return;
          }
          setComparison(message.comparison);
          setSelected([]);
        }
        if (message.type === 'error' && (request.current || mutationPending.current)) {
          setPending(false);
          setError(message.message);
          setComparison(null);
          setSelected([]);
          setConfirmRestore(false);
          mutationPending.current = false;
        }
        if (message.type === 'notice' && mutationPending.current) {
          setResultNotice(message.message);
          mutationPending.current = false;
        }
      }),
    [feature.id],
  );
  const compare = () => {
    if (!source || busy) return;
    const id = crypto.randomUUID();
    request.current = id;
    expected.current = {
      checkpointId: source.id,
      ...(targetId ? { targetCheckpointId: targetId } : {}),
    };
    setResultNotice('');
    setComparison(null);
    setSelected([]);
    setPending(!isDemo);
    setConfirmRestore(false);
    setError(isDemo ? 'Démonstration : aucune comparaison de fichiers n’a été effectuée.' : '');
    dispatch({
      type: 'compareCheckpoint',
      requestId: id,
      featureId: feature.id,
      checkpointId: source.id,
      ...(targetId ? { targetCheckpointId: targetId } : {}),
    });
  };
  const currentComparison = Boolean(
    comparison &&
      comparison.checkpointId === sourceId &&
      (comparison.targetCheckpointId ?? '') === targetId,
  );
  const restorable = comparison?.files.filter((f) => f.restorable).map((f) => f.path) ?? [];
  const allowed =
    selected.length > 0 &&
    canMutate &&
    currentComparison &&
    !targetId &&
    !pending &&
    selected.every((path) => restorable.includes(path));
  return (
    <StudioDialog
      title="Le code garde des points de repère."
      subtitle={`${feature.title} · ${feature.worktree ? 'worktree isolé' : 'dossier courant'}. Comparer et restaurer ces fichiers ne demande aucun appel IA.`}
      onClose={onClose}
      className="checkpoint-dialog"
    >
      {resultNotice && (
        <div className="checkpoint-result" role="status">
          {resultNotice}
        </div>
      )}
      {multi && (
        <label className="field">
          <span>Projet du point de restauration</span>
          <select
            aria-label="Projet du point de restauration"
            value={projectId}
            disabled={busy}
            onChange={(event) => {
              setProjectId(event.target.value);
              invalidate();
            }}
          >
            {feature.projects!.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="checkpoint-grid">
        <section className="checkpoint-history">
          <div className="section-heading">
            <h3>
              <History size={15} /> Points de restauration
            </h3>
            <button
              className="text-button"
              disabled={!canMutate}
              onClick={() => {
                setCreating(!creating);
                setLabel('');
              }}
            >
              <Plus size={13} /> Nouveau point
            </button>
          </div>
          {creating && (
            <div className="checkpoint-create">
              <label className="field">
                <span>Nom du point manuel</span>
                <input
                  autoFocus
                  maxLength={200}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Avant de simplifier la navigation"
                />
              </label>
              <button
                className="button secondary small"
                disabled={!label.trim() || !canMutate}
                onClick={() => {
                  mutationPending.current = true;
                  setResultNotice('');
                  dispatch({
                    type: 'createCheckpoint',
                    featureId: feature.id,
                    label: label.trim(),
                    ...(multi ? { projectId } : {}),
                  });
                  setCreating(false);
                  setLabel('');
                }}
              >
                Créer le point <Check size={13} />
              </button>
            </div>
          )}
          <div className="checkpoint-list">
            {snapshots.map((snapshot) => (
              <button
                key={snapshot.id}
                className={sourceId === snapshot.id ? 'selected' : ''}
                onClick={() => {
                  setSourceId(snapshot.id);
                  if (targetId === snapshot.id) setTargetId('');
                  invalidate();
                }}
                aria-pressed={sourceId === snapshot.id}
              >
                <span className={`checkpoint-kind ${snapshot.kind}`}>
                  <span />
                  {kinds[snapshot.kind]}
                </span>
                <strong>{snapshot.label}</strong>
                <span className="checkpoint-time">
                  <Clock3 size={10} />
                  {stamp(snapshot.createdAt)}
                </span>
                <small>
                  {snapshot.branch} · {snapshot.head.slice(0, 8)}
                </small>
                <small>
                  {snapshot.fileCount} fichiers · {size(snapshot.totalBytes)}
                  {snapshot.excludedCount > 0 ? ` · ${snapshot.excludedCount} exclus` : ''}
                </small>
                {snapshot.stepId && (
                  <em>
                    {feature.steps.find((s) => s.id === snapshot.stepId)?.name ?? snapshot.stepId}
                    {snapshot.attemptId ? ` · ${attemptLabel(snapshot)}` : ''}
                  </em>
                )}
              </button>
            ))}
          </div>
          {!snapshots.length && (
            <div className="checkpoint-empty">
              <Layers size={28} />
              <h3>Un premier repère à garder.</h3>
              <p>
                {feature.worktree
                  ? 'Les tentatives créent des points avant et après leur exécution. Vous pouvez aussi en créer un maintenant.'
                  : 'Les anciens parcours restent dans le dossier courant. Créez un point manuel pour conserver son état Git.'}
              </p>
            </div>
          )}
          <div className="checkpoint-history-note">
            <ShieldCheck size={14} />
            <p>
              {feature.worktree
                ? 'Les points automatiques accompagnent les tentatives de ce worktree.'
                : 'Les points automatiques sont réservés aux nouvelles sessions en worktree.'}{' '}
              Les fichiers exclus ne font pas partie des points de restauration.
            </p>
          </div>
        </section>
        <section className="checkpoint-comparison">
          <div className="section-heading">
            <h3>
              <ArrowLeftRight size={15} /> Comparer le code
            </h3>
            <span className="muted">{comparison?.files.length ?? 0} changements</span>
          </div>
          {source ? (
            <>
              <div className="comparison-direction">
                <span>
                  <strong>{source.label}</strong>
                  <small>
                    {stamp(source.createdAt)} · {source.head.slice(0, 8)}
                  </small>
                </span>
                <ArrowRight size={17} />
                <label className="field">
                  <span className="sr-only">Cible de la comparaison</span>
                  <select
                    aria-label="Cible de la comparaison"
                    value={targetId}
                    onChange={(e) => {
                      setTargetId(e.target.value);
                      invalidate();
                    }}
                  >
                    <option value="">État actuel du dossier</option>
                    {snapshots
                      .filter((s) => s.id !== source.id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label} · {stamp(s.createdAt)}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="comparison-toolbar">
                <button
                  className="button secondary small"
                  disabled={busy || pending}
                  onClick={compare}
                >
                  {pending ? (
                    <LoaderCircle size={13} className="spin" />
                  ) : (
                    <ArrowLeftRight size={13} />
                  )}{' '}
                  {comparison ? 'Actualiser la comparaison' : 'Comparer les fichiers'}
                </button>
                {targetId && (
                  <span className="field-help">
                    Comparaison de deux points : consultation uniquement.
                  </span>
                )}
              </div>
              {source.excludedCount > 0 && (
                <details className="snapshot-exclusions">
                  <summary>
                    <TriangleAlert size={12} /> {source.excludedCount} fichier
                    {source.excludedCount > 1 ? 's' : ''} exclu{source.excludedCount > 1 ? 's' : ''}{' '}
                    de ce point
                  </summary>
                  <ul>
                    {source.excludedPaths.map((path) => (
                      <li key={path}>{path}</li>
                    ))}
                  </ul>
                </details>
              )}
              {error && (
                <div className="inline-error" role="alert">
                  <TriangleAlert size={14} />
                  {error}
                </div>
              )}
              {comparison && currentComparison ? (
                <>
                  <div className="restore-selection-heading">
                    <span>
                      {targetId
                        ? 'Fichiers différents entre ces points'
                        : 'Choisissez explicitement les fichiers à restaurer'}
                    </span>
                    {!targetId && restorable.length > 0 && (
                      <button
                        className="text-button"
                        disabled={!canMutate}
                        onClick={() =>
                          setSelected(selected.length === restorable.length ? [] : restorable)
                        }
                      >
                        {selected.length === restorable.length
                          ? 'Tout désélectionner'
                          : 'Sélectionner les fichiers restaurables'}
                      </button>
                    )}
                  </div>
                  <div className="checkpoint-changes">
                    {comparison.files.map((file) => (
                      <div
                        className={`checkpoint-change ${file.status} ${selected.includes(file.path) ? 'selected' : ''}`}
                        key={file.path}
                      >
                        {!targetId && (
                          <input
                            type="checkbox"
                            aria-label={`Restaurer ${file.path}`}
                            checked={selected.includes(file.path)}
                            disabled={!file.restorable || !canMutate}
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? [...selected, file.path]
                                  : selected.filter((path) => path !== file.path),
                              )
                            }
                          />
                        )}
                        <span className={`change-symbol ${file.status}`}>
                          {file.status === 'added' ? '+' : file.status === 'deleted' ? '−' : '~'}
                        </span>
                        <div>
                          <strong title={file.path}>{file.path}</strong>
                          <small>
                            {targetId
                              ? file.status === 'added'
                                ? 'Ajouté dans la cible'
                                : file.status === 'deleted'
                                  ? 'Absent de la cible'
                                  : 'Contenu différent'
                              : file.status === 'added'
                                ? 'Ajouté depuis ce point · la restauration le supprimera'
                                : file.status === 'deleted'
                                  ? 'Supprimé depuis ce point · la restauration le recréera'
                                  : 'Modifié depuis ce point · la restauration remplacera son contenu'}
                            {file.binary ? ' · binaire' : ''}
                          </small>
                          {file.reason && <em>{file.reason}</em>}
                        </div>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            dispatch({
                              type: 'openCheckpointDiff',
                              featureId: feature.id,
                              checkpointId: source.id,
                              ...(targetId ? { targetCheckpointId: targetId } : {}),
                              path: file.path,
                            })
                          }
                        >
                          <FileCode2 size={13} /> Diff
                        </button>
                      </div>
                    ))}
                  </div>
                  {!comparison.files.length && (
                    <div className="checkpoint-empty">
                      <Check size={27} />
                      <h3>Aucune différence signalée.</h3>
                      <p>Les fichiers inclus dans cette comparaison sont identiques.</p>
                    </div>
                  )}
                  {!targetId && comparison.files.length > 0 && (
                    <div className="restore-footer">
                      <p>
                        <strong>
                          {selected.length} fichier{selected.length > 1 ? 's' : ''} sélectionné
                          {selected.length > 1 ? 's' : ''}
                        </strong>
                        <span>
                          Une sauvegarde automatique sera créée avant restauration. Les validations
                          de ce parcours seront invalidées.
                        </span>
                      </p>
                      <button
                        className="button primary small"
                        disabled={!allowed}
                        onClick={() => setConfirmRestore(true)}
                      >
                        <RotateCcw size={13} /> Restaurer la sélection
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="checkpoint-empty">
                  <ArrowLeftRight size={27} />
                  <h3>Un avant, un après, une décision claire.</h3>
                  <p>
                    Comparez ce point au dossier actuel ou à un autre point. Aucun fichier n’est
                    modifié par une comparaison.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="checkpoint-empty">
              <History size={28} />
              <h3>Choisissez un point de départ.</h3>
              <p>Les fichiers de cette session restent à leur emplacement actuel.</p>
            </div>
          )}
        </section>
      </div>
      {state.workspaceOperation && (
        <div className="workspace-operation">
          <LoaderCircle className="spin" size={14} />
          {state.workspaceOperation.label}
        </div>
      )}
      {hasActiveRun(state) && (
        <p className="field-help">
          Une tentative est en cours. Les opérations sur les points de restauration seront
          disponibles après son arrêt.
        </p>
      )}
      <div className="modal-actions">
        <span className="muted">{feature.worktree?.path ?? state.workspace.path}</span>
        <button className="button secondary" onClick={onClose}>
          Fermer les points
        </button>
      </div>
      {confirmRestore && comparison && (
        <div
          className="restore-confirm"
          role="alertdialog"
          aria-labelledby="restore-confirm-title"
          aria-describedby="restore-confirm-copy"
        >
          <div>
            <span className="eyebrow">
              <RotateCcw size={13} /> RESTAURATION CIBLÉE
            </span>
            <h3 id="restore-confirm-title">
              Revenir à « {source?.label} » pour {selected.length} fichier
              {selected.length > 1 ? 's' : ''} ?
            </h3>
            <p id="restore-confirm-copy">
              Le host créera d’abord une sauvegarde de récupération. Seuls les fichiers cochés
              seront restaurés dans le dossier de cette session. Les validations du parcours
              deviendront à actualiser.
            </p>
            <ul>
              {selected.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
            <p className="field-help">
              Si les fichiers ont changé depuis la comparaison, le host refusera cette restauration
              et demandera une nouvelle comparaison.
            </p>
          </div>
          <div className="restore-confirm-actions">
            <button className="button secondary small" onClick={() => setConfirmRestore(false)}>
              Conserver l’état actuel
            </button>
            <button
              className="button primary small"
              disabled={!allowed}
              onClick={() => {
                if (!allowed) return;
                mutationPending.current = true;
                setResultNotice('');
                dispatch({
                  type: 'restoreCheckpoint',
                  featureId: feature.id,
                  checkpointId: sourceId,
                  paths: selected,
                  expectedFingerprint: comparison.fingerprint,
                });
                invalidate();
              }}
            >
              <RotateCcw size={13} /> Confirmer la restauration
            </button>
          </div>
        </div>
      )}
    </StudioDialog>
  );
}

export function AttemptCheckpointLinks({
  feature,
  attempt,
  state,
  dispatch,
}: {
  feature: Feature;
  attempt?: Attempt;
  state: StudioState;
  dispatch: Dispatch;
}) {
  const [open, setOpen] = useState<{ checkpointId: string; targetCheckpointId?: string } | null>(
    null,
  );
  const before = feature.checkpoints?.find((c) => c.id === attempt?.checkpointBeforeId);
  const after = feature.checkpoints?.find((c) => c.id === attempt?.checkpointAfterId);
  if (!before && !after) return null;
  return (
    <>
      <div className="attempt-checkpoint-links">
        <span>
          <History size={12} /> Points de cette tentative
        </span>
        <div>
          {before && (
            <button className="text-button" onClick={() => setOpen({ checkpointId: before.id })}>
              Avant <RotateCcw size={10} />
            </button>
          )}
          {after && (
            <button className="text-button" onClick={() => setOpen({ checkpointId: after.id })}>
              Après <RotateCcw size={10} />
            </button>
          )}
          {before && after && (
            <button
              className="text-button"
              onClick={() => setOpen({ checkpointId: before.id, targetCheckpointId: after.id })}
            >
              Comparer <ArrowLeftRight size={10} />
            </button>
          )}
        </div>
      </div>
      {open && (
        <CheckpointPanel
          feature={feature}
          state={state}
          dispatch={dispatch}
          initialCheckpointId={open.checkpointId}
          initialTargetCheckpointId={open.targetCheckpointId}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
