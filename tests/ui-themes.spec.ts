import { navigate } from './ui-navigation-helpers';
import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { demoState } from '../webview/demo';
import type { ClientMessage } from '../src/shared/types';
import type { ThemeId } from '../src/shared/themes';

import { THEME_IDS, themeDefinitions } from '../src/shared/themes';
const palettes = THEME_IDS.filter((id) => id !== 'auto').map((id) => ({
  id,
  ...themeDefinitions[id],
}));
const nativeColors = {
  dark: {
    background: '#141414',
    foreground: '#ffffff',
    input: '#282828',
    muted: '#bbbbbb',
    link: '#9bddff',
  },
  light: {
    background: '#ffffff',
    foreground: '#141414',
    input: '#eeeeee',
    muted: '#404040',
    link: '#004c96',
  },
};
async function hosted(
  page: Page,
  theme: ThemeId = 'auto',
  native: 'dark' | 'light' = 'dark',
  duringRun = false,
) {
  const state = structuredClone(demoState);
  if (duringRun) {
    state.features[0].status = 'running';
    state.features[0].steps[1].status = 'running';
  }
  await page.addInitScript(
    ({ state, theme, native, colors }) => {
      const sent: ClientMessage[] = [];
      Object.assign(window, {
        themeMessages: sent,
        acquireVsCodeApi: () => ({
          getState: () => ({ view: 'settings' }),
          setState: (state: unknown) => Reflect.set(window, 'persistedThemeView', state),
          postMessage: (message: ClientMessage) => {
            sent.push(message);
            if (message.type === 'ready')
              setTimeout(() => {
                window.postMessage({ type: 'state', state }, '*');
                window.postMessage({ type: 'themeState', theme }, '*');
              }, 0);
          },
        }),
      });
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.dataset.studioTheme = theme;
        for (const [key, color] of Object.entries({
          'editor-background': colors.background,
          'sideBar-background': colors.input,
          'editorWidget-background': colors.background,
          'input-background': colors.input,
          foreground: colors.foreground,
          'input-foreground': colors.foreground,
          descriptionForeground: colors.muted,
          'input-placeholderForeground': colors.muted,
          'textLink-foreground': colors.link,
          'panel-border': colors.foreground,
          'input-border': colors.foreground,
          focusBorder: colors.link,
          contrastBorder: colors.foreground,
          contrastActiveBorder: colors.link,
        }))
          document.documentElement.style.setProperty(`--vscode-${key}`, color);
        document.body.className = `vscode-${native}`;
        const defaults = document.createElement('style');
        defaults.textContent = `@layer vscode-default { body { color: var(--vscode-foreground); padding: 0 20px; } kbd { background: var(--vscode-input-background); } blockquote { background: var(--vscode-input-background); } }`;
        document.head.append(defaults);
      });
    },
    { state, theme, native, colors: nativeColors[native] },
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'L’ambiance du cockpit' })).toBeVisible();
}
async function lastThemeRequest(page: Page) {
  return page.evaluate(() =>
    (Reflect.get(window, 'themeMessages') as ClientMessage[])
      .filter((m) => m.type === 'setTheme')
      .at(-1),
  ) as Promise<Extract<ClientMessage, { type: 'setTheme' }>>;
}
async function themeState(page: Page, theme: string, requestId?: string, error?: string) {
  await page.evaluate(
    ({ theme, requestId, error }) =>
      window.postMessage({ type: 'themeState', theme, requestId, error }, '*'),
    { theme, requestId, error },
  );
}

test('huit choix accessibles : ack, erreur corrélée et brouillon de réglages préservé pendant un run', async ({
  page,
}) => {
  await hosted(page, 'auto', 'dark', true);
  await expect(page.getByRole('radio')).toHaveCount(8);
  const draft = page.getByLabel('Durée maximale d’une tentative');
  await draft.fill('37');
  await page.getByRole('radio', { name: 'Suivre VS Code — Automatique' }).focus();
  await page.keyboard.press('ArrowRight');
  const request = await lastThemeRequest(page);
  expect(request).toMatchObject({ type: 'setTheme', theme: 'jardin-clair' });
  expect(request.requestId).toBeTruthy();
  await expect(page.getByRole('radio', { name: 'Guilde pixel — Sombre' })).toBeDisabled();
  await expect(page.getByText('Préférence personnelle enregistrée.', { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator('html')).toHaveAttribute('data-studio-theme-effective', 'auto');
  await themeState(page, 'guilde-sombre', 'unrelated');
  await expect(page.locator('html')).toHaveAttribute('data-studio-theme-effective', 'auto');
  await themeState(page, 'jardin-clair', request.requestId);
  await expect(page.getByRole('radio', { name: 'Jardin des idées — Clair' })).toBeChecked();
  await expect(
    page.getByText('Préférence personnelle enregistrée.', { exact: true }),
  ).toBeVisible();
  await expect(draft).toHaveValue('37');
  await expect(page.getByRole('radio', { name: 'Jardin des idées — Clair' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const rejected = await lastThemeRequest(page);
  expect(rejected.theme).toBe('jardin-sombre');
  await themeState(page, 'jardin-clair', rejected.requestId, 'Écriture refusée par VS Code.');
  await expect(page.getByRole('alert')).toContainText('Écriture refusée');
  await expect(page.getByRole('radio', { name: 'Jardin des idées — Clair' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Jardin des idées — Sombre' })).toBeEnabled();
  await expect(page.getByRole('radio', { name: 'Jardin des idées — Sombre' })).toBeFocused();
  await expect(draft).toHaveValue('37');
  const messages = await page.evaluate(
    () => Reflect.get(window, 'themeMessages') as ClientMessage[],
  );
  expect(messages.filter((m) => m.type === 'saveSettings')).toHaveLength(0);
});

test('config externe, valeur invalide, navigation et contraste élevé conservent la préférence', async ({
  page,
}) => {
  await hosted(page, 'jardin-sombre');
  await themeState(page, 'jardin-sombre');
  await expect(page.getByRole('radio', { name: 'Jardin des idées — Sombre' })).toBeChecked();
  await navigate(page, 'Sessions');
  await expect(page.locator('html')).toHaveAttribute(
    'data-studio-theme-effective',
    'jardin-sombre',
  );
  expect(await page.evaluate(() => Reflect.get(window, 'persistedThemeView'))).toMatchObject({
    view: 'sessions',
  });
  await navigate(page, 'Réglages');
  await expect(page.getByRole('radio', { name: 'Jardin des idées — Sombre' })).toBeChecked();
  for (const native of ['vscode-high-contrast', 'vscode-high-contrast-light']) {
    await page.evaluate((native) => (document.body.className = native), native);
    await expect(page.locator('html')).toHaveAttribute('data-studio-theme-effective', 'auto');
    await expect(page.locator('html')).toHaveAttribute('data-studio-theme', 'jardin-sombre');
    await expect(
      page.getByText('Le contraste élevé de VS Code est prioritaire.', { exact: false }),
    ).toBeVisible();
    const colors = await page.locator('body').evaluate((body) => {
      const style = getComputedStyle(body);
      return {
        border: style.getPropertyValue('--input-border').trim(),
        native: style.getPropertyValue('--vscode-contrastBorder').trim(),
        accent: style.getPropertyValue('--coral').trim(),
        nativeAccent: style.getPropertyValue('--vscode-textLink-foreground').trim(),
      };
    });
    expect(colors.border).toBe(colors.native);
    expect(colors.accent).toBe(colors.nativeAccent);
  }
  await page.evaluate(() => (document.body.className = 'vscode-light'));
  await expect(page.locator('html')).toHaveAttribute(
    'data-studio-theme-effective',
    'jardin-sombre',
  );
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(page.locator('html')).toHaveAttribute('data-studio-theme-effective', 'auto');
  await page.emulateMedia({ forcedColors: 'none' });
  await expect(page.locator('html')).toHaveAttribute(
    'data-studio-theme-effective',
    'jardin-sombre',
  );
  await themeState(page, 'invalid-theme');
  await expect(page.getByRole('radio', { name: 'Suivre VS Code — Automatique' })).toBeChecked();
});

test('le mode automatique suit le thème natif et les radios sont utilisables au clavier en démo', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await navigate(page, 'Réglages');
  const auto = page.getByRole('radio', { name: 'Suivre VS Code — Automatique' });
  await auto.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Jardin des idées — Clair' })).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Jardin des idées — Sombre' })).toBeChecked();
  await expect(
    page.getByText('Aperçu pour cette session de démonstration.', { exact: true }),
  ).toBeVisible();
  await auto.click();
  await page.evaluate(() => (document.body.className = 'vscode-light'));
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await page.evaluate(() => (document.body.className = 'vscode-dark'));
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await page.reload();
  await navigate(page, 'Réglages');
  await expect(auto).toBeChecked();
});

for (const palette of palettes) {
  test(`${palette.name} ${palette.kind} : surfaces et contrastes sous VS Code clair et sombre, vues 1440 et 390`, async ({
    page,
  }) => {
    await hosted(page, palette.id);
    for (const native of ['dark', 'light'] as const) {
      await page.evaluate(
        ({ native, colors }) => {
          document.body.className = `vscode-${native}`;
          for (const [key, color] of Object.entries({
            'editor-background': colors.background,
            'sideBar-background': colors.input,
            'editorWidget-background': colors.background,
            'input-background': colors.input,
            foreground: colors.foreground,
            'input-foreground': colors.foreground,
            descriptionForeground: colors.muted,
            'input-placeholderForeground': colors.muted,
            'textLink-foreground': colors.link,
            focusBorder: colors.link,
          }))
            document.documentElement.style.setProperty(`--vscode-${key}`, color);
        },
        { native, colors: nativeColors[native] },
      );
      await expect(page.locator('body')).toHaveClass(`vscode-${native}`);
      await expect(page.locator('html')).toHaveCSS('color-scheme', palette.scheme!);
      const initialPalette = await page.evaluate(() => {
        const root = document.documentElement;
        const saved = root.dataset.studioThemeEffective!;
        const before = getComputedStyle(document.body).color;
        delete root.dataset.studioThemeEffective;
        const initial = getComputedStyle(document.body).color;
        root.dataset.studioThemeEffective = saved;
        return { before, initial };
      });
      expect(initialPalette.initial).toBe(initialPalette.before);
      const pairs = await page.evaluate(() => {
        const body = getComputedStyle(document.body);
        const resolve = (token: string) => {
          const node = document.createElement('span');
          node.style.color = `var(${token})`;
          document.body.append(node);
          const color = getComputedStyle(node).color;
          node.remove();
          return color;
        };
        const contrast = (a: string, b: string) => {
          const luminance = (color: string) => {
            const [r, g, b] = color
              .match(/[\d.]+/g)!
              .slice(0, 3)
              .map(Number)
              .map((v) => {
                if (!color.startsWith('color(srgb')) v /= 255;
                return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
              });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const la = luminance(a),
            lb = luminance(b);
          return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
        };
        const results: Record<string, number> = {};
        for (const surface of ['--bg', '--side', '--panel', '--panel-soft']) {
          for (const ink of [
            '--fg',
            '--muted',
            '--coral',
            '--apricot',
            '--lavender',
            '--green',
            '--error',
          ])
            results[`${ink}/${surface}`] = contrast(resolve(ink), resolve(surface));
          results[`control/${surface}`] = contrast(resolve('--input-border'), resolve(surface));
        }
        results['error message'] = contrast(resolve('--error'), resolve('--error-bg'));
        results['primary text'] = contrast(resolve('--on-accent'), resolve('--coral'));
        results['primary hover text'] = contrast(resolve('--on-accent'), resolve('--accent-hover'));
        const input = document.querySelector<HTMLInputElement>('input[type="number"]')!;
        const styles = getComputedStyle(input);
        results['real input text'] = contrast(styles.color, styles.backgroundColor);
        results['real input border'] = contrast(styles.borderColor, styles.backgroundColor);
        results['body text'] = contrast(
          body.color,
          getComputedStyle(document.documentElement).backgroundColor,
        );
        return results;
      });
      for (const [pair, value] of Object.entries(pairs))
        expect(value, pair).toBeGreaterThanOrEqual(
          pair.startsWith('control/') || pair === 'real input border' ? 3 : 4.5,
        );
      await navigate(page, 'Livraison');
      await navigate(page, 'Azure DevOps');
      const organization = page.getByLabel('Organisation', { exact: true });
      await expect(organization).toBeVisible();
      const surfaces = await organization.evaluate((input) => {
        const style = getComputedStyle(input);
        const probe = document.createElement('i');
        probe.style.color = 'var(--fg)';
        probe.style.background = 'var(--panel-soft)';
        document.body.append(probe);
        const expected = getComputedStyle(probe);
        const result = {
          color: style.color,
          background: style.backgroundColor,
          expectedColor: expected.color,
          expectedBackground: expected.backgroundColor,
        };
        probe.remove();
        return result;
      });
      expect(surfaces.color).toBe(surfaces.expectedColor);
      expect(surfaces.background).toBe(surfaces.expectedBackground);
      await navigate(page, 'Consommation');
      await expect(page.locator('.usage-dashboard')).toBeVisible();
      await navigate(page, 'Réglages');
      await page
        .getByRole('radio', {
          name:
            palette.id === 'jardin-clair'
              ? 'Jardin des idées — Sombre'
              : 'Jardin des idées — Clair',
          exact: true,
        })
        .click();
      const failed = await lastThemeRequest(page);
      await themeState(page, palette.id, failed.requestId, 'Préférence non enregistrée.');
      const alert = page.getByRole('alert');
      await expect(alert).toContainText('Préférence non enregistrée.');
      const alertColor = await alert.evaluate((alert) => {
        const probe = document.createElement('i');
        probe.style.color = 'var(--error)';
        document.body.append(probe);
        const result = {
          actual: getComputedStyle(alert).color,
          expected: getComputedStyle(probe).color,
        };
        probe.remove();
        return result;
      });
      expect(alertColor.actual).toBe(alertColor.expected);
      await themeState(page, palette.id);
    }
    const directory = '/tmp/feature-studio-themes-review';
    await mkdir(directory, { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await navigate(page, 'Réglages');
      await expect(
        page.getByRole('radio', { name: `${palette.name} — ${palette.kind}` }),
      ).toBeChecked();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({ path: `${directory}/${palette.id}-${width}-settings.png` });
      await navigate(page, 'Sessions');
      await expect(page.locator('.dashboard-page')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({ path: `${directory}/${palette.id}-${width}-dashboard.png` });
    }
  });
}

test('Halloween habille les agents seulement quand choisi, avec repli et contraste élevé', async ({
  page,
}) => {
  await hosted(page, 'halloween', 'dark', true);
  await navigate(page, 'Agents');
  const portrait = page.locator('.pixel-avatar img').first();
  await expect(portrait).toHaveAttribute('src', /avatar-events\/halloween\//);
  await expect(portrait).toHaveJSProperty('complete', true);
  await expect(portrait).not.toHaveJSProperty('naturalWidth', 0);
  await themeState(page, 'jardin-clair');
  await expect(portrait).toHaveAttribute('src', /^\/avatars\//);
  await themeState(page, 'halloween');
  await expect(portrait).toHaveAttribute('src', /avatar-events\/halloween\//);
  await page.evaluate(() => (document.body.className = 'vscode-high-contrast'));
  await expect(portrait).toHaveAttribute('src', /^\/avatars\//);
  await page.evaluate(() => (document.body.className = 'vscode-dark'));
  await expect(portrait).toHaveAttribute('src', /avatar-events\/halloween\//);
  await portrait.dispatchEvent('error');
  await expect(portrait).toHaveAttribute('src', /^\/avatars\//);
  await themeState(page, 'papier-sombre');
  await expect(portrait).toHaveAttribute('src', /^\/avatars\//);
  await themeState(page, 'halloween');
  await expect(portrait).toHaveAttribute('src', /avatar-events\/halloween\//);
});
