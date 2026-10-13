import { useEffect, useRef, useState } from 'react';
import type { ProfileSaveOptions, ProfileScope, ProfileTarget } from '../src/shared/profiles';
import { isDemo, subscribe } from './bridge';

export function useProfileSave(onClose: () => void) {
  const request = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'profileSaveResult' || message.requestId !== request.current) return;
        request.current = null;
        setPending(false);
        if (message.error) setError(message.error);
        else onClose();
      }),
    [onClose],
  );
  return {
    pending,
    error,
    start: (save: (requestId: string) => void) => {
      if (isDemo) {
        setError('Démonstration : aucune sauvegarde effectuée.');
        return;
      }
      const requestId = crypto.randomUUID();
      request.current = requestId;
      setError('');
      setPending(true);
      save(requestId);
    },
  };
}
export function profileOptions(
  scope: ProfileScope,
  target: ProfileTarget | undefined,
  source?: { source: 'bundled' | ProfileScope; revision?: string },
): ProfileSaveOptions {
  return {
    scope,
    expectedRevision: target?.revision ?? null,
    ...(source?.revision ? { sourceScope: source.source, sourceRevision: source.revision } : {}),
  };
}
export function ProfileScopeSelector({
  scope,
  onChange,
  target,
  active,
  origin,
  versions,
  pending,
  error,
}: {
  scope: ProfileScope;
  onChange: (scope: ProfileScope) => void;
  target?: ProfileTarget;
  active?: 'bundled' | ProfileScope;
  origin?: 'bundled' | ProfileScope;
  versions: { source: 'bundled' | ProfileScope; revision?: string; path: string }[];
  pending: boolean;
  error: string;
}) {
  const label = (source: string) =>
    source === 'workspace' ? 'projet' : source === 'user' ? 'personnel' : 'kit fourni';
  return (
    <fieldset className="field">
      <legend>Portée du profil</legend>
      <label>
        <span>Enregistrer dans</span>
        <select
          aria-label="Portée du profil"
          value={scope}
          disabled={pending}
          onChange={(event) => onChange(event.target.value as ProfileScope)}
        >
          <option value="user">PERSONNEL · tous mes projets</option>
          <option value="workspace">PROJET · ce dépôt</option>
        </select>
      </label>
      <small>
        {scope === 'user'
          ? 'Enregistré au niveau utilisateur, disponible dans tous les projets.'
          : 'Enregistré dans le dépôt, pour ce projet.'}
      </small>
      <p>
        Priorité : projet → personnel → kit fourni. Version active :{' '}
        <strong>{label(active ?? scope)}</strong>.
      </p>
      {scope === 'user' && active === 'workspace' && (
        <p role="status">
          La version projet restera active ici après cette sauvegarde personnelle.
        </p>
      )}
      {origin && origin !== scope && (
        <p role="status">
          Copie de la version {label(origin)} affichée vers la portée {label(scope)}. La version
          d’origine est conservée.
        </p>
      )}
      <p>
        Cible :{' '}
        <code style={{ overflowWrap: 'anywhere' }}>
          {target?.path ?? 'Chemin fourni par l’hôte à la sauvegarde'}
        </code>
        <br />
        Révision attendue :{' '}
        <code style={{ overflowWrap: 'anywhere' }}>
          {target?.revision ?? 'absent · création exclusive'}
        </code>
      </p>
      {versions.length > 0 && (
        <details>
          <summary>Versions et overrides ({versions.length})</summary>
          {versions.map((version) => (
            <p key={version.source}>
              <strong>
                {label(version.source)}
                {version.source === active ? ' · active' : ' · masquée'}
              </strong>
              <br />
              <code style={{ overflowWrap: 'anywhere' }}>{version.path}</code>
              <br />
              <code style={{ overflowWrap: 'anywhere' }}>
                {version.revision ?? 'révision non fournie'}
              </code>
            </p>
          ))}
        </details>
      )}
      <small>
        Changer de portée conserve un brouillon par portée et charge sa version existante.
      </small>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
