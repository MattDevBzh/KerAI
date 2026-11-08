import { useEffect, useRef, useState } from 'react';
import { isHosted, send, subscribe, sessionGitDefaults, saveSessionGitDefaults } from './bridge';
import {
  suggestedSessionBranch,
  type GitPreparation,
  type SessionGitChoice,
} from '../src/shared/gitPreparation';

export interface GitSelection {
  ready: boolean;
  choice?: SessionGitChoice;
}
/** Shared preparation for ordinary sessions and tickets. All Git writes stay in the host. */
export function SessionGitPreparation({
  projectId,
  title,
  isolated,
  disabled,
  onChange,
}: {
  projectId?: string;
  title: string;
  isolated: boolean;
  disabled?: boolean;
  onChange: (selection: GitSelection) => void;
}) {
  const [preparation, setPreparation] = useState<GitPreparation>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [baseRef, setBaseRef] = useState('');
  const [name, setName] = useState<string>();
  const [allowCached, setAllowCached] = useState(false);
  const [createInCurrent, setCreateInCurrent] = useState(false);
  const request = useRef('');
  const base = useRef('');
  const creating = isolated || createInCurrent;
  const branchName = name ?? suggestedSessionBranch(title);
  const refresh = (remote?: string) => {
    setLoading(true);
    setError('');
    setAllowCached(false);
    const requestId = (request.current = crypto.randomUUID());
    if (isHosted) send({ type: 'prepareSessionGit', requestId, projectId, remote });
    else {
      setPreparation({
        id: requestId,
        branch: 'main',
        head: 'a'.repeat(40),
        dirtyCount: 0,
        remotes: [],
        defaultRef: 'refs/heads/main',
        branches: [{ ref: 'refs/heads/main', name: 'main', commit: 'a'.repeat(40) }],
      });
      setBaseRef('refs/heads/main');
      setLoading(false);
    }
  };
  useEffect(() => {
    const saved = sessionGitDefaults(projectId ?? 'current');
    base.current = saved?.baseRef ?? '';
    setBaseRef('');
    setPreparation(undefined);
    const unsubscribe = subscribe((message) => {
      if (message.type !== 'sessionGitPrepared' || message.requestId !== request.current) return;
      setLoading(false);
      setError(message.error ?? '');
      setPreparation(message.preparation);
      if (message.preparation) {
        const next = message.preparation;
        const ref = next.branches.some((b) => b.ref === base.current)
          ? base.current
          : (next.defaultRef ?? next.branches[0]?.ref ?? '');
        base.current = ref;
        setBaseRef(ref);
      }
    });
    refresh(saved?.remote);
    return () => {
      request.current = '';
      unsubscribe();
    };
  }, [projectId]);
  const branch = preparation?.branches.find((b) => b.ref === baseRef);
  const collision = preparation?.branches.some(
    (b) =>
      b.ref === `refs/heads/${branchName}` ||
      preparation.remotes.some((remote) => b.ref === `refs/remotes/${remote}/${branchName}`),
  );
  const ready =
    !creating ||
    Boolean(
      !loading &&
        !error &&
        preparation &&
        branch &&
        branchName.trim() &&
        !collision &&
        (!preparation.fetchError || allowCached) &&
        (isolated || !preparation.dirtyCount),
    );
  useEffect(() => {
    onChange({
      ready,
      choice:
        creating && preparation && branch
          ? {
              preparationId: preparation.id,
              baseRef: branch.ref,
              baseCommit: branch.commit,
              branchName,
              allowCached,
            }
          : undefined,
    });
  }, [ready, creating, preparation, branch, branchName, allowCached, onChange]);
  return (
    <fieldset className="session-git-preparation" disabled={disabled}>
      <legend>Préparer la branche</legend>
      {!isolated && (
        <label className="field">
          <span>Travail dans le dossier courant</span>
          <select
            value={createInCurrent ? 'new' : 'continue'}
            onChange={(e) => setCreateInCurrent(e.target.value === 'new')}
          >
            <option value="continue">Continuer sur la branche actuelle</option>
            <option value="new">Créer une nouvelle branche</option>
          </select>
        </label>
      )}
      {creating ? (
        <>
          {preparation && preparation.remotes.length > 0 && (
            <label className="field">
              <span>Serveur distant</span>
              <select
                value={preparation.remote}
                disabled={loading}
                onChange={(e) => {
                  base.current = '';
                  saveSessionGitDefaults(projectId ?? 'current', { remote: e.target.value });
                  refresh(e.target.value);
                }}
              >
                {preparation.remotes.map((remote) => (
                  <option key={remote}>{remote}</option>
                ))}
              </select>
            </label>
          )}
          <p role="status">
            {loading
              ? 'Actualisation des branches…'
              : preparation?.remote
                ? preparation.fetchError
                  ? 'Actualisation distante indisponible.'
                  : `Branches actualisées à ${new Date(preparation.fetchedAt!).toLocaleTimeString('fr-FR')}.`
                : 'Dépôt local : aucun serveur distant configuré.'}
          </p>
          {error && <p role="alert">{error}</p>}
          {preparation?.fetchError && (
            <div role="alert">
              <p>{preparation.fetchError}</p>
              <p>
                Dernière récupération réussie :{' '}
                {preparation.fetchedAt
                  ? new Date(preparation.fetchedAt).toLocaleString('fr-FR')
                  : 'date inconnue'}
                .
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={allowCached}
                  onChange={(e) => setAllowCached(e.target.checked)}
                />{' '}
                Partir de la dernière version connue
              </label>
            </div>
          )}
          <label className="field">
            <span>Branche de départ</span>
            <select
              required
              disabled={loading}
              value={baseRef}
              onChange={(e) => {
                base.current = e.target.value;
                setBaseRef(e.target.value);
                saveSessionGitDefaults(projectId ?? 'current', {
                  remote: preparation?.remote,
                  baseRef: e.target.value,
                });
              }}
            >
              <option value="" disabled>
                Choisir une branche
              </option>
              {preparation?.branches.map((b) => (
                <option key={b.ref} value={b.ref}>
                  {b.name}
                  {b.ref.startsWith('refs/heads/') ? ' · locale' : ' · distante'}
                </option>
              ))}
            </select>
          </label>
          {branch && (
            <p className="muted">
              Commit de départ : {branch.commit.slice(0, 12)}.{' '}
              {branch.ref.startsWith('refs/remotes/')
                ? 'Les commits uniquement locaux ne seront pas inclus.'
                : 'Cette base locale peut différer de la version du serveur.'}
            </p>
          )}
          <label className="field">
            <span>Nouvelle branche</span>
            <input
              required
              maxLength={200}
              value={branchName}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {collision && (
            <p role="alert">
              Cette branche existe déjà. Choisis un autre nom ou reprends le travail existant depuis
              Git.
            </p>
          )}
          {Boolean(preparation?.dirtyCount) && (
            <p role={isolated ? 'status' : 'alert'}>
              {preparation!.dirtyCount} fichier(s) modifié(s) ou nouveau(x).{' '}
              {isolated
                ? 'Ils restent dans le dossier source et ne seront pas copiés.'
                : 'Enregistre ou range ces changements dans ton outil Git avant de créer la branche.'}
            </p>
          )}
        </>
      ) : (
        <p>La session utilisera la branche et les changements du dossier courant.</p>
      )}
      <div className="session-git-actions">
        <button
          type="button"
          className="button secondary small"
          disabled={loading}
          onClick={() => refresh(preparation?.remote)}
        >
          {creating ? 'Actualiser les branches' : 'Revérifier'}
        </button>
        <button
          type="button"
          className="button secondary small"
          onClick={() => send({ type: 'openSessionGit', projectId })}
        >
          Ouvrir Git
        </button>
      </div>
    </fieldset>
  );
}
