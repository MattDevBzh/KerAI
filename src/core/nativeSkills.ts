import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { parse, stringify } from 'yaml';
import type { PromptSection, RunInput } from '../shared/types';

/** Stable names are independent of the catalogue's human-facing, editable labels. */
export const nativeSkillName = (id: string) =>
  `studio-${id.toLowerCase().replace(/_/g, '-').slice(0, 48)}-${createHash('sha256').update(id).digest('hex').slice(0, 8)}`;

export function nativeSkill(input: RunInput, section: PromptSection) {
  const skill = input.skills.find((item) => section.id === `skill:${item.id}`);
  if (!skill || section.enabled === false || section.unavailable) return undefined;
  const prefix = `Compétence ${skill.name} :\n`;
  const source = section.content.startsWith(prefix)
    ? section.content.slice(prefix.length)
    : section.content;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source);
  const metadata = match ? parse(match[1], { uniqueKeys: true }) : {};
  const body = match ? match[2] : source;
  if (!body.trim()) throw new Error(`La compétence « ${skill.name} » est vide.`);
  const name = nativeSkillName(skill.id);
  const descriptor = {
    name,
    description: (skill.description || skill.name).slice(0, 1024),
    disableModelInvocation: metadata?.['disable-model-invocation'] === true,
  };
  // In particular, never pass allowed-tools, hooks, agents or provider overrides.
  // Loading instructions does not grant permission to run their commands.
  const content = `---\n${stringify({ name, description: descriptor.description, 'disable-model-invocation': descriptor.disableModelInvocation })}---\n${body.trim()}\n\nRessources du catalogue KerAI : ${skill.path ? dirname(skill.path) : 'aucun dossier associé'}. Les fichiers associés ne sont pas chargés avec cette compétence. Leur consultation et l’exécution de scripts restent soumises aux outils autorisés et aux permissions de cette étape. Les validations humaines restent obligatoires.\n`;
  return { skill, descriptor, content };
}

/** Keep the editable full source in the preview, but send only a catalogue entry initially. */
export function nativePromptSection(input: RunInput, section: PromptSection): string {
  const selected = section.source === 'skill' ? nativeSkill(input, section) : undefined;
  return selected
    ? selected.descriptor.disableModelInvocation
      ? `Compétence sélectionnée explicitement : ${selected.skill.name} (${selected.descriptor.name}). ${selected.descriptor.description}\nCette compétence interdit l’invocation automatique : Copilot doit la précharger pour cet agent à partir de la sélection humaine. Le journal de chargement confirme le contenu reçu.`
      : `Compétence disponible à la demande : ${selected.skill.name} (${selected.descriptor.name}). ${selected.descriptor.description}\nUtilise l’outil skill pour charger ses instructions si nécessaire ; sa présence au catalogue ne signifie pas qu’elle est chargée.`
    : section.content;
}
