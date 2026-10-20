#!/usr/bin/env python3
"""Build a portable Node distribution plus Mooncakes source archive, then test it."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from source_digest import source_digest

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT/'package.json').read_text())['version']
manifest = (ROOT/'moon.mod').read_text()
module = re.search(r'name\s*=\s*"([^"]+)"', manifest)[1]
module_version = re.search(r'version\s*=\s*"([^"]+)"', manifest)[1]
if module_version != VERSION: raise SystemExit('Node and MoonBit package versions differ')
verification = json.loads((ROOT/'reports/verification.json').read_text())
if verification.get('status') != 'passed':
    raise SystemExit('No completed current verification report; run npm test before packaging')
if verification.get('source_sha256') != source_digest(ROOT):
    raise SystemExit('Source changed since verification; run npm test before packaging')

subprocess.run(['node', 'tools/build.mjs'], cwd=ROOT, check=True)
subprocess.run([str(ROOT/'tools/moon'), 'package'], cwd=ROOT, check=True)
source = ROOT/'_build/publish'/f'{module.replace("/", "-")}-{VERSION}.zip'
release_dir = ROOT/'_build/releases'
release_dir.mkdir(parents=True, exist_ok=True)
filename = f'moonbit-uri-template-{VERSION}.zip'
archive_path = release_dir/filename
with tempfile.TemporaryDirectory(prefix='uri-template-release-') as temporary:
    bundle = Path(temporary)/f'moonbit-uri-template-{VERSION}'
    bundle.mkdir()
    files = ['tools/cli.mjs', 'tools/cli.test.mjs', 'tools/diagnostics.mjs', 'tools/serve-playground.mjs',
             'dist/engine.mjs', 'package.json',
             'tools/project.mjs', 'tools/project.test.mjs', 'tools/json-source.mjs', 'tools/suggestions.mjs',
             'tools/playground.test.mjs',
             'sdk/index.mjs', 'sdk/index.d.mts', 'sdk/sdk.test.mjs',
             'tools/differential.test.mjs', 'testdata/differential/results.json',
             'dist/licenses/moonbit-core-LICENSE', 'reports/sdk-package.json', 'docs/SDK.md',
             'integrations/github-audit/main.mjs', 'integrations/github-audit/package.json',
             'integrations/github-audit/contracts.mjs', 'integrations/github-audit/upgrade.mjs',
             'integrations/github-audit/link-selection.mjs',
             'integrations/github-audit/requests.json', 'integrations/github-audit/integration.test.mjs',
             'integrations/github-audit/README.md',
             'dist/playground/index.html', 'dist/playground/main.mjs', 'dist/playground/worker.mjs',
             'dist/playground/style.css', 'dist/playground/engine.mjs', 'dist/playground/diagnostics.mjs',
             'dist/playground/compute.mjs', 'dist/playground/controller.mjs', 'dist/playground/json-source.mjs',
             'LICENSE', 'NOTICE', 'examples/search.json', 'examples/users.json', 'examples/resource.json',
             'reports/verification.json']
    for name in files:
        target = bundle/name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT/name, target)
    shutil.copyfile(source, bundle/source.name)
    sdk = json.loads((ROOT/'reports/sdk-package.json').read_text())
    sdk_archive = ROOT/sdk['artifact']
    if sdk['status'] != 'passed' or sdk['sourceSha256'] != verification['source_sha256'] or hashlib.sha256(sdk_archive.read_bytes()).hexdigest() != sdk['sha256']:
        raise SystemExit('SDK package evidence is stale')
    shutil.copyfile(sdk_archive, bundle/sdk_archive.name)
    license_file = ROOT/'.toolchain/lib/core/LICENSE'
    if not license_file.exists():
        moon = shutil.which('moon')
        if moon:
            home = Path(os.environ.get('MOON_HOME', str(Path(moon).resolve().parent.parent)))
            license_file = home/'lib/core/LICENSE'
    if not license_file.exists(): raise SystemExit('MoonBit standard library license not found')
    (bundle/'licenses').mkdir()
    shutil.copyfile(license_file, bundle/'licenses/moonbit-core-LICENSE')
    (bundle/'README.md').write_text(f'''# MoonBit URI Template {VERSION}\n\nLocal release candidate, not a registry publication. Portable CLI compiled from MoonBit. Requires Node.js 22+. No runtime npm dependencies. Typed ESM SDK installation: npm install ./moonbit-uri-template-0.2.0.tgz (see docs/SDK.md).\n\n```sh\nnode tools/cli.mjs expand '/users/{{id}}{{?page}}' --vars-file examples/users.json\nnode tools/cli.mjs validate '%27{{x}}%27' --strict\nnode --test sdk/sdk.test.mjs tools/differential.test.mjs tools/cli.test.mjs tools/project.test.mjs tools/playground.test.mjs integrations/github-audit/integration.test.mjs\nnode tools/cli.mjs project integrations/github-audit/requests.json --json\nnode tools/serve-playground.mjs  # http://127.0.0.1:4173\n```\n\nThe included {source.name} is the Mooncakes source archive.\nVerification evidence: reports/verification.json.\nThe compiled engine includes MoonBit's Apache-2.0 standard library; its license is in licenses/.\n''')
    paths = sorted(p for p in bundle.rglob('*') if p.is_file())
    checksums = {str(p.relative_to(bundle)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    (bundle/'SHA256SUMS.json').write_text(json.dumps(checksums, indent=2)+'\n')
    with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(p for p in bundle.rglob('*') if p.is_file()):
            name = str(path.relative_to(bundle.parent))
            entry = zipfile.ZipInfo(name, date_time=(2026,10,14,0,0,0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = (0o100755 if name.endswith('/tools/cli.mjs') else 0o100644) << 16
            archive.writestr(entry,path.read_bytes())
    unpacked = Path(temporary)/'extracted'
    with zipfile.ZipFile(archive_path) as archive:
        if any('.toolchain/' in name or 'credentials' in name or '/.git/' in name for name in archive.namelist()):
            raise SystemExit('Unexpected private file in release')
        archive.extractall(unpacked)
    installed = unpacked/bundle.name
    check = json.loads((installed/'SHA256SUMS.json').read_text())
    for name, expected in check.items():
        if hashlib.sha256((installed/name).read_bytes()).hexdigest() != expected:
            raise SystemExit('Release checksum mismatch: '+name)
    tests = subprocess.run(['node','--test','sdk/sdk.test.mjs','tools/differential.test.mjs','tools/cli.test.mjs','tools/project.test.mjs','tools/playground.test.mjs','integrations/github-audit/integration.test.mjs'],cwd=installed,text=True,capture_output=True)
    output = tests.stdout+tests.stderr
    (ROOT/'reports/release-cli.log').write_text(output)
    if tests.returncode: print(output); raise SystemExit(tests.returncode)
    total=re.search(r'(?:#|ℹ) tests (\d+)',output)
    passed=re.search(r'(?:#|ℹ) pass (\d+)',output)
    failed=re.search(r'(?:#|ℹ) fail (\d+)',output)
    if not total or not passed or not failed or total[1]!=passed[1] or failed[1]!='0':
        raise SystemExit('Release CLI evidence missing')
    report={'version':VERSION,'archive':f'_build/releases/{filename}',
            'sha256':hashlib.sha256(archive_path.read_bytes()).hexdigest(),
            'tested_from_extracted_archive':True,'test_scope':'CLI, SDK, project workflow and offline consumer', 'cli_tests':int(total[1]),'cli_passed':int(passed[1]),
            'files':list(check), 'required_node':'>=22', 'source_sha256': verification['source_sha256'], 'published': False}
    (ROOT/'reports/release.json').write_text(json.dumps(report,indent=2)+'\n')
    print(f'Release verified: {filename}; {passed[1]} CLI tests passed after extraction')
