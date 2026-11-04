import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { browserErrorMessage, type BrowserPhase } from '../src/host/navigation/BrowserErrors';
import { BrowserSessionManager } from '../src/host/navigation/BrowserSessionManager';
import {
  browserDiagnostics,
  browserFailureEvidence,
  type BrowserDiagnostic,
} from '../src/host/navigation/BrowserDiagnostics';

const privateLog =
  '\nCall log: https://private.invalid/account?token=SECRET_URL_TOKEN\nfill("SECRET_FIELD") C:\\Users\\PRIVATE_PERSON\\profile';
describe('browser failure diagnostics', () => {
  it('keeps useful system evidence but excludes arbitrary values and private log content', () => {
    const evidence = browserFailureEvidence(
      new Error(
        'spawn EPERM net::ERR_CERT_AUTHORITY_INVALID exitCode=21 signal=SIGTERM' + privateLog,
      ),
    );
    expect(evidence).toEqual({
      systemCode: 'EPERM',
      networkCode: 'ERR_CERT_AUTHORITY_INVALID',
      exitCode: 21,
      signal: 'SIGTERM',
    });
    expect(
      browserFailureEvidence(
        new Error('net::ERR_SECRET_TOKEN signal=SECRET_SIGNAL exitCode=SECRET_EXIT' + privateLog),
      ),
    ).toEqual({});
    expect(JSON.stringify(evidence)).not.toContain('SECRET');
  });
  it.each<[BrowserPhase, string, string]>([
    ['launch', 'Failed to create a ProcessSingleton for your profile directory.', 'déjà utilisé'],
    ['launch', 'spawn EPERM', 'système refuse'],
    ['launch', 'spawn ENOENT', 'n’est plus accessible'],
    ['launch', 'Target page, context or browser has been closed', 'fermé pendant son démarrage'],
    ['launch', 'Timeout 15000ms exceeded', 'démarrage dans le délai'],
    ['navigate', 'page.goto: net::ERR_CERT_AUTHORITY_INVALID', 'connexion HTTPS'],
    ['navigate', 'page.goto: net::ERR_CONNECTION_REFUSED', 'application refuse la connexion'],
    [
      'navigate',
      'page.goto: net::ERR_NAME_NOT_RESOLVED',
      'adresse de l’application est introuvable',
    ],
    ['navigate', 'page.goto: net::ERR_TUNNEL_CONNECTION_FAILED', 'proxy'],
    ['navigate', 'Timeout 15000ms exceeded', 'chargement de l’application'],
    ['setup', 'binding failure', 'préparer la session'],
    ['prepare', 'unexpected registry failure', 'vérifier le navigateur installé'],
    ['operation', 'Timeout 15000ms exceeded', 'cible absente'],
  ])('classifies %s failures without exposing Playwright logs: %s', (phase, raw, expected) => {
    const message = browserErrorMessage(new Error(raw + privateLog), phase);
    expect(message).toContain(expected);
    for (const secret of ['private.invalid', 'SECRET_URL_TOKEN', 'SECRET_FIELD', 'PRIVATE_PERSON'])
      expect(message).not.toContain(secret);
  });
  it('keeps unknown failures specific to their phase and preserves curated validation errors', () => {
    expect(browserErrorMessage(new Error(privateLog), 'launch')).toContain(
      'Impossible de démarrer',
    );
    expect(browserErrorMessage(new Error(privateLog), 'navigate')).toContain(
      'page de l’application',
    );
    expect(browserErrorMessage(new Error('NAV:Origine non autorisée.'), 'navigate')).toBe(
      'Origine non autorisée.',
    );
    expect(browserErrorMessage(null, 'launch')).toContain('Impossible de démarrer');
  });
});

describe('startup error across the real worker IPC', () => {
  let directory: string;
  let manager: BrowserSessionManager;
  const diagnostics: BrowserDiagnostic[] = [];
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'kerai-startup-failure-'));
    const require = createRequire(import.meta.url);
    await mkdir(path.join(directory, 'node_modules'));
    await symlink(
      path.dirname(require.resolve('playwright-core/package.json')),
      path.join(directory, 'node_modules', 'playwright-core'),
      'junction',
    );
    const workerPath = path.join(directory, 'worker.cjs');
    await build({
      entryPoints: ['src/host/navigation/worker.ts'],
      outfile: workerPath,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['playwright-core', 'playwright-core/package.json'],
      // Only process launch is simulated. The actual worker and manager exchange IPC.
      banner: {
        js: `require('playwright-core').chromium.launchPersistentContext = async () => { throw new Error(${JSON.stringify('Failed to create a ProcessSingleton for your profile directory.' + privateLog)}); };`,
      },
      logLevel: 'silent',
    });
    manager = new BrowserSessionManager({
      storageRoot: path.join(directory, 'private'),
      workerPath,
      executablePath: process.execPath,
    });
    browserDiagnostics.configure((row) => diagnostics.push(row));
  });
  afterAll(async () => {
    await manager?.dispose();
    browserDiagnostics.configure();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it('reports a detected executable separately from an unsuccessful launch', async () => {
    expect(await manager.prepare()).toMatchObject({
      ready: true,
      executablePath: process.execPath,
    });
    await expect(
      manager.open({
        id: 'fixture',
        name: 'Fixture',
        projectIds: [],
        origin: 'https://private.invalid',
        allowedOrigins: [],
        interactionPolicy: 'inspect',
        createdAt: '',
        updatedAt: '',
      }),
    ).rejects.toThrow('Le profil de navigateur réservé à KerAI est déjà utilisé.');
    expect(manager.status()?.state).toBe('interrupted');
    expect(diagnostics.map(({ phase, outcome }) => [phase, outcome])).toEqual([
      ['prepare', 'started'],
      ['prepare', 'ok'],
      ['launch', 'started'],
      ['launch', 'error'],
    ]);
    expect(diagnostics.at(-1)).toMatchObject({
      platform: process.platform,
      arch: process.arch,
      runtime: expect.any(String),
      elapsedMs: expect.any(Number),
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(/SECRET|PRIVATE_PERSON|private.invalid/);
  });
});
