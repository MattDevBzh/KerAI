import { runProcess, type ProcessResult } from './process';

/** Read Git without optional index writes, inherited repository redirects or external filters. */
export async function gitRead(
  root: string,
  args: string[],
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxBytes?: number;
    rawOutput?: boolean;
  } = {},
): Promise<ProcessResult> {
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.keys(process.env)
      .filter((key) => key.startsWith('GIT_'))
      .map((key) => [key, undefined]),
  );
  Object.assign(env, {
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
  });
  const flags = [
    '--no-pager',
    '--no-optional-locks',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'submodule.recurse=false',
  ];
  const filters = await runProcess(
    'git',
    [
      ...flags,
      'config',
      '--null',
      '--name-only',
      '--get-regexp',
      '^filter\\..*\\.(smudge|clean|process|required)$',
    ],
    root,
    {
      ...options,
      env,
      rawOutput: true,
      maxBytes: 256000,
    },
  );
  if ((filters.code !== 0 && filters.code !== 1) || filters.truncated)
    throw new Error('Impossible de vérifier les filtres Git.');
  const names = new Set(
    filters.stdout
      .split('\0')
      .filter(Boolean)
      .map((key) => key.replace(/\.(smudge|clean|process|required)$/, '')),
  );
  for (const name of names)
    for (const setting of ['smudge=', 'clean=', 'process=', 'required=false'])
      flags.push('-c', `${name}.${setting}`);
  return runProcess('git', [...flags, ...args], root, { ...options, env });
}
