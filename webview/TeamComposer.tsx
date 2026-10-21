import { inheritTeamProfiles } from '../src/shared/agentInheritance';
import { AgentModelOverrides } from './AgentModelOverrides';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  Plus,
  Search,
  Settings2,
  Trash2,
  Users,
} from 'lucide-react';
import type { ClientMessage, Feature, StudioState, WorkflowStep } from '../src/shared/types';
import {
  agentStep,
  assertTeamOrder,
  effectiveTeamModel,
  insertTeam,
  instantiateTeam,
  isLinearTeam,
  moveTeamStep,
  orderedAgents,
  orderTeam,
  removeTeamStep,
  teamLocked,
  teamSteps,
} from '../src/shared/team';
import { Avatar } from './Avatar';
import { AgentFavorite } from './AgentFavorite';
import { subscribe } from './bridge';
import './team.css';

type DragItem = { kind: 'agent' | 'team' | 'member'; id: string };
const dragType = 'application/x-feature-studio-team';
const policies = {
  'read-only': 'Lecture seule',
  'workspace-write': 'Écriture dans le projet',
  tests: 'Tests préautorisés',
};

export function TeamComposer({
  feature,
  state,
  dispatch,
  onClose,
  onPendingChange,
}: {
  feature: Feature;
  state: StudioState;
  dispatch: (message: ClientMessage) => void;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [steps, setSteps] = useState(() =>
    orderTeam(inheritTeamProfiles(teamSteps(feature), state.agents)),
  );
  const [revision] = useState(feature.teamRevision ?? 0);
  const [search, setSearch] = useState(''),
    [editing, setEditing] = useState('');
  const [error, setError] = useState(''),
    [announcement, setAnnouncement] = useState('');
  const [pending, setPending] = useState(false),
    [dropAt, setDropAt] = useState<number>();
  const dragged = useRef<DragItem | null>(null),
    request = useRef('');
  const locked = teamLocked(feature);
  const stale = revision !== (feature.teamRevision ?? 0);
  const busy =
    pending ||
    Boolean(state.workspaceOperation) ||
    state.features.some(
      (f) => f.steps.some((s) => s.status === 'running') || f.autopilot?.status === 'running',
    );
  const disabled = busy || locked || stale || Boolean(feature.archived);
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'featureTeamResult' || message.requestId !== request.current) return;
        setPending(false);
        onPendingChange(false);
        if (message.error) setError(message.error);
        else onClose();
      }),
    [onClose, onPendingChange],
  );
  const apply = (change: () => WorkflowStep[], text: string) => {
    if (disabled) return;
    try {
      setSteps(change());
      setError('');
      setAnnouncement(text);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  const add = (item: DragItem, at: number) =>
    apply(
      () => {
        if (item.kind === 'member') {
          const from = steps.findIndex((step) => step.id === item.id);
          return moveTeamStep(steps, from, Math.min(steps.length - 1, at > from ? at - 1 : at));
        }
        if (item.kind === 'agent') {
          const agent = state.agents.find((agent) => agent.id === item.id);
          if (!agent) throw new Error('Cet agent n’est plus disponible.');
          const step = agentStep(agent);
          setEditing(step.id);
          return insertTeam(steps, [step], at);
        }
        const team = state.workflows.find((team) => team.id === item.id);
        if (!team) throw new Error('Cette équipe n’est plus disponible.');
        return insertTeam(
          steps,
          instantiateTeam(orderTeam(inheritTeamProfiles(team.steps, state.agents))),
          at,
        );
      },
      item.kind === 'member' ? 'Intervention déplacée.' : 'Composition mise à jour.',
    );
  const start = (event: DragEvent, item: DragItem) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    dragged.current = item;
    event.dataTransfer.setData(dragType, JSON.stringify(item));
    event.dataTransfer.effectAllowed = item.kind === 'member' ? 'move' : 'copy';
  };
  const end = () => {
    dragged.current = null;
    setDropAt(undefined);
  };
  const dropZone = (at: number) => (
    <div
      className={`team-drop-zone ${dropAt === at ? 'over' : ''}`}
      data-drop-index={at}
      onDragOver={(event) => {
        if (disabled || !dragged.current) return;
        event.preventDefault();
        setDropAt(at);
        event.dataTransfer.dropEffect = dragged.current.kind === 'member' ? 'move' : 'copy';
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (dragged.current) add(dragged.current, at);
        end();
      }}
      aria-hidden="true"
    >
      <Plus size={15} />
    </div>
  );
  const query = search.trim().toLocaleLowerCase('fr');
  const agents = orderedAgents(state.agents, state.favoriteAgentIds).filter((agent) =>
    `${agent.name} ${agent.nickname ?? ''} ${agent.description}`
      .toLocaleLowerCase('fr')
      .includes(query),
  );
  const teams = state.workflows.filter((team) =>
    `${team.name} ${team.description}`.toLocaleLowerCase('fr').includes(query),
  );
  const selected = steps.find((step) => step.id === editing);
  const update = (patch: Partial<WorkflowStep>) =>
    apply(
      () => steps.map((step) => (step.id === editing ? { ...step, ...patch } : step)),
      'Réglages modifiés.',
    );
  const issues: string[] = [];
  try {
    assertTeamOrder(steps);
  } catch (reason) {
    issues.push((reason as Error).message);
  }
  for (const step of steps) {
    if (!step.name.trim()) issues.push('Chaque intervention doit avoir un rôle.');
    if (!state.agents.some((agent) => agent.id === step.agentId))
      issues.push(`Agent absent : ${step.agentId}.`);
  }
  const missingSkills = [
    ...new Set(
      steps.flatMap((step) => [
        ...step.skills,
        ...(state.agents.find((agent) => agent.id === step.agentId)?.skills ?? []),
      ]),
    ),
  ].filter((id) => !state.skills.some((skill) => skill.id === id));
  return (
    <div className="team-composer">
      <section className="team-selection" aria-label="Mon équipe">
        <div className="section-heading">
          <h3>
            Mon équipe{' '}
            <span className="count-pill">
              {steps.length} intervention{steps.length > 1 ? 's' : ''}
            </span>
          </h3>
          <small>{isLinearTeam(steps) ? 'Ordre d’exécution' : 'Dépendances conservées'}</small>
        </div>
        <p className="muted">
          Glissez une photo ou une équipe ici. Un agent peut intervenir plusieurs fois.
        </p>
        <div className={`team-members ${!steps.length ? 'empty' : ''}`}>
          {dropZone(0)}
          {!steps.length && (
            <div
              className="team-empty-target"
              onDragOver={(event) => {
                if (!disabled && dragged.current) {
                  event.preventDefault();
                  setDropAt(0);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged.current) add(dragged.current, 0);
                end();
              }}
            >
              <Users size={30} />
              <strong>Votre équipe commence ici</strong>
              <span>Déposez un agent ou une équipe, ou utilisez « Ajouter ».</span>
            </div>
          )}
          {steps.map((step, index) => {
            const agent = state.agents.find((agent) => agent.id === step.agentId);
            const effective = effectiveTeamModel(step, feature, state);
            return (
              <div className="team-member-slot" key={step.id}>
                <article
                  className={`team-member ${editing === step.id ? 'editing' : ''}`}
                  data-member-id={step.id}
                >
                  <span className="team-position">{index + 1}</span>
                  <div
                    className="team-avatar-drag"
                    draggable={!disabled}
                    onDragStart={(event) => start(event, { kind: 'member', id: step.id })}
                    onDragEnd={end}
                    title="Déplacer cette intervention"
                  >
                    <Avatar agent={agent} />
                    <GripVertical size={14} />
                  </div>
                  <strong>{agent?.nickname || agent?.name || step.agentId}</strong>
                  <dl>
                    <dt>Rôle</dt>
                    <dd>{step.name}</dd>
                    <dt>Modèle</dt>
                    <dd>{effective.model}</dd>
                    <dt>Réflexion</dt>
                    <dd>{effective.reasoning}</dd>
                  </dl>
                  <small className="team-policy">
                    {feature.execution
                      ? 'Outils natifs · permissions de la session'
                      : policies[step.policy]}
                  </small>
                  <label className="field team-participation">
                    <span>Participation</span>
                    <select
                      aria-label={`Participation de ${step.name}`}
                      disabled={disabled}
                      value={step.optional ? 'optional' : 'required'}
                      onChange={(event) =>
                        apply(
                          () =>
                            steps.map((item) =>
                              item.id === step.id
                                ? { ...item, optional: event.target.value === 'optional' }
                                : item,
                            ),
                          'Participation modifiée.',
                        )
                      }
                    >
                      <option value="required">Obligatoire</option>
                      <option value="optional">Facultative</option>
                    </select>
                  </label>
                  {effective.profile && <small>Profil de budget : {effective.profile}</small>}
                  <div className="team-member-actions">
                    <button
                      className="icon-button"
                      disabled={disabled || index === 0}
                      aria-label={`Monter ${step.name}`}
                      onClick={() =>
                        apply(() => moveTeamStep(steps, index, index - 1), 'Intervention déplacée.')
                      }
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={disabled || index === steps.length - 1}
                      aria-label={`Descendre ${step.name}`}
                      onClick={() =>
                        apply(() => moveTeamStep(steps, index, index + 1), 'Intervention déplacée.')
                      }
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={disabled}
                      aria-label={`Régler ${step.name}`}
                      aria-expanded={editing === step.id}
                      onClick={() => setEditing(editing === step.id ? '' : step.id)}
                    >
                      <Settings2 size={14} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={disabled}
                      aria-label={`Dupliquer ${step.name}`}
                      onClick={() =>
                        apply(
                          () =>
                            insertTeam(
                              steps,
                              instantiateTeam([{ ...step, dependsOn: [] }]),
                              index + 1,
                            ),
                          'Intervention dupliquée.',
                        )
                      }
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={disabled}
                      aria-label={`Retirer ${step.name}`}
                      onClick={() =>
                        apply(() => removeTeamStep(steps, step.id), 'Intervention retirée.')
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
                {dropZone(index + 1)}
              </div>
            );
          })}
        </div>
      </section>
      {selected && (
        <fieldset className="team-settings" disabled={disabled}>
          <legend>Intervention : {selected.name}</legend>
          <AgentModelOverrides
            step={selected}
            state={state}
            onChange={update}
            native={Boolean(feature.execution)}
          />
          {feature.budget?.modelProfile && feature.budget.modelProfile !== 'current' && (
            <p className="muted">Le profil du budget de la feature a priorité sur ces choix.</p>
          )}
          {!!selected.dependsOn.length && (
            <p className="muted">
              Après :{' '}
              {selected.dependsOn
                .map((id) => steps.find((step) => step.id === id)?.name || id)
                .join(', ')}
              .
            </p>
          )}
        </fieldset>
      )}
      <label className="team-search">
        <Search size={17} />
        <input
          aria-label="Rechercher des équipes ou agents"
          placeholder="Rechercher une équipe, un agent, un rôle…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <section className="team-catalog" aria-label="Équipes existantes">
        <h3>Équipes existantes</h3>
        <div className="team-template-grid">
          {teams.map((team) => (
            <article className="team-template" key={team.id}>
              <div
                draggable={!disabled}
                onDragStart={(event) => start(event, { kind: 'team', id: team.id })}
                onDragEnd={end}
                className="team-template-drag"
                title="Glisser toute l’équipe"
              >
                <div className="team-template-avatars">
                  {team.steps.slice(0, 5).map((step) => (
                    <Avatar
                      key={step.id}
                      agent={state.agents.find((agent) => agent.id === step.agentId)}
                      small
                    />
                  ))}
                  {team.steps.length > 5 && <span>+{team.steps.length - 5}</span>}
                </div>
                <strong>{team.name}</strong>
                <small>
                  {team.steps.length} intervention{team.steps.length > 1 ? 's' : ''}
                </small>
              </div>
              <p>{team.description}</p>
              <button
                className="button secondary small"
                disabled={disabled}
                onClick={() => add({ kind: 'team', id: team.id }, steps.length)}
              >
                <Plus size={14} />
                Ajouter l’équipe
              </button>
            </article>
          ))}
          {!teams.length && <p className="muted">Aucune équipe correspondante.</p>}
        </div>
      </section>
      <section className="team-catalog" aria-label="Agents individuels">
        <h3>
          Agents <small>Favoris en premier</small>
        </h3>
        <div className="team-agent-grid">
          {agents.map((agent) => (
            <article className="team-agent" key={agent.id} data-agent-id={agent.id}>
              <AgentFavorite agent={agent} state={state} dispatch={dispatch} />
              <div
                className="team-avatar-drag"
                draggable={!disabled}
                onDragStart={(event) => start(event, { kind: 'agent', id: agent.id })}
                onDragEnd={end}
                title={`Glisser ${agent.nickname || agent.name}`}
              >
                <Avatar agent={agent} />
                <GripVertical size={14} />
              </div>
              <strong>{agent.nickname || agent.name}</strong>
              <p>{agent.description}</p>
              <button
                className="button secondary small"
                disabled={disabled}
                aria-label={`Ajouter ${agent.nickname || agent.name}`}
                onClick={() => add({ kind: 'agent', id: agent.id }, steps.length)}
              >
                <Plus size={14} />
                Ajouter
              </button>
            </article>
          ))}
          {!agents.length && <p className="muted">Aucun agent correspondant.</p>}
        </div>
      </section>
      <div className="team-save-bar">
        <span className="team-sr-only" aria-live="polite">
          {announcement}
        </span>
        {(locked || stale) && (
          <p className="team-error" role="alert">
            {locked
              ? 'Le parcours a commencé : l’équipe est désormais verrouillée.'
              : 'L’équipe a changé. Fermez puis rouvrez ce panneau.'}
          </p>
        )}
        {error && (
          <p className="team-error" role="alert">
            {error}
          </p>
        )}
        {!!issues.length && (
          <p className="team-error" role="alert">
            {[...new Set(issues)].join(' ')}
          </p>
        )}
        {!!missingSkills.length && (
          <p className="muted">
            Skills introuvables : {missingSkills.join(', ')}. Restaurez-les ou excluez-les du
            contexte avant lancement.
          </p>
        )}
        {feature.autopilot && (
          <p className="muted">
            Valider cette composition réinitialise la configuration du pilote.
          </p>
        )}
        <div className="modal-actions">
          <span className="muted">
            {!steps.length
              ? 'La feature restera sans équipe.'
              : 'Modifiable jusqu’à la première décision ou exécution.'}
          </span>
          <button className="button secondary" disabled={pending} onClick={onClose}>
            Annuler
          </button>
          <button
            className="button primary"
            disabled={disabled || !!issues.length}
            onClick={() => {
              request.current = crypto.randomUUID();
              setPending(true);
              onPendingChange(true);
              setError('');
              dispatch({
                type: 'saveFeatureTeam',
                featureId: feature.id,
                requestId: request.current,
                expectedRevision: revision,
                steps,
              });
            }}
          >
            {pending ? 'Enregistrement…' : 'Valider l’équipe'}
          </button>
        </div>
      </div>
    </div>
  );
}
