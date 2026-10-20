#!/usr/bin/env python3
"""Run release gates and write an evidence-based, per-corpus report."""
import collections
import atexit
import datetime
import difflib
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
from source_digest import source_digest

ROOT = Path(__file__).resolve().parent.parent
MOON = str(ROOT/'tools/moon')
REPORTS = ROOT/'reports'
REPORTS.mkdir(exist_ok=True)
report = {'status': 'running',
          'verification_started_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat()}
initial_head = subprocess.run(['git','rev-parse','HEAD'], cwd=ROOT, text=True, capture_output=True)
report['git_head'] = initial_head.stdout.strip() if initial_head.returncode == 0 else None
report['working_tree_dirty'] = bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip())
finished = False

def save_report():
    (REPORTS/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')

def finalize_report():
    if not finished:
        report['status'] = 'failed'
        report['failure_note'] = 'Verification stopped before all gates passed; historical log files are not current success evidence.'
    save_report()

# Replace the checked-in historical report immediately, including early failures.
save_report()
atexit.register(finalize_report)

def run(args, cwd=ROOT, log=None):
    report['current_gate'] = args
    save_report()
    result = subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if log: (REPORTS/log).write_text(result.stdout)
    if result.returncode:
        print(result.stdout)
        raise SystemExit(result.returncode)
    return result.stdout

run([MOON, 'fmt', '--check'])
run([sys.executable, 'tools/test_fixture_literals.py'])
original = {name: (ROOT/name).read_bytes() for name in ('conformance_test.mbt', 'testdata/manifest.json')}
run([sys.executable, 'tools/generate_fixtures.py'])
for name, data in original.items():
    actual = (ROOT/name).read_bytes()
    if actual != data:
        diff = ''.join(difflib.unified_diff(
            data.decode('utf-8').splitlines(True), actual.decode('utf-8').splitlines(True),
            fromfile='committed/'+name, tofile='generated/'+name,
        ))
        (REPORTS/'fixture-drift.diff').write_text(diff, encoding='utf-8')
        (REPORTS/('fixture-drift-'+Path(name).name)).write_bytes(actual)
        print(diff[:12000])
        raise SystemExit('Generated fixture drift: '+name+'; see reports/fixture-drift.diff')
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
report.update({'verified_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'os': platform.platform(), 'toolchain': versions.strip(),
          'node': run(['node','--version']).strip(), 'source_sha256': source_digest(ROOT),
          'upstream_commit': manifest['commit'], 'backends': {}, 'fixture_literal_roundtrips': 10})
for backend in ('js', 'wasm', 'wasm-gc', 'native'):
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
workflow = run(['node','--test','tools/project.test.mjs','integrations/github-audit/integration.test.mjs'], log='tests-workflow.log')
workflow_total = re.search(r'(?:#|ℹ) tests (\d+)', workflow)
workflow_pass = re.search(r'(?:#|ℹ) pass (\d+)', workflow)
workflow_fail = re.search(r'(?:#|ℹ) fail (\d+)', workflow)
if not workflow_total or not workflow_pass or not workflow_fail or workflow_fail[1] != '0' or workflow_total[1] != workflow_pass[1]: raise SystemExit('Workflow tests incomplete')
report['workflow'] = {'total':int(workflow_total[1]), 'passed':int(workflow_pass[1]), 'failed':0, 'network':'offline only; live evidence is separate'}
sdk = run(['node', '--test', 'sdk/sdk.test.mjs'], log='tests-sdk.log')
sdk_total = re.search(r'(?:#|ℹ) tests (\d+)', sdk)
sdk_pass = re.search(r'(?:#|ℹ) pass (\d+)', sdk)
sdk_fail = re.search(r'(?:#|ℹ) fail (\d+)', sdk)
if not sdk_total or not sdk_pass or not sdk_fail or sdk_fail[1] != '0' or sdk_total[1] != sdk_pass[1]: raise SystemExit('SDK tests incomplete')
run(['node', 'tools/verify_sdk_package.mjs'], log='sdk-package.log')
report['sdk'] = {'total': int(sdk_total[1]), 'passed': int(sdk_pass[1]), 'failed': 0,
                 'package': json.loads((REPORTS/'sdk-package.json').read_text())}
run(['node','tools/cli.mjs','project','integrations/github-audit/requests.json','--github'], log='project-check.log')
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
        (app/'moon.mod').write_text('name = "acceptance/downstream"\nimport { "'+module_name+'@'+module_version+'" }\n')
        (app/'moon.pkg').write_text('import { "cjyhjy/uri_template" @uri }\npkgtype(kind: "executable")\n')
        (app/'main.mbt').write_text('fn main {\n let vars = @uri.Variables::new()\n vars.set("id", @uri.Scalar("42"))\n let t = @uri.parse("/users/{id}").unwrap()\n println(t.measure(vars).unwrap())\n println(t.expand_batch([vars], required=["id"]).unwrap()[0])\n let catalog = @uri.compile_catalog([("user", "/users/{id}")]).unwrap()\n println(catalog.measure("user", vars).unwrap())\n println(catalog.expand_batch([@uri.CatalogRequest::new("user", vars, required=["id"])]).unwrap()[0])\n println("profiles=" + t.variable_profiles().length().to_string())\n println("reserved=" + t.diff_contract(@uri.parse("/users/{+id}").unwrap()).reserved_added.to_string())\n println("audit=" + catalog.audit(@uri.TemplatePolicy::new()).unwrap().is_clean().to_string())\n println("findings=" + catalog.inspect_requests([@uri.CatalogRequest::new("user", @uri.Variables::new(), required=["id"])]).unwrap().total_findings.to_string())\n match @uri.expand("/users/{id}", vars) {\n Ok(s) => println(s)\n Err(e) => println(e.message)\n }\n}\n')
        for backend in ('js','wasm','wasm-gc','native'):
            output=run([MOON,'run','.', '--target',backend],cwd=app)
            if any(marker not in output for marker in ['/users/42', 'profiles=1', 'reserved=true', 'audit=true', 'findings=1']): raise SystemExit('Downstream import failed: '+backend)
report['package']={'files':names,'sha256':hashlib.sha256(archive_path.read_bytes()).hexdigest(),'clean_downstream_backends':['js','wasm','wasm-gc','native']}
head = subprocess.run(['git','rev-parse','HEAD'], cwd=ROOT, text=True, capture_output=True)
report['git_head'] = head.stdout.strip() if head.returncode == 0 else None
report['status'] = 'passed'
report.pop('current_gate', None)
finished = True
save_report()
print(f"CLI: {report['cli']['passed']} passed; clean package imports passed on four backends")
print('Wrote reports/verification.json')
