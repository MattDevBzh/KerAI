import { describe, it, expect } from 'vitest';
import { prSessionContext, selectPrSessionContext } from '../src/host/PrSessionContext';
import { demoState } from '../webview/demo';
import { documentSourceContext } from '../webview/documentSource';
import type { Attempt } from '../src/shared/types';
import type { DevOpsState } from '../src/shared/devops';
const devops: DevOpsState = {
  authenticated: true,
  busy: false,
  notices: [],
  tickets: [],
  pullRequests: [],
  links: [],
  history: [],
};
function fixture() {
  const feature = structuredClone(demoState.features[0]);
  feature.id = 'context-session';
  feature.description =
    'Besoin principal' +
    documentSourceContext({
      name: 'Sécurité.md',
      sha256: 'a'.repeat(64),
      warnings: [],
      text: 'SEC-42 : vérifier les accès.\npassword=private-value',
    });
  const attempt: Attempt = {
    id: 'attempt-1',
    startedAt: '2026-11-08T10:00:00Z',
    status: 'approved',
    feedback: 'Décision : conserver la compatibilité',
    logs: [],
    questions: [{ id: 'q', text: 'Pourquoi ?', choices: [] }],
    answers: { q: 'Pour protéger les accès' },
    changedFiles: [],
    artifact: { name: 'Plan.md', content: 'Plan validé', updatedAt: '2026-11-08T11:00:00Z' },
    launch: {
      initialContext: 'Contexte transmis',
      mcpServerIds: [],
      memoryIds: [],
      useProjectMemory: false,
    },
    pair: {
      messages: [
        {
          id: 'human',
          role: 'user',
          content: 'Décision humaine à retenir',
          at: '2026-11-08T10:02:00Z',
          status: 'complete',
        },
        {
          id: 'assistant',
          role: 'assistant',
          content: 'Réponse utile',
          at: '2026-11-08T10:03:00Z',
          status: 'complete',
        },
        {
          id: 'private',
          role: 'assistant',
          kind: 'reasoning',
          content: 'PRIVATE_REASONING',
          at: '2026-11-08T10:03:00Z',
          status: 'complete',
        },
        {
          id: 'stream',
          role: 'assistant',
          content: 'INCOMPLETE_TEXT',
          at: '2026-11-08T10:04:00Z',
          status: 'streaming',
        },
      ],
    } as Attempt['pair'],
  };
  feature.steps = [{ ...feature.steps[0], id: 'step', name: 'Spécification', attempts: [attempt] }];
  return { feature, attempt };
}
describe('selected session context for PRs', () => {
  it('exposes actual imported documents, reports, exchanges and decisions with provenance and redacted secrets', () => {
    const { feature } = fixture(),
      catalog = prSessionContext(feature, devops);
    const document = catalog.items.find((item) => item.kind === 'document')!;
    expect(document.label).toBe('Sécurité.md');
    expect(document.content).toContain('SEC-42');
    expect(document.content).not.toContain('private-value');
    expect(catalog.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'report',
          label: 'Plan.md',
          origin: expect.stringContaining('tentative 1'),
        }),
        expect.objectContaining({ kind: 'exchange', content: 'Décision humaine à retenir' }),
        expect.objectContaining({
          kind: 'decision',
          content: expect.stringContaining('Pour protéger'),
        }),
      ]),
    );
    expect(JSON.stringify(catalog)).not.toMatch(/PRIVATE_REASONING|INCOMPLETE_TEXT/);
    const selected = selectPrSessionContext(catalog, [
      { id: document.id, digest: document.digest },
    ]);
    expect(selected.sources).toEqual([document]);
    expect(JSON.stringify(selected.sources)).not.toContain('Réponse utile');
    expect(selectPrSessionContext(catalog).sources).toEqual([]);
  });
  it('rejects stale, deleted, duplicate and cross-session source references', () => {
    const { feature } = fixture(),
      catalog = prSessionContext(feature, devops),
      item = catalog.items.find((item) => item.kind === 'document')!;
    const selection = [{ id: item.id, digest: item.digest }];
    feature.description = feature.description.replace('vérifier les accès', 'nouvelle règle');
    expect(() => selectPrSessionContext(prSessionContext(feature, devops), selection)).toThrow(
      'a changé',
    );
    expect(() => selectPrSessionContext({ ...catalog, items: [] }, selection)).toThrow(
      'plus disponible',
    );
    expect(() => selectPrSessionContext(catalog, [...selection, ...selection])).toThrow(
      'distincts',
    );
    expect(() =>
      selectPrSessionContext(
        prSessionContext({ ...feature, id: 'another-session' }, devops),
        selection,
      ),
    ).toThrow('plus disponible');
  });
  it('splits long texts without losing Unicode, exposes every part and rejects an oversized selection', () => {
    const { feature } = fixture();
    const text = 'x'.repeat(11999) + '🛡️' + 'z'.repeat(90000);
    feature.steps = [];
    feature.description = text;
    const catalog = prSessionContext(feature, devops);
    expect(catalog.items.map((item) => item.content).join('')).toBe(text);
    expect(catalog.items.at(-1)!.label).toContain(`/${catalog.items.length}`);
    expect(catalog.items.every((item) => !/[\uD800-\uDBFF]$/.test(item.content))).toBe(true);
    expect(() =>
      selectPrSessionContext(
        catalog,
        catalog.items.map(({ id, digest }) => ({ id, digest })),
      ),
    ).toThrow('80 000');
    expect(selectPrSessionContext(catalog, catalog.items.slice(0, 2)).sources).toHaveLength(2);
  });
  it('limits the catalogue explicitly and includes nested session reports without exposing unrelated sessions', () => {
    const { feature, attempt } = fixture();
    const child = {
      ...structuredClone(feature),
      id: 'child',
      title: 'Sous-tâche',
      description: 'Child context',
      steps: [
        {
          ...feature.steps[0],
          attempts: [
            {
              ...attempt,
              id: 'child-attempt',
              artifact: { name: 'Child.md', content: 'Child report', updatedAt: 'now' },
            },
          ],
        },
      ],
    };
    feature.steps[0].subplanState = {
      acceptedRevisions: [],
      iterations: [
        {
          id: 'iteration',
          number: 1,
          taskId: 'task',
          title: 'Sous-tâche',
          description: '',
          planRevision: 1,
          orchestrationAttemptId: attempt.id,
          feature: child,
        },
      ],
    };
    expect(prSessionContext(feature, devops).items).toContainEqual(
      expect.objectContaining({ label: 'Child.md', origin: expect.stringContaining('Sous-tâche') }),
    );
    feature.description = 'A'.repeat(2_100_000);
    const bounded = prSessionContext(feature, devops);
    expect(bounded.items.reduce((n, item) => n + item.content.length, 0)).toBeLessThanOrEqual(
      2_000_000,
    );
    expect(bounded.warnings.join('')).toContain('Catalogue partiel');
  });
});
