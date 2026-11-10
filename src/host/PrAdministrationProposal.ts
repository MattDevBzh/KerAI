import { prAdminProposalSchema } from '../core/prAdministrationSchemas';
import type {
  PrAdminModelProposal,
  PrAdministrationSettings,
  PrDiffBlock,
} from '../shared/prAdministration';
import { missingPrRuleReferences } from '../shared/prRuleReferences';

export class PrProposalFormatError extends Error {}

/** Resolve short model references only against this frozen, host-verified diff. */
export function resolvePrAdministrationProposal(
  proposal: PrAdminModelProposal,
  blocks: PrDiffBlock[],
  settings: PrAdministrationSettings,
  sources: string[],
): PrAdminModelProposal {
  const issues: string[] = [],
    keys = new Set<string>();
  for (const field of ['title', 'description'] as const)
    if (proposal[field] !== undefined && !settings[field])
      issues.push(`${field} : action désactivée pour cette mission`);
  if (proposal.comments.length && !settings.comments)
    issues.push('comments : commentaires désactivés pour cette mission');
  const comments = proposal.comments.map((comment, index) => {
    const ref = comment.blockId.trim();
    const alias = /^B([1-9]\d*|0+[1-9]\d*)$/i.exec(ref);
    const block =
      blocks.find((candidate) => candidate.id === ref) ??
      (alias ? blocks[Number(alias[1]) - 1] : undefined);
    if (!block)
      issues.push(
        `comments.${index}.blockId : bloc absent du diff transmis ; choisir exclusivement un identifiant de la liste blocks. Une plage du rapport ne constitue pas un identifiant de bloc.`,
      );
    const missing = missingPrRuleReferences(comment.rule, sources);
    if (missing.length)
      issues.push(
        `comments.${index}.rule : référence absente des textes transmis ; vérifier les constats du contexte fourni et sélectionner toutes les parties du bilan si nécessaire`,
      );
    if (block) {
      const key = `${block.stableKey}:${comment.rule.toLocaleLowerCase()}`;
      if (keys.has(key))
        issues.push(
          `comments.${index} : doublon pour le même bloc et la même règle ; réunir les explications de cette annotation`,
        );
      keys.add(key);
    }
    return { ...comment, blockId: block?.id ?? comment.blockId };
  });
  if (issues.length) throw new PrProposalFormatError(issues.slice(0, 6).join(' ; '));
  return { ...proposal, comments };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Normalize absent optional text, never discard actions or invent their content. */
export function parsePrAdministrationProposal(content: string) {
  let value: unknown;
  try {
    value = JSON.parse(
      content
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, ''),
    );
  } catch {
    throw new PrProposalFormatError('Réponse JSON invalide ou tronquée.');
  }
  if (record(value)) {
    for (const key of ['title', 'description']) {
      if (value[key] === null || (typeof value[key] === 'string' && !value[key].trim()))
        delete value[key];
    }
    if (value.comments == null) value.comments = [];
    if (Array.isArray(value.comments)) {
      for (const comment of value.comments) {
        if (!record(comment)) continue;
        if (comment.rule == null) comment.rule = '';
        if (comment.reference == null) comment.reference = '';
      }
    }
  }
  const result = prAdminProposalSchema.safeParse(value);
  if (result.success) return result.data;
  // Report structure only: never echo model text, unknown keys or secrets in diagnostics.
  const fields = new Set([
    'summary',
    'title',
    'description',
    'comments',
    'blockId',
    'rule',
    'explanation',
    'reference',
  ]);
  const details = result.error.issues.slice(0, 6).map((issue) => {
    const field =
      issue.path
        .map((part) => (typeof part === 'number' || fields.has(String(part)) ? String(part) : '?'))
        .join('.') || 'réponse';
    const reason =
      issue.code === 'too_big'
        ? `limite de ${issue.maximum} dépassée`
        : issue.code === 'too_small'
          ? 'valeur vide ou trop courte'
          : issue.code === 'unrecognized_keys'
            ? 'champ supplémentaire non autorisé'
            : 'champ manquant ou type incorrect';
    return `${field} : ${reason}`;
  });
  throw new PrProposalFormatError(details.join(' ; '));
}
