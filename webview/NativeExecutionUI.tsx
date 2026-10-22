import type { NativeActivity, NativePermissionMode } from '../src/shared/native';
import { NATIVE_PERMISSION_MODES, permissionLabels } from '../src/shared/native';
import type { StudioState } from '../src/shared/types';

export function PermissionPicker({
  value,
  state,
  disabled,
  onChange,
}: {
  value: NativePermissionMode;
  state: StudioState;
  disabled?: boolean;
  onChange: (mode: NativePermissionMode) => void;
}) {
  const available = state.runtime.native?.permissionModes;
  return (
    <label className="field native-permissions">
      <span>Permissions Copilot</span>
      <select
        aria-label="Permissions Copilot"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as NativePermissionMode)}
      >
        {NATIVE_PERMISSION_MODES.map((mode) => (
          <option
            key={mode}
            value={mode}
            disabled={available ? !available.includes(mode) : mode !== 'manual'}
          >
            {permissionLabels[mode]}
            {available && !available.includes(mode) ? ' · indisponible' : ''}
          </option>
        ))}
      </select>
      <small>
        {value === 'manual'
          ? 'Choisissez un accord ponctuel, par type pour la session, ou pour les lectures dans la solution.'
          : value === 'assisted'
            ? 'Copilot évalue les actions et vous consulte lorsqu’un accord reste nécessaire.'
            : 'Copilot autorise les outils, les chemins et les adresses sans vous solliciter, dans les limites de votre organisation.'}{' '}
        Un changement de mode efface les accords mémorisés. Les actions déjà lancées restent
        effectuées.
      </small>
      {state.runtime.native?.error && (
        <span className="inline-error">{state.runtime.native.error}</span>
      )}
    </label>
  );
}

export function NativeActivityPanel({ activities }: { activities: NativeActivity[] }) {
  if (!activities.length) return null;
  const status = {
    running: 'En cours',
    completed: 'Terminé',
    failed: 'Échec',
    interrupted: 'Interrompu',
  };
  return (
    <section className="native-activity" aria-label="Activité native Copilot">
      <h3>Outils natifs Copilot</h3>
      <p className="field-help">
        Événements reçus de Copilot. Un code de sortie confirme une commande ; le compte rendu de
        l’agent ne constitue pas une preuve de test.
      </p>
      {activities.map((activity) => (
        <details
          className={`evidence-entry ${activity.status === 'failed' ? 'failed' : ''}`}
          key={activity.id}
        >
          <summary>
            <strong>{activity.tool}</strong>
            <span>
              {status[activity.status]}
              {activity.exitCode !== undefined ? ` · code ${activity.exitCode}` : ''}
            </span>
          </summary>
          <div className="evidence-body">
            <p>
              Dossier de session : <code>{activity.directory}</code>
            </p>
            <p>{new Date(activity.startedAt).toLocaleString('fr-FR')} · Source : Copilot</p>
            {activity.command && <pre>{activity.command}</pre>}
            <details>
              <summary>Paramètres de l’appel</summary>
              <pre>{activity.arguments}</pre>
            </details>
            {activity.output && <pre>{activity.output}</pre>}
            {activity.files?.length ? (
              <p>Fichiers signalés par l’outil : {activity.files.join(', ')}</p>
            ) : null}
            {activity.command && activity.exitCode === undefined && (
              <p className="field-help">
                Code de sortie non communiqué. La réussite de la commande n’est pas attestée.
              </p>
            )}
            {activity.truncated && (
              <p className="field-help">
                Affichage tronqué ; les événements détaillés sont conservés dans l’archive de
                session.
              </p>
            )}
          </div>
        </details>
      ))}
    </section>
  );
}
