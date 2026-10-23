import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  navigationJourneySchema,
  hasSensitiveNavigationUrl,
  navigationStepSchema,
  parseNavigationJson,
} from '../core/navigationSchemas';
import type {
  NavigationCondition,
  NavigationJourney,
  NavigationLocator,
  NavigationParameter,
  NavigationStep,
} from '../shared/navigation';
import { NAVIGATION_LIMITS } from '../shared/navigation';

export interface NavigationImportResult {
  journey: NavigationJourney;
  warnings: string[];
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} : objet requis.`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], label: string): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new Error(`${label} : propriété non prise en charge « ${key} ».`);
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 4000)
    throw new Error(`${label} : texte requis.`);
  return value;
}
function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${label} : nombre requis.`);
  return value;
}
function target(step: Record<string, unknown>, warnings: string[]): NavigationLocator {
  if (step.target !== undefined && step.target !== 'main')
    throw new Error(
      'Les onglets importés nécessitent une revue manuelle ; cible non prise en charge.',
    );
  if (!Array.isArray(step.selectors) || !step.selectors.length)
    throw new Error('Action sans sélecteur.');
  const candidates: string[] = [];
  for (const item of step.selectors) {
    if (!Array.isArray(item) || item.length !== 1 || typeof item[0] !== 'string')
      throw new Error('Chaîne de sélecteurs shadow/frame non prise en charge.');
    candidates.push(item[0]);
  }
  for (const selector of candidates) {
    if (/^(xpath\/|pierce\/)/.test(selector)) continue;
    if (selector.startsWith('aria/')) {
      const match = /^aria\/(.+?)(?:\[role="?([a-z]+)"?\])?$/.exec(selector);
      if (!match) continue;
      if (candidates.length > 1)
        warnings.push(
          'Sélecteurs alternatifs du Recorder : seule la cible sémantique retenue sera vérifiée.',
        );
      return match[2]
        ? { strategy: 'role', value: match[2], name: match[1] }
        : { strategy: 'label', value: match[1] };
    }
    if (selector.startsWith('text/')) return { strategy: 'text', value: selector.slice(5) };
    if (/^[a-zA-Z]+\//.test(selector)) continue;
    return { strategy: 'css', value: selector };
  }
  throw new Error('Aucun sélecteur pris en charge (CSS, aria ou text).');
}
function assertEvents(value: unknown, warnings: string[]): NavigationCondition[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('assertedEvents doit être une liste.');
  return value.map((item) => {
    const event = record(item, 'Événement');
    keys(event, ['type', 'url', 'title'], 'Événement');
    if (event.type !== 'navigation') throw new Error('Événement Recorder non pris en charge.');
    if (event.title)
      warnings.push(
        'Le titre du document Recorder est informatif ; seule l’URL est vérifiée. Ajouter une condition visuelle d’arrivée.',
      );
    const url = string(event.url, 'URL attendue');
    if (hasSensitiveNavigationUrl(url))
      throw new Error('URL attendue sensible ou invalide : utiliser la connexion manuelle.');
    return { kind: 'url', value: url };
  });
}
/** Closed JSON conversion. Unsupported actions fail the entire preview, never vanish. */
export function importNavigationJSON(json: string, applicationId: string): NavigationImportResult {
  const input = record(parseNavigationJson(json), 'Import');
  const warnings: string[] = [];
  const now = new Date().toISOString();
  if ('navigationVersion' in input) {
    keys(input, ['navigationVersion', 'journey'], 'Export KerAI');
    if (input.navigationVersion !== 1)
      throw new Error('Version de navigation inconnue ; original conservé.');
    const original = navigationJourneySchema.parse(input.journey);
    const journey = navigationJourneySchema.parse({
      ...original,
      id: randomUUID(),
      applicationId,
      revision: 0,
      hash: undefined,
      parentHash: undefined,
      status: 'draft',
      variantOf: undefined,
      createdAt: now,
      updatedAt: now,
      provenance: { mode: 'import', source: 'KerAI portable v1' },
    });
    parameterize(journey, warnings);
    return { journey, warnings };
  }
  keys(input, ['title', 'steps', 'timeout'], 'Chrome Recorder');
  if (
    input.timeout !== undefined &&
    finite(input.timeout, 'Délai') > NAVIGATION_LIMITS.stepTimeoutMs
  )
    throw new Error('Délai Recorder supérieur à 15 secondes.');
  if (
    !Array.isArray(input.steps) ||
    !input.steps.length ||
    input.steps.length > NAVIGATION_LIMITS.steps
  )
    throw new Error('Importer entre 1 et 80 étapes.');
  const steps: NavigationStep[] = [];
  let pendingKey: string | undefined;
  for (const [index, item] of input.steps.entries()) {
    const raw = record(item, `Étape ${index + 1}`);
    const type = string(raw.type, 'Type');
    const common = ['type', 'timeout', 'assertedEvents'];
    const base = {
      id: `step-${index + 1}`,
      timeoutMs: raw.timeout === undefined ? undefined : finite(raw.timeout, 'Délai'),
      postconditions: assertEvents(raw.assertedEvents, warnings),
      effect: 'unknown' as const,
    };
    let step: NavigationStep;
    if (pendingKey && type !== 'keyUp')
      throw new Error('Une touche maintenue entre plusieurs actions n’est pas prise en charge.');
    switch (type) {
      case 'navigate':
        keys(raw, [...common, 'url'], type);
        step = { ...base, action: 'navigate', url: string(raw.url, 'URL') };
        break;
      case 'setViewport':
        keys(
          raw,
          [
            ...common,
            'width',
            'height',
            'deviceScaleFactor',
            'isMobile',
            'hasTouch',
            'isLandscape',
          ],
          type,
        );
        if (
          raw.isMobile ||
          raw.hasTouch ||
          raw.isLandscape ||
          (raw.deviceScaleFactor !== undefined && raw.deviceScaleFactor !== 1)
        )
          throw new Error(
            'Émulation mobile, tactile, paysage ou densité non standard non prise en charge.',
          );
        step = {
          ...base,
          action: 'viewport',
          width: finite(raw.width, 'Largeur'),
          height: finite(raw.height, 'Hauteur'),
          effect: 'read',
        };
        break;
      case 'click':
        keys(
          raw,
          [...common, 'target', 'selectors', 'offsetX', 'offsetY', 'button', 'duration'],
          type,
        );
        if (
          (raw.button !== undefined && raw.button !== 'primary') ||
          (raw.duration !== undefined && raw.duration !== 0)
        )
          throw new Error('Seul le clic principal simple est pris en charge.');
        if (raw.offsetX !== undefined || raw.offsetY !== undefined)
          warnings.push(
            `Étape ${index + 1} : le clic sera centré sur la cible unique ; les coordonnées Recorder ne sont pas reprises.`,
          );
        step = { ...base, action: 'click', target: target(raw, warnings) };
        break;
      case 'change':
        keys(raw, [...common, 'target', 'selectors', 'value'], type);
        step = {
          ...base,
          action: 'fill',
          target: target(raw, warnings),
          value: {
            literal: typeof raw.value === 'string' ? raw.value : string(raw.value, 'Valeur'),
          },
        };
        break;
      case 'keyDown':
        keys(raw, [...common, 'target', 'key', 'selectors'], type);
        pendingKey = string(raw.key, 'Touche');
        if (!raw.selectors)
          throw new Error(
            'Touche sur focus implicite non prise en charge ; ajouter une cible explicite.',
          );
        step = { ...base, action: 'press', target: target(raw, warnings), key: pendingKey };
        break;
      case 'keyUp':
        keys(raw, [...common, 'target', 'key'], type);
        if (!pendingKey || raw.key !== pendingKey || base.postconditions.length)
          throw new Error(
            'Relâchement de touche non associé ou avec événement non pris en charge.',
          );
        pendingKey = undefined;
        continue;
      case 'scroll':
        keys(raw, [...common, 'target', 'selectors', 'x', 'y'], type);
        if (raw.target !== undefined && raw.target !== 'main')
          throw new Error('Onglet de défilement non pris en charge.');
        step = {
          ...base,
          action: 'scroll',
          x: finite(raw.x, 'X'),
          y: finite(raw.y, 'Y'),
          target: raw.selectors ? target(raw, warnings) : undefined,
          effect: 'read',
        };
        break;
      case 'waitForElement':
        keys(raw, [...common, 'target', 'selectors', 'visible', 'count', 'operator'], type);
        if (
          (raw.count !== undefined && raw.count !== 1) ||
          (raw.operator !== undefined && raw.operator !== '==')
        )
          throw new Error('Seule une cible unique peut être attendue.');
        step = {
          ...base,
          action: 'wait',
          postconditions: [
            ...base.postconditions,
            { kind: raw.visible === false ? 'hidden' : 'visible', target: target(raw, warnings) },
          ],
          effect: 'read',
        };
        break;
      default:
        throw new Error(
          `Étape ${index + 1} : « ${type} » non pris en charge. Aucun JavaScript ou script système ne sera exécuté.`,
        );
    }
    steps.push(navigationStepSchema.parse(step));
  }
  if (pendingKey) throw new Error('Touche jamais relâchée.');
  const journey: NavigationJourney = {
    id: randomUUID(),
    applicationId,
    revision: 0,
    title: string(input.title, 'Titre'),
    intent: string(input.title, 'Intention'),
    tags: [],
    prerequisites: [],
    parameters: [],
    steps,
    arrival: [],
    status: 'draft',
    provenance: { mode: 'import', source: 'Chrome Recorder (sous-ensemble)' },
    createdAt: now,
    updatedAt: now,
  };
  parameterize(journey, warnings);
  warnings.push(
    'Définir les prérequis et au moins une condition d’arrivée avant le rejeu de vérification.',
  );
  return { journey: navigationJourneySchema.parse(journey), warnings: [...new Set(warnings)] };
}
function parameterize(journey: NavigationJourney, warnings: string[]): void {
  for (const [index, step] of journey.steps.entries()) {
    if (step.value && 'literal' in step.value) {
      let name = `value_${index + 1}`;
      while (journey.parameters.some((item) => item.name === name)) name += '_';
      const parameter: NavigationParameter = {
        name,
        label: `Valeur de l’étape ${index + 1}`,
        type: 'string',
        required: true,
        sensitive: true,
      };
      journey.parameters.push(parameter);
      step.value = { parameter: name };
      warnings.push(
        `Étape ${index + 1} : valeur importée remplacée par le paramètre ${name}, à renseigner au rejeu.`,
      );
    }
  }
  for (const parameter of journey.parameters) delete parameter.defaultValue;
}
/** Export excludes host provenance, run refs, captures, defaults and literal form values. */
export function exportNavigationJourney(value: NavigationJourney): string {
  const journey = structuredClone(navigationJourneySchema.parse(value));
  parameterize(journey, []);
  delete journey.hash;
  delete journey.parentHash;
  delete journey.variantOf;
  journey.revision = 0;
  journey.status = 'draft';
  journey.provenance = { mode: 'import', source: 'KerAI portable v1' };
  return JSON.stringify({ navigationVersion: 1, journey }, null, 2);
}
export class ChromeRecorderImport {
  parse(json: string, applicationId: string): NavigationImportResult {
    return importNavigationJSON(json, applicationId);
  }
}
