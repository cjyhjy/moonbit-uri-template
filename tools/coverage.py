#!/usr/bin/env python3
"""Collect local instrumentation coverage; never upload to a third-party service."""
import json
import re
import subprocess
from pathlib import Path
root = Path(__file__).resolve().parent.parent
result = subprocess.run([str(root/'tools/moon'), 'coverage', 'analyze', '--', '-f', 'summary'], cwd=root, text=True, capture_output=True)
output = result.stdout + result.stderr
(root/'reports/coverage-summary.txt').write_text(output)
print(output, end='')
if result.returncode: raise SystemExit(result.returncode)
match = re.search(r'Total: (\d+)/(\d+)', output)
if not match: raise SystemExit('Coverage summary missing')
report = {'covered_instrumentation_points':int(match[1]), 'total_instrumentation_points':int(match[2]),
          'scope':'MoonBit instrumented packages; examples are separately executed by verify.py without instrumentation.',
          'purpose':'Diagnostic only; no arbitrary percentage gate. Standard conformance remains the release gate.'}
(root/'reports/coverage.json').write_text(json.dumps(report,indent=2)+'\n')
