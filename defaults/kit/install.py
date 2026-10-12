#!/usr/bin/env python3
"""Install Copilot kit files. Preview by default; Python 3.10+, standard library only."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sys
import uuid


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(root, relative):
    if not isinstance(relative, str) or not relative or '\\' in relative or ':' in relative or '\x00' in relative:
        raise ValueError('Chemin non autorisé : ' + repr(relative))
    pure = PurePosixPath(relative)
    if pure.is_absolute() or any(p in {'.', '..', '.git'} for p in pure.parts) or pure.as_posix() != relative:
        raise ValueError('Chemin non autorisé : ' + repr(relative))
    current = root
    for part in pure.parts:
        current = current / part
        if current.is_symlink() or (current.exists() and current.resolve() != current):
            raise ValueError('Lien symbolique ou redirection de chemin refusé : ' + str(current))
    if not current.resolve().is_relative_to(root):
        raise ValueError('Chemin hors du dossier cible : ' + relative)
    return current


def plan_install(source, repo):
    manifest = json.loads((source / 'install-manifest.json').read_text(encoding='utf-8'))
    if manifest.get('version') != '2.0.0' or not isinstance(manifest.get('files'), list):
        raise ValueError('Manifeste absent ou version incompatible.')
    plan = []
    seen = set()
    for entry in manifest['files']:
        src = safe_path(source, entry['source'])
        dst = safe_path(repo, entry['target'])
        key = os.path.normcase(str(dst))
        if key in seen:
            raise ValueError('Destination répétée dans le manifeste : ' + entry['target'])
        seen.add(key)
        if not src.is_file():
            raise ValueError('Fichier du kit manquant : ' + entry['source'])
        data = src.read_bytes()
        if digest(data) != entry['sha256']:
            raise ValueError('Empreinte incorrecte dans le kit : ' + entry['source'])
        if dst.exists() and not dst.is_file():
            raise ValueError('Un dossier occupe la destination : ' + entry['target'])
        previous = dst.read_bytes() if dst.exists() else None
        before = digest(previous) if previous is not None else None
        if previous is None:
            action = 'CREATE'
        elif previous == data:
            action = 'IDENTICAL'
        elif entry['policy'] == 'preserve':
            action = 'PRESERVE'
        elif entry['policy'] != 'managed':
            raise ValueError('Politique inconnue : ' + entry['target'])
        elif before in entry['previous_sha256']:
            action = 'UPDATE_KNOWN'
        else:
            action = 'CONFLICT'
        plan.append({'entry': entry, 'data': data, 'before': before, 'action': action})
    # Validate storage locations before performing any mutation.
    for directory in ['.ai/kit-install', '.ai/kit-backups', '.ai/kit-conflicts']:
        p = safe_path(repo, directory)
        if p.exists() and not p.is_dir():
            raise ValueError('Un fichier occupe le dossier de suivi : ' + directory)
    return manifest['version'], plan


def write_new(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as stream:
        stream.write(data)


def apply_plan(repo, version, plan):
    changed = [p for p in plan if p['action'] in {'CREATE', 'UPDATE_KNOWN', 'CONFLICT'}]
    if not changed:
        print('Aucune écriture nécessaire.')
        return 0
    run_id = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    journal_rel = '.ai/kit-install/' + run_id + '.json'
    journal = {'version': version, 'repo': str(repo), 'run_id': run_id, 'status': 'in-progress', 'files': []}
    journal_path = safe_path(repo, journal_rel)
    write_new(journal_path, json.dumps(journal, ensure_ascii=False, indent=2).encode('utf-8'))
    try:
        for item in changed:
            entry, data, action = item['entry'], item['data'], item['action']
            dst = safe_path(repo, entry['target'])
            current = dst.read_bytes() if dst.exists() else None
            current_hash = digest(current) if current is not None else None
            if current_hash != item['before']:
                raise ValueError('Fichier modifié depuis l’aperçu interne : ' + entry['target'])
            record = {'target': entry['target'], 'action': action}
            if action == 'CREATE':
                write_new(dst, data)
            elif action == 'CONFLICT':
                candidate_rel = '.ai/kit-conflicts/' + run_id + '/' + entry['target']
                write_new(safe_path(repo, candidate_rel), data)
                record['candidate'] = candidate_rel
            else:
                backup_rel = '.ai/kit-backups/' + run_id + '/' + entry['target']
                write_new(safe_path(repo, backup_rel), current)
                temp_rel = entry['target'] + '.kit-' + run_id + '.tmp'
                temporary = safe_path(repo, temp_rel)
                try:
                    write_new(temporary, data)
                    # Recheck immediately before replacing the recognized old file.
                    dst = safe_path(repo, entry['target'])
                    if digest(dst.read_bytes()) != item['before']:
                        raise ValueError('Modification concurrente : ' + entry['target'])
                    os.replace(temporary, dst)
                finally:
                    if temporary.exists():
                        temporary.unlink()
                record['backup'] = backup_rel
            journal['files'].append(record)
        conflicts = sum(p['action'] == 'CONFLICT' for p in plan)
        journal['status'] = 'needs-merge' if conflicts else 'complete'
        print('Journal : ' + str(journal_path))
        if conflicts:
            print('Fichiers personnalisés préservés. Propositions à fusionner dans : ' +
                  str(repo / '.ai/kit-conflicts' / run_id))
            return 3
        print('Fichiers du kit installés. Configurer .ai/project.md et les profils avant utilisation.')
        return 0
    except (OSError, ValueError) as exc:
        journal['status'] = 'partial-error'
        journal['error'] = str(exc)
        print('Installation partielle ; consulter le journal : ' + str(journal_path), file=sys.stderr)
        raise
    finally:
        safe_path(repo, journal_rel).write_text(json.dumps(journal, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True, help='Dossier existant du dépôt à équiper')
    parser.add_argument('--apply', action='store_true', help='Appliquer les copies ; sans cette option, aperçu seul')
    args = parser.parse_args()
    try:
        source = Path(__file__).resolve().parent
        repo = Path(args.repo).expanduser().resolve()
        if not repo.is_dir():
            raise ValueError('Le dossier cible doit déjà exister.')
        if source == repo or source.is_relative_to(repo) or repo.is_relative_to(source):
            raise ValueError('Extraire le kit hors du dépôt cible avant de lancer l’installateur.')
        version, plan = plan_install(source, repo)
        labels = {'CREATE': 'AJOUT', 'IDENTICAL': 'IDENTIQUE', 'PRESERVE': 'CONFIG CONSERVÉE',
                  'UPDATE_KNOWN': 'MISE À JOUR + SAUVEGARDE', 'CONFLICT': 'CONFLIT : EXISTANT CONSERVÉ'}
        print(('INSTALLATION' if args.apply else 'APERÇU — aucune écriture') + ' · kit ' + version)
        print('Destination : ' + str(repo))
        for item in plan:
            print(labels[item['action']] + ' : ' + item['entry']['target'])
        if not args.apply:
            print('Ajouter --apply pour installer. Les conflits seront proposés séparément.')
            return 0
        return apply_plan(repo, version, plan)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print('Erreur : ' + str(exc), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
