import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, symlink, rm, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  BrowserSessionManager,
  navigationOrigin,
} from '../src/host/navigation/BrowserSessionManager';
import { importNavigationJSON } from '../src/host/ChromeRecorderImport';
import { navigationDefinitionHash } from '../src/host/NavigationStore';
import { installInteractionGuard } from '../src/host/navigation/InteractionGuard';
import { installRecorder } from '../src/host/navigation/recorder';
import { navigationFixture } from './fixtures/navigation-application';
import type {
  ApplicationProfile,
  NavigationJourney,
  NavigationStep,
} from '../src/shared/navigation';

const executablePath = [
  chromium.executablePath(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].find((candidate) => existsSync(candidate));
const require = createRequire(import.meta.url);
const step = (
  action: NavigationStep['action'],
  id: string,
  more: Partial<NavigationStep> = {},
): NavigationStep => ({ action, id, ...more });
const target = (value: string) => ({ strategy: 'css' as const, value });
let fixture: Awaited<ReturnType<typeof navigationFixture>>;
let directory: string;
let workerPath: string;
let manager: BrowserSessionManager;
let application: ApplicationProfile;

// These tests never contact Copilot or install a browser. CI without Chromium reports the prerequisite explicitly.
describe.skipIf(!executablePath)(
  'navigation real browser worker (existing Chromium required)',
  () => {
    beforeAll(async () => {
      fixture = await navigationFixture();
      directory = await mkdtemp(path.join(tmpdir(), 'kerai-navigation-browser-'));
      workerPath = path.join(directory, 'runtime', 'worker.cjs');
      await mkdir(path.join(directory, 'runtime', 'node_modules'), { recursive: true });
      await symlink(
        path.dirname(require.resolve('playwright-core/package.json')),
        path.join(directory, 'runtime', 'node_modules', 'playwright-core'),
        'junction',
      );
      await build({
        entryPoints: ['src/host/navigation/worker.ts'],
        outfile: workerPath,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node22',
        external: ['playwright-core', 'playwright-core/package.json'],
        // Resolve synthetic custom domains locally, only inside this test worker.
        banner: {
          js: `
          const testChromium = require('playwright-core').chromium;
          const testLaunch = testChromium.launchPersistentContext.bind(testChromium);
          testChromium.launchPersistentContext = (profile, options) => testLaunch(profile, {
            ...options,
            args: ['--host-resolver-rules=MAP *.kerai.test 127.0.0.1', '--no-proxy-server', '--remote-debugging-port=0'],
          });
        `,
        },
        logLevel: 'silent',
      });
      application = {
        id: 'fixture',
        name: 'Fixture',
        projectIds: [],
        origin: fixture.origin,
        allowedOrigins: [],
        interactionPolicy: 'authorized',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });
    afterAll(async () => {
      await fixture?.close();
      if (directory) await rm(directory, { recursive: true, force: true });
    });
    beforeEach(async () => {
      manager = new BrowserSessionManager({
        storageRoot: path.join(directory, 'private'),
        workerPath,
        executablePath,
        headless: true,
      });
      await manager.open(application);
    });
    afterEach(async () => {
      await manager?.acknowledgeRecording();
      await manager?.dispose();
    });

    test('distinguishes a refused local connection from browser startup and can retry', async () => {
      const stopped = await navigationFixture();
      await stopped.close();
      await expect(manager.open({ ...application, origin: stopped.origin })).rejects.toThrow(
        'Le navigateur a démarré, mais l’application refuse la connexion',
      );
      expect(manager.status()?.state).toBe('interrupted');
      await manager.open(application);
      expect((await manager.inspect()).text).toContain('Parcours local');
    });
    test('diagnoses HTTPS failure without bypassing TLS checks', async () => {
      await expect(
        manager.open({ ...application, origin: fixture.origin.replace('http:', 'https:') }),
      ).rejects.toThrow('Le navigateur a démarré, mais la connexion HTTPS');
      expect(manager.status()?.state).toBe('interrupted');
    });
    test('replays a real imported double click, then waits for delayed postconditions', async () => {
      const imported = importNavigationJSON(
        JSON.stringify({
          title: 'Double',
          steps: [{ type: 'doubleClick', selectors: [['#double']] }],
        }),
        'fixture',
      );
      await manager.act(imported.journey.steps[0]);
      expect((await manager.inspect()).text).toContain('Double réussi');
      await manager.act(
        step('click', 'delayed', {
          target: target('#delayed'),
          postconditions: [{ kind: 'visible', target: target('#delayed-result') }],
        }),
      );
      expect((await manager.inspect()).text).toContain('Prêt');
    });
    test('resolves a related business entity and refuses to silently substitute a frozen identity', async () => {
      const selection = step('resolve', 'garage', {
        target: target('.garage'),
        resolver: {
          output: 'garageId',
          attribute: 'data-id',
          pick: 'unique',
          filters: [{ selector: '.brand', text: 'Oula' }, { selector: '.car' }],
        },
      });
      const result = await manager.act(selection);
      expect(result.resolvedParameters).toEqual({ garageId: 'g1' });
      await expect(manager.act(selection, { garageId: 'g2' })).rejects.toThrow(
        'Aucune donnée métier',
      );
      const car = await manager.act(
        step('resolve', 'car', {
          target: target('.garage[data-id="{{garageId}}"] .car'),
          resolver: { output: 'carId', attribute: 'data-car', pick: 'unique', filters: [] },
        }),
        result.resolvedParameters,
      );
      expect(car.resolvedParameters).toEqual({ carId: 'c1' });
    });
    test('reaches an already verified state without reset but reproduces the full sequence', async () => {
      const recipe: NavigationJourney = {
        id: 'reach',
        applicationId: application.id,
        revision: 1,
        title: 'Garage',
        intent: 'Atteindre',
        tags: [],
        prerequisites: [],
        parameters: [],
        steps: [step('click', 'double', { target: target('#double') })],
        arrival: [{ kind: 'visible', target: target('#double') }],
        status: 'available',
        provenance: { mode: 'human' },
        createdAt: '',
        updatedAt: '',
      };
      const reached = await manager.replay(recipe, {}, { mode: 'reach' });
      expect(reached.status).toBe('succeeded');
      expect(reached.metrics.actions).toBe(0);
      expect(reached.skippedSteps).toEqual(['double']);
      const reproduced = await manager.replay(recipe, {}, { mode: 'reproduce' });
      expect(reproduced.status).toBe('succeeded');
      expect(reproduced.metrics.actions).toBe(2);
      expect(reproduced.events[0].stepId).toBe('browser-reset');
    });
    test('reach still verifies business identity even when the arrival is already visible', async () => {
      const recipe: NavigationJourney = {
        id: 'business-reach',
        applicationId: application.id,
        revision: 1,
        title: 'Garage',
        intent: 'Même garage',
        tags: [],
        prerequisites: [],
        parameters: [],
        steps: [
          step('resolve', 'select-garage', {
            target: target('.garage'),
            resolver: {
              output: 'garageId',
              attribute: 'data-id',
              pick: 'unique',
              filters: [{ selector: '.brand', text: 'Oula' }],
            },
          }),
        ],
        arrival: [{ kind: 'visible', target: target('#double') }],
        status: 'available',
        provenance: { mode: 'human' },
        createdAt: '',
        updatedAt: '',
      };
      const first = await manager.replay(recipe, {}, { mode: 'reach' });
      expect(first.status).toBe('succeeded');
      expect(first.resolvedParameters).toEqual({ garageId: 'g1' });
      const gone = await manager.replay(recipe, { garageId: 'missing' }, { mode: 'reach' });
      expect(gone.status).toBe('failed');
      expect(gone.error).toContain('Aucune donnée métier');
    });
    test('replay refuses blank required parameters before changing the browser', async () => {
      const recipe: NavigationJourney = {
        id: 'required',
        applicationId: application.id,
        revision: 1,
        title: 'Commune',
        intent: 'Afficher',
        tags: [],
        prerequisites: [],
        parameters: [
          {
            name: 'city',
            label: 'Commune',
            type: 'string',
            required: true,
            defaultValue: 'Liffré',
          },
        ],
        steps: [step('fill', 'city', { target: target('#city'), value: { parameter: 'city' } })],
        arrival: [{ kind: 'visible', target: target('#city') }],
        status: 'available',
        provenance: { mode: 'human' },
        createdAt: '',
        updatedAt: '',
      };
      for (const city of ['', '   '])
        await expect(manager.replay(recipe, { city })).rejects.toThrow('Commune');
    });
    test('compares a bounded same-origin served resource without returning its body', async () => {
      const result = await manager.assetDigest(`${fixture.origin}/build.js`);
      expect(result.sha256).toBe(
        createHash('sha256').update('window.fixtureBuild = 1;').digest('hex'),
      );
      expect(Object.keys(result).sort()).toEqual(['bytes', 'sha256']);
      await expect(manager.assetDigest(`${fixture.otherOrigin}/build.js`)).rejects.toThrow(
        'périmètre',
      );
    });
    test('opens existing Chromium, acts and checks bounded sanitized inspection', async () => {
      expect((await manager.prepare()).ready).toBe(true);
      await manager.act(
        step('fill', 'fill', { target: target('#city'), value: { literal: 'Liffré' } }),
      );
      await manager.act(
        step('click', 'click', {
          target: target('#go'),
          postconditions: [{ kind: 'text', target: target('#result'), value: 'Liffré' }],
        }),
      );
      const observation = await manager.inspect();
      expect(observation.text).toContain('Résultat Liffré');
      expect(JSON.stringify(observation)).not.toMatch(
        /TOP_SECRET|PRIVATE_LOGIN|SECRET_TOKEN|PRIVATE_TEXT/,
      );
      expect(JSON.stringify(observation).length).toBeLessThanOrEqual(6000);
      const styles = await manager.inspect({
        target: target('#result'),
        category: 'styles',
        properties: ['color', 'position', 'unsupported'],
      });
      expect(styles.elements[0].styles?.color).toBe('rgb(20, 60, 90)');
      const network = await manager.inspect({ category: 'network' });
      expect(network.text).toContain('/api');
      expect(network.text).not.toMatch(/PRIVATE_QUERY|NEVER_READ_RESPONSE_BODY/);
    });
    test('opens the configured entry path and preserves its query and hash route', async () => {
      const url = `${fixture.origin}/settings?tab=profile#details`;
      await manager.open({ ...application, startUrl: url });
      const result = await manager.act(
        step('wait', 'arrival', { postconditions: [{ kind: 'url', value: url }] }),
      );
      expect(result.url).toBe(`${fixture.origin}/settings`);
    });
    test('opens and records a custom domain while blocking undeclared hosts, schemes and ports', async () => {
      const port = new URL(fixture.origin).port;
      const origin = `http://app.kerai.test:${port}`;
      const secondOrigin = `http://second.kerai.test:${port}`;
      await manager.open({ ...application, origin, allowedOrigins: [origin, secondOrigin] });
      expect((await manager.inspect()).url).toBe(`${origin}/`);
      await manager.startRecording();
      expect(manager.status()?.recordedSteps[0].url).toBe(`${origin}/`);
      await manager.stopRecording();
      await manager.acknowledgeRecording();
      await manager.act(step('navigate', 'allowed', { url: `${secondOrigin}/clients` }));
      await manager.act(
        step('fill', 'city', { target: target('#city'), value: { literal: 'Liffré' } }),
      );
      await manager.act(step('click', 'show', { target: target('#go') }));
      expect((await manager.inspect()).text).toContain('Résultat Liffré');
      for (const url of [
        `http://undeclared.kerai.test:${port}`,
        `http://app.kerai.test:${new URL(fixture.otherOrigin).port}`,
        `https://app.kerai.test:${port}`,
        fixture.origin,
      ])
        await expect(manager.act(step('navigate', 'blocked', { url }))).rejects.toThrow(
          'non autorisée',
        );
    });
    // Two deliberately absent arrivals each consume the real 15s deadline, plus
    // three browser restarts and durable receipts. This is a correctness test.
    test('replays known journey without AI and verifies arrival separately', async () => {
      const journey: NavigationJourney = {
        id: 'journey',
        applicationId: application.id,
        revision: 1,
        hash: 'a'.repeat(64),
        title: 'Fixture',
        intent: 'reach result',
        tags: [],
        prerequisites: [],
        parameters: [{ name: 'city', label: 'Commune', type: 'string', required: true }],
        steps: [
          step('fill', 'fill', { target: target('#city'), value: { parameter: 'city' } }),
          step('click', 'click', { target: target('#go') }),
        ],
        arrival: [{ kind: 'text', target: target('#result'), value: 'Liffré' }],
        status: 'draft',
        provenance: { mode: 'human' },
        createdAt: '',
        updatedAt: '',
      };
      const run = await manager.replay(journey, { city: 'Liffré' });
      expect(run.definitionHash).toBe(navigationDefinitionHash(journey));
      expect(run.status).toBe('succeeded');
      expect(run.arrivalVerified).toBe(true);
      expect(run.metrics.providerCalls).toBe(0);
      expect(run.metrics.actions).toBe(3);
      const independent = await manager.replay(
        {
          ...journey,
          steps: [
            step('wait', 'initial', {
              target: target('h1'),
              postconditions: [{ kind: 'visible', target: target('h1') }],
            }),
          ],
        },
        { city: 'Liffré' },
      );
      expect(independent.status).toBe('failed');
      const failed = await manager.replay(
        { ...journey, arrival: [{ kind: 'text', target: target('#result'), value: 'ABSENT' }] },
        { city: 'Liffré' },
      );
      expect(failed.status).toBe('failed');
      expect(failed.arrivalVerified).toBe(false);
    }, 90000);
    test('arrival URL distinguishes business queries and hash routes while receipts stay redacted', async () => {
      const current = `${fixture.origin}/settings?tab=profile#details`;
      const result = await manager.act(step('navigate', 'profile', { url: current }));
      expect(result.url).toBe(`${fixture.origin}/settings`);
      for (const expected of [
        `${fixture.origin}/settings?tab=security#details`,
        `${fixture.origin}/settings?tab=profile#security`,
      ]) {
        await expect(
          manager.act(
            step('wait', 'wrong-route', {
              timeoutMs: 100,
              postconditions: [{ kind: 'url', value: expected }],
            }),
          ),
        ).rejects.toThrow('attente dépassé');
      }
      await expect(
        manager.act(
          step('wait', 'correct-route', { postconditions: [{ kind: 'url', value: current }] }),
        ),
      ).resolves.toMatchObject({ conditions: [true] });
      await manager.startRecording();
      expect(manager.status()?.recordedSteps[0].url).toBe(current);
      await manager.stopRecording();
      await manager.acknowledgeRecording();
    });
    test('imported waitForElement waits for asynchronous arrival and respects its deadline', async () => {
      const imported = importNavigationJSON(
        JSON.stringify({
          title: 'Async arrival',
          steps: [
            { type: 'navigate', url: fixture.origin },
            { type: 'click', selectors: [['#delayed']] },
            {
              type: 'waitForElement',
              selectors: [['#delayed-result']],
              visible: true,
              timeout: 1500,
            },
          ],
        }),
        application.id,
      ).journey;
      const run = await manager.replay(
        {
          ...imported,
          revision: 1,
          arrival: [{ kind: 'text', target: target('#delayed-result'), value: 'Prêt' }],
        },
        {},
      );
      expect(run.status).toBe('succeeded');
      const started = Date.now();
      await expect(
        manager.act(
          step('wait', 'timeout', {
            timeoutMs: 150,
            postconditions: [{ kind: 'visible', target: target('#never-exists') }],
          }),
        ),
      ).rejects.toThrow('attente dépassé');
      expect(Date.now() - started).toBeGreaterThanOrEqual(130);
      expect(Date.now() - started).toBeLessThan(2000);
    });
    test('rejects secrets, unapproved origins, arbitrary keys and captures private host receipts', async () => {
      for (const id of ['#password', '#username', '#token'])
        await expect(
          manager.act(
            step('fill', id, { target: target(id), value: { literal: 'never-send-this' } }),
          ),
        ).rejects.toThrow('manuelle');
      await expect(
        manager.act(step('navigate', 'external', { url: fixture.otherOrigin })),
      ).rejects.toThrow('non autorisée');
      await expect(
        manager.act(step('navigate', 'secret-query', { url: `${fixture.origin}/?token=SECRET` })),
      ).rejects.toThrow('non autorisée');
      await expect(
        manager.act(step('press', 'bad-key', { target: target('#city'), key: 'Control+L' })),
      ).rejects.toThrow('non supportée');
      for (const secretRoute of ['/?%74oken=SECRET', '/#access_token=SECRET'])
        await expect(
          manager.act(
            step('navigate', 'encoded-secret', { url: `${fixture.origin}${secretRoute}` }),
          ),
        ).rejects.toThrow('non autorisée');
      const capture = await manager.capture();
      const bytes = await readFile(capture.path);
      expect(capture.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(capture.bytes).toBe(bytes.length);
      expect(capture.viewport.width).toBe(1280);
      if (process.platform !== 'win32') expect((await stat(capture.path)).mode & 0o777).toBe(0o600);
      await manager.act(step('click', 'external-frame', { target: target('#external') }));
      await expect(manager.capture()).rejects.toThrow('frame');
    });
    test('manual authentication suspends every capture and value path until explicit local resume', async () => {
      await manager.startRecording();
      await manager.takeControl();
      expect(manager.status()?.recordingPaused).toBe(true);
      await expect(manager.inspect()).rejects.toThrow('Reprise explicite');
      await expect(manager.capture()).rejects.toThrow('Reprise explicite');
      await expect(
        manager.act(
          step('fill', 'fill', { target: target('#city'), value: { literal: 'blocked' } }),
        ),
      ).rejects.toThrow('Reprise explicite');
      await manager.resumeControl();
      expect((await manager.inspect()).text).toContain('Parcours local');
    });
    test('declared Space and PageUp/PageDown keys remain managed interactions', async () => {
      await manager.act(step('press', 'space', { target: target('#check'), key: 'Space' }));
      expect(manager.status()?.state).toBe('idle');
      for (const key of ['PageUp', 'PageDown']) {
        await manager.act(step('press', key, { target: target('#city'), key }));
        expect(manager.status()?.state).toBe('idle');
      }
    });
    test('targeted scroll moves the container and preserves an omitted axis', async () => {
      await manager.act(
        step('scroll', 'container', { target: target('#scroll-box'), x: 20, y: 60 }),
      );
      await manager.act(
        step('wait', 'container-arrived', {
          postconditions: [{ kind: 'text', target: target('#scroll-state'), value: '20,60' }],
        }),
      );
      await manager.act(step('scroll', 'container-y', { target: target('#scroll-box'), y: 80 }));
      await manager.act(
        step('wait', 'container-y-arrived', {
          postconditions: [{ kind: 'text', target: target('#scroll-state'), value: '20,80' }],
        }),
      );
      await manager.act(step('scroll', 'window-y', { y: 120 }));
      await manager.act(
        step('wait', 'window-arrived', {
          postconditions: [
            { kind: 'text', target: target('#window-scroll-state'), value: '0,120' },
          ],
        }),
      );
      expect(manager.status()?.state).toBe('idle');
    });
    test('single lease rejects competing work and stop interrupts pending action', async () => {
      const pending = manager.act(
        step('click', 'waiting', { target: target('#city'), timeoutMs: 15000 }),
      );
      await expect(manager.inspect()).rejects.toThrow('commande active');
      await pending;
      await manager.act(step('navigate', 'blank', { url: `${fixture.origin}/` }));
      // Existing but hidden element exercises cancellation of a real Playwright wait.
      const wait = manager.act(
        step('wait', 'hidden', { target: target('script'), timeoutMs: 15000 }),
      );
      const result = wait.catch((error) => error as Error);
      await manager.stop();
      expect(await result).toBeInstanceOf(Error);
      expect(manager.status()?.state).toBe('interrupted');
      await expect(manager.inspect()).rejects.toThrow('Reprise explicite');
      await manager.open(application);
      expect(manager.status()?.state).toBe('idle');
    });
    test('serializes concurrent browser openings before replacing session ownership', async () => {
      const results = await Promise.allSettled([
        manager.open(application),
        manager.open(application),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(manager.status()?.state).toBe('idle');
      await expect(manager.inspect()).resolves.toMatchObject({ url: `${fixture.origin}/` });
    });
    test('stop during profile preparation cancels opening before Chromium launches', async () => {
      await manager.dispose();
      let stopped: Promise<void> | undefined;
      manager = new BrowserSessionManager({
        storageRoot: path.join(directory, 'cancelled-open'),
        workerPath,
        executablePath,
        headless: true,
        onChange(state) {
          if (state.state === 'idle' && !stopped) stopped = manager.stop();
        },
      });
      await expect(manager.open(application)).rejects.toThrow('interrompue');
      await stopped;
      expect(manager.status()?.state).toBe('interrupted');
    });
    test('recording transitions keep the application DOM untouched', async () => {
      const before = await manager.inspect();
      await manager.startRecording();
      expect(manager.status()?.state).toBe('recording');
      await expect(manager.act(step('click', 'click', { target: target('#go') }))).rejects.toThrow(
        'démonstration',
      );
      await manager.pauseRecording();
      expect(manager.status()?.recordingPaused).toBe(true);
      await manager.resumeRecording();
      await manager.stopRecording();
      const after = await manager.inspect();
      expect(after.text).toBe(before.text);
      expect(after.elements).toEqual(before.elements);
    });
    async function humanPage() {
      const profiles = path.join(directory, 'private', 'browser-profiles');
      const profile = createHash('sha256')
        .update(JSON.stringify([application.id, application.origin, application.role ?? 'default']))
        .digest('hex');
      const port = (
        await readFile(path.join(profiles, profile, 'DevToolsActivePort'), 'utf8')
      ).split('\n')[0];
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      return browser.contexts()[0].pages()[0];
    }
    test('records one effect when Enter activates a button', async () => {
      const page = await humanPage();
      await manager.startRecording();
      await page.locator('#go').press('Enter');
      await manager.stopRecording();
      expect(
        manager
          .status()
          ?.recordedSteps.slice(1)
          .map((step) => step.action),
      ).toEqual(['press']);
    });
    test('keeps paused demonstration under human control after an inspection', async () => {
      await manager.inspect();
      const page = await humanPage();
      await manager.startRecording();
      await manager.pauseRecording();
      await page.locator('#go').click();
      await manager.resumeRecording();
      await page.locator('#go').click();
      await manager.stopRecording();
      expect(
        manager
          .status()
          ?.recordedSteps.slice(1)
          .map((step) => step.action),
      ).toEqual(['click']);
    });
    test('explicitly resumes a retained demonstration after returning manual control', async () => {
      const page = await humanPage();
      await manager.startRecording();
      await manager.takeControl();
      await page.locator('#go').click();
      await manager.resumeControl();
      expect(manager.status()).toMatchObject({
        state: 'idle',
        recordingActive: true,
        recordingPaused: true,
      });
      await manager.inspect();
      await manager.resumeRecording();
      await page.locator('#go').click();
      await manager.stopRecording();
      expect(
        manager
          .status()
          ?.recordedSteps.slice(1)
          .map((step) => step.action),
      ).toEqual(['click']);
      await manager.acknowledgeRecording();
      await expect(manager.resumeRecording()).rejects.toThrow('Aucune démonstration');
    });
    test('preserves an uncorroborated navigation as a manual review step', async () => {
      const page = await humanPage();
      await page.evaluate(() => {
        const link = document.createElement('a');
        link.id = 'next-route';
        link.href = '/next';
        link.textContent = 'Suivant';
        link.addEventListener('click', () => link.remove());
        document.body.prepend(link);
      });
      await manager.startRecording();
      await page.locator('#next-route').click();
      await page.waitForURL(`${fixture.origin}/next`);
      await manager.stopRecording();
      const recorded = manager.status()!.recordedSteps.slice(1);
      expect(recorded).toMatchObject([{ action: 'manual', effect: 'unknown' }]);
      expect([`${fixture.origin}/`, `${fixture.origin}/next`]).toContain(recorded[0].url);
      expect(recorded[0].note).toContain('avant le rejeu');
      expect(recorded[0].target).toBeUndefined();
      expect(recorded[0].value).toBeUndefined();
      await expect(manager.act(recorded[0])).rejects.toThrow('Étape manuelle');
    });
    test('accepts persisted viewport boundaries and refuses dimensions outside them', async () => {
      for (const [width, height] of [
        [240, 200],
        [7680, 4320],
      ]) {
        await manager.act(step('viewport', 'resize', { width, height }));
        const observation = await manager.inspect({ target: target('body') });
        expect(observation.elements[0].rect?.width).toBeLessThanOrEqual(width);
      }
      for (const [width, height] of [
        [239, 200],
        [7681, 4320],
        [240, 199],
        [7680, 4321],
      ])
        await expect(manager.act(step('viewport', 'invalid', { width, height }))).rejects.toThrow(
          'Dimensions',
        );
    });
    test('hard host crash preserves the demo and running receipt without launching a browser on recovery', async () => {
      const crashRoot = path.join(directory, 'crash-private');
      const runner = path.join(directory, 'crash-host.cjs');
      await build({
        stdin: {
          contents:
            `
      import { BrowserSessionManager } from ${JSON.stringify(path.resolve('src/host/navigation/BrowserSessionManager.ts'))};
      const config = JSON.parse(process.argv[2]);
      const manager = new BrowserSessionManager(config.options);
      await manager.open(config.application);
      if (config.kind === 'demo') { await manager.startRecording(); process.send({ready:true}); }
      else { process.send({ready:true}); await manager.replay(config.journey,{}); }
      process.on('message', () => {});
      process.on('disconnect', () => { void manager.dispose().finally(() => process.exit(0)); });
    `.replace(
              '      await manager.open(config.application);',
              '      (async () => { await manager.open(config.application);',
            ) + '\n})();',
          resolveDir: process.cwd(),
          sourcefile: 'crash-host.ts',
          loader: 'ts',
        },
        outfile: runner,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node22',
        logLevel: 'silent',
      });
      const launch = async (kind: string, journey?: NavigationJourney) => {
        const child = fork(
          runner,
          [
            JSON.stringify({
              kind,
              journey,
              application,
              options: { storageRoot: crashRoot, workerPath, executablePath, headless: true },
            }),
          ],
          { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
        );
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            child.kill();
            reject(new Error('Crash fixture startup timeout'));
          }, 10000);
          child.once('message', () => {
            clearTimeout(timer);
            resolve();
          });
          child.once('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`Crash fixture exited: ${code}`));
          });
        });
        return child;
      };
      const demoHost = await launch('demo');
      const exited = new Promise<void>((resolve) => demoHost.once('exit', () => resolve()));
      demoHost.kill('SIGKILL');
      await exited;
      const recovered = new BrowserSessionManager({
        storageRoot: crashRoot,
        workerPath: '/must-not-launch.cjs',
      });
      await recovered.initialize();
      expect(recovered.status()?.state).toBe('interrupted');
      expect(recovered.status()?.recordingActive).toBe(true);
      expect((await recovered.stopRecording()).recordedSteps[0].action).toBe('navigate');
      await expect(recovered.inspect()).rejects.toThrow('Reprise explicite');
      await recovered.acknowledgeRecording();
      await recovered.dispose();
      const journey: NavigationJourney = {
        id: 'crashed-journey',
        applicationId: application.id,
        revision: 1,
        title: 'Interrupted',
        intent: 'Interruption',
        tags: [],
        prerequisites: [],
        parameters: [],
        steps: [
          step('fill', 'filled', { target: target('#city'), value: { literal: 'safe' } }),
          step('wait', 'pending', { target: target('script'), timeoutMs: 15000 }),
        ],
        arrival: [{ kind: 'visible', target: target('#result') }],
        status: 'draft',
        provenance: { mode: 'human' },
        createdAt: '',
        updatedAt: '',
      };
      const replayHost = await launch('replay', journey);
      try {
        await expect
          .poll(
            async () => {
              if (replayHost.exitCode !== null || replayHost.signalCode !== null)
                throw new Error(
                  `Crash fixture exited before its checkpoint: ${replayHost.exitCode ?? replayHost.signalCode}`,
                );
              const saved = JSON.parse(
                await readFile(path.join(crashRoot, 'navigation', 'browser-recovery.json'), 'utf8'),
              );
              const run = saved.runs[0];
              if (run && run.status !== 'running')
                throw new Error(
                  `Replay ended before the crash checkpoint: ${run.status}: ${run.error ?? ''}`,
                );
              return run?.events?.at(-1)?.stepId;
            },
            // Replay resets Chromium (up to 30s) before durably recording its first action.
            { timeout: 35000 },
          )
          .toBe('filled');
      } finally {
        if (replayHost.exitCode === null && replayHost.signalCode === null) {
          const replayExited = new Promise<void>((resolve) =>
            replayHost.once('exit', () => resolve()),
          );
          replayHost.kill('SIGKILL');
          await replayExited;
        }
      }
      const next = new BrowserSessionManager({
        storageRoot: crashRoot,
        workerPath: '/must-not-launch.cjs',
      });
      await next.initialize();
      const receipts = next.recoveryRuns();
      expect(receipts[0].status).toBe('interrupted');
      expect(receipts[0].events.at(-1)?.stepId).toBe('filled');
      expect(receipts[0].arrivalVerified).toBe(false);
      await next.clearRecoveredRuns([receipts[0].id]);
      expect(next.recoveryRuns()).toEqual([]);
      await next.dispose();
    }, 60000);
    test('read-only application rejects browser actions and replay', async () => {
      await manager.open({ ...application, interactionPolicy: 'inspect' });
      await expect(manager.act(step('click', 'click', { target: target('#go') }))).rejects.toThrow(
        'inspection',
      );
      expect((await manager.inspect()).text).toContain('Parcours local');
    });
  },
);

describe.skipIf(!executablePath)('temporary recorder real DOM events', () => {
  let browser: Browser;
  let page: Page;
  let local: Awaited<ReturnType<typeof navigationFixture>>;
  beforeAll(async () => {
    local = await navigationFixture();
    browser = await chromium.launch({ executablePath, headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    await local?.close();
  });
  test('unexpected native gestures invalidate ownership without transmitting keys or touching the DOM', async () => {
    const page = await browser.newPage();
    const interruptions: unknown[] = [];
    await page.exposeBinding('__ownership', (_source, event) => {
      interruptions.push(event);
    });
    await page.goto(local.origin);
    const before = await page.locator('html').innerHTML();
    await page.evaluate(installInteractionGuard, {
      binding: '__ownership',
      origins: [local.origin],
      generation: 42,
    });
    await page
      .locator('#go')
      .evaluate((element) => (window as any).__keraiInteractionGuard.expect(element, 'pointer'));
    await page.locator('#go').click();
    expect(interruptions).toEqual([]);
    await page.locator('#city').click();
    expect(interruptions).toEqual([{ generation: 42 }]);
    await page.locator('#city').press('Z');
    expect(interruptions).toEqual([{ generation: 42 }, { generation: 42 }]);
    await page.evaluate(() =>
      document
        .querySelector('#city')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'FAKE_SECRET', bubbles: true })),
    );
    expect(interruptions.length).toBe(2);
    expect(JSON.stringify(interruptions)).not.toContain('Z');
    await page.evaluate(() => (window as any).__keraiInteractionGuard.stop());
    await page.locator('#city').click();
    expect(interruptions.length).toBe(2);
    const after = await page.locator('html').innerHTML();
    expect(after.replace('Résultat ', 'En attente')).toBe(before);
    await page.close();
  });
  test('records container scroll with its own target rather than window coordinates', async () => {
    const page = await browser.newPage();
    const events: any[] = [];
    await page.exposeBinding('__scrollRecord', (_source, event) => events.push(event));
    await page.goto(local.origin);
    await page.evaluate(installRecorder, {
      binding: '__scrollRecord',
      origins: [local.origin],
      generation: 1,
    });
    await page.evaluate(() => (window as any).__keraiNavigationRecorder.start());
    await page.locator('#scroll-box').evaluate((element) => element.scrollTo(20, 60));
    await expect
      .poll(() => events.find((event) => event.step?.action === 'scroll'), { timeout: 2000 })
      .toMatchObject({
        step: { action: 'scroll', target: { strategy: 'css', value: '#scroll-box' }, x: 20, y: 60 },
      });
    await page.close();
  });
  test('consolidates edits before immediate click, excludes credentials, removes listeners and denies foreign origin', async () => {
    page = await browser.newPage();
    const events: any[] = [];
    await page.exposeBinding('__record', (_source, event) => events.push(event));
    await page.goto(local.origin);
    const before = await page.locator('html').innerHTML();
    await page.evaluate(installRecorder, {
      binding: '__record',
      origins: [local.origin],
      generation: 1,
    });
    await page.evaluate(() => (window as any).__keraiNavigationRecorder.start());
    await page.locator('#city').fill('Liffré');
    await page.locator('#go').click();
    await page.locator('#password').fill('SECRET_INPUT');
    await page.locator('#go').click();
    expect(events.map((e) => e.step.action)).toEqual(['fill', 'click', 'click']);
    expect(events[0].step.value.literal).toBe('Liffré');
    expect(JSON.stringify(events)).not.toContain('SECRET_INPUT');
    await page.evaluate(() => (window as any).__keraiNavigationRecorder.stop());
    await page.locator('#city').fill('Paused');
    await page.locator('#go').click();
    expect(events.length).toBe(3);
    const after = await page.locator('html').innerHTML();
    expect(after.replace(/Résultat Paused/g, 'En attente')).toBe(before);
    await page.goto(local.otherOrigin);
    await page.evaluate(installRecorder, {
      binding: '__record',
      origins: [local.origin],
      generation: 1,
    });
    await page.evaluate(() => (window as any).__keraiNavigationRecorder.start());
    await page.locator('#external-secret').fill('FORBIDDEN_VALUE');
    await page.locator('h1').click();
    expect(events.length).toBe(3);
    await page.close();
  });
});

test('application origin accepts remote sites and paths but rejects non-web and credential URLs', () => {
  expect(navigationOrigin('http://localhost:3000')).toBe('http://localhost:3000');
  expect(navigationOrigin('https://example.org/app?tenant=demo#/tasks')).toBe(
    'https://example.org',
  );
  expect(navigationOrigin('http://lms.intranet:8080/Dev/')).toBe('http://lms.intranet:8080');
  for (const url of [
    'file:///tmp/test',
    'javascript:alert(1)',
    'http://user:secret@localhost',
    'https://example.org/?token=secret',
  ])
    expect(() => navigationOrigin(url)).toThrow();
});
