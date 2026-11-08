import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AgentProfile } from '../src/shared/types';
import type { DevOpsClientMessage, DevOpsState } from '../src/shared/devops';
import { defaultPullRequestSettings, type PrReviewer } from '../src/shared/pullRequestPreparation';

export function PullRequestPreparation({
  children,
  state,
  agents,
  featureId,
  target,
  title,
  description,
  apply,
  dispatch,
  reviewers,
  setReviewers,
  isDraft,
  setIsDraft,
}: {
  children?: ReactNode;
  state: DevOpsState;
  agents: AgentProfile[];
  featureId: string;
  target: string;
  title: string;
  description: string;
  apply: (title: string, description: string) => void;
  dispatch: (message: DevOpsClientMessage) => void;
  reviewers: PrReviewer[];
  setReviewers: (reviewers: PrReviewer[]) => void;
  isDraft: boolean;
  setIsDraft: (value: boolean) => void;
}) {
  const [settings, setSettings] = useState(state.prSettings ?? defaultPullRequestSettings);
  const [query, setQuery] = useState('');
  const attempted = useRef(false),
    received = useRef(''),
    baseline = useRef<string | undefined>(undefined);
  const busy = state.busy;
  const settingsChanged =
    JSON.stringify(settings) !== JSON.stringify(state.prSettings ?? defaultPullRequestSettings);
  const available = agents.some((agent) => agent.id === state.prSettings?.agentId);
  const canGenerate =
    !!state.deliverySession &&
    !!featureId &&
    !!target &&
    state.authenticated &&
    !!state.snapshot &&
    !state.snapshot.files.length &&
    !busy &&
    !settingsChanged &&
    available;
  function generate() {
    attempted.current = true;
    baseline.current = `${title}\0${description}`;
    dispatch({ type: 'deliveryGeneratePr', featureId, target });
  }
  useEffect(() => {
    if (
      !attempted.current &&
      !state.prGeneration &&
      !title &&
      !description &&
      canGenerate &&
      !state.existingPr
    )
      generate();
  }, [canGenerate, title, description, state.prGeneration, state.existingPr]);
  const generation = state.prGeneration;
  const current =
    generation?.featureId === featureId &&
    generation?.target === target &&
    generation?.head === state.snapshot?.head;
  useEffect(() => {
    if (!generation || received.current === generation.id) return;
    received.current = generation.id;
    if (current && baseline.current === `${title}\0${description}`)
      apply(generation.title, generation.description);
  }, [generation, current, title, description, apply]);
  return (
    <div className="pr-preparation">
      <details className="devops-card" open={!available || undefined}>
        <summary>Réglages de PR pour ce dépôt</summary>
        <p>
          Ces valeurs sont conservées pour les prochaines PR de ce projet et de ce dépôt Azure
          DevOps.
        </p>
        <label>
          Agent de rédaction
          <select
            value={settings.agentId}
            disabled={busy}
            onChange={(event) => setSettings({ ...settings, agentId: event.target.value })}
          >
            {!agents.some((agent) => agent.id === settings.agentId) && (
              <option value={settings.agentId}>Agent indisponible — choisir un profil</option>
            )}
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.nickname || agent.name}
                {agent.model ? ` · ${agent.model}` : ''}
              </option>
            ))}
          </select>
        </label>
        <p>
          Le modèle et les instructions du profil choisi sont utilisés. Modifie le profil dans le
          catalogue Agents pour les ajuster.
        </p>
        <label>
          Branche cible par défaut
          <input
            maxLength={200}
            value={settings.target}
            disabled={busy}
            onChange={(event) => setSettings({ ...settings, target: event.target.value })}
          />
        </label>
        <label>
          Consignes et modèle de description
          <textarea
            maxLength={12000}
            value={settings.instructions}
            disabled={busy}
            placeholder="Langue, sections attendues, conventions de titre, modèle de description…"
            onChange={(event) => setSettings({ ...settings, instructions: event.target.value })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.isDraft}
            disabled={busy}
            onChange={(event) => setSettings({ ...settings, isDraft: event.target.checked })}
          />
          Créer en brouillon par défaut
        </label>
        <p>
          Relecteurs par défaut :{' '}
          {settings.reviewers.map((item) => item.name).join(', ') || 'aucun'}.
        </p>
        <button
          disabled={busy}
          onClick={() => setSettings({ ...settings, reviewers: structuredClone(reviewers) })}
        >
          Utiliser les relecteurs de cette PR par défaut
        </button>
        <button
          disabled={
            busy ||
            !state.config ||
            !settings.target ||
            !agents.some((agent) => agent.id === settings.agentId)
          }
          onClick={() => dispatch({ type: 'deliverySavePrSettings', settings })}
        >
          Enregistrer les réglages de PR
        </button>
      </details>
      <section aria-label="Rédaction de la PR">
        <h3>Rédaction avec ton agent</h3>
        {!state.deliverySession && (
          <p>Ouvre la préparation depuis la session pour rédiger à partir de sa branche.</p>
        )}
        {!!state.snapshot?.files.length && (
          <p>
            Termine le commit des fichiers ci-dessus pour que l’agent décrive le code qui sera
            réellement livré.
          </p>
        )}
        {!state.authenticated && (
          <p>Connecte Azure DevOps pour comparer la branche cible et rechercher les relecteurs.</p>
        )}
        {settingsChanged && <p>Enregistre tes réglages avant de lancer la rédaction.</p>}
        <p>
          La rédaction utilise le diff commité et les preuves de la session. Elle consomme les
          crédits du fournisseur choisi.
        </p>
        <div className="devops-actions">
          <button disabled={!canGenerate} onClick={generate}>
            {generation || title || description ? 'Régénérer avec l’agent' : 'Générer avec l’agent'}
          </button>
          {state.prGenerating && (
            <button onClick={() => dispatch({ type: 'deliveryCancelGeneration' })}>
              Arrêter la rédaction
            </button>
          )}
        </div>
        {state.prGenerating && <p role="status">L’agent rédige le titre et la description…</p>}
        {generation && (
          <details
            className="devops-card"
            open={generation.title !== title || generation.description !== description || undefined}
          >
            <summary>Proposition de l’agent · {generation.model || generation.agentId}</summary>
            <p>
              Version {generation.head.slice(0, 12)} vers {generation.target} · cible{' '}
              {generation.targetHead.slice(0, 12)}
            </p>
            <strong>{generation.title}</strong>
            <pre className="devops-text">{generation.description}</pre>
            {!current && (
              <p role="status">La branche ou la cible a changé. Relance la rédaction.</p>
            )}
            <button
              disabled={busy || !current}
              onClick={() => apply(generation.title, generation.description)}
            >
              Remplacer le titre et la description par cette proposition
            </button>
            <p>Les modifications que tu saisis pendant la rédaction sont conservées.</p>
          </details>
        )}
      </section>
      {children}
      <section aria-label="Relecteurs de la PR">
        <h3>Relecteurs</h3>
        <label>
          Rechercher un relecteur
          <input
            value={query}
            maxLength={200}
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          disabled={busy || !state.authenticated || query.trim().length < 2}
          onClick={() => dispatch({ type: 'deliverySearchReviewers', query: query.trim() })}
        >
          Rechercher dans Azure DevOps
        </button>
        <p>La recherche nécessite le droit Identity en lecture sur ton jeton Azure DevOps.</p>
        {state.reviewerResults
          ?.filter((item) => !reviewers.some((selected) => selected.id === item.id))
          .map((item) => (
            <button
              key={item.id}
              disabled={busy || reviewers.length >= 30}
              onClick={() => setReviewers([...reviewers, item])}
            >
              Ajouter {item.name}
            </button>
          ))}
        {state.reviewerResults?.length === 0 && <p>Aucun relecteur trouvé.</p>}
        <ul>
          {reviewers.map((item) => (
            <li key={item.id}>
              {item.name}{' '}
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={item.required}
                  onChange={(event) =>
                    setReviewers(
                      reviewers.map((selected) =>
                        selected.id === item.id
                          ? { ...selected, required: event.target.checked }
                          : selected,
                      ),
                    )
                  }
                />
                Obligatoire
              </label>{' '}
              <button
                disabled={busy}
                onClick={() =>
                  setReviewers(reviewers.filter((selected) => selected.id !== item.id))
                }
              >
                Retirer {item.name}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <label>
        <input
          type="checkbox"
          disabled={busy}
          checked={isDraft}
          onChange={(event) => setIsDraft(event.target.checked)}
        />
        Créer cette PR en brouillon
      </label>
      {!isDraft && <p>La PR sera prête à relire dès sa création.</p>}
    </div>
  );
}
