#!/usr/bin/env python3
"""Reproduce a local Octokit integration. Use --download for initial setup."""
import argparse
import datetime
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import urllib.request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
MANIFEST = json.loads((HERE / 'manifest.json').read_text())
OUT = ROOT / '_build/octokit-endpoint'
OUT.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--download', action='store_true', help='Download fixed upstream source and npm dependencies')
parser.add_argument('--live', action='store_true', help='Additionally send one anonymous GitHub GET using the adapted build')
args = parser.parse_args()
work = Path(tempfile.mkdtemp(prefix='run-', dir=OUT))
report_path = ROOT / 'reports/octokit-endpoint.json'
report = {
    'status': 'running', 'performed_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'kind': 'self-performed third-party integration', 'externalUserFeedback': False,
    'upstream': MANIFEST, 'work': str(work.relative_to(ROOT)), 'logs': {},
    'project_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save():
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')


def run(command, label, cwd, allow_failure=False):
    result = subprocess.run([str(a) for a in command], cwd=cwd, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    log = work / (label + '.log')
    log.write_text(result.stdout)
    report['logs'][label] = {'path': str(log.relative_to(ROOT)), 'sha256': sha(log), 'exit_code': result.returncode}
    save()
    print(label + ': ' + str(result.returncode), flush=True)
    if result.returncode and not allow_failure:
        raise RuntimeError(label + ': ' + result.stdout[-4500:])
    return result


def tests(label, upstream, allow_failure=False, coverage=True):
    target = work / (label + '.json')
    command = ['npm', 'test', '--', '--reporter=json', '--outputFile=' + str(target)] if coverage else [
        upstream / 'node_modules/.bin/vitest', 'run', '--reporter=json', '--outputFile=' + str(target)]
    result = run(command, label, upstream, allow_failure)
    data = json.loads(target.read_text())
    summary = {key: data[key] for key in ['numTotalTests', 'numPassedTests', 'numFailedTests']}
    summary['failed_tests'] = [a['fullName'] for suite in data['testResults']
                               for a in suite.get('assertionResults', []) if a['status'] == 'failed']
    summary['exit_code'] = result.returncode
    summary['coverage_gate'] = 'upstream unchanged 100% thresholds' if coverage else 'not run'
    return summary


try:
    save()
    archive = OUT / 'upstream.tar.gz'
    if not archive.exists():
        if not args.download:
            raise RuntimeError('Source cache missing; run with --download')
        with urllib.request.urlopen(MANIFEST['source_url'], timeout=60) as response:
            data = response.read(4 * 1024 * 1024 + 1)
        if len(data) > 4 * 1024 * 1024:
            raise RuntimeError('Source archive exceeds download budget')
        archive.write_bytes(data)
    if sha(archive) != MANIFEST['source_sha256']:
        raise RuntimeError('Upstream source archive SHA-256 mismatch')
    with tarfile.open(fileobj=io.BytesIO(archive.read_bytes())) as tar:
        for item in tar.getmembers():
            if item.issym() or item.islnk() or '..' in Path(item.name).parts or Path(item.name).is_absolute():
                raise RuntimeError('Unsafe source archive member')
        tar.extractall(work)
    upstream = work / ('endpoint.js-' + MANIFEST['commit'])
    originals = {str(p.relative_to(upstream)): sha(p) for p in upstream.rglob('*') if p.is_file()}
    test_hashes = {name: digest for name, digest in originals.items() if name.startswith('test/')}
    template = upstream / 'src/util/url-template.ts'
    cache_args = ['--cache', str(OUT / 'npm-cache')]
    offline = [] if args.download else ['--offline']
    run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund', *cache_args, *offline], 'install-upstream', upstream)
    baseline = tests('baseline-tests', upstream)
    assert baseline['numTotalTests'] == 59 and baseline['numFailedTests'] == 0
    run(['npm', 'run', 'build'], 'baseline-build', upstream)
    baseline_consumer = run(['node', HERE / 'consumer.mjs', upstream / 'pkg/dist-bundle/index.js', '--baseline'], 'baseline-consumer', upstream)
    report['baseline'] = {'tests': baseline, 'build': 'passed', 'consumer': json.loads(baseline_consumer.stdout)}
    save()

    run(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact',
         *cache_args, *offline, MANIFEST['sdk']], 'install-sdk', upstream)
    installed = json.loads((upstream / 'node_modules/moonbit-uri-template/package.json').read_text())
    lock = json.loads((upstream / 'package-lock.json').read_text())
    sdk_lock = lock['packages']['node_modules/moonbit-uri-template']
    assert installed['version'] == '0.5.1' and sdk_lock['integrity'] == MANIFEST['sdk_integrity']

    template.write_text('''import { compileTemplate } from "moonbit-uri-template";

export function parseUrl(template: string) {
  const compiled = compileTemplate(template);
  return {
    expand(context: Record<string, unknown>): string {
      return compiled.expand(context);
    },
  };
}
''')
    report['direct_replacement'] = tests('direct-tests', upstream, allow_failure=True, coverage=False)
    assert report['direct_replacement']['numFailedTests'] == 3
    save()

    template.write_bytes((HERE / 'adapter.ts').read_bytes())
    adapted = tests('adapted-tests', upstream)
    assert adapted['numTotalTests'] == baseline['numTotalTests'] and adapted['numFailedTests'] == 0
    run(['npm', 'run', 'build'], 'adapted-build', upstream)
    extra = ['--live'] if args.live else []
    adapted_consumer = run(['node', HERE / 'consumer.mjs', upstream / 'pkg/dist-bundle/index.js', *extra], 'adapted-consumer', upstream)
    consumer = json.loads(adapted_consumer.stdout)
    assert consumer['checks'] == report['baseline']['consumer']['checks']
    changed = [name for name, digest in originals.items() if sha(upstream / name) != digest]
    assert sorted(changed) == ['package-lock.json', 'package.json', 'src/util/url-template.ts']
    assert all(sha(upstream / name) == digest for name, digest in test_hashes.items())
    report.update({
        'status': 'passed',
        'adapted': {'tests': adapted, 'build': 'passed', 'consumer': consumer,
                    'installed_sdk_integrity': sdk_lock['integrity']},
        'unchanged_upstream_test_sha256': test_hashes, 'changed_upstream_files': changed,
        'adapter_sha256': sha(HERE / 'adapter.ts'),
        'integration_source_sha256': {name: sha(HERE / name) for name in ['adapter.ts', 'consumer.mjs', 'manifest.json', 'run.py']},
        'runtime': {'tested_node': subprocess.check_output(['node', '--version'], text=True).strip(),
                    'upstream_node': json.loads((upstream / 'package.json').read_text())['engines']['node'],
                    'sdk_node': installed['engines']['node']},
        'adaptations': ['Preserve Octokit trailing-slash handling', 'Convert bigint URL IDs to decimal strings',
                        'Pass only referenced URL variables; leave body/query objects to Octokit'],
        'limitations': ['Local experiment, not an upstream PR or adoption',
                        '59 upstream tests, 8 consumer checks and one compatibility probe do not prove universal drop-in compatibility',
                        'Exploded query lists differ: legacy helper joins items with a comma; SDK uses the RFC 6570 ampersand separator',
                        'Uses published npm SDK; not a MoonBit-native downstream project',
                        'SDK requires Node >=22 whereas pinned upstream declares >=20; this run tests Node 26 only',
                        'SDK input validation remains stricter than the legacy helper for malformed or non-JSON values'],
        'license_handling': 'Upstream source and notices stay in ignored local cache; tracked adapter and runner are independently written',
    })
    save()
    print('Integration passed: 59 unchanged upstream tests, build, 8 consumer checks and one documented compatibility difference; report ' + str(report_path), flush=True)
except Exception as error:
    report['status'] = 'failed'
    report['error'] = str(error)
    save()
    raise
