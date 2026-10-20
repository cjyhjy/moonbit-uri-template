#!/usr/bin/env python3
"""Pin peer checkouts and record real test execution, never infer quality from counts."""
import datetime, hashlib, json, re, shutil, subprocess
from pathlib import Path
from source_digest import source_digest
ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT/'_build/peer-audit'
REPORTS = ROOT/'reports'
STAMP = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d')
MOON = str(ROOT/'tools/moon')
PEERS = {'magic': ('Magic486/moon-uri-template', '8fecb90c2190e4715935b5f4ea0937b0b5c8d08b'),
         'jsj': ('JSJ222/MoonUriTemplate', 'ee7d3be94e80459d5e4f2fc9eafcc8b1a11ae3df')}
report = {'date': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'status': 'running', 'peers': {}, 'ours_source_sha256': source_digest(ROOT),
          'toolchain': subprocess.check_output([MOON,'version','--all'],text=True).strip()}
def save(): (REPORTS/f'peer-audit-{STAMP}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
save()
try:
    WORK.mkdir(parents=True, exist_ok=True)
    for name, (repo, pin) in PEERS.items():
        folder = WORK/name
        if not folder.exists():
            subprocess.run(['git','clone','--quiet','https://github.com/'+repo,str(folder)],check=True)
            subprocess.run(['git','checkout','--quiet',pin],cwd=folder,check=True)
        if subprocess.check_output(['git','status','--porcelain'],cwd=folder,text=True).strip():
            raise RuntimeError('Peer checkout has local changes: '+name)
        actual = subprocess.check_output(['git','rev-parse','HEAD'],cwd=folder,text=True).strip()
        if actual != pin: raise RuntimeError('Peer checkout does not match pin: '+name)
        remote = subprocess.check_output(['git','ls-remote','https://github.com/'+repo,'HEAD'],text=True).split()[0]
        item = {'repository': 'https://github.com/'+repo, 'commit': actual, 'remote_head': remote, 'backends': {}}
        report['peers'][name] = item
        # moon test without a path tests every member of the enclosing workspace.
        # Limit this phase to ONE module (including all its subpackages).
        (WORK/'moon.work').write_text('members = ["'+name+'"]\n')
        item['test_scope'] = 'single-module workspace including subpackages'
        for backend in ('js','wasm-gc','native'):
            result = subprocess.run([MOON,'test','--target',backend],cwd=folder,capture_output=True,text=True)
            log = f'peer-{name}-{backend}-{STAMP}.log'
            (REPORTS/log).write_text(result.stdout+result.stderr)
            summary = re.search(r'Total tests: (\d+), passed: (\d+), failed: (\d+)', result.stdout+result.stderr)
            item['backends'][backend] = {'exit_code':result.returncode,'summary':summary.group(0) if summary else None,'log':log}
            save()
            if result.returncode or not summary or summary[1] != summary[2] or summary[3] != '0': raise RuntimeError('Peer tests failed or incomplete: '+name+' '+backend)
    # Consumer imports copied current core and exact peers; peer sources stay untouched.
    ours = WORK/'ours'
    ours.mkdir(exist_ok=True)
    for p in ROOT.glob('*.mbt'):
        if not p.name.endswith(('_test.mbt','_wbtest.mbt')): shutil.copyfile(p,ours/p.name)
    for name in ('moon.mod','moon.pkg'): shutil.copyfile(ROOT/name,ours/name)
    consumer = WORK/'consumer'; consumer.mkdir(exist_ok=True)
    (WORK/'moon.work').write_text('members = ["ours", "magic", "jsj", "consumer"]\n')
    (consumer/'moon.mod').write_text('name = "audit/consumer"\nimport { "cjyhjy/uri_template@0.2.0", "Magic486/moon-uri-template@0.1.2", "JSJ222/moonuritemplate@0.2.0" }\n')
    (consumer/'moon.pkg').write_text('import { "cjyhjy/uri_template" @ours, "Magic486/moon-uri-template" @magic, "JSJ222/moonuritemplate" @jsj }\npkgtype(kind: "executable")\n')
    source = (ROOT/'testdata/peer-smoke/main.mbt.txt').read_text()
    additions = (ROOT/'testdata/peer-smoke/usability.mbt.txt').read_text()
    (consumer/'main.mbt').write_text(source.rstrip()[:-1]+additions+'\n}\n')
    report['probe_source_sha256'] = hashlib.sha256((consumer/'main.mbt').read_bytes()).hexdigest()
    report['probes'] = {}
    for backend in ('js','wasm-gc','native'):
        result = subprocess.run([MOON,'run','.', '--target',backend],cwd=consumer,capture_output=True,text=True)
        log = f'peer-probe-{backend}-{STAMP}.log'
        (REPORTS/log).write_text(result.stdout+result.stderr)
        report['probes'][backend] = {'exit_code':result.returncode,'log':log,'stdout':result.stdout}
        save()
        if result.returncode or result.stdout != (ROOT/'testdata/peer-smoke/expected-usability.txt').read_text(): raise RuntimeError('Shared probe failed or output changed: '+backend)
    report['status']='passed'
except BaseException as e:
    report['status']='failed'; report['error']=str(e); raise
finally: save()
print(f'Peer tests and shared probes completed; see reports/peer-audit-{STAMP}.json')
