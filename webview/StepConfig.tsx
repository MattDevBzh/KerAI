import { Check } from 'lucide-react';
import { useState } from 'react';
import { orderedAgents } from '../src/shared/team';
import type { FeatureStep, StudioState } from '../src/shared/types';
import { AgentProfileSummary } from './AgentModelOverrides';
import { McpPicker } from './ExecutionUI';

import { ModelSelect } from './SessionPrimitives';

export function StepConfig({
  native = false,
  step,
  state,
  save,
}: {
  native?: boolean;
  step: FeatureStep;
  state: StudioState;
  save: (v: {
    agentId: string;
    model?: string;
    reasoning?: string;
    skills: string[];
    maxAttempts: number;
    initialContext?: string;
    mcpServerIds?: string[];
    askBeforeRun?: boolean;
  }) => void;
}) {
  const [agent, setAgent] = useState(step.agentId);
  const [model, setModel] = useState(step.model ?? '');
  const [reasoning, setReasoning] = useState(step.reasoning ?? '');
  const [skills, setSkills] = useState(step.skills);
  const [maxAttempts, setMaxAttempts] = useState(step.maxAttempts);
  const [initialContext, setInitialContext] = useState(step.initialContext ?? '');
  const [mcpServerIds, setMcpServerIds] = useState(step.mcpServerIds ?? []);
  const [askBeforeRun, setAskBeforeRun] = useState(step.askBeforeRun ?? false);
  const profile = state.agents.find((a) => a.id === agent);
  const efforts =
    state.runtime.models.find(
      (m) => m.id === (model || profile?.model || state.settings.defaultModel),
    )?.reasoningEfforts ?? [];
  return (
    <form
      className="step-config"
      onSubmit={(e) => {
        e.preventDefault();
        save({
          agentId: agent,
          model: model || undefined,
          reasoning: reasoning || undefined,
          skills: step.inheritAgent ? [] : skills,
          maxAttempts,
          initialContext,
          mcpServerIds,
          askBeforeRun,
        });
      }}
    >
      <div className="field-row">
        <label className="field">
          <span>Profil de l’agent</span>
          <select
            disabled={step.inheritAgent}
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
          >
            {orderedAgents(state.agents, state.favoriteAgentIds).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <ModelSelect
          state={state}
          value={model}
          emptyLabel={`Hériter de l’agent (${profile?.model || state.settings.defaultModel || 'Automatique'})`}
          onChange={(v) => {
            setModel(v);
            setReasoning('');
          }}
        />
      </div>
      {(efforts.length > 0 || reasoning) && (
        <label className="field">
          <span>Effort de raisonnement</span>
          <select value={reasoning} onChange={(e) => setReasoning(e.target.value)}>
            <option value="">Hériter de l’agent ({profile?.reasoning || 'Automatique'})</option>
            {reasoning && !efforts.includes(reasoning) && (
              <option value={reasoning}>{reasoning} · configuré</option>
            )}
            {efforts.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>Limite de tentatives</span>
        <input
          type="number"
          min={Math.max(step.attempts.length, 1)}
          max={100}
          value={maxAttempts || ''}
          placeholder="Sans limite"
          onChange={(e) => setMaxAttempts(Number(e.target.value))}
        />
        <small>
          {step.attempts.length} tentative{step.attempts.length > 1 ? 's' : ''} déjà effectuée
          {step.attempts.length > 1 ? 's' : ''}. Chaque nouvelle tentative peut consommer votre
          quota Copilot. Laisser vide autorise les relances manuelles sans limite.
        </small>
      </label>
      <label className="field">
        <span>Contexte initial de l’étape</span>
        <textarea
          rows={3}
          value={initialContext}
          onChange={(e) => setInitialContext(e.target.value)}
          placeholder="Le contexte proposé à chaque lancement de cette étape."
        />
      </label>
      <McpPicker state={state} selected={mcpServerIds} onChange={setMcpServerIds} />
      <label className="inline-check">
        <input
          type="checkbox"
          checked={askBeforeRun}
          onChange={(e) => setAskBeforeRun(e.target.checked)}
        />
        <span>Demander un contexte humain avant exécution automatique</span>
      </label>
      {step.inheritAgent && profile ? (
        <AgentProfileSummary agent={profile} state={state} native={native} />
      ) : (
        <fieldset className="skill-options">
          <legend>Skills pour cette étape</legend>
          {state.skills.length ? (
            state.skills.map((s) => (
              <label key={s.id}>
                <input
                  type="checkbox"
                  checked={skills.includes(s.id)}
                  onChange={(e) =>
                    setSkills(
                      e.target.checked ? [...skills, s.id] : skills.filter((id) => id !== s.id),
                    )
                  }
                />
                {s.name}
              </label>
            ))
          ) : (
            <span className="muted">Aucune skill disponible dans ce projet.</span>
          )}
        </fieldset>
      )}
      <button className="button secondary small" disabled={!agent}>
        Enregistrer la configuration <Check size={14} />
      </button>
    </form>
  );
}
