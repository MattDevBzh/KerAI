import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CopilotClient, RuntimeConnection, type SessionConfig } from '@github/copilot-sdk';
import { expect, it } from 'vitest';
import { CopilotLaunch } from '../src/host/CopilotLaunch';
import {
  applyNativePermissions,
  decideNativePermission,
  NATIVE_TOOLS,
  NATIVE_READ_TOOLS,
  verifyNativeCatalog,
} from '../src/host/NativeCopilot';

const cliPath = process.env.FEATURE_STUDIO_CATALOG_CLI;
it.skipIf(!cliPath)(
  'real CLI native tools, questions, permission refusal and managed deny without inference',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'studio-native-runtime-'));
    const launch = await CopilotLaunch.create(cliPath!, root);
    const client = new CopilotClient({
      connection: RuntimeConnection.forStdio({
        path: resolve('scripts/copilot-launcher.js'),
        args: [
          launch.configPath,
          '--no-remote',
          '--no-custom-instructions',
          '--disable-builtin-mcps',
        ],
      }),
      workingDirectory: root,
      baseDirectory: join(root, 'runtime'),
      useLoggedInUser: false,
      logLevel: 'none',
    });
    let approve = false,
      remembered = false,
      permissions = 0;
    try {
      await client.start();
      expect((await client.getStatus()).version).toBe('1.0.102');
      await writeFile(join(root, 'fixture.txt'), 'before');
      const config: SessionConfig = {
        model: 'fixture-model',
        provider: { type: 'openai', baseUrl: 'http://127.0.0.1:1', apiKey: 'unused-local-probe' },
        workingDirectory: root,
        availableTools: NATIVE_TOOLS,
        enableConfigDiscovery: false,
        enableFileHooks: false,
        skipCustomInstructions: true,
        enableSkills: false,
        skillDirectories: [],
        pluginDirectories: [],
        memory: { enabled: false },
        remoteSession: 'off',
        // A real runtime-managed deny must win even in allow-all.
        managedSettings: { permissions: { deny: ['Shell(node --version)'] } },
        onPermissionRequest: (request) => {
          permissions++;
          return decideNativePermission(
            request,
            'manual',
            async () => (approve ? (remembered ? 'remembered' : true) : false),
            root,
          );
        },
        onUserInputRequest: async () => ({ answer: 'Blue', wasFreeform: false }),
      };
      const session = await client.createSession(config);
      await session.rpc.tools.initializeAndValidate();
      verifyNativeCatalog((await session.rpc.tools.getCurrentMetadata()).tools!.map((t) => t.name));
      await applyNativePermissions(session, 'manual', root);
      const shell = process.platform === 'win32' ? 'powershell' : 'bash';
      const execute = (command: string) =>
        session.rpc.tools.execute({
          name: shell,
          arguments: { command, description: 'Native CI fixture', mode: 'sync' },
        });
      await execute(`node -e "require('fs').writeFileSync('denied.txt','denied')"`).catch(() => {});
      expect(permissions).toBeGreaterThan(0);
      await expect(readFile(join(root, 'denied.txt'))).rejects.toThrow();
      approve = true;
      const read = await session.rpc.tools.execute({
        name: 'view',
        arguments: { path: join(root, 'fixture.txt') },
      });
      expect(JSON.stringify(read)).toContain('before');
      await session.rpc.tools.execute({
        name: 'edit',
        arguments: { path: join(root, 'fixture.txt'), old_str: 'before', new_str: 'after' },
      });
      expect(await readFile(join(root, 'fixture.txt'), 'utf8')).toBe('after');
      await session.rpc.tools.execute({
        name: 'apply_patch',
        arguments: '*** Begin Patch\n*** Add File: patch-fixture.txt\n+native patch\n*** End Patch',
      });
      expect((await readFile(join(root, 'patch-fixture.txt'), 'utf8')).trim()).toBe('native patch');
      const beforeRemembered = permissions;
      const permissionWorkspace = join(root, 'permission-root');
      await mkdir(permissionWorkspace);
      // Force an actual read request while the host still scopes the grant to this fixture.
      await applyNativePermissions(session, 'manual', permissionWorkspace);
      remembered = true;
      const rememberedRead = await session.rpc.tools.execute({
        name: 'view',
        arguments: { path: join(root, 'fixture.txt') },
      });
      expect(JSON.stringify(rememberedRead)).toContain('after');
      expect(permissions).toBeGreaterThan(beforeRemembered);
      remembered = false;
      await applyNativePermissions(session, 'manual', root);
      expect(JSON.stringify(await execute('node -e "console.log(42)"'))).toContain('42');
      const answer = await session.rpc.tools.execute({
        name: 'ask_user',
        arguments: { question: 'Choose', choices: ['Blue', 'Red'] },
      });
      expect(JSON.stringify(answer)).toContain('Blue');
      await applyNativePermissions(session, 'allow-all', root);
      approve = false;
      const count = permissions;
      expect(JSON.stringify(await execute('node -e "console.log(43)"'))).toContain('43');
      expect(permissions).toBe(count);
      const denied = await execute('node --version').catch((error) => ({
        error: error.message,
      }));
      expect(denied).not.toMatchObject({ resultType: 'success' });
      await applyNativePermissions(session, 'manual', root);
      await execute('node -e "console.log(44)"').catch(() => {});
      expect(permissions).toBeGreaterThan(count);
      await session.disconnect();
      // A resumed session must really change its model-facing catalog in both directions.
      for (const readOnly of [true, false, true]) {
        const resumed = await client.resumeSession(session.sessionId, {
          ...config,
          allowTranscriptRecovery: false,
          availableTools: readOnly ? NATIVE_READ_TOOLS : NATIVE_TOOLS,
        });
        await applyNativePermissions(resumed, 'manual', root);
        await resumed.rpc.tools.initializeAndValidate();
        const names = (await resumed.rpc.tools.getCurrentMetadata()).tools!.map((t) => t.name);
        verifyNativeCatalog(names, [], readOnly);
        expect(resumed.sessionId).toBe(session.sessionId);
        expect(names.includes('edit')).toBe(!readOnly);
        if (readOnly) {
          await resumed.rpc.tools
            .execute({
              name: 'apply_patch',
              arguments:
                '*** Begin Patch\n*** Add File: forbidden-patch.txt\n+forbidden\n*** End Patch',
            })
            .catch(() => undefined);
          await expect(readFile(join(root, 'forbidden-patch.txt'))).rejects.toThrow();
        }
        approve = true;
        const content = await resumed.rpc.tools.execute({
          name: 'view',
          arguments: { path: join(root, 'fixture.txt') },
        });
        expect(JSON.stringify(content)).toContain('after');
        await resumed.disconnect();
      }
    } finally {
      await client.stop();
      await launch.stop();
      await launch.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
