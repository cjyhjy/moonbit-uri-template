#!/usr/bin/env python3
"""Verify the independent MoonBit registry consumer; --live enables three public GETs."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
CLIENT = ROOT / 'integrations/moonbit-github'
MOON = str(ROOT / 'tools/moon')
IGNORED = {'.mooncakes', '_build', '__pycache__'}


def fingerprint():
    digest = hashlib.sha256()
    for path in sorted(CLIENT.rglob('*')):
        if path.is_file() and not IGNORED.intersection(path.relative_to(CLIENT).parts):
            digest.update(str(path.relative_to(CLIENT)).encode() + b'\0' + path.read_bytes() + b'\0')
    return digest.hexdigest()


def fixture():
    """Synthetic offline input, deliberately separate from the pinned live description."""
    paths = {}
    for operation, suffix in [('repos/get', ''), ('repos/list-commits', '/commits'), ('repos/list-releases', '/releases')]:
        parameters = [dict(name=n, **{'in': 'path'}, required=True, schema={'type': 'string'}) for n in ('owner', 'repo')]
        if suffix:
            parameters.append({'name': 'per_page', 'in': 'query', 'schema': {'type': 'integer'}})
        paths['/repos/{owner}/{repo}' + suffix] = {'get': {'operationId': operation, 'parameters': parameters}}
    return {'openapi': '3.1.0', 'info': {'title': 'Synthetic offline native-client fixture', 'version': '1'}, 'paths': paths}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true')
    args = parser.parse_args()
    name = 'native-client-live' if args.live else 'native-client-offline'
    report_path = ROOT / 'reports' / (name + '.json')
    log_path = ROOT / 'reports' / (name + '.log')
    metadata = json.loads((CLIENT / 'upstream.json').read_text())
    report = dict(status='running', evidence='live-public-api' if args.live else 'offline-registry-consumer',
                  started_at_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  source_sha256=fingerprint(), verifier_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), backend='native', externalUserFeedback=False,
                  dependencies={'cjyhjy/uri_template': metadata['uri_template_version'], 'moonbitlang/async': metadata['async_version']},
                  toolchain=json.loads((ROOT / 'toolchain.lock.json').read_text()), checks=[])
    logs = []

    def save():
        report_path.write_text(json.dumps(report, indent=2) + '\n')

    save()
    try:
        with tempfile.TemporaryDirectory(prefix='uri-native-consumer-') as temporary:
            work = Path(temporary)
            app = work / 'app'
            shutil.copytree(CLIENT, app, ignore=shutil.ignore_patterns(*IGNORED))

            def run(command, expected=0, timeout=180):
                result = subprocess.run(command, cwd=app, text=True, capture_output=True, timeout=timeout)
                output = result.stdout + result.stderr
                logs.append('$ ' + ' '.join(command) + '\n' + output)
                log_path.write_text('\n'.join(logs).replace(str(work.resolve()), '<fresh-project>').replace(str(work), '<fresh-project>').replace(str(ROOT), '<repository>'))
                if result.returncode != expected:
                    raise RuntimeError(f'command exited {result.returncode}, expected {expected}: {output[-4000:]}')
                return result.stdout

            # Dependency acquisition may use the network. Tests and default CLI never call public APIs.
            run([MOON, 'check', '--target', 'native'])
            tree = run([MOON, 'tree'])
            for module, version in report['dependencies'].items():
                if f'{module}@{version}' not in tree:
                    raise RuntimeError(f'unexpected registry resolution for {module}: {tree}')
            report['dependency_tree'] = tree.replace(str(work.resolve()), '<fresh-project>').replace(str(work), '<fresh-project>')
            report['fresh_project_registry_dependencies'] = True
            tests = run([MOON, 'test', '--target', 'native', '--frozen'])
            match = re.search(r'Total tests: (\d+), passed: (\d+), failed: 0', tests)
            if not match or match[1] != match[2]:
                raise RuntimeError('native test evidence missing')
            report['tests'] = int(match[1])
            run([MOON, 'build', '--target', 'native', '--frozen'])
            executable = app / '_build/native/debug/build/cmd/main/main.exe'
            if not executable.is_file():
                raise RuntimeError('native executable missing')
            spec = app / 'offline.json'
            spec.write_text(json.dumps(fixture()))
            requests = app / 'requests.json'
            planned = json.loads(run([str(executable), str(spec), str(requests)]))
            expected = ['https://api.github.com/repos/cjyhjy/moonbit-uri-template',
                        'https://api.github.com/repos/cjyhjy/moonbit-uri-template/commits?per_page=2',
                        'https://api.github.com/repos/cjyhjy/moonbit-uri-template/releases?per_page=2']
            if planned.get('mode') != 'plan' or [r['url'] for r in planned['requests']] != expected:
                raise RuntimeError('unexpected URL plan')
            report['checks'].append('default CLI plans three URLs without sending requests')
            bad = json.loads(requests.read_text())
            del bad['requests'][1]['variables']['repo']
            invalid = app / 'invalid.json'
            invalid.write_text(json.dumps(bad))
            failure = json.loads(run([str(executable), str(spec), str(invalid), '--live'], expected=2))
            if failure.get('code') != 'MissingBinding':
                raise RuntimeError('CLI did not preserve the core missing-binding error')
            report['checks'].append('invalid second request blocks live batch with MissingBinding and exit 2')
            report['checks'].extend(['endpoint and repository response validation', 'streaming body cap', 'deadline cancellation', 'redirect and HTTP-error rejection'])
            report['plan'] = planned
            if args.live:
                url = f"https://raw.githubusercontent.com/{metadata['repository']}/{metadata['commit']}/{metadata['path']}"
                with urllib.request.urlopen(url, timeout=60) as response:
                    data = response.read(33554433)
                if len(data) > 33554432 or hashlib.sha256(data).hexdigest() != metadata['sha256']:
                    raise RuntimeError('pinned GitHub description checksum or size mismatch')
                spec = app / 'github.json'
                spec.write_bytes(data)
                planned = json.loads(run([str(executable), str(spec), str(requests)]))
                if [r['url'] for r in planned['requests']] != expected:
                    raise RuntimeError('official description does not produce the expected request URLs')
                report['description'] = dict(url=url, bytes=len(data), sha256=metadata['sha256'], origin='pinned official GitHub OpenAPI description')
                started = time.monotonic()
                result = json.loads(run([str(executable), str(spec), str(requests), '--live']))
                if not result.get('ok') or len(result['results']) != 3 or any(r['status'] != 200 for r in result['results']):
                    raise RuntimeError('live responses incomplete')
                report['result'] = result
                report['elapsed_ms'] = round((time.monotonic() - started) * 1000)
                report['checks'].append('three native HTTPS GETs from official OpenAPI operation IDs; response bodies validated')
            report['status'] = 'passed'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        raise
    finally:
        report['finished_at_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        save()
    print(f'{name}: passed ({report["tests"]} native tests, registry consumer, CLI checks)')


if __name__ == '__main__':
    main()
