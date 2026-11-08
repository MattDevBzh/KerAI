import { randomUUID } from 'node:crypto';
import { WorkflowEngine } from '../core/workflow';
import type { AgentAdapter, AgentProfile, Feature, StudioSettings } from '../shared/types';
import { redact } from './process';
export async function runPrProse(input: {
  feature: Feature;
  agent: AgentProfile;
  adapter: AgentAdapter;
  settings: StudioSettings;
  workspacePath: string;
  prompt: string;
  signal: AbortSignal;
}) {
  const feature = new WorkflowEngine().createFeature(
    {
      id: 'pr-writing',
      name: 'Rédaction de PR',
      description: '',
      icon: 'git-pull-request',
      steps: [
        {
          id: 'write',
          name: 'Rédiger les propositions',
          description: '',
          agentId: input.agent.id,
          policy: 'read-only',
          skills: [],
          maxAttempts: 1,
          artifact: 'pr.md',
          dependsOn: [],
          model: input.agent.model,
          reasoning: input.agent.reasoning,
        },
      ],
    },
    { title: input.feature.title, description: '' },
  );
  const attempt = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    status: 'running' as const,
    feedback: '',
    logs: [],
    questions: [],
    answers: {},
    changedFiles: [],
  };
  const result = await input.adapter.run(
    {
      mode: 'discussion',
      feature,
      step: feature.steps[0],
      attempt,
      agent: { ...structuredClone(input.agent), tools: [], skills: [], policy: 'read-only' },
      skills: [],
      workspacePath: input.workspacePath,
      settings: { ...input.settings, hooks: [], testCommands: [], testPaths: [], mcpServers: [] },
      preparedPrompt: redact(input.prompt),
    },
    { onSession() {}, onEvent() {} },
    input.signal,
  );
  if (input.signal.aborted) throw new Error('Rédaction arrêtée. Les textes sont conservés.');
  return result;
}
export function parsePrJson(content: string): unknown {
  try {
    return JSON.parse(
      content
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, ''),
    );
  } catch {
    throw new Error('La réponse de l’agent est illisible. Ton brouillon est conservé.');
  }
}
