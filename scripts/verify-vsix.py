"""Check the deliverable against this checkout before publishing or smoke testing it."""

import argparse
import hashlib
import json
import zipfile
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree


def verify(vsix, root, extract=None, match_build=False):
    package = json.loads((root / 'package.json').read_text())
    lock = json.loads((root / 'package-lock.json').read_text())
    version = package['version']
    assert lock['version'] == lock['packages']['']['version'] == version
    with zipfile.ZipFile(vsix) as archive:
        assert archive.testzip() is None, 'Corrupt VSIX archive'
        names = archive.namelist()
        assert len(names) == len(set(names)), 'Duplicate archive entries'
        for name in names:
            path = PurePosixPath(name)
            assert not path.is_absolute() and '..' not in path.parts, name
        embedded = json.loads(archive.read('extension/package.json'))
        for field in ('name', 'publisher', 'version'):
            assert embedded[field] == package[field], f'Incorrect package {field}'
        manifest = ElementTree.fromstring(archive.read('extension.vsixmanifest'))
        identity = manifest.find('.//{*}Identity')
        assert identity is not None and identity.attrib['Version'] == version
        host_path = embedded['main'].removeprefix('./')
        host = archive.read('extension/' + host_path)
        ui = archive.read('extension/dist/webview/assets/app.js')
        for marker in ('setReward', 'unlockDragonBall', 'setLivingHq', 'resolveOptionalStep'):
            for label, bundle in (('host', host), ('webview', ui)):
                assert marker.encode() in bundle, f'{marker} missing from {label}'
        assert b'hq-paper-plane' in ui, 'Context transfer missing from webview'
        styles = archive.read('extension/dist/webview/assets/index.css')
        assert b'hq-paper-delivery' in styles, 'Paper plane animation missing from stylesheet'
        properties = embedded['contributes']['configuration']['properties']
        themes = properties['featureStudio.appearance.theme']['enum']
        assert all(theme in themes for theme in ('noob', 'matrix', 'dragonball'))
        assert properties['featureStudio.appearance.livingHq']['default'] is False
        built_files = [path for path in (root / 'dist').rglob('*') if path.is_file()] if match_build else []
        if match_build:
            assert built_files, 'Build the checkout before checking the package'
        for path in built_files:
            member = 'extension/' + path.relative_to(root).as_posix()
            assert archive.read(member) == path.read_bytes(), f'Outdated build: {member}'
        assets = [path for path in (root / 'webview/public').rglob('*') if path.is_file()]
        for path in assets:
            member = 'extension/dist/webview/' + path.relative_to(root / 'webview/public').as_posix()
            assert archive.read(member) == path.read_bytes(), f'Missing or changed asset: {member}'
        for folder in ('qg', 'rewards', 'avatar-events/dragonball'):
            assert any(path.is_relative_to(root / 'webview/public' / folder) for path in assets), folder
        notes = Path('docs/releases') / f'v{version}.md'
        assert archive.read('extension/' + notes.as_posix()) == (root / notes).read_bytes()
        if extract:
            extract.mkdir(parents=True, exist_ok=False)
            archive.extractall(extract)
    result = {
        'version': version,
        'vsix': str(vsix),
        'bytes': vsix.stat().st_size,
        'sha256': hashlib.sha256(vsix.read_bytes()).hexdigest(),
        'verifiedBuildFiles': len(built_files),
        'verifiedPublicAssets': len(assets),
        'features': ['rewards', 'livingHq', 'dragonball', 'optionalSteps', 'hqContextTransfer'],
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    version = json.loads((root / 'package.json').read_text())['version']
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('vsix', nargs='?', type=Path, default=root / 'releases' / f'feature-studio-{version}.vsix')
    parser.add_argument('--extract', type=Path)
    parser.add_argument('--match-build', action='store_true', help='Also compare every file with the local build')
    args = parser.parse_args()
    verify(args.vsix.resolve(), root, args.extract, args.match_build)
