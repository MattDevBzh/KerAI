import type { NativeActivity, NativePermissionMode } from '../src/shared/native';
import { NATIVE_PERMISSION_MODES, permissionLabels } from '../src/shared/native';
import type { Feature, FeatureStep, RunLaunchOptions, StudioState } from '../src/shared/types';
import { restrictedNativeTools } from './launchReadiness';

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

export function EffectiveLaunchCapabilities({
  state,
  feature,
  step,
  launch,
}: {
  state: StudioState;
  feature: Feature;
  step: FeatureStep;
  launch: RunLaunchOptions;
}) {
  const scope = restrictedNativeTools(state, feature, step, launch);
  const application = state.navigation?.applications.find(
    (item) => item.id === launch.navigation?.applicationId,
  );
  const connections = launch.mcpServerIds.map((id) =>
    state.settings.mcpServers?.find((server) => server.id === id),
  );
  return (
    <section
      className="native-capabilities"
      aria-label="Capacités et autorisations de cette tentative"
    >
      <h3>Ce que cette tentative peut utiliser</h3>
      <p>
        Projet :{' '}
        {feature.projects?.map((project) => project.name).join(', ') || state.workspace.name}.
      </p>
      {launch.pair && (
        <p>
          Le travail en pair commence par un cadrage : aucun travail d’édition ni commande avant
          votre accord sur le plan.
        </p>
      )}
      {feature.execution ? (
        <>
          <p>
            {scope.readOnly
              ? 'Lecture et recherche dans les fichiers, questions à l’humain. Édition et terminal exclus pour ce profil ou contexte.'
              : 'Le catalogue natif autorise lecture, recherche, édition, terminal et questions, sous réserve des permissions Copilot.'}
          </p>
          <p>
            Permissions sélectionnées : {permissionLabels[launch.permissionMode ?? 'manual']}.{' '}
            {launch.permissionMode === 'allow-all'
              ? 'Les outils, chemins et adresses peuvent être autorisés sans demande, selon la politique de votre organisation.'
              : 'Le runtime et la politique de votre organisation décident des actions qui nécessitent un accord.'}
          </p>
          <p>
            Catalogue natif vérifié :{' '}
            {state.runtime.native?.available
              ? scope.tools.join(', ') || 'aucun outil communiqué'
              : 'diagnostic Copilot nécessaire'}
            .
          </p>
        </>
      ) : launch.pair ? (
        <p>
          Aucun outil ni accès au dépôt pendant ce cadrage. Les capacités de réalisation seront
          activées après votre accord.
        </p>
      ) : (
        <p>
          Politique de l’étape :{' '}
          {step.policy === 'read-only'
            ? 'lecture seule ; aucune édition ni commande de test'
            : step.policy === 'tests'
              ? 'écriture dans le périmètre de tests et commandes de tests configurées'
              : 'écriture dans le projet ; les fichiers existants restent protégés sauf accord explicite'}
          . Les capacités déclarées de l’agent limitent aussi ses outils.
        </p>
      )}
      <p>
        Navigation :{' '}
        {application
          ? launch.pair
            ? `${application.name} · ${application.startUrl ?? application.origin}. ${feature.execution ? 'Lecture des parcours et inspection possibles ; interactions, rejeu et entretien indisponibles avant votre accord.' : 'Outils de navigation indisponibles pendant le cadrage.'}`
            : `${application.name} · ${application.startUrl ?? application.origin}. ${scope.owner ? 'Navigateur propriétaire ; entretien des parcours autorisé.' : 'Consommateur du parcours sélectionné.'} ${!launch.navigation?.allowInteractions || application.interactionPolicy === 'inspect' ? 'Inspection seule.' : application.interactionPolicy === 'confirm' ? 'Chaque interaction demandée par l’agent reste à confirmer.' : 'Interactions autorisées dans les limites du profil.'}`
          : 'aucune application sélectionnée'}
        .
      </p>
      <p>
        Connexions MCP :{' '}
        {scope.readOnly
          ? 'exclues du catalogue dans ce contexte de lecture restreinte, même si cochées ci-dessous'
          : connections.length
            ? connections
                .map((server) =>
                  server
                    ? `${server.name} (${server.tools.filter(Boolean).join(', ') || 'aucun outil autorisé'} ; ${state.mcpCatalogs?.[server.id]?.state === 'ready' ? 'catalogue vérifié' : 'connexion à vérifier'})`
                    : 'connexion supprimée ou indisponible',
                )
                .join(' · ')
            : 'aucune sélectionnée'}
        .
      </p>
      <small>
        Le lancement vérifie à nouveau les capacités et les permissions. Changer le contexte ou ses
        droits prépare une nouvelle tentative ; cela n’étend pas une exécution déjà commencée.
      </small>
    </section>
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
