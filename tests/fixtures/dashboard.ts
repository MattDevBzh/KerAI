import type { Page } from '@playwright/test';
import { demoState } from '../../webview/demo';
import { defaultDashboardConfig, type DashboardState } from '../../src/shared/dashboard';
import type { ClientMessage } from '../../src/shared/types';
import { ticketDetailFixture } from './tickets';

export async function installDashboardHost(page: Page, detached = false) {
  const state = structuredClone(demoState);
  state.runtime.state = 'ready';
  state.projectCatalog = {
    projects: [
      { id: 'studio', name: 'Feature Studio', path: '/projects/studio' },
      { id: 'portal', name: 'Portail client', path: '/projects/portal' },
    ],
    selectedProjectIds: ['studio'],
    activeProjectId: 'studio',
    dedicated: false,
    windows: false,
  };
  state.features.forEach((f, i) => {
    f.projects = [{ ...state.projectCatalog!.projects[i === 1 ? 1 : 0], branch: 'main' }];
    f.updatedAt = new Date().toISOString();
    if (i === 1) {
      f.status = 'running';
      f.steps[0].status = 'running';
      f.steps[0].attempts = [
        {
          ...structuredClone(state.features[0].steps[0].attempts[0]),
          id: 'active-attempt',
          startedAt: new Date(Date.now() - 45000).toISOString(),
          finishedAt: undefined,
          status: 'running',
        },
      ];
    }
    f.steps.forEach((s) =>
      s.attempts.forEach((a) => {
        a.startedAt = new Date(
          Date.now() - (a.status === 'running' ? 45000 : 15 * 60000),
        ).toISOString();
        if (a.finishedAt) a.finishedAt = new Date(Date.now() - 12 * 60000).toISOString();
      }),
    );
  });
  const dashboard: DashboardState = {
    revision: 0,
    config: defaultDashboardConfig(),
    data: {
      'default-tickets': {
        tickets: [
          { projectId: 'studio', projectName: 'Feature Studio', item: ticketDetailFixture },
        ],
        prs: [],
        loading: false,
        partial: false,
        errors: [],
        updatedAt: new Date().toISOString(),
      },
      'default-prs': {
        tickets: [],
        prs: [
          {
            projectId: 'studio',
            projectName: 'Feature Studio',
            item: {
              id: 84,
              title: 'Contrats de préparation',
              status: 'active',
              createdBy: 'Camille',
              sourceBranch: 'feature/tickets',
              targetBranch: 'main',
              url: 'https://dev.azure.com/atelier/Studio/_git/cockpit/pullrequest/84',
            },
          },
        ],
        loading: false,
        partial: false,
        errors: [],
        updatedAt: new Date().toISOString(),
      },
    },
  };
  await page.addInitScript(
    ({ state, dashboard, detached }) => {
      const messages: ClientMessage[] = [];
      let secret = localStorage.getItem('dashboard-secret') === 'true';
      let theme = localStorage.getItem('dashboard-theme') ?? 'jardin-sombre';
      const secretState = (requestId?: string, error?: string) =>
        window.postMessage(
          {
            type: 'secretThemeState',
            dragonBallUnlocked: secret,
            requestId,
            error,
          },
          '*',
        );
      const stored = sessionStorage.getItem('dashboard-fixture');
      if (stored) Object.assign(dashboard, JSON.parse(stored));
      Object.assign(window, {
        dashboardMessages: messages,
        dashboardFixture: dashboard,
        studioFixture: state,
        acquireVsCodeApi: () => ({
          getState: () => ({ view: 'dashboard', navigationVersion: 2 }),
          setState() {},
          postMessage(message: ClientMessage) {
            messages.push(message);
            if (message.type === 'ready')
              setTimeout(() => {
                window.postMessage({ type: 'state', state }, '*');
                window.postMessage({ type: 'themeState', theme }, '*');
                window.postMessage({ type: 'livingHqState', enabled: true }, '*');
                secretState();
                window.postMessage(
                  {
                    type: 'accountCredits',
                    state: {
                      state: 'unavailable',
                      message: 'Compte non interrogé dans cette capture de démonstration.',
                    },
                  },
                  '*',
                );
              }, 0);
            if (message.type === 'refreshSecretThemes') setTimeout(() => secretState(), 0);
            if (message.type === 'unlockDragonBall' && !Reflect.get(window, 'dropSecret')) {
              setTimeout(() => {
                if (Reflect.get(window, 'rejectSecret')) {
                  secretState(message.requestId, 'Stockage personnel indisponible.');
                  return;
                }
                secret = true;
                theme = 'dragonball';
                localStorage.setItem('dashboard-secret', 'true');
                localStorage.setItem('dashboard-theme', theme);
                window.postMessage({ type: 'themeState', theme }, '*');
                secretState(message.requestId);
              }, 15);
            }
            if (message.type === 'setTheme') {
              theme = message.theme;
              localStorage.setItem('dashboard-theme', theme);
              window.postMessage({ type: 'themeState', theme, requestId: message.requestId }, '*');
            }
            if (message.type === 'dashboardVisible' || message.type === 'dashboardRefresh')
              setTimeout(
                () => window.postMessage({ type: 'dashboardState', state: dashboard }, '*'),
                0,
              );
            if (message.type === 'dashboardSave') {
              dashboard.config = message.config;
              dashboard.revision++;
              sessionStorage.setItem('dashboard-fixture', JSON.stringify(dashboard));
              setTimeout(() => {
                window.postMessage({ type: 'dashboardState', state: dashboard }, '*');
                window.postMessage({ type: 'dashboardSaved', requestId: message.requestId }, '*');
              }, 0);
            }
            if (message.type === 'dashboardOpen')
              window.postMessage(
                {
                  type: 'navigate',
                  view: message.page ?? 'sessions',
                  featureId: message.featureId,
                  stepId: message.stepId,
                },
                '*',
              );
          },
        }),
      });
      if (detached) document.documentElement.dataset.studioSurface = 'control';
    },
    { state, dashboard, detached },
  );
  await page.goto(detached ? '/?surface=control' : '/');
}
