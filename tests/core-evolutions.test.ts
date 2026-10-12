import { describe, expect, it } from 'vitest';
import {
  autopilotConfigSchema,
  budgetSchema,
  launchSchema,
  mcpServerSchema,
  memorySchema,
  reviewSchema,
} from '../src/core/evolutionSchemas';
describe('bounded strict evolution configuration', () => {
  it('accepts secret references only and rejects embedded URL credentials or transport ambiguity', () => {
    const server = {
      id: 'local',
      name: 'Local',
      transport: 'stdio',
      command: 'node',
      args: [],
      envKeys: ['MCP_TOKEN'],
      headers: {},
      tools: ['search'],
      autoApproveReadOnly: false,
      enabled: true,
    };
    expect(mcpServerSchema.parse(server).command).toBe('node');
    expect(() =>
      mcpServerSchema.parse({ ...server, env: { MCP_TOKEN: 'secret-value' } }),
    ).toThrow();
    expect(() =>
      mcpServerSchema.parse({ ...server, envKeys: ['literal-secret-with-dashes'] }),
    ).toThrow();
    expect(() =>
      mcpServerSchema.parse({
        ...server,
        transport: 'http',
        command: undefined,
        url: 'https://user:password@example.com',
      }),
    ).toThrow();
    expect(() => mcpServerSchema.parse({ ...server, url: 'https://example.com' })).toThrow();
  });
  it('rejects huge context, duplicate selections, invalid budgets and conflicting review claims', () => {
    const launch = { initialContext: '', mcpServerIds: [], memoryIds: [], useProjectMemory: false };
    expect(() => launchSchema.parse({ ...launch, initialContext: 'x'.repeat(60001) })).toThrow();
    expect(() => launchSchema.parse({ ...launch, memoryIds: ['a', 'a'] })).toThrow();
    expect(() =>
      budgetSchema.parse({ maxRuns: 0, maxPromptChars: 60000, modelProfile: 'current' }),
    ).toThrow();
    expect(() =>
      reviewSchema.parse({
        verdict: 'pass',
        summary: 'Fine',
        findings: [{ id: 'bug', severity: 'blocking', message: 'Bug' }],
      }),
    ).toThrow();
    expect(() =>
      autopilotConfigSchema.parse({
        checkpoints: [],
        maxRuns: 10,
        maxCorrectionCycles: 21,
        stepInputs: {},
      }),
    ).toThrow();
  });
  it('rejects MCP configurations that the runtime cannot grant precisely', () => {
    const server = {
      id: 'mcp-local',
      name: 'Local',
      transport: 'stdio',
      command: 'node',
      args: [],
      envKeys: [],
      headers: {},
      tools: ['search'],
      autoApproveReadOnly: false,
      enabled: true,
    };
    for (const id of ['github', 'constructor', 'prototype', '1server', 'with.dot', 'x'.repeat(65)])
      expect(() => mcpServerSchema.parse({ ...server, id })).toThrow();
    for (const tools of [['*'], ['search', 'search'], ['with/slash'], ['x'.repeat(129)]])
      expect(() => mcpServerSchema.parse({ ...server, tools })).toThrow();
    expect(() =>
      mcpServerSchema.parse({ ...server, envKeys: ['MCP_TOKEN', 'MCP_TOKEN'] }),
    ).toThrow();
    expect(() =>
      mcpServerSchema.parse({
        ...server,
        transport: 'http',
        command: undefined,
        url: 'https://example.com/mcp#fragment',
      }),
    ).toThrow();
  });
  it('validates local memory without any adapter or extra prompt request', () => {
    const memory = {
      id: 'memory',
      title: 'Decision',
      content: 'Keep the existing contract',
      category: 'decision',
      enabled: true,
      agentIds: [],
      updatedAt: 'now',
    };
    expect(memorySchema.parse(memory).content).toBe('Keep the existing contract');
    expect(() => memorySchema.parse({ ...memory, unknown: true })).toThrow();
  });
});
