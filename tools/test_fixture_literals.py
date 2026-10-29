#!/usr/bin/env python3
"""Round-trip source literals through the actual compiler against code points."""
import subprocess
import tempfile
from pathlib import Path
from moonbit_literal import quote

ROOT = Path(__file__).resolve().parent.parent
samples = ['', r'\u0041', r'\u0000', r'\{value}', '\\', '"',
           '\0\n\r\t\b\f', ''.join(chr(i) for i in range(32)),
           '\u4e2d\u6587\U0001f600', r'\\u0041\"\uABCD']
lines = []
for index, sample in enumerate(samples):
    expected = ', '.join(str(ord(char)) for char in sample)
    lines.append(f'test "literal_{index}" {{\n'
                 f'  let actual = {quote(sample)}.to_array().map(c => c.to_int())\n'
                 f'  let expected : Array[Int] = [{expected}]\n'
                 f'  assert_eq(actual, expected)\n}}')
with tempfile.TemporaryDirectory(prefix='uri-fixture-literal-') as temporary:
    work = Path(temporary)
    # A package imports only the prelude. Standalone scripts implicitly import
    # core packages, whose short names can collide as the standard library grows.
    (work/'moon.mod').write_text('name = "verification/fixture_literals"\n')
    (work/'moon.pkg').write_text('')
    script = work/'roundtrip_test.mbt'
    script.write_text('\n'.join(lines), encoding='utf-8')
    subprocess.run([str(ROOT/'tools/moon'), 'test',
                    '--target', 'js', '--deny-warn'], cwd=work, check=True)
print(f'Fixture literals: {len(samples)} compiler round trips passed')
