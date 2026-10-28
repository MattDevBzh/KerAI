import {
  chromium,
  type BrowserContext,
  type Page,
  type Frame,
  type Locator,
} from 'playwright-core';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  NavigationStep,
  NavigationCondition,
  NavigationLocator,
  BrowserInspection,
} from '../../shared/navigation';
import type { InspectionRequest, WorkerRequest, WorkerOpen, WorkerAct } from './protocol';
import { installInteractionGuard } from './InteractionGuard';
import { inspectChromium } from './ChromiumInspection';
import { redactPng } from './redactPng';
import { hasSensitiveNavigationUrl, isNavigationUrl } from '../../core/navigationSchemas';
import { installRecorder } from './recorder';

let context: BrowserContext | undefined;
let openOptions: WorkerOpen | undefined;
let origins: string[] = [];
let authenticationOrigins: string[] = [];
let generation = 0;
let busy = false;
let auth = false;
let recording = false;
let recordSequence = 0;
let recordEpoch = 0;
let binding = '';
let interactionBinding = '';
let controlOwned = false;
let outputChain: Promise<void> = Promise.resolve();
const frameSequence = new WeakMap<Frame, number>();
const network: { url: string; method: string; status?: number; type: string }[] = [];
const activationJobs = new Set<Promise<void>>();
const cleanUrl = (value: string) => {
  try {
    const u = new URL(value);
    return `${u.origin}${u.pathname}`.slice(0, 1500);
  } catch {
    return '';
  }
};
const isAllowed = (url: string) => {
  try {
    return origins.includes(new URL(url).origin);
  } catch {
    return false;
  }
};
const safeError = (error: unknown) => {
  // Playwright messages include selectors and fill arguments. Never send those logs to the host.
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('NAV:')) return message.slice(4, 800);
  if (message.includes('Timeout'))
    return 'Délai de l’action dépassé ; cible absente, ambiguë ou non interactive.';
  return 'Opération navigateur échouée ; vérifiez la cible et l’état de la page.';
};
function fail(message: string): never {
  throw new Error(`NAV:${message}`);
}
function requireContext(): BrowserContext {
  if (!context) fail('Aucun navigateur ouvert.');
  return context;
}
function guard(frame: Frame | Page) {
  if (auth) fail('Connexion manuelle active : observation et capture suspendues.');
  if (!isAllowed(frame.url())) fail('Origine non autorisée : observation et interaction refusées.');
}
function pageFor(target?: NavigationLocator): Page {
  const pages = requireContext().pages();
  const index = target?.tab ?? 0;
  if (!Number.isInteger(index) || index < 0 || !pages[index]) fail('Onglet indisponible.');
  guard(pages[index]);
  return pages[index];
}
async function frameFor(target?: NavigationLocator): Promise<Frame> {
  const page = pageFor(target);
  if (!target?.frame) return page.mainFrame();
  if (target.frame.length > 1000) fail('Sélecteur de frame trop long.');
  const locator = page.locator(target.frame);
  if ((await locator.count()) !== 1) fail('Frame absente ou ambiguë.');
  const element = await locator.elementHandle();
  const frame = await element?.contentFrame();
  if (!frame) fail('La cible ne désigne pas une frame.');
  guard(frame);
  return frame;
}
async function locate(target?: NavigationLocator, waitMs?: number): Promise<Locator> {
  if (!target || typeof target.value !== 'string' || target.value.length > 1000)
    fail('Cible déclarative requise.');
  const frame = await frameFor(target);
  let locator: Locator;
  switch (target.strategy) {
    case 'testId':
      locator = frame.getByTestId(target.value);
      break;
    case 'role':
      locator = frame.getByRole(target.value as Parameters<Frame['getByRole']>[0], {
        name: target.name,
        exact: true,
      });
      break;
    case 'label':
      locator = frame.getByLabel(target.value, { exact: true });
      break;
    case 'text':
      locator = frame.getByText(target.value, { exact: true });
      break;
    case 'css':
      locator = frame.locator(target.value);
      break;
    default:
      return fail('Type de cible non supporté.');
  }
  if (waitMs) await locator.waitFor({ state: 'attached', timeout: waitMs });
  const count = await locator.count();
  if (!count) fail('Cible absente.');
  if (count !== 1) fail('Cible ambiguë ; sélection unique obligatoire.');
  guard(frame);
  return locator;
}
async function rejectSensitive(locator: Locator) {
  const sensitive = await locator.evaluate(
    (el) =>
      Boolean(
        el.closest(
          'input[type="password"], [autocomplete="username"], [autocomplete="current-password"], [autocomplete="new-password"], [autocomplete="one-time-code"], [data-private], [data-sensitive]',
        ),
      ) ||
      /password|passwd|secret|token|credential|login|username|email|otp/i.test(
        [el.getAttribute('name'), el.id, el.getAttribute('autocomplete')].join(' '),
      ),
  );
  if (sensitive) fail('Champ de connexion ou secret : saisie manuelle requise.');
}
function executable(configured?: string): string | undefined {
  if (configured) {
    if (!path.isAbsolute(configured) || !existsSync(configured))
      fail('Exécutable navigateur configuré introuvable.');
    return configured;
  }
  const candidates = [
    chromium.executablePath(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    process.env.PROGRAMFILES &&
      path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] &&
      path.join(process.env['PROGRAMFILES(X86)']!, 'Microsoft/Edge/Application/msedge.exe'),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ];
  return candidates.find((candidate): candidate is string =>
    Boolean(candidate && existsSync(candidate)),
  );
}
async function conditions(conditions: NavigationCondition[]): Promise<boolean[]> {
  if (!Array.isArray(conditions) || conditions.length > 80) fail('Conditions invalides.');
  const results: boolean[] = [];
  for (const condition of conditions) {
    const page = pageFor(condition.target);
    if (condition.kind === 'url') {
      const expected = new URL(condition.value ?? '', page.url());
      if (!isAllowed(expected.href) || hasSensitiveNavigationUrl(expected.href))
        fail('URL de condition non autorisée.');
      // Compare the functional URL in memory; only receipts use the redacted URL.
      results.push(new URL(page.url()).href === expected.href);
    } else if (condition.kind === 'hidden') {
      try {
        results.push(!(await (await locate(condition.target)).isVisible()));
      } catch (error) {
        if ((error as Error).message.includes('Cible absente')) results.push(true);
        else throw error;
      }
    } else {
      const target = await locate(condition.target);
      await rejectSensitive(target);
      if (condition.kind === 'visible') results.push(await target.isVisible());
      else if (condition.kind === 'text')
        results.push((await target.innerText({ timeout: 15000 })).includes(condition.value ?? ''));
      else fail('Condition non supportée.');
    }
  }
  return results;
}
async function ensureInteractionGuards() {
  if (!context) return;
  await Promise.allSettled(
    context.pages().flatMap((page) =>
      page
        .frames()
        .filter((frame) => isAllowed(frame.url()))
        .map(async (frame) => {
          const present = await frame.evaluate(() =>
            Boolean((window as any).__keraiInteractionGuard),
          );
          if (!present)
            await frame.evaluate(installInteractionGuard, {
              binding: interactionBinding,
              origins,
              generation,
            });
        }),
    ),
  );
}
async function clearInteractionExpectations() {
  if (!context) return;
  await Promise.allSettled(
    context
      .pages()
      .flatMap((page) =>
        page
          .frames()
          .map((frame) =>
            frame.evaluate(() => (window as any).__keraiInteractionGuard?.clear()).catch(() => {}),
          ),
      ),
  );
}
async function action({ step, parameters }: WorkerAct) {
  controlOwned = true;
  await ensureInteractionGuards();
  await clearInteractionExpectations();
  if (
    !step ||
    ![
      'navigate',
      'click',
      'fill',
      'select',
      'check',
      'press',
      'scroll',
      'viewport',
      'wait',
      'manual',
    ].includes(step.action)
  )
    fail('Action non supportée.');
  const page = pageFor(step.target);
  const timeout = Math.min(Math.max(step.timeoutMs ?? 10000, 1), 15000);
  const target =
    step.target && step.action !== 'wait' ? await locate(step.target, timeout) : undefined;
  if (target) await rejectSensitive(target);
  if (target && ['click', 'check', 'select', 'press'].includes(step.action)) {
    await target.evaluate(
      (element, action) =>
        (window as any).__keraiInteractionGuard?.expect(element, action.kind, action.key),
      {
        kind: step.action === 'press' ? 'key' : 'pointer',
        key: step.key === 'Space' ? ' ' : step.key,
      },
    );
  }
  switch (step.action) {
    case 'navigate': {
      const url = new URL(step.url ?? '', page.url());
      if (!isAllowed(url.href) || hasSensitiveNavigationUrl(url.href))
        fail('URL de navigation non autorisée.');
      await page.goto(url.href, { timeout, waitUntil: 'domcontentloaded' });
      guard(page);
      break;
    }
    case 'click':
      if (!target) fail('Cible obligatoire.');
      await target.click({ timeout });
      break;
    case 'fill':
    case 'select': {
      if (!target || !step.value) fail('Cible et valeur obligatoires.');
      const value = 'literal' in step.value ? step.value.literal : parameters[step.value.parameter];
      if (typeof value !== 'string' || value.length > 4000) fail('Paramètre absent ou trop long.');
      // Re-check the actual current frame immediately before writing a potentially private value.
      guard(await frameFor(step.target));
      if (step.action === 'fill') await target.fill(value, { timeout });
      else await target.selectOption(value, { timeout });
      break;
    }
    case 'check':
      if (!target || typeof step.checked !== 'boolean') fail('Cible et état de case obligatoires.');
      await target.setChecked(step.checked, { timeout });
      break;
    case 'press':
      if (
        !target ||
        !step.key ||
        !/^(Enter|Tab|Escape|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Backspace|Delete)$/.test(
          step.key,
        )
      )
        fail('Touche non supportée.');
      await target.press(step.key, { timeout });
      break;
    case 'scroll': {
      if (
        (step.x === undefined && step.y === undefined) ||
        (step.x !== undefined && (!Number.isFinite(step.x) || Math.abs(step.x) > 100000)) ||
        (step.y !== undefined && (!Number.isFinite(step.y) || Math.abs(step.y) > 100000))
      )
        fail('Coordonnées de défilement invalides.');
      const frame = await frameFor(step.target);
      if (target)
        await target.evaluate(
          (element, position) =>
            element.scrollTo(position.x ?? element.scrollLeft, position.y ?? element.scrollTop),
          { x: step.x, y: step.y },
        );
      else
        await frame.evaluate(
          (position) => window.scrollTo(position.x ?? window.scrollX, position.y ?? window.scrollY),
          { x: step.x, y: step.y },
        );
      break;
    }
    case 'viewport':
      if (
        !Number.isInteger(step.width) ||
        !Number.isInteger(step.height) ||
        step.width! < 320 ||
        step.width! > 3840 ||
        step.height! < 240 ||
        step.height! > 2160
      )
        fail('Dimensions de viewport invalides.');
      await page.setViewportSize({ width: step.width!, height: step.height! });
      break;
    case 'wait': {
      const expected = step.postconditions?.length
        ? step.postconditions
        : step.target
          ? [{ kind: 'visible' as const, target: step.target }]
          : [];
      if (!expected.length) fail('Une attente exige une cible ou des conditions.');
      const deadline = Date.now() + timeout;
      while (true) {
        let ready = false;
        try {
          ready = (await conditions(expected)).every(Boolean);
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes('Cible absente.')) throw error;
        }
        if (ready) break;
        if (Date.now() >= deadline) fail('Délai des conditions d’attente dépassé.');
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))),
        );
        guard(page);
      }
      break;
    }
    case 'manual':
      fail('Étape manuelle : reprise humaine requise.');
  }
  guard(page);
  const observed = await conditions(step.postconditions ?? []);
  if (observed.some((value) => !value)) fail('Postcondition non satisfaite.');
  return { url: cleanUrl(page.url()), conditions: observed };
}
async function inspect(request: InspectionRequest): Promise<BrowserInspection> {
  controlOwned = true;
  await ensureInteractionGuards();
  const page = pageFor(request.target);
  const frame = await frameFor(request.target);
  const root = request.target ? await locate(request.target) : frame.locator('body');
  if (request.target) await rejectSensitive(root);
  const category = request.category ?? 'dom';
  if (!['dom', 'styles', 'network', 'sources'].includes(category))
    fail('Catégorie d’inspection non supportée.');
  const output: BrowserInspection = {
    url: cleanUrl(page.url()),
    title: '',
    observedAt: new Date().toISOString(),
    text: '',
    elements: [],
    resources: [],
    truncated: false,
  };
  if (category === 'network') {
    const slice = network.filter((item) => isAllowed(item.url)).slice(-30);
    const content = JSON.stringify(slice);
    output.text = content.slice(0, 4500);
    output.truncated = network.length > 30 || content.length > 4500;
    return output;
  }
  if (category === 'sources') {
    Object.assign(
      output,
      await inspectChromium(requireContext(), page, undefined, 'sources', origins),
    );
    guard(page);
    guard(frame);
    return output;
  }
  const allowedProperties = [
    'display',
    'position',
    'color',
    'background-color',
    'font-size',
    'font-family',
    'width',
    'height',
    'margin',
    'padding',
    'border',
    'overflow',
    'visibility',
    'opacity',
    'z-index',
    'grid-template-columns',
    'gap',
  ];
  const properties = (request.properties ?? ['display', 'color', 'background-color', 'font-size'])
    .filter((p) => allowedProperties.includes(p))
    .slice(0, 12);
  const offset = Math.max(
    0,
    Math.min(Number.isInteger(request.offset) ? request.offset! : 0, 10000),
  );
  const data = await root.evaluate(
    (root, args) => {
      if (!args.origins.includes(location.origin)) throw new Error('Origin changed');
      const privateSelector =
        'input,textarea,select,[contenteditable="true"],[data-private],[data-sensitive],script,style,noscript,iframe';
      const elements = [root, ...Array.from(root.querySelectorAll('*'))].filter(
        (el) => !el.closest(privateSelector),
      );
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      let text = '';
      while ((node = walker.nextNode()) && text.length < args.offset + 6001) {
        if (node.parentElement && !node.parentElement.closest(privateSelector))
          text += `${node.textContent?.trim() ?? ''} `;
      }
      return {
        text: text.slice(args.offset, args.offset + 4500),
        truncated: text.length > args.offset + 4500 || elements.length > 12,
        elements: elements.slice(args.offset, args.offset + 12).map((el) => {
          const rect = el.getBoundingClientRect();
          const styles: Record<string, string> = {};
          if (args.styles) {
            const computed = getComputedStyle(el);
            for (const property of args.properties)
              styles[property] = computed.getPropertyValue(property).slice(0, 150);
          }
          return {
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role') ?? undefined,
            name: (
              el.getAttribute('aria-label') ??
              (el.children.length === 0 ? el.textContent : '') ??
              ''
            ).slice(0, 160),
            selector: el.id ? `#${CSS.escape(el.id)}` : undefined,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            ...(args.styles ? { styles } : {}),
          };
        }),
      };
    },
    { offset, styles: category === 'styles', properties, origins },
  );
  guard(frame);
  Object.assign(output, data);
  if (category === 'styles') {
    const extra = await inspectChromium(requireContext(), page, root, 'styles', origins);
    output.text = extra.text;
    output.resources = extra.resources;
    output.truncated ||= extra.truncated;
    guard(page);
    guard(frame);
  }
  // Budget applies to the whole observation, not just the text field.
  while (JSON.stringify(output).length > 6000 && output.elements.length) {
    output.elements.pop();
    output.truncated = true;
  }
  return output;
}
async function capture(request: { target?: NavigationLocator }) {
  controlOwned = true;
  await ensureInteractionGuards();
  const page = pageFor(request.target);
  for (const frame of page.frames())
    if (frame !== page.mainFrame() && !isAllowed(frame.url()))
      fail('Capture refusée : une frame possède une origine non autorisée.');
  const privateFields = page
    .frames()
    .map((frame) =>
      frame.locator(
        'input,textarea,select,[contenteditable="true"],[data-private],[data-sensitive]',
      ),
    );
  const target = request.target ? await locate(request.target) : undefined;
  const rectangles = async () => {
    const boxes = [];
    for (const fields of privateFields) {
      const count = await fields.count();
      if (count > 500) fail('Trop de champs privés pour une capture sûre.');
      for (let index = 0; index < count; index++) {
        const box = await fields.nth(index).boundingBox();
        if (box) boxes.push(box);
      }
    }
    return boxes;
  };
  const before = await rectangles();
  const crop = target ? await target.boundingBox() : undefined;
  if (target && !crop) fail('La cible de capture est invisible.');
  const raw = await page.screenshot({
    type: 'png',
    fullPage: false,
    scale: 'css',
    caret: 'initial',
    timeout: 15000,
  });
  const after = await rectangles();
  if (JSON.stringify(before) !== JSON.stringify(after))
    fail('Capture refusée : les zones privées ont changé pendant la collecte.');
  const bytes = redactPng(raw, before, crop ?? undefined);
  guard(page);
  for (const frame of page.frames())
    if (frame !== page.mainFrame() && !isAllowed(frame.url()))
      fail('Capture interrompue : origine de frame modifiée.');
  if (bytes.length > 16 * 1024 * 1024) fail('Capture trop volumineuse.');
  return {
    data: bytes.toString('base64'),
    url: cleanUrl(page.url()),
    viewport: page.viewportSize() ?? { width: 1280, height: 800 },
    browser: requireContext().browser()?.version() ?? 'chromium',
  };
}
function warn(message: string) {
  process.send?.({ event: 'warning', generation, message });
}
async function activateFrame(frame: Frame) {
  const epoch = recordEpoch;
  if (!recording || auth || !isAllowed(frame.url())) return;
  try {
    frameSequence.delete(frame);
    await frame.evaluate(installRecorder, { binding, origins, generation });
    if (epoch !== recordEpoch || !recording || auth || !isAllowed(frame.url())) return;
    await frame.evaluate(() => (window as any).__keraiNavigationRecorder?.start());
  } catch {
    if (recording)
      warn(
        'Une page ou frame a changé pendant l’activation ; démonstration partiellement observée.',
      );
  }
}
function queueFrame(frame: Frame) {
  const job = activateFrame(frame);
  activationJobs.add(job);
  void job.finally(() => activationJobs.delete(job));
}
async function deactivateRecording() {
  recording = false;
  await Promise.allSettled([...activationJobs]);
  if (context)
    await Promise.allSettled(
      context
        .pages()
        .flatMap((page) =>
          page
            .frames()
            .map((frame) =>
              frame
                .evaluate(() => (window as any).__keraiNavigationRecorder?.stop())
                .catch(() => {}),
            ),
        ),
    );
  await outputChain;
  recordEpoch++;
}
async function initializeRecorder() {
  interactionBinding = `__keraiInteraction_${randomUUID().replaceAll('-', '')}`;
  await requireContext().exposeBinding(interactionBinding, async (source, event: unknown) => {
    if (
      !controlOwned ||
      recording ||
      auth ||
      !source.frame ||
      !isAllowed(source.frame.url()) ||
      !event ||
      typeof event !== 'object' ||
      (event as { generation?: number }).generation !== generation
    )
      return;
    controlOwned = false;
    process.send?.({
      event: 'interrupted',
      generation,
      message:
        'Interaction humaine inattendue : commande arrêtée, observation invalidée. Un effet déjà produit reste possible.',
    });
    const previous = context;
    context = undefined;
    await previous?.close().catch(() => {});
  });
  binding = `__keraiNavigation_${randomUUID().replaceAll('-', '')}`;
  await requireContext().exposeBinding(binding, async (source, event: unknown) => {
    if (!recording || auth || !source.frame || !isAllowed(source.frame.url())) return;
    if (!event || typeof event !== 'object' || JSON.stringify(event).length > 6000) return;
    const input = event as {
      generation?: number;
      sequence?: number;
      step?: NavigationStep;
      unsupported?: string;
    };
    if (input.generation !== generation || !Number.isInteger(input.sequence)) return;
    const previous = frameSequence.get(source.frame) ?? 0;
    if (input.sequence! <= previous) return;
    frameSequence.set(source.frame, input.sequence!);
    if (input.unsupported === 'scroll-target') {
      warn('Défilement de conteneur sans cible stable : non enregistré, à préciser avant rejeu.');
      return;
    }
    if (!input.step) return;
    const epoch = recordEpoch;
    outputChain = outputChain
      .then(async () => {
        if (epoch !== recordEpoch || auth || !isAllowed(source.frame.url())) return;
        const raw = input.step!;
        if (!['click', 'fill', 'select', 'check', 'press', 'scroll'].includes(raw.action)) return;
        const step: NavigationStep = {
          id: randomUUID(),
          action: raw.action,
          effect: raw.action === 'scroll' ? 'read' : 'unknown',
        };
        const tab = requireContext().pages().indexOf(source.page);
        if (tab < 0) return;
        if (raw.target) {
          if (
            !['testId', 'role', 'label', 'text', 'css'].includes(raw.target.strategy) ||
            typeof raw.target.value !== 'string' ||
            raw.target.value.length > 1000
          )
            return;
          step.target = {
            strategy: raw.target.strategy,
            value: raw.target.value,
            name: typeof raw.target.name === 'string' ? raw.target.name.slice(0, 200) : undefined,
            tab,
          };
          if (source.frame !== source.page.mainFrame()) {
            const name = source.frame.name();
            if (!name || !/^[a-zA-Z0-9_-]{1,80}$/.test(name)) {
              warn('Frame sans nom stable : interaction non enregistrée.');
              return;
            }
            step.target.frame = `iframe[name="${name}"]`;
          }
          try {
            const locator = await locate(step.target);
            await rejectSensitive(locator);
          } catch {
            warn('Cible disparue ou ambiguë : interaction non corroborée, à revoir.');
            return;
          }
        } else if (raw.action !== 'scroll') return;
        if (raw.action === 'fill' || raw.action === 'select') {
          if (
            !raw.value ||
            !('literal' in raw.value) ||
            typeof raw.value.literal !== 'string' ||
            raw.value.literal.length > 4000
          )
            return;
          step.value = { literal: raw.value.literal };
          step.note = 'Valeur de démonstration à revoir ou convertir en paramètre.';
        }
        if (raw.action === 'check') {
          if (typeof raw.checked !== 'boolean') return;
          step.checked = raw.checked;
        }
        if (raw.action === 'press') {
          if (!['Enter', 'Escape'].includes(raw.key ?? '')) return;
          step.key = raw.key;
        }
        if (raw.action === 'scroll') {
          if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return;
          step.x = raw.x;
          step.y = raw.y;
        }
        if (epoch !== recordEpoch || auth || !isAllowed(source.frame.url())) return;
        process.send?.({ event: 'record', generation, sequence: ++recordSequence, step });
      })
      .catch(() => warn('Événement non acquitté : démonstration incomplète.'));
    await outputChain;
  });
  const observe = (page: Page) => {
    page.on('framenavigated', (frame) => {
      void ensureInteractionGuards();
      frameSequence.delete(frame);
      if (recording) queueFrame(frame);
    });
    page.on('domcontentloaded', () => {
      void ensureInteractionGuards();
      if (recording) for (const frame of page.frames()) queueFrame(frame);
    });
    page.on('close', () => {
      if (recording) warn('Onglet fermé pendant la démonstration ; vérifier les dernières étapes.');
    });
    if (recording) for (const frame of page.frames()) queueFrame(frame);
  };
  requireContext().on('page', observe);
  requireContext().pages().forEach(observe);
}
async function dispatch(request: WorkerRequest): Promise<unknown> {
  const payload = request.payload as any;
  if (request.command === 'close') {
    generation = request.generation;
    auth = true;
    await deactivateRecording();
    const previous = context;
    context = undefined;
    await previous?.close();
    return {};
  }
  if (request.command === 'prepare') {
    const executablePath = executable(payload?.executablePath);
    return {
      runtime: require('playwright-core/package.json').version,
      executablePath,
      ready: Boolean(executablePath),
      ...(!executablePath
        ? {
            reason:
              'Aucun Chromium existant. Sélectionnez un exécutable autorisé ; aucun téléchargement automatique.',
          }
        : {}),
    };
  }
  if (request.command === 'open') {
    const options = payload as WorkerOpen;
    openOptions = structuredClone(options);
    origins = options.allowedOrigins;
    authenticationOrigins = options.authenticationOrigins ?? [];
    for (const origin of authenticationOrigins) {
      const url = new URL(origin);
      if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password)
        fail('Origine d’authentification HTTPS invalide.');
    }
    for (const origin of origins) {
      const url = new URL(origin);
      if (!isNavigationUrl(origin) || url.origin !== origin)
        fail('Origine HTTP ou HTTPS invalide.');
    }
    if (!origins.includes(options.origin)) fail('Origine principale non autorisée.');
    const startUrl = options.startUrl ?? options.origin;
    if (
      !isNavigationUrl(startUrl) ||
      hasSensitiveNavigationUrl(startUrl) ||
      new URL(startUrl).origin !== options.origin
    )
      fail('URL de démarrage invalide ou hors du site de l’application.');
    generation = request.generation;
    controlOwned = false;
    auth = false;
    recording = false;
    network.length = 0;
    const executablePath = executable(options.executablePath);
    if (!executablePath)
      fail('Aucun navigateur Chromium existant. Installation ou sélection humaine requise.');
    context = await chromium.launchPersistentContext(options.profilePath, {
      executablePath,
      headless: options.headless,
      viewport: { width: 1280, height: 800 },
      acceptDownloads: false,
      serviceWorkers: 'block',
    });
    context.setDefaultTimeout(15000);
    let blockedNavigation = false;
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (
        request.isNavigationRequest() &&
        !isAllowed(request.url()) &&
        !(auth && authenticationOrigins.includes(new URL(request.url()).origin))
      ) {
        blockedNavigation = true;
        warn(
          'Navigation externe bloquée ; connexion manuelle explicite et origine déclarée requises.',
        );
        await route.abort();
      } else await route.continue();
    });
    context.on('request', (request) => {
      if (!auth && isAllowed(request.url())) {
        network.push({
          url: cleanUrl(request.url()),
          method: request.method(),
          type: request.resourceType(),
        });
        if (network.length > 100) network.shift();
      }
    });
    context.on('response', (response) => {
      if (auth || !isAllowed(response.url())) return;
      const found = [...network].reverse().find((item) => item.url === cleanUrl(response.url()));
      if (found) found.status = response.status();
    });
    await initializeRecorder();
    const page = context.pages()[0] ?? (await context.newPage());
    try {
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (error) {
      if (!blockedNavigation) throw error;
    }
    if (!isAllowed(page.url())) {
      auth = true;
      warn('Redirection externe : connexion manuelle requise, capture suspendue.');
    }
    return { url: cleanUrl(page.url()) };
  }
  if (request.generation !== generation) fail('Génération de bail périmée.');
  switch (request.command) {
    case 'reset': {
      if (!openOptions) fail('Aucune application préparée pour le rejeu.');
      await deactivateRecording();
      const previous = context;
      context = undefined;
      await previous?.close();
      const result = await dispatch({ ...request, command: 'open', payload: openOptions });
      controlOwned = true;
      await ensureInteractionGuards();
      return result;
    }
    case 'act':
      try {
        return await action(payload);
      } finally {
        await clearInteractionExpectations();
      }
    case 'inspect':
      return inspect(payload ?? {});
    case 'capture':
      return capture(payload ?? {});
    case 'conditions':
      return conditions(payload);
    case 'human':
      controlOwned = false;
      await deactivateRecording();
      auth = true;
      network.length = 0;
      return {};
    case 'resume':
      auth = false;
      try {
        pageFor();
      } catch (error) {
        auth = true;
        throw error;
      }
      return {};
    case 'recordStart':
    case 'recordResume': {
      const recordingPage = pageFor();
      if (hasSensitiveNavigationUrl(recordingPage.url()))
        fail(
          'URL privée : terminez la connexion et ouvrez une route sans identifiant sensible avant d’enregistrer.',
        );
      const initialUrl = recordingPage.url();
      if (request.command === 'recordStart') recordSequence = 0;
      recording = true;
      recordEpoch++;
      await Promise.all(
        requireContext()
          .pages()
          .flatMap((page) => page.frames().map((frame) => activateFrame(frame))),
      );
      return { url: initialUrl };
    }
    case 'recordPause':
    case 'recordStop':
      await deactivateRecording();
      return {};
    default:
      fail('Commande non supportée.');
  }
}
process.on('message', async (request: WorkerRequest) => {
  if (!request || !Number.isInteger(request.id) || !Number.isInteger(request.generation)) return;
  const cancellation = request.command === 'close';
  if (busy && !cancellation) {
    process.send?.({
      id: request.id,
      generation: request.generation,
      error: 'Une commande navigateur est déjà active.',
    });
    return;
  }
  if (!cancellation) busy = true;
  try {
    const result = await dispatch(request);
    process.send?.({ id: request.id, generation: request.generation, result });
  } catch (error) {
    process.send?.({ id: request.id, generation: request.generation, error: safeError(error) });
  } finally {
    if (!cancellation) busy = false;
  }
});
process.on('disconnect', () => {
  void context?.close().finally(() => process.exit(0));
  if (!context) process.exit(0);
});
