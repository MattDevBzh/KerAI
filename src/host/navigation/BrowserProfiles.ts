import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { lstat, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

export function windowsBrowserProfileRoot(): string | undefined {
  if (process.platform !== 'win32') return undefined;
  const local = process.env.LOCALAPPDATA;
  return path.join(
    local && path.isAbsolute(local) ? local : path.join(homedir(), 'AppData', 'Local'),
    'KerAI',
    'browser-profiles',
  );
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    if (!(await lstat(directory)).isDirectory())
      throw new Error(
        'Le dossier du profil navigateur doit être un répertoire, sans lien symbolique.',
      );
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Keep Chromium below Windows' path constraints without mixing project or application profiles. */
export async function prepareBrowserProfile(
  storageRoot: string,
  identity: [applicationId: string, origin: string, role: string],
  profileRoot?: string,
): Promise<string> {
  const legacy = path.join(
    storageRoot,
    'browser-profiles',
    createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
  );
  if (!profileRoot) {
    await mkdir(legacy, { recursive: true, mode: 0o700 });
    return legacy;
  }
  if (!path.isAbsolute(profileRoot))
    throw new Error('Le dossier local des profils navigateur doit être absolu.');
  const storageKey =
    process.platform === 'win32'
      ? path.resolve(storageRoot).toLowerCase()
      : path.resolve(storageRoot);
  const destination = path.join(
    profileRoot,
    createHash('sha256')
      .update(JSON.stringify([storageKey, ...identity]))
      .digest('hex'),
  );
  await mkdir(profileRoot, { recursive: true, mode: 0o700 });
  await directoryExists(profileRoot);
  if (await directoryExists(destination)) return destination;
  if (await directoryExists(legacy)) {
    try {
      // Atomic same-volume migration retains cookies and refuses an in-use Windows profile.
      await rename(legacy, destination);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === 'ENOENT' &&
        (await directoryExists(destination))
      )
        return destination;
      if ((error as NodeJS.ErrnoException).code === 'EXDEV')
        throw new Error(
          'Le profil navigateur existant est sur un autre disque ; déplacement automatique impossible. Le profil original est conservé.',
        );
      throw new Error(
        'Impossible de déplacer le profil navigateur vers son dossier local. Fermez les autres fenêtres KerAI utilisant cette application puis réessayez. Le profil original est conservé.',
      );
    }
  } else {
    await mkdir(destination, { recursive: true, mode: 0o700 });
  }
  return destination;
}
