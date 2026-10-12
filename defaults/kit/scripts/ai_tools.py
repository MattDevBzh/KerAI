#!/usr/bin/env python3
"""Local deterministic helpers. Python 3.10+, no package and no AI call."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid
import xml.etree.ElementTree as ET


def git(root, *args):
    env = dict(os.environ, GIT_PAGER='cat', GIT_OPTIONAL_LOCKS='0')
    result = subprocess.run(['git', '-c', 'core.quotePath=false', *args],
                            cwd=root, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise ValueError(result.stderr.decode('utf-8', 'replace').strip())
    return result.stdout


def repo_root():
    return Path(git(Path.cwd(), 'rev-parse', '--show-toplevel').decode().strip())


def stamp():
    return dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]


def within(root, value):
    path = Path(value)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('Utiliser un chemin relatif au dépôt, sans ..')
    resolved = (root / path).resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError('Chemin hors dépôt')
    return resolved


def is_sensitive(name):
    p = Path(name)
    return (p.name.lower().startswith('.env') or
            p.suffix.lower() in {'.pem', '.pfx', '.p12', '.key', '.kdbx'} or
            p.name.lower() in {'id_rsa', 'id_ed25519', 'credentials', 'secrets.json'} or
            '.git' in p.parts)


def snapshot(root, args):
    scopes = []
    for scope in args.path:
        relative = within(root, scope).relative_to(root).as_posix()
        if relative == '.' or relative.startswith('.ai'):
            raise ValueError('Choisir un périmètre explicite tel que src/Module ou tests/Module')
        scopes.append(':(literal)' + relative)
    head = git(root, 'rev-parse', 'HEAD').decode().strip()
    base = git(root, 'rev-parse', '--verify', '--end-of-options', args.base + '^{commit}').decode().strip()
    if args.merge_base:
        base = git(root, 'merge-base', base, head).decode().strip()
    tracked = git(root, 'diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', base, '--', *scopes)
    untracked = git(root, 'ls-files', '--others', '--exclude-standard', '-z', '--', *scopes)
    old = {x.decode('utf-8', 'surrogateescape') for x in tracked.split(b'\0') if x}
    new = {x.decode('utf-8', 'surrogateescape') for x in untracked.split(b'\0') if x}
    entries, bodies = [], []
    remaining = args.max_chars
    for name in sorted(old | new):
        p = root / name
        reason = ''
        if is_sensitive(name):
            reason = 'nom potentiellement sensible'
        elif p.is_symlink() or not p.resolve().is_relative_to(root.resolve()):
            reason = 'lien symbolique ou chemin extérieur'
        elif p.exists() and not p.is_file():
            reason = 'répertoire ou sous-module : revue spécifique requise'
        if reason:
            entries.append((name, 'EXCLU : ' + reason))
            continue
        if name in new:
            if p.stat().st_size > 250_000:
                entries.append((name, 'EXCLU : fichier volumineux'))
                continue
            raw = p.read_bytes()
            if b'\0' in raw:
                entries.append((name, 'EXCLU : binaire'))
                continue
            try:
                content = raw.decode('utf-8')
            except UnicodeDecodeError:
                entries.append((name, 'EXCLU : encodage non UTF-8'))
                continue
            body = 'NOUVEAU FICHIER\n' + content
        else:
            raw = git(root, 'diff', '--no-ext-diff', '--no-textconv', '--no-color',
                      '--unified=3', base, '--', ':(literal)' + name)
            body = raw.decode('utf-8', 'replace')
            if 'Binary files ' in body:
                entries.append((name, 'EXCLU : diff binaire'))
                continue
        take = max(0, min(len(body), 20_000, remaining))
        truncated = take < len(body)
        entries.append((name, 'TRONQUÉ' if truncated else 'inclus'))
        if take:
            bodies.append('\n## ' + json.dumps(name, ensure_ascii=False) + '\n\n' +
                          body[:take] + ('\n[TRONQUÉ : ouvrir le fichier pour compléter]\n' if truncated else '\n'))
        remaining -= take
    incomplete = any(status != 'inclus' for _, status in entries)
    lines = ['# Paquet local de relecture', '', 'HEAD : ' + head, 'Base : ' + base,
             'Date UTC : ' + dt.datetime.now(dt.timezone.utc).isoformat(),
             'Périmètres : ' + ', '.join(args.path),
             'Périmètre incomplet : ' + ('OUI' if incomplete else 'non, dans les chemins demandés'),
             '', 'État final sur disque ; le staging seul peut différer.',
             'Contenu local à vérifier avant partage. Aucun scanner de secrets intégré.',
             '', '## Inventaire']
    lines += ['- ' + json.dumps(n, ensure_ascii=False) + ' : ' + s for n, s in entries]
    if not entries:
        lines += ['Aucun changement trouvé dans ces chemins.']
    text = '\n'.join(lines) + '\n' + '\n'.join(bodies)
    out = root / '.ai' / 'review' / stamp()
    out.mkdir(parents=True)
    (out / 'snapshot.md').write_text(text, encoding='utf-8', errors='backslashreplace')
    print(out / 'snapshot.md')
    print('Vérifier le périmètre et les éventuelles exclusions avant de joindre ce fichier.')
    return 0


def read_trx(paths):
    totals = dict(total=0, executed=0, passed=0, failed=0, skipped=0)
    failures, problems = [], []
    if not paths:
        problems.append('Aucun TRX produit : le succès ne peut pas être établi.')
    for path in paths:
        try:
            if path.stat().st_size > 20_000_000:
                raise ValueError('TRX trop volumineux pour ce wrapper')
            tree = ET.parse(path)
            counters = tree.find('.//{*}Counters')
            summary = tree.find('.//{*}ResultSummary')
            if counters is None:
                raise ValueError('compteurs absents')
            for key in ('total', 'executed', 'passed', 'failed'):
                value = int(counters.attrib[key])
                if value < 0:
                    raise ValueError('compteur négatif')
                totals[key] += value
            totals['skipped'] += int(counters.attrib.get('notExecuted', '0'))
            if int(counters.attrib['executed']) < 1:
                problems.append(path.name + ' : aucun test exécuté pour cette cible.')
            if summary is None or summary.attrib.get('outcome') not in {'Completed', 'Passed'}:
                problems.append(path.name + ' : résultat global non réussi.')
            results = tree.findall('.//{*}UnitTestResult')
            if len(results) < int(counters.attrib['executed']):
                problems.append(path.name + ' : résultats individuels insuffisants.')
            for result in results:
                outcome = result.attrib.get('outcome', '')
                if outcome not in {'Passed', 'NotExecuted'}:
                    error = result.find('.//{*}Message')
                    failures.append({'name': result.attrib.get('testName', '?'), 'outcome': outcome,
                                     'message': ((error.text or '') if error is not None else '')[:1500]})
        except (ET.ParseError, KeyError, ValueError, OSError) as exc:
            problems.append(path.name + ' : TRX non exploitable (' + str(exc) + ')')
    return totals, failures, problems


def kill_tree(process):
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait()


def run_tests(root, args):
    config = json.loads((root / '.ai/test-profiles.json').read_text(encoding='utf-8-sig'))
    if config.get('runner') != 'vstest':
        raise ValueError('Ce wrapper nécessite VSTest ; adapter séparément pour MTP.')
    profile = config['profiles'][args.profile]
    if '__' in json.dumps(profile):
        raise ValueError('Renseigner les placeholders du profil avant le premier lancement.')
    project = within(root, profile['project'])
    if not project.is_file() or project.suffix != '.csproj':
        raise ValueError('Le profil doit viser un projet .csproj existant du dépôt.')
    minimum = int(profile.get('minimum_executed', 1))
    timeout = int(profile.get('timeout_seconds', 300))
    if minimum < 1 or timeout < 1:
        raise ValueError('minimum_executed et timeout_seconds doivent être positifs.')
    if os.environ.get('DOTNET_TEST_RUNNER', '').lower() == 'microsoft.testing.platform':
        raise ValueError('DOTNET_TEST_RUNNER sélectionne MTP, pas VSTest.')
    # global.json may be inherited from an ancestor directory.
    for parent in [root, *root.parents]:
        global_json = parent / 'global.json'
        if global_json.exists():
            try:
                data = json.loads(global_json.read_text(encoding='utf-8-sig'))
            except json.JSONDecodeError:
                raise ValueError('global.json non analysable : vérifier manuellement le runner.')
            if str(data.get('test', {}).get('runner', '')).lower() == 'microsoft.testing.platform':
                raise ValueError('global.json sélectionne MTP ; ne pas utiliser ce wrapper.')
            break
    out = root / '.ai/runs' / stamp()
    command = ['dotnet', 'test', str(project), '--no-restore', '--configuration',
               profile.get('configuration', 'Debug'), '--logger', 'trx;LogFilePrefix=ai-tests',
               '--results-directory', str(out), '--verbosity', 'minimal']
    if profile.get('filter'):
        command += ['--filter', profile['filter']]
    if args.dry_run:
        print(json.dumps({'argv':command, 'minimum_executed':minimum,
                          'timeout_seconds':timeout}, ensure_ascii=False, indent=2))
        return 0
    out.mkdir(parents=True)
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    head = git(root, 'rev-parse', 'HEAD').decode().strip()
    dirty_before = git(root, 'diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--')
    fingerprint = hashlib.sha256(dirty_before).hexdigest()
    start = time.monotonic()
    timed_out = False
    with (out / 'run.log').open('w', encoding='utf-8') as log:
        log.write('argv = ' + json.dumps(command, ensure_ascii=False) + '\n')
        log.flush()
        kwargs = {'start_new_session':True} if os.name != 'nt' else {'creationflags':subprocess.CREATE_NEW_PROCESS_GROUP}
        try:
            process = subprocess.Popen(command, cwd=root, stdout=log, stderr=subprocess.STDOUT, **kwargs)
        except OSError as exc:
            log.write(str(exc))
            exit_code = 127
        else:
            try:
                exit_code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                kill_tree(process)
                exit_code = 124
    totals, failures, problems = read_trx(sorted(out.glob('*.trx')))
    if timed_out:
        problems.append('Délai dépassé ; processus et descendants arrêtés.')
    if totals['executed'] < minimum:
        problems.append('Nombre de tests exécutés inférieur au minimum attendu.')
    current = git(root, 'diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--')
    if hashlib.sha256(current).hexdigest() != fingerprint:
        problems.append('Les modifications suivies ont changé pendant le lancement.')
    if git(root, 'rev-parse', 'HEAD').decode().strip() != head:
        problems.append('HEAD a changé pendant le lancement.')
    ok = exit_code == 0 and totals['failed'] == 0 and not failures and not problems
    result = {'status':'passed' if ok else 'not-validated', 'profile':args.profile,
              'started_utc':started, 'head':head, 'tracked_diff_sha256':fingerprint,
              'note':'Empreinte partielle : exclut fichiers non suivis ; aucun contrôle des modifications après le run.',
              'argv':command, 'dotnet_exit_code':exit_code, 'elapsed_seconds':round(time.monotonic()-start,2),
              'counts':totals, 'failures':failures, 'problems':problems}
    (out / 'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    lines = ['# Validation locale', '', '- Statut : ' + result['status'],
             '- Profil : ' + args.profile, '- HEAD : ' + head, '- Début UTC : ' + started,
             '- Code retour .NET : ' + str(exit_code), '- Durée : ' + str(result['elapsed_seconds']) + ' s',
             '- Compteurs : ' + json.dumps(totals,ensure_ascii=False),
             '- Commande (argv) : ' + json.dumps(command,ensure_ascii=False),
             '- Toute modification ultérieure exige une nouvelle validation.',
             '- Empreinte indicative : fichiers non suivis exclus. Ne pas modifier le code pendant le run.',
             '', '## Problèmes de validation']
    lines += ['- ' + p for p in problems] or ['Aucun.']
    lines += ['', '## Échecs (maximum 10 dans ce résumé)']
    for failure in failures[:10]:
        lines += ['- ' + failure['name'] + ' : ' + failure['outcome'], failure['message']]
    lines += ['', 'Log complet et TRX dans ce dossier. Vérifier les données avant partage.']
    (out / 'summary.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(out / 'summary.md')
    # Preserve native failure code; validation without trustworthy evidence gets 2.
    return exit_code if exit_code != 0 else (0 if ok else 2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest='operation',required=True)
    snap = subs.add_parser('snapshot')
    snap.add_argument('--path',action='append',required=True)
    snap.add_argument('--base',default='HEAD')
    snap.add_argument('--merge-base',action='store_true')
    snap.add_argument('--max-chars',type=int,default=60_000)
    run = subs.add_parser('test')
    run.add_argument('--profile',required=True)
    run.add_argument('--dry-run',action='store_true')
    args = parser.parse_args()
    try:
        root = repo_root()
        if args.operation == 'snapshot':
            if args.max_chars < 1:
                raise ValueError('--max-chars doit être positif')
            return snapshot(root,args)
        return run_tests(root,args)
    except (ValueError,OSError,KeyError) as exc:
        print('Erreur : ' + str(exc),file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
