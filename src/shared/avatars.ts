import catalog from './avatar-catalog.json';

export const avatarOptions = catalog.avatars;
export const avatarIds = avatarOptions.map(({ id }) => id);
export const legacyAvatarAliases: Readonly<Record<string, string>> = catalog.legacyAliases;
export const avatarDefaults: Readonly<Record<string, string>> = catalog.defaults;
export const acceptedAvatarIds = [...avatarIds, ...Object.keys(legacyAvatarAliases)] as [
  string,
  ...string[],
];
const known = new Set(avatarIds);

/** Resolve legacy profiles at display time; never rewrite personal files on load. */
export function resolveAvatar(avatar?: string, agentId?: string): string {
  if (avatar && known.has(avatar)) return avatar;
  if (avatar && Object.hasOwn(legacyAvatarAliases, avatar)) return legacyAvatarAliases[avatar];
  if (agentId && Object.hasOwn(avatarDefaults, agentId)) return avatarDefaults[agentId];
  return 'backend-developer';
}
