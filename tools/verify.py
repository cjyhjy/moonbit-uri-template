#!/usr/bin/env python3
"""Run release gates and write an evidence-based, per-corpus report."""
import collections
import datetime
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOON = str(ROOT/'tools/moon')
REPORTS = ROOT/'reports'
REPORTS.mkdir(exist_ok=True)

def run(args, cwd=ROOT, log=None):
    result = subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if log: (REPORTS/log).write_text(result.stdout)
    if result.returncode:
        print(result.stdout)
        raise SystemExit(result.returncode)
    return result.stdout

def digest():
    entries = []
    for folder in ('adapter', 'cmd', 'examples', 'testdata', 'tools', 'bench'):
        base = ROOT/folder
        if base.exists(): entries.extend(p for p in base.rglob('*') if p.is_file() and '__pycache__' not in p.parts)
    entries.extend(p for p in ROOT.iterdir() if p.is_file() and p.suffix in ('.mbt', '.mbti', '.pkg', '.mod', '.json'))
    hashed = hashlib.sha256()
    for path in sorted(set(entries)):
        hashed.update(str(path.relative_to(ROOT)).encode()+b'\0'+path.read_bytes()+b'\0')
    return hashed.hexdigest()

run([MOON, 'fmt', '--check'])
original = {name: (ROOT/name).read_bytes() for name in ('conformance_test.mbt', 'testdata/manifest.json')}
run([sys.executable, 'tools/generate_fixtures.py'])
for name, data in original.items():
    if (ROOT/name).read_bytes() != data: raise SystemExit('Generated fixture drift: '+name)
interfaces = {p: p.read_bytes() for p in ROOT.rglob('pkg.generated.mbti') if '.toolchain' not in p.parts and '_build' not in p.parts}
run([MOON, 'info'])
if any(p.read_bytes() != data for p, data in interfaces.items()): raise SystemExit('Public API snapshot drift; review and commit moon info output.')
manifest = json.loads((ROOT/'testdata/manifest.json').read_text())
for filename, meta in manifest['files'].items():
    path = ROOT/'testdata/upstream'/filename
    if hashlib.sha256(path.read_bytes()).hexdigest() != meta['sha256']: raise SystemExit('Fixture checksum mismatch: '+filename)
lock = json.loads((ROOT/'toolchain.lock.json').read_text())
versions = run([MOON, 'version', '--all'])
if 'v'+lock['version']+' ' not in versions: raise SystemExit('Unexpected compiler version; run tools/bootstrap.py')
report = {'verified_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'os': platform.platform(), 'toolchain': versions.strip(),
          'node': run(['node','--version']).strip(), 'source_sha256': digest(),
          'upstream_commit': manifest['commit'], 'backends': {}}
for backend in ('js', 'wasm-gc', 'native'):
    run([MOON, 'check', '--target', backend, '--deny-warn'])
    output = run([MOON, 'test', '--target', backend, '--deny-warn', '--verbose'], log=f'tests-{backend}.log')
    success_names = re.findall(r'\("([^"\n]+)"\) ok', output)
    counts = collections.Counter(success_names)
    expected = [item['id'] for item in manifest['tests']]
    missing = [name for name in expected if counts[name] != 1]
    if missing: raise SystemExit(f'{backend}: missing or duplicated upstream executions: {missing}')
    summary = re.search(r'Total tests: (\d+), passed: (\d+), failed: (\d+)', output)
    if not summary or summary[3] != '0' or summary[1] != summary[2]: raise SystemExit('Incomplete test run: '+backend)
    files = {name: {'total': meta['count'], 'passed': meta['count'], 'failed': 0, 'skipped': 0, 'failure_ids': []} for name, meta in manifest['files'].items()}
    levels = dict(collections.Counter(str(item['level']) for item in manifest['tests']))
    report['backends'][backend] = {'total':int(summary[1]), 'passed':int(summary[2]), 'failed':0,
        'upstream_files': files, 'upstream_by_level':levels, 'upstream_executions':expected}
    demo = run([MOON,'run','examples','--target',backend])
    if '/users/42?page=2\n/users/99?page=2' not in demo: raise SystemExit('Example mismatch: '+backend)
    print(f'{backend}: {summary[2]}/{summary[1]} passed; all {len(expected)} upstream cases executed exactly once')
run(['node','tools/build.mjs'])
cli = run(['node','--test','tools/cli.test.mjs'], log='tests-cli.log')
cli_total = re.search(r'(?:#|ℹ) tests (\d+)',cli)
cli_pass = re.search(r'(?:#|ℹ) pass (\d+)',cli)
cli_fail = re.search(r'(?:#|ℹ) fail (\d+)',cli)
if not cli_total or not cli_pass or not cli_fail or cli_fail[1] != '0' or cli_total[1]!=cli_pass[1]: raise SystemExit('CLI test report missing')
report['cli'] = {'total':int(cli_total[1]),'passed':int(cli_pass[1]),'failed':0}
package = run([MOON, 'package', '--list'],log='package.log')
module_manifest=(ROOT/'moon.mod').read_text()
module_name=re.search(r'name\s*=\s*"([^"]+)"',module_manifest)[1]
module_version=re.search(r'version\s*=\s*"([^"]+)"',module_manifest)[1]
archive_path=ROOT/'_build/publish'/f'{module_name.replace("/","-")}-{module_version}.zip'
if not archive_path.exists(): raise SystemExit('Package archive missing')
with zipfile.ZipFile(archive_path) as archive:
    names = archive.namelist()
    if any('.toolchain/' in n or '/.git/' in n or n.startswith('.git/') or 'dist/' in n for n in names): raise SystemExit('Unexpected build/private file in package')
    for required in ('moon.mod','moon.pkg','LICENSE','README.md','parser.mbt','conformance_test.mbt','toolchain.lock.json'):
        if required not in names: raise SystemExit('Missing package file: '+required)
    with tempfile.TemporaryDirectory(prefix='uri-template-downstream-') as temp:
        work = Path(temp)
        library = work/'library'
        library.mkdir()
        archive.extractall(library)
        app = work/'consumer'
        app.mkdir()
        (work/'moon.work').write_text('members = ["library", "consumer"]\n')
        (app/'moon.mod').write_text('name = "acceptance/downstream"\nimport { "cjyhjy/uri_template@0.1.0" }\n')
        (app/'moon.pkg').write_text('import { "cjyhjy/uri_template" @uri }\npkgtype(kind: "executable")\n')
        (app/'main.mbt').write_text('fn main {\n let vars = @uri.Variables::new()\n vars.set("id", @uri.Scalar("42"))\n match @uri.expand("/users/{id}", vars) {\n Ok(s) => println(s)\n Err(e) => println(e.message)\n }\n}\n')
        for backend in ('js','wasm-gc','native'):
            output=run([MOON,'run','.', '--target',backend],cwd=app)
            if '/users/42' not in output: raise SystemExit('Downstream import failed: '+backend)
report['package']={'files':names,'sha256':hashlib.sha256(archive_path.read_bytes()).hexdigest(),'clean_downstream_backends':['js','wasm-gc','native']}
head = subprocess.run(['git','rev-parse','HEAD'], cwd=ROOT, text=True, capture_output=True)
report['git_head'] = head.stdout.strip() if head.returncode == 0 else None
(REPORTS/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(f"CLI: {report['cli']['passed']} passed; clean package imports passed on three backends")
print('Wrote reports/verification.json')
