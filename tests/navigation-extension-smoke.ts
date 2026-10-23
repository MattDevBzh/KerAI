import * as assert from 'node:assert/strict';
import type { ClientMessage, StudioState } from '../src/shared/types';
import { navigationFixture } from './fixtures/navigation-application';

/** Optional actual packaged-worker smoke. Never calls a provider or installs a browser. */
export async function navigationExtensionSmoke(api: {
  getState(): StudioState | undefined;
  dispatch(message: ClientMessage): Promise<unknown>;
}) {
  const fixture = await navigationFixture();
  const dispatch = (command: Extract<ClientMessage, { type: 'navigation' }>['command']) =>
    api.dispatch({ type: 'navigation', requestId: `navigation-${command.action}`, command });
  const now = new Date().toISOString();
  try {
    assert.ok(api.getState()?.agents.some((agent) => agent.id === 'fs-navigator'));
    await dispatch({
      action: 'saveApplication',
      application: {
        id: 'packaged-navigation',
        name: 'Recette locale du paquet',
        projectIds: [],
        origin: fixture.origin,
        allowedOrigins: [fixture.origin],
        ownerNavigatorId: 'fs-navigator',
        interactionPolicy: 'authorized',
        createdAt: now,
        updatedAt: now,
      },
    });
    assert.ok(
      api
        .getState()
        ?.navigation?.applications.some((application) => application.id === 'packaged-navigation'),
    );
    await dispatch({ action: 'prepare', applicationId: 'packaged-navigation' });
    assert.equal(
      api.getState()?.navigation?.browser?.state,
      'idle',
      'The worker bundled in this VSIX starts through the real extension host',
    );
    await dispatch({ action: 'inspect' });
    assert.ok(
      api.getState()?.navigation?.inspection,
      'Real DOM inspection crosses worker IPC and extension state',
    );
    await dispatch({ action: 'capture' });
    const capture = api.getState()?.navigation?.captures?.at(-1);
    assert.ok(
      capture?.sha256 && capture.bytes > 0,
      'Actual masked PNG receipt saved by the packaged host',
    );
    await dispatch({
      action: 'import',
      applicationId: 'packaged-navigation',
      json: JSON.stringify({
        title: 'Résultat Lille',
        steps: [
          { type: 'navigate', url: fixture.origin },
          { type: 'change', selectors: [['#city']], value: 'Lille' },
          { type: 'click', selectors: [['#go']] },
        ],
      }),
    });
    const draft = api.getState()?.navigation?.journeys.at(-1);
    assert.ok(draft, 'The packaged host imports a Recorder journey');
    draft.parameters.forEach((parameter) => {
      parameter.sensitive = false;
    });
    draft.arrival = [
      { kind: 'text', target: { strategy: 'css', value: '#result' }, value: 'Résultat Lille' },
    ];
    await dispatch({ action: 'saveDraft', journey: draft, expectedRevision: draft.revision });
    const updated = api
      .getState()!
      .navigation!.journeys.find((journey) => journey.id === draft.id)!;
    await dispatch({
      action: 'replay',
      journeyId: draft.id,
      parameters: Object.fromEntries(
        updated.parameters.map((parameter) => [parameter.name, 'Lille']),
      ),
      mode: 'verify',
      confirmInteractions: true,
      prerequisitesConfirmed: true,
    });
    const run = api.getState()?.navigation?.runs.at(-1);
    assert.equal(run?.status, 'succeeded', run?.error);
    assert.equal(run.arrivalVerified, true);
    assert.equal(run.metrics.providerCalls, 0);
    await dispatch({
      action: 'commit',
      journeyId: draft.id,
      expectedRevision: updated.revision,
      runId: run.id,
    });
    assert.equal(
      api.getState()?.navigation?.journeys.find((journey) => journey.id === draft.id)?.status,
      'available',
    );
    console.log(
      'NAVIGATION_PACKAGED_SMOKE_OK: real Chromium, import, edit, replay, capture and publication; no provider.',
    );
  } finally {
    await dispatch({ action: 'closeBrowser' });
    await fixture.close();
  }
}
