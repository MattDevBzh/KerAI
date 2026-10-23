import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { inspectChromium, sourceMapCandidatePath } from '../src/host/navigation/ChromiumInspection';
const executablePath = [
  chromium.executablePath(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].find((file) => existsSync(file));
it('treats source map paths as untrusted relative candidates', () => {
  expect(sourceMapCandidatePath('webpack:///./src/Screen.tsx')).toBe('src/Screen.tsx');
  expect(sourceMapCandidatePath('Screen.tsx', 'src')).toBe('src/Screen.tsx');
  for (const raw of [
    '../../secret',
    '/etc/passwd',
    'C:\\Secrets\\token',
    'https://other/secret',
    'src/file.ts?token=x',
  ])
    expect(sourceMapCandidatePath(raw)).toBeUndefined();
  expect(sourceMapCandidatePath('screen.ts', '/private')).toBeUndefined();
  expect(sourceMapCandidatePath('screen.ts', '../private')).toBeUndefined();
});
describe.skipIf(!executablePath)('Chromium CDP targeted source and CSS inspection', () => {
  let server: Server, origin: string, browser: Browser, context: BrowserContext, page: Page;
  let redirectedRequests = 0;
  beforeAll(async () => {
    server = createServer((request, response) => {
      const url = new URL(request.url!, 'http://localhost');
      if (url.pathname === '/') {
        response.setHeader('content-type', 'text/html');
        response.end(
          '<link rel="stylesheet" href="/style.css"><button class="target">Factures</button><iframe src="/frame"></iframe><script src="/bundle.js"></script><script src="/wrong.js"></script><script src="/redirect.js"></script><script src="/large.js"></script>',
        );
      } else if (url.pathname === '/frame') {
        response.setHeader('content-type', 'text/html');
        response.end('<button class="target">Frame</button>');
      } else if (url.pathname === '/style.css') {
        response.setHeader('content-type', 'text/css');
        response.end(
          '.target { color: rgb(20, 60, 90); padding: 12px; background-image: url("/asset?token=CSS_SECRET"); }',
        );
      } else if (url.pathname.endsWith('.js')) {
        response.setHeader('content-type', 'text/javascript');
        response.end(
          `window.${url.pathname.includes('bundle') ? 'fixture' : url.pathname.slice(1, -3)} = 1;\n//# sourceMappingURL=${url.pathname.slice(1)}.map`,
        );
      } else if (url.pathname === '/bundle.js.map') {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            version: 3,
            file: 'bundle.js',
            sources: ['webpack:///./src/Factures.tsx', '../private/token.txt', '/etc/passwd'],
            sourcesContent: ['SOURCE_CONTENT_MUST_NOT_LEAVE_BROWSER', 'SECRET', 'SECRET'],
            mappings: 'AAAA',
          }),
        );
      } else if (url.pathname === '/wrong.js.map') {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            version: 3,
            file: 'other-bundle.js',
            sources: ['src/Wrong.ts'],
            sourcesContent: ['PRIVATE_WRONG'],
            mappings: 'AAAA',
          }),
        );
      } else if (url.pathname === '/redirect.js.map') {
        response.statusCode = 302;
        response.setHeader('location', '/must-not-follow');
        response.end();
      } else if (url.pathname === '/must-not-follow') {
        redirectedRequests++;
        response.end('should not fetch');
      } else if (url.pathname === '/large.js.map') {
        response.setHeader('content-type', 'application/json');
        response.setHeader('content-length', String(4 * 1024 * 1024 + 10));
        response.end('too big');
      } else {
        response.statusCode = 404;
        response.end();
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browser = await chromium.launch({ executablePath, headless: true });
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto(origin);
  });
  afterAll(async () => {
    await context?.close();
    await browser?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });
  it('returns matching CSS selectors, safe properties and stylesheet line without page mutation', async () => {
    const before = await page.content();
    const result = await inspectChromium(context, page, page.locator('.target').first(), 'styles', [
      origin,
    ]);
    expect(result.text).toContain('.target');
    expect(result.text).toContain('color: rgb(20, 60, 90)');
    expect(result.text).toContain('/style.css:1');
    expect(JSON.stringify(result)).not.toContain('CSS_SECRET');
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(5800);
    expect(await page.content()).toBe(before);
  });
  it('loads bounded source map metadata while rejecting conflicting bundles, redirects and sensitive contents', async () => {
    const result = await inspectChromium(context, page, undefined, 'sources', [origin]);
    expect(result.sourceMaps.find((map) => map.bundleUrl.endsWith('/bundle.js'))).toMatchObject({
      state: 'candidate',
      sources: ['src/Factures.tsx'],
    });
    expect(result.text).toContain('incompatible');
    expect(result.text).toContain('hors budget');
    expect(result.sourceMaps.some((map) => map.bundleUrl.endsWith('/wrong.js'))).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(
      /SOURCE_CONTENT_MUST|PRIVATE_WRONG|token.txt|passwd/,
    );
    expect(redirectedRequests).toBe(0);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(5800);
  });
  it('does not attribute an iframe locator to a similar main-document node', async () => {
    const result = await inspectChromium(
      context,
      page,
      page.frameLocator('iframe').locator('.target'),
      'styles',
      [origin],
    );
    expect(result.text).toContain('frame non résolue');
    expect(result.resources).toEqual([]);
  });
});
