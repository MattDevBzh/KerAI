import { describe, expect, it } from 'vitest';
import {
  hasSensitiveNavigationUrl,
  navigationConditionSchema,
  navigationJourneySchema,
  navigationStepSchema,
} from '../src/core/navigationSchemas';
import { exportNavigationJourney, importNavigationJSON } from '../src/host/ChromeRecorderImport';
import type { NavigationJourney } from '../src/shared/navigation';
const now = '2026-10-23T12:00:00.000Z';
function journey(url: string, arrival = false): NavigationJourney {
  return {
    id: 'journey',
    applicationId: 'app',
    revision: 0,
    title: 'Parcours',
    intent: 'Atteindre une fiche',
    tags: [],
    prerequisites: [],
    parameters: [],
    steps: [{ id: 'navigate', action: 'navigate', url: arrival ? '/' : url }],
    arrival: arrival ? [{ kind: 'url', value: url }] : [],
    status: 'draft',
    provenance: { mode: 'human' },
    createdAt: now,
    updatedAt: now,
  };
}
const sensitive = [
  'http://user:DO_NOT_REFLECT@localhost:3000/',
  'http://localhost:3000/?password=DO_NOT_REFLECT',
  'https://app.example.com/?token=DO_NOT_REFLECT',
  'http://intranet:8080/#access_token=DO_NOT_REFLECT',
  '/?TOKEN=DO_NOT_REFLECT',
  '/?api_key=DO_NOT_REFLECT',
  '/?access_token=DO_NOT_REFLECT',
  '/?id_token=DO_NOT_REFLECT',
  '/?authorization=DO_NOT_REFLECT',
  '/callback?code=DO_NOT_REFLECT&state=state',
  '/?%74%6f%6b%65%6e=DO_NOT_REFLECT',
  '/?%2561ccess%255Ftoken=DO_NOT_REFLECT',
  '/#token=DO_NOT_REFLECT',
  '/#/callback?access_token=DO_NOT_REFLECT',
  '/#token/DO_NOT_REFLECT',
  '/#Bearer%20DO_NOT_REFLECT',
  '/#eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.abcdefghijk12345',
  '/#ABCdef123456789012345678901234567890abcdef',
  '/?redirect=%2Fcallback%3Fcode%3DDO_NOT_REFLECT',
];
describe('credential URLs never enter navigation definitions or exports', () => {
  it.each(sensitive)('rejects sensitive URL %s with a generic error', (url) => {
    expect(hasSensitiveNavigationUrl(url)).toBe(true);
    const step = navigationStepSchema.safeParse({ id: 'navigate', action: 'navigate', url });
    expect(step.success).toBe(false);
    if (!step.success) expect(step.error.message).not.toContain('DO_NOT_REFLECT');
    const condition = navigationConditionSchema.safeParse({ kind: 'url', value: url });
    expect(condition.success).toBe(false);
    if (!condition.success) expect(condition.error.message).not.toContain('DO_NOT_REFLECT');
  });
  it.each([
    '/?customerId=42&tab=billing#details',
    '/#/orders?customerId=42',
    '/?search=token+renewal&sort=name',
    'http://localhost:3000/reports?year=2026#overview',
    'https://app.example.com/reports?year=2026#overview',
    'http://intranet:8080/reports?year=2026#overview',
  ])('preserves ordinary query and fragment semantics %s', (url) => {
    expect(hasSensitiveNavigationUrl(url)).toBe(false);
    expect(navigationStepSchema.parse({ id: 'navigate', action: 'navigate', url }).url).toBe(url);
    expect(navigationConditionSchema.parse({ kind: 'url', value: url }).value).toBe(url);
  });
  it('rejects Recorder navigation and asserted navigation events before producing a draft', () => {
    for (const steps of [
      [{ type: 'navigate', url: '/?token=DO_NOT_REFLECT' }],
      [
        {
          type: 'navigate',
          url: '/',
          assertedEvents: [{ type: 'navigation', url: '/callback#access_token=DO_NOT_REFLECT' }],
        },
      ],
    ]) {
      try {
        importNavigationJSON(JSON.stringify({ title: 'Synthetic', steps }), 'app');
        throw new Error('Unexpected acceptance');
      } catch (error) {
        expect((error as Error).message).toMatch(/sensible|invalide/);
        expect((error as Error).message).not.toContain('DO_NOT_REFLECT');
      }
    }
  });
  it('rejects portable imports, stored arrival contracts and exports of old unsafe definitions', () => {
    for (const value of [
      journey('/?token=DO_NOT_REFLECT'),
      journey('/#authorization=DO_NOT_REFLECT', true),
    ]) {
      expect(navigationJourneySchema.safeParse(value).success).toBe(false);
      expect(() =>
        importNavigationJSON(JSON.stringify({ navigationVersion: 1, journey: value }), 'app'),
      ).toThrow(/sensible|invalide/);
      try {
        exportNavigationJourney(value);
        throw new Error('Unexpected acceptance');
      } catch (error) {
        expect((error as Error).message).toMatch(/sensible|invalide/);
        expect((error as Error).message).not.toContain('DO_NOT_REFLECT');
      }
    }
  });
  it('keeps a safe exact URL through Recorder conversion and portable export', () => {
    const url = 'http://localhost:3000/?customerId=42&tab=billing#details';
    const imported = importNavigationJSON(
      JSON.stringify({
        title: 'Customer',
        steps: [{ type: 'navigate', url, assertedEvents: [{ type: 'navigation', url }] }],
      }),
      'app',
    ).journey;
    expect(imported.steps[0].url).toBe(url);
    expect(imported.steps[0].postconditions?.[0].value).toBe(url);
    const exported = JSON.parse(exportNavigationJourney(imported));
    expect(exported.journey.steps[0].url).toBe(url);
  });
});
