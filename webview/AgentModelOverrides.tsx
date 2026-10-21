import type { AgentProfile, StudioState, WorkflowStep } from '../src/shared/types';
import { agentPolicy } from '../src/shared/agentInheritance';

export function AgentProfileSummary({
  agent,
  state,
  native = false,
}: {
  agent: AgentProfile;
  state: StudioState;
  native?: boolean;
}) {
  const permissions = {
    'read-only': 'Lecture seule',
    'workspace-write': 'Écriture dans le projet',
    tests: 'Tests préautorisés',
  };
  return (
    <div className="field-help" aria-label="Paramètres hérités de l’agent">
      <strong>{agent.nickname || agent.name}</strong>
      <p>{agent.description}</p>
      <p>
        Skills :{' '}
        {agent.skills.map((id) => state.skills.find((s) => s.id === id)?.name || id).join(', ') ||
          'Aucune'}
      </p>
      <p>
        {native
          ? 'Permissions : réglage Copilot de la session'
          : `Profil Studio : ${permissions[agentPolicy(agent)]}`}{' '}
        · Contexte : {agent.emptyContextByDefault ? 'vide par défaut' : 'profil de l’agent'}
      </p>
      <small>
        Instructions et skills proviennent du menu Agents au lancement.{' '}
        {native
          ? 'Les outils natifs suivent les permissions de la session.'
          : 'Les restrictions des outils Studio concernent les sessions utilisant ce régime.'}
      </small>
    </div>
  );
}

export function AgentModelOverrides({
  step,
  state,
  onChange,
  native = false,
}: {
  step: Pick<WorkflowStep, 'agentId' | 'model' | 'reasoning'>;
  state: StudioState;
  native?: boolean;
  onChange: (patch: Pick<WorkflowStep, 'model' | 'reasoning'>) => void;
}) {
  const agent = state.agents.find((agent) => agent.id === step.agentId);
  const model = step.model || agent?.model || state.settings.defaultModel;
  const efforts = state.runtime.models.find((m) => m.id === model)?.reasoningEfforts ?? [];
  return (
    <>
      {agent && <AgentProfileSummary agent={agent} state={state} native={native} />}
      <div className="field-row">
        <label className="field">
          <span>Modèle de l’intervention</span>
          <select
            value={step.model ?? ''}
            onChange={(e) => onChange({ model: e.target.value || undefined, reasoning: undefined })}
          >
            <option value="">
              Hériter de l’agent ({agent?.model || state.settings.defaultModel || 'Automatique'})
            </option>
            {step.model && !state.runtime.models.some((m) => m.id === step.model) && (
              <option value={step.model}>{step.model} · configuré</option>
            )}
            {state.runtime.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Niveau de réflexion</span>
          <select
            value={step.reasoning ?? ''}
            onChange={(e) => onChange({ reasoning: e.target.value || undefined })}
          >
            <option value="">Hériter de l’agent ({agent?.reasoning || 'Automatique'})</option>
            {[...new Set([...(step.reasoning ? [step.reasoning] : []), ...efforts])].map(
              (effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      <p className="field-help">
        Un choix « Hériter » reste vide dans l’équipe. La valeur courante de l’agent est utilisée à
        chaque lancement.
      </p>
    </>
  );
}
