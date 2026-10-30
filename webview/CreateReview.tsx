import { useEffect, useRef, useState } from 'react';
import { GitBranch, GitPullRequest, LoaderCircle } from 'lucide-react';
import type { ClientMessage, StudioState } from '../src/shared/types';
import { parsePullRequestUrl, reviewTargetLabel, type ReviewTarget } from '../src/shared/reviews';
import { isHosted, subscribe } from './bridge';
import { Modal } from './SessionPrimitives';

export function CreateReview({
  state,
  dispatch,
  onClose,
}: {
  state: StudioState;
  dispatch: (message: ClientMessage) => void;
  onClose: () => void;
}) {
  const projects = state.projectCatalog?.projects ?? [];
  const [projectId, setProjectId] = useState(
    state.projectCatalog?.activeProjectId ?? projects[0]?.id ?? '',
  );
  const [kind, setKind] = useState<'git' | 'pull-request'>('git');
  const [mode, setMode] = useState<'working-tree' | 'branches'>('working-tree');
  const [url, setUrl] = useState('');
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [branches, setBranches] = useState<{ name: string; ref: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [branchError, setBranchError] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const creation = useRef<{ key: string; id: string } | undefined>(undefined);
  useEffect(() => {
    if (kind !== 'git' || mode !== 'branches') return;
    setBranches([]);
    setSource('');
    setDestination('');
    setBranchError('');
    if (!isHosted) {
      setBranchError('La liste des branches est disponible dans VS Code.');
      return;
    }
    const requestId = crypto.randomUUID();
    setLoading(true);
    const unsubscribe = subscribe((message) => {
      if (message.type !== 'reviewBranchesResult' || message.requestId !== requestId) return;
      setLoading(false);
      setBranchError(message.error ?? '');
      setBranches(message.branches ?? []);
    });
    dispatch({ type: 'reviewBranches', requestId, projectId: projectId || undefined });
    return unsubscribe;
  }, [projectId, mode, kind, refresh]);
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'featureCreateResult' || message.requestId !== creation.current?.id)
          return;
        setPending(false);
        if (message.error) setError(message.error);
        else onClose();
      }),
    [onClose],
  );
  const target: ReviewTarget =
    kind === 'pull-request'
      ? { kind, url: url.trim() }
      : mode === 'branches'
        ? { kind: mode, source, destination }
        : { kind: mode };
  let invalid = '';
  if (kind === 'pull-request') {
    try {
      parsePullRequestUrl(url.trim());
    } catch {
      invalid = 'Indiquez une URL de Pull Request GitHub ou Azure DevOps valide.';
    }
  } else if (mode === 'branches' && (!source || !destination || source === destination))
    invalid = 'Choisissez deux branches différentes.';
  const blocked =
    pending ||
    Boolean(state.workspaceOperation) ||
    !state.workspace.trusted ||
    (projects.length > 0 && !projectId);
  return (
    <Modal
      title="Nouvelle relecture"
      subtitle="Choisissez le code à relire. Vous pourrez ajouter du contexte au lancement."
      onClose={pending ? () => {} : onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (blocked || invalid) return;
          if (!isHosted) {
            setError('Ouvrez KerAI dans VS Code pour créer une relecture.');
            return;
          }
          const key = JSON.stringify({ target, projectId });
          if (creation.current?.key !== key) creation.current = { key, id: crypto.randomUUID() };
          setPending(true);
          setError('');
          dispatch({
            type: 'createFeature',
            requestId: creation.current!.id,
            reviewTarget: target,
            title: `Relecture · ${reviewTargetLabel(target)}`,
            description: '',
            projectIds: projectId ? [projectId] : undefined,
          });
        }}
      >
        <fieldset
          disabled={blocked}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gap: 16 }}
        >
          {projects.length > 0 && (
            <label className="field">
              <span>Projet à relire</span>
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} — {project.path}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="field-row" role="group" aria-label="Type de relecture">
            <button
              type="button"
              className={`button ${kind === 'git' ? 'primary' : 'secondary'}`}
              aria-pressed={kind === 'git'}
              onClick={() => setKind('git')}
            >
              <GitBranch size={16} /> Branche Git
            </button>
            <button
              type="button"
              className={`button ${kind === 'pull-request' ? 'primary' : 'secondary'}`}
              aria-pressed={kind === 'pull-request'}
              onClick={() => setKind('pull-request')}
            >
              <GitPullRequest size={16} /> Pull Request
            </button>
          </div>
          {kind === 'pull-request' ? (
            <label className="field">
              <span>URL de la Pull Request</span>
              <input
                type="url"
                required
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://github.com/organisation/depot/pull/123"
              />
              <small>
                GitHub ou Azure DevOps. La connexion au dépôt sera utilisée pendant la relecture.
              </small>
            </label>
          ) : (
            <>
              <label className="field">
                <span>Changements à relire</span>
                <select
                  value={mode}
                  onChange={(event) => setMode(event.target.value as typeof mode)}
                >
                  <option value="working-tree">Modifications non commitées</option>
                  <option value="branches">De branche à branche</option>
                </select>
                <small>
                  {mode === 'working-tree'
                    ? 'Fichiers indexés, modifiés et non suivis du projet.'
                    : 'Changements apportés par la source depuis l’ancêtre commun avec la destination. Aucun changement de branche.'}
                </small>
              </label>
              {mode === 'branches' && (
                <>
                  <div className="field-row">
                    {(['source', 'destination'] as const).map((side) => (
                      <label className="field" key={side}>
                        <span>{side === 'source' ? 'Branche source' : 'Branche destination'}</span>
                        <select
                          disabled={loading}
                          value={side === 'source' ? source : destination}
                          onChange={(event) =>
                            (side === 'source' ? setSource : setDestination)(event.target.value)
                          }
                        >
                          <option value="">Choisir une branche</option>
                          {branches.map((branch) => (
                            <option key={branch.ref} value={branch.ref}>
                              {branch.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  {loading && <p role="status">Chargement des branches…</p>}
                  {branchError && <p role="alert">{branchError}</p>}
                  <button
                    type="button"
                    className="text-button"
                    disabled={loading}
                    onClick={() => setRefresh((value) => value + 1)}
                  >
                    Actualiser les branches
                  </button>
                  <p className="muted">
                    Branches locales et références distantes déjà présentes dans le projet.
                  </p>
                </>
              )}
            </>
          )}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={pending} onClick={onClose}>
            Annuler
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={
              blocked || Boolean(invalid) || (kind === 'git' && mode === 'branches' && loading)
            }
            title={invalid}
          >
            {pending && <LoaderCircle size={16} />} Créer la relecture
          </button>
        </div>
      </form>
    </Modal>
  );
}
