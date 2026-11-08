import type { Feature } from '../shared/types';
import type { DevOpsState } from '../shared/devops';
import { allFeatures } from '../shared/subplans';
import { prepareSessionPullRequest } from '../shared/deliveryDraft';
import { redact } from './process';
import { prHash } from './PrAdministrationDiff';
import {
  PR_CONTEXT_CHUNK,
  PR_CONTEXT_MAX_ITEMS,
  PR_CONTEXT_MAX_SELECTED,
  type PrSessionContextCatalog,
  type PrSessionContextItem,
  type PrSessionContextKind,
  type PrSessionContextSelection,
  type PrSessionContextSnapshot,
} from '../shared/prSessionContext';

/** Retained session text only: no filesystem reads, tool outputs or private reasoning. */
export function prSessionContext(feature: Feature, devops: DevOpsState): PrSessionContextCatalog {
  const items: PrSessionContextItem[] = [],
    warnings = new Set<string>();
  let characters = 0;
  function add(
    key: string,
    kind: PrSessionContextKind,
    label: string,
    origin: string,
    text?: string,
  ) {
    if (!text?.trim()) return;
    const safe = redact(text),
      chunks: string[] = [];
    for (let offset = 0; offset < safe.length; ) {
      let end = Math.min(offset + PR_CONTEXT_CHUNK, safe.length);
      if (end < safe.length && /[\uD800-\uDBFF]/.test(safe[end - 1])) end--;
      chunks.push(safe.slice(offset, end));
      offset = end;
    }
    for (const [index, content] of chunks.entries()) {
      const part = index + 1,
        parts = chunks.length;
      if (items.length >= 500 || characters + content.length > 2_000_000) {
        warnings.add(
          'Catalogue partiel : limite de 500 éléments ou 2 millions de caractères atteinte. Les autres textes restent consultables dans la session.',
        );
        return;
      }
      const item = {
        id: prHash(`${feature.id}:${key}:${part}`),
        kind,
        label: redact(`${label}${parts > 1 ? ` · partie ${part}/${parts}` : ''}`).slice(0, 600),
        origin: redact(origin).slice(0, 1000),
        content,
      };
      items.push({ ...item, digest: prHash(JSON.stringify(item)) });
      characters += content.length;
    }
  }
  function textWithDocuments(
    key: string,
    kind: PrSessionContextKind,
    label: string,
    origin: string,
    text?: string,
  ) {
    if (!text) return;
    // Recognize the importer envelope only; ordinary Markdown remains untouched.
    const pattern =
      /\n\n---\nDocument source importé : ([^\r\n]+)\nEmpreinte SHA-256 du fichier original : ([a-f0-9]{64})\n[\s\S]*?\n\nFin du document source : \1\n/g;
    let offset = 0,
      index = 0;
    for (const match of text.matchAll(pattern)) {
      add(`${key}:text:${index}`, kind, label, origin, text.slice(offset, match.index));
      add(`${key}:document:${index}`, 'document', match[1], origin, match[0].trim());
      offset = match.index! + match[0].length;
      index++;
    }
    add(`${key}:text:${index}`, kind, label, origin, text.slice(offset));
  }
  for (const current of allFeatures([feature])) {
    const prefix = current.id,
      origin = current.id === feature.id ? feature.title : `${feature.title} › ${current.title}`;
    textWithDocuments(
      `${prefix}:need`,
      'need',
      'Besoin de la session',
      origin,
      current.description,
    );
    for (const instruction of current.instructions ?? [])
      if (instruction.active)
        add(
          `${prefix}:instruction:${instruction.id}`,
          'instruction',
          'Consigne épinglée',
          `${origin} · révision ${instruction.revision}`,
          instruction.text,
        );
    if (current.images?.length)
      warnings.add(
        'Les images et les fichiers binaires ne sont pas transmis ici. Les documents importés sous forme de texte sont sélectionnables.',
      );
    for (const step of current.steps) {
      const stepOrigin = `${origin} › ${step.name}`;
      textWithDocuments(
        `${prefix}:${step.id}:initial`,
        'launch',
        'Contexte prévu pour l’étape',
        stepOrigin,
        step.initialContext,
      );
      for (const [attemptIndex, attempt] of Array.from(step.attempts.entries()).reverse()) {
        const key = `${prefix}:${step.id}:${attempt.id}`,
          at = `${stepOrigin} · tentative ${attemptIndex + 1} · ${attempt.status} · ${attempt.startedAt}`;
        add(
          `${key}:artifact`,
          'report',
          attempt.artifact?.name ?? 'Compte rendu',
          at,
          attempt.artifact?.content,
        );
        for (const version of [...(attempt.artifactVersions ?? [])].reverse())
          if (version.content !== attempt.artifact?.content)
            add(
              `${key}:artifact-version:${version.revision}`,
              'report',
              `Compte rendu historique · révision ${version.revision}`,
              `${at} · ${version.author} · ${version.at}`,
              version.content,
            );
        for (const memory of attempt.memorySnapshot ?? [])
          add(
            `${key}:memory:${memory.id}`,
            'launch',
            `Mémoire transmise · ${memory.title}`,
            at,
            memory.content,
          );
        textWithDocuments(
          `${key}:launch`,
          'launch',
          'Contexte transmis au lancement',
          at,
          attempt.launch?.initialContext,
        );
        add(`${key}:feedback`, 'decision', 'Retour humain', at, attempt.feedback);
        for (const question of attempt.questions)
          if (attempt.answers[question.id])
            add(
              `${key}:answer:${question.id}`,
              'decision',
              'Question et réponse',
              at,
              `${question.text}\n\nRéponse enregistrée : ${attempt.answers[question.id]}`,
            );
        for (const [id, block] of Object.entries(attempt.launch?.contextBlocks ?? {}))
          if (block.enabled !== false && block.content)
            add(
              `${key}:block:${id}`,
              'launch',
              `Extrait ajusté au lancement · ${id}`,
              at,
              block.content,
            );
        for (const load of attempt.nativeContextLoads ?? []) {
          add(
            `${key}:load:${load.id}`,
            'instruction',
            load.name,
            `${at} · texte chargé par l’agent${load.truncated ? ' · extrait partiel' : ''}`,
            load.content,
          );
          if (load.truncated)
            warnings.add(
              'Certaines consignes chargées par l’agent n’ont été conservées qu’en partie ; elles sont signalées comme extraits partiels.',
            );
        }
        for (const message of [...(attempt.pair?.messages ?? [])].reverse()) {
          if (
            message.kind === 'reasoning' ||
            message.role === 'system' ||
            message.status === 'streaming' ||
            message.delivery === 'pending' ||
            message.delivery === 'skipped'
          )
            continue;
          add(
            `${key}:message:${message.id}`,
            'exchange',
            message.role === 'user' ? 'Message humain' : 'Réponse de l’agent',
            `${at} · ${message.at} · ${message.status}${message.delivery === 'uncertain' ? ' · réception incertaine' : ''}`,
            message.content,
          );
          if (message.images?.length)
            warnings.add(
              'Les images jointes aux échanges sont exclues ; seul leur texte est sélectionnable.',
            );
        }
      }
    }
  }
  return {
    featureId: feature.id,
    title: redact(feature.title),
    summary: redact(prepareSessionPullRequest(feature, devops).description),
    items,
    warnings: [...warnings],
  };
}
export function selectPrSessionContext(
  catalog: PrSessionContextCatalog,
  selections: PrSessionContextSelection[] = [],
): PrSessionContextSnapshot {
  if (
    selections.length > PR_CONTEXT_MAX_ITEMS ||
    new Set(selections.map((item) => item.id)).size !== selections.length
  )
    throw new Error('Sélection de contexte invalide : au plus 40 éléments distincts.');
  const sources = selections.map((selection) => {
    const item = catalog.items.find((item) => item.id === selection.id);
    if (!item || item.digest !== selection.digest)
      throw new Error(
        'Une source de contexte a changé ou n’est plus disponible. Actualise les sources de la session puis relis ta sélection.',
      );
    return structuredClone(item);
  });
  if (sources.reduce((n, item) => n + item.content.length, 0) > PR_CONTEXT_MAX_SELECTED)
    throw new Error(
      'Le contexte sélectionné dépasse 80 000 caractères. Retire des éléments ou choisis moins de parties.',
    );
  return {
    summary: catalog.summary,
    sources,
    warnings: catalog.warnings,
    fingerprint: prHash(
      JSON.stringify({ featureId: catalog.featureId, summary: catalog.summary, sources }),
    ),
  };
}
