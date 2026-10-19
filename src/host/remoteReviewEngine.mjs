#!/usr/bin/env node
// Relecture distante 1.0.0 — Node.js >= 18, Git >= 2.31. No npm dependencies.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isSensitivePath } from './PolicyEngine';

const MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_ROOT = path.join(os.homedir(), '.copilot', 'remote-review');
const decode = (buffer) => new TextDecoder('utf-8', { fatal: true }).decode(buffer);
const fail = (message) => {
  throw new Error(message);
};
const hash = (text) => createHash('sha256').update(text).digest('hex');
const cleanError = (text) =>
  text
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1[secret]@')
    .replace(/(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+/g, '[secret]');

function git(args, { cwd, dir, root = DEFAULT_ROOT, accepted = [0] } = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' };
  // Do not let the caller's current repository redirect our commands.
  for (const key of Object.keys(env)) {
    if (
      /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG.*|EXTERNAL_DIFF|DIFF_OPTS|SHALLOW_FILE|REPLACE_REF_BASE)$/.test(
        key,
      )
    )
      delete env[key];
  }
  const command = [
    '--no-pager',
    '--no-replace-objects',
    '-c',
    `core.hooksPath=${path.join(root, 'disabled-hooks')}`,
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.quotePath=false',
    '-c',
    'gc.auto=0',
    '-c',
    'maintenance.auto=false',
    '-c',
    'protocol.ext.allow=never',
    '-c',
    'protocol.file.allow=always',
    ...(dir ? [`--git-dir=${dir}`] : []),
    ...args,
  ];
  try {
    return execFileSync('git', command, {
      cwd: cwd ?? root,
      env,
      timeout: 60000,
      maxBuffer: MAX_BYTES,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (accepted.includes(error.status)) return error.stdout ?? Buffer.alloc(0);
    if (error.code === 'ENOENT')
      fail('Git est introuvable dans le PATH. Installer Git puis rouvrir VS Code.');
    if (error.code === 'ENOBUFS')
      fail(
        'Sortie Git supérieure à 32 Mio : réduire la recherche ou cibler un fichier. Aucun résultat complet disponible.',
      );
    if (error.code === 'ETIMEDOUT')
      fail(
        'Git a dépassé 60 secondes. Vérifier la connexion et l’authentification Git, puis réessayer.',
      );
    fail(cleanError(String(error.stderr || error.message)).slice(0, 4000));
  }
}

function repositoryUrl(value, allowLocal = false) {
  if (!value || /[\r\n\0]/.test(value) || value.startsWith('-'))
    fail('URL Git manquante ou invalide.');
  if (allowLocal && path.isAbsolute(value)) return value;
  if (/^[\w.-]+@[\w.-]+:[^\s]+$/.test(value)) return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('Utiliser une URL Git HTTPS ou SSH, pas un dossier local.');
  }
  if (!['https:', 'ssh:'].includes(url.protocol))
    fail('Seules les URL Git HTTPS et SSH sont acceptées.');
  if (url.password || (url.protocol === 'https:' && url.username) || url.search || url.hash) {
    fail(
      'Retirer les identifiants, tokens et paramètres de l’URL. Utiliser le gestionnaire d’identifiants Git.',
    );
  }
  return value.replace(/\/$/, '');
}

function branch(value, remote = 'origin', root = DEFAULT_ROOT) {
  if (!value) fail('Préciser explicitement la branche source et la branche de base.');
  let name = value.replace(/^refs\/heads\//, '');
  if (name.startsWith(`refs/remotes/${remote}/`))
    name = name.slice(`refs/remotes/${remote}/`.length);
  else if (name.startsWith(`${remote}/`)) name = name.slice(remote.length + 1);
  if (name.startsWith('-') || /[\r\n\0]/.test(name)) fail('Nom de branche invalide.');
  git(['check-ref-format', `refs/heads/${name}`], { root });
  return name;
}

function changeList(buffer) {
  const tokens = decode(buffer).split('\0');
  const changes = [];
  for (let i = 0; i < tokens.length - 1; ) {
    const status = tokens[i++];
    if (/^[RC]/.test(status)) {
      const oldPath = tokens[i++],
        newPath = tokens[i++];
      changes.push({ status, path: newPath, oldPath });
    } else changes.push({ status, path: tokens[i++] });
  }
  return changes;
}

export function prepare(options, { root = DEFAULT_ROOT, allowLocal = false } = {}) {
  fs.mkdirSync(root, { recursive: true });
  let url = options.repo;
  if (!url && options.local) {
    const remote = options.remote || 'origin';
    if (!/^[A-Za-z0-9_.-]+$/.test(remote) || remote.startsWith('-'))
      fail('Nom de remote invalide.');
    // Only read the URL. No fetch, checkout, stash or write in the user's repository.
    url = decode(git(['remote', 'get-url', remote], { cwd: options.local, root })).trim();
  }
  url = repositoryUrl(url, allowLocal);
  const source = branch(options.source, options.remote, root),
    base = branch(options.base, options.remote, root);
  const key = hash(url),
    cache = path.join(root, 'cache', `${key}.git`);
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  const lock = `${cache}.review-lock`;
  let handle;
  try {
    handle = fs.openSync(lock, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST')
      fail(`Ce cache est occupé. Attendre la fin de la préparation. Verrou : ${lock}`);
    throw error;
  }
  try {
    fs.writeFileSync(
      handle,
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        lease: options.lease,
      }),
    );
    if (!fs.existsSync(cache)) git(['init', '--bare', '--template=', cache], { root });
    if (fs.lstatSync(cache).isSymbolicLink())
      fail('Le cache Git ne doit pas être un lien symbolique.');
    if (decode(git(['rev-parse', '--is-bare-repository'], { dir: cache, root })).trim() !== 'true')
      fail('Le cache existant n’est pas un dépôt bare.');
    const id = randomUUID();
    const prefix = `refs/remote-reviews/${id}`;
    git(
      [
        'fetch',
        '--atomic',
        '--no-tags',
        '--no-write-fetch-head',
        '--no-recurse-submodules',
        url,
        `+refs/heads/${base}:${prefix}/base`,
        `+refs/heads/${source}:${prefix}/source`,
      ],
      { dir: cache, root },
    );
    const rev = (ref) =>
      decode(git(['rev-parse', '--verify', `${ref}^{commit}`], { dir: cache, root })).trim();
    const baseSha = rev(`${prefix}/base`),
      sourceSha = rev(`${prefix}/source`);
    const mergeBases = decode(
      git(['merge-base', '--all', baseSha, sourceSha], { dir: cache, root }),
    )
      .trim()
      .split('\n');
    if (mergeBases.length !== 1 || !/^[a-f0-9]{40,64}$/.test(mergeBases[0]))
      fail('Ancêtre commun unique introuvable. Comparaison non préparée.');
    const mergeBaseSha = mergeBases[0];
    const changes = changeList(
      git(
        [
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--name-status',
          '-z',
          '-M',
          mergeBaseSha,
          sourceSha,
          '--',
        ],
        { dir: cache, root },
      ),
    );
    const reportDir = path.join(root, 'reports', id);
    fs.mkdirSync(reportDir, { recursive: true });
    const snapshot = {
      schemaVersion: 1,
      id,
      repository: url,
      cacheKey: key,
      fetchedAt: new Date().toISOString(),
      source,
      base,
      sourceSha,
      baseSha,
      mergeBaseSha,
      comparison: 'merge-base -> source',
      changes,
      reportPath: path.join(reportDir, 'RELECTURE_DISTANTE.md'),
    };
    fs.writeFileSync(
      path.join(reportDir, 'snapshot.json'),
      JSON.stringify(snapshot, null, 2) + '\n',
      { flag: 'wx' },
    );
    fs.writeFileSync(
      snapshot.reportPath,
      '# Relecture distante\n\n**Relecture non commencée.**\n',
      { flag: 'wx' },
    );
    return summary(snapshot, root);
  } finally {
    fs.closeSync(handle);
    fs.unlinkSync(lock);
  }
}

function load(id, root) {
  if (!/^[a-f0-9-]{36}$/.test(id || ''))
    fail('Identifiant de session invalide : utiliser celui retourné par prepare.');
  const snapshot = JSON.parse(
    fs.readFileSync(path.join(root, 'reports', id, 'snapshot.json'), 'utf8'),
  );
  if (snapshot.id !== id || !/^[a-f0-9]{64}$/.test(snapshot.cacheKey)) fail('Snapshot invalide.');
  for (const key of ['sourceSha', 'baseSha', 'mergeBaseSha'])
    if (!/^[a-f0-9]{40,64}$/.test(snapshot[key])) fail('SHA invalide.');
  return snapshot;
}
function summary(snapshot, root) {
  const { changes, ...info } = snapshot;
  return {
    ...info,
    changedFileCount: changes.length,
    snapshotPath: path.join(root, 'reports', snapshot.id, 'snapshot.json'),
    next: changes.length
      ? `files --session ${snapshot.id}`
      : 'Aucun changement depuis l’ancêtre commun.',
  };
}
function integer(value, fallback, min, max) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max)
    fail(`Nombre attendu entre ${min} et ${max}.`);
  return number;
}
function filePath(value) {
  if (!value || /[\r\n\0]/.test(value) || value.startsWith('/') || value.split('/').includes('..'))
    fail('Utiliser un chemin Git relatif au dépôt, avec des /, sans ..');
  if (value.includes('\\') || /^[a-z]:/i.test(value) || isSensitivePath(value))
    fail('Chemin hors périmètre ou sensible : accès refusé.');
  return value;
}
function textPage(text, start = 1, count = 120) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const page = [],
    omittedLongLines = [];
  let characters = 0,
    cursor = Math.min(start - 1, lines.length);
  for (; cursor < lines.length && page.length < count; cursor++) {
    const line = lines[cursor].replace(/\r$/, '');
    if (characters && characters + line.length > 24000) break;
    if (line.length > 24000) {
      omittedLongLines.push(cursor + 1);
      page.push({
        line: cursor + 1,
        text: '[Ligne > 24 000 caractères non affichée ; couverture partielle.]',
      });
    } else {
      page.push({ line: cursor + 1, text: line });
      characters += line.length;
    }
  }
  return {
    totalLines: lines.length,
    start,
    nextStart: cursor < lines.length ? cursor + 1 : null,
    omittedLongLines,
    lines: page,
  };
}

export function inspect(command, options, { root = DEFAULT_ROOT, allowLocal = false } = {}) {
  if (command === 'doctor')
    return {
      node: process.version,
      git: decode(git(['--version'])).trim(),
      personalDirectory: root,
    };
  const snapshot = load(options.session, root);
  const allChanges = snapshot.changes;
  snapshot.changes = allChanges.filter(
    (item) => !isSensitivePath(item.path) && (!item.oldPath || !isSensitivePath(item.oldPath)),
  );
  const excludedCount = allChanges.length - snapshot.changes.length;
  if (command === 'info') return summary(snapshot, root);
  const dir = path.join(root, 'cache', `${snapshot.cacheKey}.git`),
    ctx = { dir, root };
  const side = options.side || 'source';
  const sha = {
    source: snapshot.sourceSha,
    base: snapshot.baseSha,
    'merge-base': snapshot.mergeBaseSha,
  }[side];
  if (!sha) fail('side doit être source, base ou merge-base.');
  const start = integer(options.start, 1, 1, 100000000),
    count = integer(options.count, 120, 1, 200);
  if (command === 'files') {
    const offset = integer(options.offset, 0, 0, 100000000),
      limit = integer(options.limit, 100, 1, 200);
    return {
      excludedCount,
      total: snapshot.changes.length,
      offset,
      files: snapshot.changes.slice(offset, offset + limit),
      nextOffset: offset + limit < snapshot.changes.length ? offset + limit : null,
    };
  }
  if (command === 'list') {
    const args = options.path ? [`:(literal)${filePath(options.path)}`] : [];
    const rows = decode(git(['ls-tree', '-r', '-z', '--full-tree', sha, '--', ...args], ctx))
      .split('\0')
      .filter(Boolean)
      .filter((row) => !isSensitivePath(row.slice(row.indexOf('\t') + 1)));
    const offset = integer(options.offset, 0, 0, 100000000),
      limit = integer(options.limit, 100, 1, 200);
    return {
      sha,
      total: rows.length,
      entries: rows.slice(offset, offset + limit).map((row) => {
        const at = row.indexOf('\t');
        const [mode, type, oid] = row.slice(0, at).split(' ');
        return { mode, type, oid, path: row.slice(at + 1) };
      }),
      nextOffset: offset + limit < rows.length ? offset + limit : null,
    };
  }
  if (command === 'read') {
    const name = filePath(options.path),
      object = `${sha}:${name}`;
    const size = Number(decode(git(['cat-file', '-s', object], ctx)).trim());
    if (size > MAX_BYTES) fail('Fichier > 32 Mio non lu. Signaler cette limite dans le rapport.');
    const data = git(['cat-file', 'blob', object], ctx);
    let text;
    if (data[0] === 0xff && data[1] === 0xfe) text = data.subarray(2).toString('utf16le');
    else {
      if (data.includes(0)) fail('Fichier binaire non relu.');
      try {
        text = decode(data);
      } catch {
        fail('Encodage non UTF-8/UTF-16LE : fichier non relu.');
      }
    }
    return { path: name, side, sha, ...textPage(text, start, count) };
  }
  if (command === 'diff') {
    const name = filePath(options.path);
    const change = snapshot.changes.find((item) => item.path === name || item.oldPath === name);
    if (!change) fail('Ce chemin ne fait pas partie des changements de la session.');
    const names = [...new Set([change.path, change.oldPath].filter(Boolean))].map(
      (p) => `:(literal)${p}`,
    );
    const text = decode(
      git(
        [
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--no-color',
          '--unified=5',
          '-M',
          snapshot.mergeBaseSha,
          snapshot.sourceSha,
          '--',
          ...names,
        ],
        ctx,
      ),
    );
    return {
      path: name,
      beforeSha: snapshot.mergeBaseSha,
      afterSha: snapshot.sourceSha,
      note: 'Les numéros de page sont ceux du diff, pas ceux du fichier. Utiliser les en-têtes @@ et read pour les constats.',
      ...textPage(text, start, count),
    };
  }
  if (command === 'search') {
    if (!options.query || /[\r\n\0]/.test(options.query))
      fail('Préciser une recherche littérale sur une ligne.');
    // A single validated file avoids broad grep leaking excluded paths. Discover paths with list first.
    if (!options.path) fail('Cibler un fichier avec path ; utiliser list pour le découvrir.');
    const name = filePath(options.path);
    if (decode(git(['cat-file', '-t', `${sha}:${name}`], ctx)).trim() !== 'blob')
      fail('La recherche nécessite un fichier, pas un dossier.');
    const paths = [`:(literal)${name}`];
    const text = decode(
      git(['grep', '-n', '-I', '-F', '--no-color', '-e', options.query, sha, '--', ...paths], {
        ...ctx,
        accepted: [0, 1],
      }),
    );
    return { sha, query: options.query, ...textPage(text, start, count) };
  }
  if (command === 'verify') {
    const text = decode(
      git(
        [
          'ls-remote',
          '--heads',
          repositoryUrl(snapshot.repository, allowLocal),
          `refs/heads/${snapshot.base}`,
          `refs/heads/${snapshot.source}`,
        ],
        ctx,
      ),
    );
    const refs = new Map(
      text
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [oid, ref] = line.split('\t');
          return [ref, oid];
        }),
    );
    return {
      sourceSha: snapshot.sourceSha,
      baseSha: snapshot.baseSha,
      currentSourceSha: refs.get(`refs/heads/${snapshot.source}`) ?? null,
      currentBaseSha: refs.get(`refs/heads/${snapshot.base}`) ?? null,
      moved:
        refs.get(`refs/heads/${snapshot.source}`) !== snapshot.sourceSha ||
        refs.get(`refs/heads/${snapshot.base}`) !== snapshot.baseSha,
    };
  }
  fail('Commande inconnue. Utiliser --help.');
}
