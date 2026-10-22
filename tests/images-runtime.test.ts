import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { CopilotClient } from '@github/copilot-sdk';
import { expect, it } from 'vitest';
import { CopilotCliAdapter } from '../src/host/CopilotCliAdapter';
import { WorkflowEngine } from '../src/core/workflow';
import { defaultSettings } from '../src/core/store';
import { screenshot } from './image-fixture';
import type { RunInput } from '../src/shared/types';
const cliPath = process.env.FEATURE_STUDIO_CATALOG_CLI;
it.skipIf(!cliPath)(
  'real runtime forwards image pixels to the provider and confines documentation to read/web tools',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'kerai-images-'));
    const requests: string[] = [];
    let catalog: string[] = [];
    let turn = 0;
    let claims = 0;
    const calls = [
      { name: 'studio_list_proofs', arguments: '{}' },
      {
        name: 'studio_propose_claim',
        arguments: JSON.stringify({
          text: 'La capture est fournie, analyse visuelle non effectuée.',
          proofIds: [],
          verdict: 'unverified',
        }),
      },
    ];
    const server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      requests.push(body);
      const call = calls[turn++];
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'fixture',
          object: 'chat.completion',
          created: 1,
          model: 'gpt-4.1',
          choices: [
            {
              index: 0,
              message: call
                ? {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{ id: `call-${turn}`, type: 'function', function: call }],
                  }
                : {
                    role: 'assistant',
                    content: '# Image reçue\n\nFixture déterministe, aucun jugement visuel réel.',
                  },
              finish_reason: call ? 'tool_calls' : 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    const engine = new WorkflowEngine();
    const feature = engine.createFeature(
      {
        id: 'documentation',
        name: 'Documentation',
        description: '',
        icon: '',
        steps: [
          {
            id: 'research',
            name: 'Recherche',
            description: 'Analyser la capture',
            agentId: 'fs-doc-research',
            skills: [],
            policy: 'read-only',
            dependsOn: [],
            artifact: 'recherche.md',
            maxAttempts: 1,
          },
        ],
      },
      { title: 'Image', description: 'Décris cette capture' },
    );
    feature.execution = { mode: 'copilot-native', permissionMode: 'manual' };
    const step = feature.steps[0];
    const attempt = engine.beginRun(feature.id, step.id);
    const input: RunInput = {
      feature,
      step,
      attempt,
      images: [screenshot],
      workspacePath: root,
      settings: { ...defaultSettings, timeoutMinutes: 1 },
      agent: {
        id: 'fs-doc-research',
        name: 'Recherche',
        description: '',
        instructions: 'Lecture seule',
        tools: ['read', 'search', 'web', 'documentation'],
        skills: [],
        source: 'bundled',
        path: '',
      },
      skills: [],
    };
    const adapter = new CopilotCliAdapter({
      cliPath: cliPath!,
      storagePath: join(root, 'runtime'),
      launcherPath: resolve('scripts/copilot-launcher.js'),
      getTools: async () => [],
      clientFactory: (options) => {
        const client = new CopilotClient({
          ...options,
          useLoggedInUser: false,
          env: { ...options.env, COPILOT_HOME: join(root, 'home') },
        });
        client.getAuthStatus = async () => ({ isAuthenticated: true });
        client.listModels = async () => [
          {
            id: 'gpt-4.1',
            name: 'Fixture vision',
            capabilities: {
              supports: { vision: true, reasoningEffort: false },
              limits: { max_context_window_tokens: 128000 },
            },
          },
        ];
        const original = client.createSession.bind(client);
        client.createSession = async (config) => {
          const session = await original({
            ...config,
            provider: { type: 'openai', baseUrl: `http://127.0.0.1:${port}`, apiKey: 'fixture' },
          });
          await session.rpc.tools.initializeAndValidate();
          catalog = (await session.rpc.tools.getCurrentMetadata()).tools?.map((t) => t.name) ?? [];
          return session;
        };
        return client;
      },
    });
    try {
      await adapter.run(
        input,
        {
          onEvent() {},
          onSession() {},
          onNativePermission: async () => false,
          getProofs: () => [],
          onProofClaim: async (proposal) => {
            claims++;
            return {
              ...proposal,
              author: 'agent',
              at: new Date().toISOString(),
              reportRevision: 0,
            };
          },
        },
        new AbortController().signal,
      );
      expect(catalog).toContain('web_fetch');
      expect(catalog).toContain('view');
      expect(catalog).toContain('studio_list_proofs');
      expect(catalog).toContain('studio_propose_claim');
      expect(claims).toBe(1);
      for (const name of ['bash', 'powershell', 'edit', 'create', 'apply_patch', 'task'])
        expect(catalog).not.toContain(name);
      expect(requests.join('\n')).toContain('image_url');
      expect(requests.join('\n')).toContain(`data:image/png;base64,${screenshot.data}`);
    } finally {
      await adapter.dispose();
      await new Promise<void>((r) => server.close(() => r()));
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
