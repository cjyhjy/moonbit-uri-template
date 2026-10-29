#!/usr/bin/env python3
"""Collect local instrumentation coverage; never upload to a third-party service."""
import json
import re
import subprocess
import tempfile
from pathlib import Path
root = Path(__file__).resolve().parent.parent
# Keep old compiler traces and nested verification checkouts out of this run.
with tempfile.TemporaryDirectory(prefix='uri-template-coverage-') as build:
    tested = subprocess.run([str(root/'tools/moon'), 'test', '--enable-coverage',
                             '--target', 'wasm-gc', '--target-dir', build],
                            cwd=root, text=True, capture_output=True)
    if tested.returncode:
        result = tested
    else:
        traces = sorted(Path(build).rglob('*.trace.source'))
        runtime_logs = sorted(Path(build).rglob('moonbit_coverage_*.txt'))
        if not traces or not runtime_logs:
            raise SystemExit('Fresh instrumented tests produced no coverage data')
        runtime = Path(build)/'runtime.txt'
        runtime.write_bytes(b'\n'.join(path.read_bytes() for path in runtime_logs))
        # The reporter otherwise searches the checkout recursively, even when
        # analyze is given a separate target directory. Supply both inputs.
        result = subprocess.run([str(root/'tools/moon'), 'coverage', 'report', '--',
                                 '-f', 'summary', '-t', str(runtime),
                                 '--source-paths', str(root), *map(str, traces)],
                                cwd=root, text=True, capture_output=True)
output = result.stdout + result.stderr
(root/'reports/coverage-summary.txt').write_text(output)
print(output, end='')
if result.returncode: raise SystemExit(result.returncode)
match = re.search(r'Total: (\d+)/(\d+)', output)
if not match: raise SystemExit('Coverage summary missing')
report = {'covered_instrumentation_points':int(match[1]), 'total_instrumentation_points':int(match[2]),
          'backend':'wasm-gc', 'isolated_fresh_build':True,
          'trace_source_files':len(traces), 'runtime_logs':len(runtime_logs),
          'scope':'MoonBit instrumented packages; examples are separately executed by verify.py without instrumentation.',
          'purpose':'Diagnostic only; no arbitrary percentage gate. Standard conformance remains the release gate.'}
(root/'reports/coverage.json').write_text(json.dumps(report,indent=2)+'\n')
