import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { demoState } from '../webview/demo';
import { StateEncoder } from '../src/shared/stateTransfer';
import { navigate } from './ui-navigation-helpers';

/** Requires `npm run build`; serves the packaged bundle, independently of Vite's dev server. */
test('built webview loads lazy pages under CSP and applies 1000-session state and deltas', async ({
  page,
}, info) => {
  const root = resolve('dist/webview');
  let html: string;
  let assets: string[];
  try {
    [html, assets] = await Promise.all([
      readFile(resolve(root, 'index.html'), 'utf8'),
      readdir(resolve(root, 'assets')),
    ]);
    await readFile(resolve(root, 'assets/app.js'));
  } catch {
    throw new Error(
      'Bundle de production absent : exécute npm run build avant npm run test:ui (dist/webview requis).',
    );
  }
  for (const prefix of ['ApplicationsUI-', 'DiscussionUI-', 'Statistics-'])
    expect(
      assets.some((name) => name.startsWith(prefix) && name.endsWith('.js')),
      `Chunk ${prefix} absent : reconstruis avec npm run build.`,
    ).toBe(true);
  const state = structuredClone(demoState);
  state.features = Array.from({ length: 1000 }, (_, index) => ({
    ...structuredClone(demoState.features[0]),
    id: `built-session-${index}`,
    title: `Session bundle ${String(index).padStart(4, '0')}`,
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 1000 - index)).toISOString(),
    archived: false,
  }));
  // A question outside the first review page proves filters apply before pagination.
  state.features[0].steps[1].status = 'waiting_input';
  const encoder = new StateEncoder();
  const initial = encoder.encode(state);
  const nonce = randomBytes(16).toString('hex');
  const csp = `default-src 'none'; script-src 'nonce-${nonce}' 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'self'; form-action 'none'`;
  const fixture = JSON.stringify({
    initial,
    discussion: {
      discussions: [],
      agents: state.agents.map((profile) => ({ key: `global:${profile.id}`, profile })),
      defaultModel: state.settings.defaultModel,
    },
  }).replace(/</g, '\\u003c');
  const bootstrap = `<script nonce="${nonce}">
    (() => {
      const fixture = ${fixture};
      const metrics = { stateInjectedAt: null, firstRowRenderedAt: null, deltaInjectedAt: null, updatedTitleRenderedAt: null };
      const violations = [];
      window.builtMetrics = metrics;
      window.builtCspViolations = violations;
      document.addEventListener('securitypolicyviolation', (event) => violations.push({ directive: event.violatedDirective, blocked: event.blockedURI, source: event.sourceFile, line: event.lineNumber, column: event.columnNumber, sample: event.sample }));
      const observer = new MutationObserver(() => {
        const title = document.querySelector('.session-title-open');
        if (title && metrics.firstRowRenderedAt === null) metrics.firstRowRenderedAt = performance.now();
        if (metrics.expectedTitle && Array.from(document.querySelectorAll('.session-title-open')).some((element) => element.textContent === metrics.expectedTitle)) metrics.updatedTitleRenderedAt ??= performance.now();
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      window.injectBuiltDelta = (delta, title) => {
        metrics.expectedTitle = title;
        metrics.deltaInjectedAt = performance.now();
        window.postMessage(delta, '*');
      };
      let saved = { view: 'sessions', navigationVersion: 2 };
      window.acquireVsCodeApi = () => ({
        getState: () => saved,
        setState: (next) => { saved = next; },
        postMessage: (message) => {
          if (message.type === 'ready') setTimeout(() => {
            metrics.stateInjectedAt = performance.now();
            window.postMessage(fixture.initial, '*');
            window.postMessage({ type: 'themeState', theme: 'guilde-sombre' }, '*');
          }, 0);
          if (message.type === 'refreshDiscussions') setTimeout(() => window.postMessage({ type: 'discussionState', state: fixture.discussion }, '*'), 0);
          if (message.type === 'navigation') setTimeout(() => window.postMessage({ type: 'navigationState', state: { navigationVersion: 1, applications: [], journeys: [], contributions: [], runs: [] } }, '*'), 0);
        },
      });
    })();
    </script>`;
  html = html
    .replace(
      '<html',
      '<html data-studio-surface="cockpit" data-studio-theme="guilde-sombre" data-studio-zoom="100"',
    )
    .replace(
      '<head>',
      `<head><meta http-equiv="Content-Security-Policy" content="${csp}">${bootstrap}`,
    )
    .replace(/<script type="module"/g, `<script nonce="${nonce}" type="module"`);
  const types: Record<string, string> = {
    js: 'text/javascript',
    css: 'text/css',
    png: 'image/png',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    woff2: 'font/woff2',
    map: 'application/json',
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      if (pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(html);
        return;
      }
      const file = resolve(root, `.${pathname}`);
      if (!file.startsWith(`${root}${sep}`)) {
        response.writeHead(403);
        response.end();
        return;
      }
      const data = await readFile(file);
      response.writeHead(200, {
        'Content-Type': types[file.split('.').at(-1)!] ?? 'application/octet-stream',
      });
      response.end(data);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Serveur de test sans port local.');
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await expect(page.getByRole('heading', { name: 'Sessions 1000', exact: true })).toBeVisible();
    await expect(page.locator('.session-row')).toHaveCount(50);
    const initialRequests = [...requests];
    console.log(
      'Built initial JS',
      initialRequests.filter((url) => url.endsWith('.js')),
    );
    const initialLazyRequests = initialRequests.filter((url) =>
      /\/(?:ApplicationsUI|DiscussionUI|Statistics)-[^/]+\.js$/.test(url),
    );
    const title = 'Session modifiée par delta';
    state.features[0].title = title;
    const delta = encoder.encode(state);
    expect(delta.type).toBe('stateDelta');
    await page.evaluate(
      ({ delta, title }) => Reflect.get(window, 'injectBuiltDelta')(delta, title),
      { delta, title },
    );
    await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('built-sessions-1280x720.png') });
    await navigate(page, 'Applications');
    await expect(page.getByRole('heading', { name: 'Applications', exact: true })).toBeVisible();
    expect(requests.some((url) => /\/ApplicationsUI-[^/]+\.js$/.test(url))).toBe(true);
    await navigate(page, 'Discussion');
    await expect(page.getByRole('heading', { name: 'Discussion', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Votre message', exact: true })).toBeVisible();
    expect(requests.some((url) => /\/DiscussionUI-[^/]+\.js$/.test(url))).toBe(true);
    const validationNavigationStartedAt = performance.now();
    await navigate(page, 'Validation');
    await expect(
      page.getByRole('heading', { name: 'Votre regard, au bon moment.', exact: true }),
    ).toBeVisible();
    const validationNavigationMs = performance.now() - validationNavigationStartedAt;
    const cards = page.locator('.validation-decision');
    const pagination = page.getByRole('navigation', { name: 'Pages des décisions' });
    const filter = page.getByRole('combobox', { name: 'Filtrer le centre de validation' });
    await expect(cards).toHaveCount(50);
    await expect(page.locator('.validation-counter')).toContainText('1000 points d’attention');
    await expect(pagination.getByRole('status')).toHaveText('Page 1/20 · 1000 décisions');
    await expect(pagination.getByRole('button', { name: 'Précédentes' })).toBeDisabled();
    const firstPageTitles = await cards.locator('h3 + p').allTextContents();
    await pagination.getByRole('button', { name: 'Suivantes' }).click();
    await expect(pagination.getByRole('status')).toHaveText('Page 2/20 · 1000 décisions');
    await expect(cards).toHaveCount(50);
    const secondPageTitles = await cards.locator('h3 + p').allTextContents();
    expect(secondPageTitles.some((value) => firstPageTitles.includes(value))).toBe(false);
    await pagination.getByRole('button', { name: 'Précédentes' }).click();
    await expect(cards.first().locator('h3 + p')).toHaveText(firstPageTitles[0]);
    await pagination.getByRole('button', { name: 'Suivantes' }).click();
    await filter.selectOption('review');
    await expect(pagination.getByRole('status')).toHaveText('Page 1/20 · 999 décisions');
    await expect(cards).toHaveCount(50);
    await filter.selectOption('question');
    await expect(pagination.getByRole('status')).toHaveText('Page 1/1 · 1 décision');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText(title);
    await expect(page.locator('.validation-counter')).toContainText('1000 points d’attention');
    await expect(pagination.getByRole('button', { name: 'Suivantes' })).toBeDisabled();
    await filter.selectOption('all');
    await pagination.getByRole('button', { name: 'Suivantes' }).click();
    // An incoming state can shrink the list while a later page is selected.
    const allFeatures = state.features;
    state.features = allFeatures.slice(0, 20);
    await page.evaluate((delta) => window.postMessage(delta, '*'), encoder.encode(state));
    await expect(pagination.getByRole('status')).toHaveText('Page 1/1 · 20 décisions');
    await expect(cards).toHaveCount(20);
    await expect(page.locator('.validation-counter')).toContainText('20 points d’attention');
    state.features = allFeatures;
    await page.evaluate((delta) => window.postMessage(delta, '*'), encoder.encode(state));
    await expect(pagination.getByRole('status')).toHaveText('Page 1/20 · 1000 décisions');
    await expect(cards).toHaveCount(50);
    await pagination.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('built-validation-pagination-1280.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await pagination.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('built-validation-pagination-390.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );

    await navigate(page, 'Sessions');
    await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.screenshot({ path: info.outputPath('built-sessions-390.png') });
    const violations = await page.evaluate(() => Reflect.get(window, 'builtCspViolations'));

    const metrics = await page.evaluate(
      () => Reflect.get(window, 'builtMetrics') as Record<string, number | null>,
    );
    for (const key of [
      'stateInjectedAt',
      'firstRowRenderedAt',
      'deltaInjectedAt',
      'updatedTitleRenderedAt',
    ])
      expect(typeof metrics[key], `Mesure ${key} observée dans le DOM`).toBe('number');
    const timings = {
      validationNavigationMs,
      initialStateToFirstRowMs: metrics.firstRowRenderedAt! - metrics.stateInjectedAt!,
      deltaToTitleMs: metrics.updatedTitleRenderedAt! - metrics.deltaInjectedAt!,
    };
    for (const value of Object.values(timings)) expect(Number.isFinite(value)).toBe(true);
    const measurementsPath = info.outputPath('built-performance-indicative.json');
    await writeFile(
      measurementsPath,
      JSON.stringify(
        {
          note: 'Mesures indicatives sur cette machine, sans seuil CI.',
          ...timings,
          initialJavaScript: initialRequests.filter((url) => url.endsWith('.js')),
          loadedJavaScript: requests.filter((url) => url.endsWith('.js')),
          cspViolations: violations,
        },
        null,
        2,
      ),
    );
    await info.attach('built-performance-indicative.json', {
      path: measurementsPath,
      contentType: 'application/json',
    });
    console.log('Built webview — mesures indicatives (ms)', timings);
    console.log('Built CSP violations', violations);
    expect(
      initialLazyRequests,
      'Les écrans secondaires ne se chargent pas avec la liste initiale.',
    ).toEqual([]);
    expect(
      violations,
      'Le bundle et ses imports différés respectent la CSP de la webview.',
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await page.goto('about:blank');
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
});
