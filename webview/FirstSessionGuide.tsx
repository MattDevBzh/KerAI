import type { ClientMessage, StudioState } from '../src/shared/types';
import './first-session.css';

export function FirstSessionGuide({
  state,
  dispatch,
  onCreate,
}: {
  state: StudioState;
  dispatch: (message: ClientMessage) => void;
  onCreate: () => void;
}) {
  const connected =
    state.runtime.state === 'ready' &&
    state.runtime.authenticated &&
    state.runtime.models.length > 0;
  return (
    <section className="first-session-guide" aria-label="Votre première session">
      <h2>Un premier besoin, une équipe pour avancer</h2>
      <ol>
        <li>Décrivez un problème ou une évolution dans votre projet.</li>
        <li>Choisissez une équipe prête à travailler, ou composez la vôtre.</li>
        <li>Préparez le contexte du premier agent, lancez-le puis relisez son résultat.</li>
      </ol>
      <p>
        Vous gardez la main sur les lancements et les validations. Créer une session ne consomme
        aucun appel IA.
      </p>
      {!state.workspace.trusted ? (
        <button
          className="button secondary"
          onClick={() => dispatch({ type: 'manageWorkspaceTrust' })}
        >
          Approuver le projet dans VS Code
        </button>
      ) : !connected ? (
        <div role="status">
          <p>
            {state.runtime.state === 'checking'
              ? 'Vérification de Copilot en cours…'
              : state.runtime.error ||
                (state.runtime.state === 'ready' && !state.runtime.models.length
                  ? 'Aucun modèle disponible. Vérifiez votre connexion Copilot avant le premier lancement.'
                  : 'La connexion Copilot sera nécessaire pour lancer le premier agent. Vous pouvez déjà préparer votre session.')}
          </p>
          <button
            className="button secondary"
            disabled={state.runtime.state === 'checking'}
            onClick={() => dispatch({ type: 'checkRuntime' })}
          >
            Vérifier la connexion Copilot
          </button>
        </div>
      ) : (
        <p>Copilot est connecté. Votre session peut être préparée.</p>
      )}
      <button
        className="button primary"
        disabled={!state.workspace.trusted || Boolean(state.workspaceOperation)}
        onClick={onCreate}
      >
        Préparer ma première session
      </button>
    </section>
  );
}
