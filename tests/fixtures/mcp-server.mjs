/** Deterministic stdio fixture. No model, network, packages or workspace mutation. */
import readline from 'node:readline';
const tools = [
  {
    name: 'read_story',
    description: 'Read a fixture story',
    inputSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'write_story',
    description: 'Simulated write, never changes disk',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'unknown_story',
    description: 'Unknown access annotation; deterministic response only',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
  },
];
const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.id === undefined) return;
  let result;
  switch (request.method) {
    case 'initialize':
      result = {
        protocolVersion: request.params?.protocolVersion ?? '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'feature-studio-fixture', version: '1.0.0' },
      };
      break;
    case 'ping':
      result = {};
      break;
    case 'tools/list':
      result = { tools };
      break;
    case 'tools/call':
      result = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: request.params?.arguments?.id ?? 1,
              title: 'A fixture story',
              called: request.params?.name,
            }),
          },
        ],
      };
      break;
    default:
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: 'Unsupported fixture method' },
        }) + '\n',
      );
      return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
