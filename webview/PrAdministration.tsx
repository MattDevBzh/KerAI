import { useState } from 'react';
import type { AgentProfile } from '../src/shared/types';
import type { DevOpsClientMessage, DevOpsState } from '../src/shared/devops';
import {
  defaultPrAdministrationSettings,
  type PrAdminPreview,
} from '../src/shared/prAdministration';

const statusLabels = {
  byDesign: 'By design · comportement voulu',
  wontFix: 'Won’t fix · aucune correction prévue',
  active: 'Active · à discuter',
  closed: 'Closed · information',
};
export function PrAdministration({
  state,
  agents,
  dispatch,
}: {
  state: DevOpsState;
  agents: AgentProfile[];
  dispatch: (message: DevOpsClientMessage) => void;
}) {
  const administration = state.prAdministration;
  const saved = administration?.settings ?? defaultPrAdministrationSettings;
  const [settings, setSettings] = useState(saved);
  const suggested =
    state.existingPr?.id ??
    state.pullRequests.find(
      (pr) => pr.sourceBranch === `refs/heads/${state.deliverySession?.branch}`,
    )?.id;
  const [chosen, setChosen] = useState('');
  const prId = Number(chosen || suggested || '');
  const changed = JSON.stringify(settings) !== JSON.stringify(saved);
  const available = agents.some((agent) => agent.id === settings.agentId);
  const busy = state.busy || !!administration?.generating;
  return (
    <details
      className="devops-card pr-administration"
      open={!!suggested || !!administration?.preview || undefined}
    >
      <summary>Intervenir sur une PR avec un agent</summary>
      <p>
        Donne à l’agent les règles et les explications utiles aux relecteurs. Il prépare des
        propositions à relire, à corriger et à sélectionner avant publication.
      </p>
      <fieldset disabled={busy}>
        <legend>Mission propre à cette session</legend>
        <label>
          Agent chargé de la PR
          <select
            value={settings.agentId}
            onChange={(e) => setSettings({ ...settings, agentId: e.target.value })}
          >
            {!available && <option value={settings.agentId}>Choisis un agent disponible</option>}
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.nickname || agent.name}
                {agent.model ? ` · ${agent.model}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Instructions pour cette intervention
          <textarea
            maxLength={12000}
            value={settings.instructions}
            placeholder="Explique chaque changement lié aux règles SEC-01 et SEC-02, en citant la règle et sa justification."
            onChange={(e) => setSettings({ ...settings, instructions: e.target.value })}
          />
        </label>
        <label>
          Règles et contexte de la session
          <textarea
            maxLength={50000}
            value={settings.context}
            placeholder="Colle les règles, leurs références et les décisions à expliquer aux relecteurs."
            onChange={(e) => setSettings({ ...settings, context: e.target.value })}
          />
        </label>
        <div className="devops-actions">
          {(['comments', 'title', 'description'] as const).map((field) => (
            <label key={field}>
              <input
                type="checkbox"
                checked={settings[field]}
                onChange={(e) => setSettings({ ...settings, [field]: e.target.checked })}
              />
              {
                {
                  comments: 'Proposer des commentaires',
                  title: 'Proposer un titre',
                  description: 'Proposer une description',
                }[field]
              }
            </label>
          ))}
        </div>
        <label>
          Statut des nouveaux fils
          <select
            value={settings.threadStatus}
            onChange={(e) =>
              setSettings({
                ...settings,
                threadStatus: e.target.value as typeof settings.threadStatus,
              })
            }
          >
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p>
          Les commentaires sont regroupés par bloc de code. Un fil existant conserve son statut ;
          dès qu’une personne répond ou le modifie, KerAI le laisse à la discussion humaine.
        </p>
        <button
          disabled={
            !available ||
            !state.config ||
            (!settings.comments && !settings.title && !settings.description)
          }
          onClick={() => dispatch({ type: 'deliveryPrAdminSettings', settings })}
        >
          Enregistrer la mission de PR
        </button>
      </fieldset>
      {changed && <p>Enregistre la mission avant de préparer les propositions.</p>}
      <label>
        Numéro de la PR à accompagner
        <input
          inputMode="numeric"
          value={chosen || (suggested ? String(suggested) : '')}
          disabled={busy}
          onChange={(e) => setChosen(e.target.value)}
          placeholder="Ex. 123"
        />
      </label>
      <p>
        La PR doit appartenir au dépôt configuré et à la branche de cette session. L’agent reçoit le
        code publié dans la PR, le contexte et les preuves de la session. La préparation consomme
        les crédits du fournisseur choisi.
      </p>
      <div className="devops-actions">
        <button
          disabled={
            busy ||
            changed ||
            !available ||
            !state.authenticated ||
            !Number.isSafeInteger(prId) ||
            prId < 1
          }
          onClick={() => dispatch({ type: 'deliveryPrAdminPreview', pullRequestId: prId })}
        >
          Préparer les interventions
        </button>
        {administration?.generating && (
          <button onClick={() => dispatch({ type: 'deliveryPrAdminCancel' })}>
            Arrêter la préparation
          </button>
        )}
      </div>
      {administration?.generating && <p role="status">L’agent prépare les interventions…</p>}
      {administration?.error && <p role="alert">{administration.error}</p>}
      {administration?.result && <p role="status">{administration.result}</p>}
      {administration?.preview && (
        <AdministrationPreview
          key={administration.preview.id}
          preview={administration.preview}
          busy={busy || changed || prId !== administration.preview.snapshot.id}
          dispatch={dispatch}
        />
      )}
    </details>
  );
}
function AdministrationPreview({
  preview,
  busy,
  dispatch,
}: {
  preview: PrAdminPreview;
  busy: boolean;
  dispatch: (message: DevOpsClientMessage) => void;
}) {
  const [edits, setEdits] = useState(
    Object.fromEntries(preview.actions.map((action) => [action.id, action.content])),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const actionable = preview.actions.filter(
    (action) =>
      (action.operation === 'create' || action.operation === 'update') &&
      !preview.completed.includes(action.id),
  );
  const chosen = actionable.filter((action) => selected.includes(action.id));
  const invalid = chosen.some(
    (action) =>
      !edits[action.id].trim() ||
      edits[action.id].length >
        (action.kind === 'title' ? 200 : action.kind === 'description' ? 4000 : 6000),
  );
  return (
    <section aria-label="Aperçu des interventions">
      <h3>Propositions pour la PR #{preview.snapshot.id}</h3>
      <p>
        <a href={preview.snapshot.url} target="_blank" rel="noreferrer">
          Ouvrir la PR dans Azure DevOps
        </a>{' '}
        · version {preview.snapshot.sourceHead.slice(0, 12)}
      </p>
      <p>{preview.summary}</p>
      <p>
        {preview.annotatedBlocks} / {preview.blockCount} blocs avec une annotation proposée ·{' '}
        {preview.model || 'agent sélectionné'}.
      </p>
      {preview.warnings.map((warning, i) => (
        <p key={i} role="note">
          {warning}
        </p>
      ))}
      <p>
        Statut des nouveaux fils : {statusLabels[preview.threadStatus]}. Relis chaque proposition et
        coche celles à publier.
      </p>
      {!preview.actions.length && <p>Aucune intervention proposée.</p>}
      {preview.actions.map((action, index) => {
        const done = preview.completed.includes(action.id);
        const disabled =
          busy || done || action.operation === 'protected' || action.operation === 'unchanged';
        const title =
          action.kind === 'comment'
            ? `${action.block!.path} · lignes ${action.block!.startLine}–${action.block!.endLine} (${action.block!.side === 'right' ? 'après' : 'avant'})`
            : action.kind === 'title'
              ? 'Titre de la PR'
              : 'Description de la PR';
        return (
          <article className="devops-card" key={action.id}>
            <h4>{title}</h4>
            <p>
              {done
                ? 'Publié'
                : {
                    create: 'Nouveau commentaire',
                    update: 'Mise à jour proposée',
                    unchanged: 'Déjà à jour',
                    protected: 'Fil préservé',
                  }[action.operation]}
            </p>
            {action.reason && <p>{action.reason}</p>}
            {action.block && (
              <details>
                <summary>Voir le bloc de code</summary>
                <pre className="devops-text">{action.block.code}</pre>
              </details>
            )}
            {action.before !== undefined && (
              <details>
                <summary>Texte actuel</summary>
                <pre className="devops-text">{action.before}</pre>
              </details>
            )}
            <label>
              Proposition {index + 1}
              <textarea
                disabled={disabled}
                maxLength={
                  action.kind === 'title' ? 200 : action.kind === 'description' ? 4000 : 6000
                }
                value={edits[action.id]}
                onChange={(e) => setEdits({ ...edits, [action.id]: e.target.value })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                disabled={disabled}
                checked={selected.includes(action.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, action.id]
                      : selected.filter((id) => id !== action.id),
                  )
                }
              />
              Publier la proposition {index + 1}
            </label>
          </article>
        );
      })}
      <p>
        Les interventions sont publiées une à une. Si la PR change ou si une écriture échoue, les
        suivantes s’arrêtent ; celles déjà publiées restent visibles.
      </p>
      <button
        disabled={busy || !chosen.length || invalid}
        onClick={() =>
          dispatch({
            type: 'deliveryPrAdminApply',
            previewId: preview.id,
            changes: chosen.map((action) => ({ id: action.id, content: edits[action.id] })),
          })
        }
      >
        Publier la sélection ({chosen.length})
      </button>
    </section>
  );
}
