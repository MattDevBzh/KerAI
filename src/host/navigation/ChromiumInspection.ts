import type { BrowserContext, Locator, Page, CDPSession } from 'playwright-core';

import type { NavigationSourceMap } from '../../shared/navigation';
export type ChromiumSourceMap = NavigationSourceMap;
export interface ChromiumInspectionResult {
  text: string;
  resources: string[];
  truncated: boolean;
  sourceMaps: ChromiumSourceMap[];
}
const MAX_TEXT = 4500;
const MAX_MAP_BYTES = 4 * 1024 * 1024;
const SAFE_PROPERTIES = new Set([
  'display',
  'position',
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'margin',
  'padding',
  'border',
  'border-color',
  'border-width',
  'border-radius',
  'opacity',
  'overflow',
  'visibility',
  'z-index',
  'gap',
  'align-items',
  'justify-content',
  'flex-direction',
  'grid-template-columns',
]);
function safeUrl(raw: string, base: string, allowed: string[]): string | undefined {
  try {
    const url = new URL(raw, base);
    if (
      raw.length > 1000 ||
      !['http:', 'https:'].includes(url.protocol) ||
      !allowed.includes(url.origin) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
function clean(value: unknown, limit = 240): string {
  return typeof value === 'string'
    ? value
        .replace(/[\r\n\t]+/g, ' ')
        .replace(
          /(?:bearer\s+|(?:password|secret|token|authorization|cookie)\s*[:=]\s*)[^\s;,]+/gi,
          '[redacted]',
        )
        .slice(0, limit)
    : '';
}
/** Map paths are hints only. The host must resolve them inside an authorized repository. */
export function sourceMapCandidatePath(raw: string, sourceRoot = ''): string | undefined {
  let value = raw.replace(/\\/g, '/');
  if (value.length > 1000 || /[\x00-\x1f?#]/.test(value)) return undefined;
  if (/^webpack:\/\//.test(value)) value = value.replace(/^webpack:\/\/[^/]*\//, '');
  if (/^\.\//.test(value)) value = value.slice(2);
  let root = sourceRoot.replace(/\\/g, '/');
  if (/^webpack:\/\//.test(root)) root = root.replace(/^webpack:\/\/[^/]*\//, '');
  if (root && (/^[a-z]+:/i.test(root) || root.startsWith('/') || root.split('/').includes('..')))
    return undefined;
  if (root) value = `${root.replace(/\/$/, '')}/${value}`;
  if (
    /^[a-z]+:/i.test(value) ||
    value.startsWith('/') ||
    value.split('/').some((part) => part === '..') ||
    !value ||
    value.startsWith('node_modules/')
  )
    return undefined;
  return value.replace(/^(?:\.\/)+/, '');
}
/** Fixed browser function: bounded streaming, no credentials or redirects, no source contents returned. */
async function mapMetadata(
  page: Page,
  url: string,
): Promise<{ sources: string[]; sourceRoot: string; file?: string; omitted: number }> {
  return page.evaluate(
    async ({ url, maximum }) => {
      const response = await fetch(url, {
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(2500),
        cache: 'no-store',
      });
      if (!response.ok || !response.body) throw new Error('Source map indisponible.');
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maximum)
        throw new Error('Source map supérieure à 4 Mio.');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          bytes += item.value.byteLength;
          if (bytes > maximum) throw new Error('Source map supérieure à 4 Mio.');
          chunks.push(item.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      const array = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        array.set(chunk, offset);
        offset += chunk.length;
      }
      const value: unknown = JSON.parse(new TextDecoder().decode(array));
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Source map invalide.');
      const map = value as Record<string, unknown>;
      if (map.version !== 3 || !Array.isArray(map.sources) || typeof map.mappings !== 'string')
        throw new Error('Source map v3 simple requise ; sections indexées non prises en charge.');
      const sources = map.sources
        .filter((source): source is string => typeof source === 'string' && source.length <= 1000)
        .slice(0, 40);
      return {
        sources,
        sourceRoot: typeof map.sourceRoot === 'string' ? map.sourceRoot.slice(0, 1000) : '',
        file: typeof map.file === 'string' ? map.file.slice(0, 300) : undefined,
        omitted: map.sources.length - sources.length,
      };
    },
    { url, maximum: MAX_MAP_BYTES },
  );
}

/** Public Chromium inspection APIs only. No generic evaluate command is exposed to callers. */
export async function inspectChromium(
  context: BrowserContext,
  page: Page,
  target: Locator | undefined,
  category: 'styles' | 'sources',
  allowedOrigins: string[],
): Promise<ChromiumInspectionResult> {
  const lines: string[] = [],
    resources = new Set<string>(),
    sourceMaps: ChromiumSourceMap[] = [];
  let truncated = false;
  let cdp: CDPSession | undefined;
  const scripts: { url: string; hash?: string; sourceMapURL?: string }[] = [];
  const sheets = new Map<string, { sourceURL?: string; sourceMapURL?: string }>();
  try {
    if (!safeUrl(page.url().split(/[?#]/)[0], page.url(), allowedOrigins))
      throw new Error('Origine d’inspection non autorisée.');
    cdp = await context.newCDPSession(page);
    cdp.on(
      'CSS.styleSheetAdded',
      (event: { header: { styleSheetId: string; sourceURL?: string; sourceMapURL?: string } }) => {
        if (sheets.size < 100) sheets.set(event.header.styleSheetId, event.header);
        else truncated = true;
      },
    );
    cdp.on(
      'Debugger.scriptParsed',
      (event: { url: string; hash?: string; sourceMapURL?: string }) => {
        if (scripts.length < 100 && safeUrl(event.url, page.url(), allowedOrigins))
          scripts.push(event);
        else if (scripts.length >= 100) truncated = true;
      },
    );
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    if (category === 'styles' && target) {
      // A fixed, bounded DOM path observes existing nodes and never mutates the target page.
      const selector = await target.evaluate((element) => {
        if (window !== window.top || element.ownerDocument !== window.document) return '';
        const parts: string[] = [];
        let current: Element | null = element;
        while (current && parts.length < 16) {
          const name = current.localName;
          if (!name) return '';
          const parent: Element | null = current.parentElement;
          const siblings = parent
            ? Array.from(parent.children).filter((child) => child.localName === name)
            : [current];
          parts.unshift(`${CSS.escape(name)}:nth-of-type(${siblings.indexOf(current) + 1})`);
          current = parent;
        }
        return current ? '' : parts.join(' > ');
      });
      if (!selector) lines.push('Règles CSS : cible trop profonde ou frame non résolue.');
      else {
        const document = await cdp.send('DOM.getDocument', { depth: 1 });
        const node = await cdp.send('DOM.querySelector', {
          nodeId: document.root.nodeId,
          selector,
        });
        if (!node.nodeId) lines.push('Règles CSS : cible absente du document principal.');
        else {
          const matched = await cdp.send('CSS.getMatchedStylesForNode', { nodeId: node.nodeId });
          for (const match of (matched.matchedCSSRules ?? []).slice(0, 12)) {
            const rule = match.rule;
            const sheet = rule.styleSheetId ? sheets.get(rule.styleSheetId) : undefined;
            const source = sheet?.sourceURL && safeUrl(sheet.sourceURL, page.url(), allowedOrigins);
            if (source) resources.add(source);
            const declarations = rule.style.cssProperties
              .filter(
                (property) =>
                  SAFE_PROPERTIES.has(property.name) && !/url\(|expression\(/i.test(property.value),
              )
              .slice(0, 12)
              .map((property) => `${property.name}: ${clean(property.value, 120)}`)
              .join('; ');
            const range = rule.style.range;
            lines.push(
              `CSS ${clean(rule.selectorList.text)}${source ? ` — ${source}${range ? `:${range.startLine + 1}` : ''}` : ' — origine non attestée'}${declarations ? ` { ${declarations} }` : ''}`,
            );
          }
          if ((matched.matchedCSSRules?.length ?? 0) > 12) truncated = true;
        }
      }
    }
    if (category === 'sources') {
      let mapRequests = 0;
      await cdp.send('Debugger.enable', { maxScriptsCacheSize: 1024 * 1024 });
      for (const script of scripts.slice(0, 20)) {
        const bundleUrl = safeUrl(script.url, page.url(), allowedOrigins);
        if (!bundleUrl) continue;
        resources.add(bundleUrl);
        lines.push(
          `Script chargé : ${bundleUrl}${script.hash ? ` ; empreinte Chromium ${clean(script.hash, 80)}` : ''}`,
        );
        if (!script.sourceMapURL) continue;
        if (mapRequests >= 4) {
          truncated = true;
          continue;
        }
        const sourceMapUrl = safeUrl(script.sourceMapURL, bundleUrl, allowedOrigins);
        if (!sourceMapUrl) {
          lines.push(
            'Source map non chargée : URL externe, privée, inline ou non prise en charge.',
          );
          continue;
        }
        try {
          mapRequests++;
          const metadata = await mapMetadata(page, sourceMapUrl);
          const sources = metadata.sources
            .map((source) => sourceMapCandidatePath(source, metadata.sourceRoot))
            .filter((source): source is string => Boolean(source));
          const file = metadata.file ? sourceMapCandidatePath(metadata.file) : undefined;
          // A contradictory `file` blocks corroboration; paths remain candidate data only.
          if (file && file.split('/').at(-1) !== new URL(bundleUrl).pathname.split('/').at(-1)) {
            lines.push(`Source map incompatible avec le bundle : ${sourceMapUrl}`);
            continue;
          }
          const map: ChromiumSourceMap = {
            bundleUrl,
            bundleHash:
              script.hash && /^[a-f0-9]{64}$/i.test(script.hash) ? script.hash : undefined,
            sourceMapUrl,
            sources,
            file,
            state: 'candidate',
            reason:
              'Référence observée par Chromium ; chemins non fiables à résoudre dans un dépôt autorisé. Aucun contenu source transmis.',
          };
          sourceMaps.push(map);
          resources.add(sourceMapUrl);
          lines.push(
            `Source map ${sourceMapUrl} : ${sources.join(', ') || 'aucun chemin relatif sûr'}. Candidats à vérifier dans le dépôt.`,
          );
          if (metadata.omitted || sources.length < metadata.sources.length) truncated = true;
        } catch {
          lines.push(`Source map non exploitable ou hors budget : ${sourceMapUrl}`);
        }
      }
      if (scripts.length > 20) truncated = true;
      if (!scripts.length)
        lines.push(
          'Aucun script local indexable observé. La recherche dans le dépôt reste disponible.',
        );
    }
  } catch (error) {
    lines.push(`Inspection Chromium indisponible : ${clean((error as Error).message, 300)}`);
  } finally {
    await cdp?.detach().catch(() => undefined);
  }
  const content = lines.join('\n');
  const result = {
    text: content.slice(0, MAX_TEXT),
    resources: [...resources].slice(0, 24),
    sourceMaps,
    truncated: truncated || content.length > MAX_TEXT,
  };
  while (JSON.stringify(result).length > 5800) {
    result.truncated = true;
    if (result.text.length > 1500)
      result.text = result.text.slice(0, Math.floor(result.text.length * 0.75));
    else if (result.resources.length) result.resources.pop();
    else if (result.sourceMaps.length) result.sourceMaps.pop();
    else break;
  }
  return result;
}
