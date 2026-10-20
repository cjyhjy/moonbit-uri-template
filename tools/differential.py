#!/usr/bin/env python3
"""Byte-for-byte differential test against two Python RFC 6570 libraries.

Setup (once, pinned by hash):
  python3 -m venv .venv-diff
  .venv-diff/bin/pip install --require-hashes -r tools/differential-requirements.txt
Run:
  .venv-diff/bin/python tools/differential.py          # compare and rewrite the baseline
  .venv-diff/bin/python tools/differential.py --check  # compare against the baseline only

The baseline testdata/differential/results.json is also checked offline by
tools/differential.test.mjs, so `npm test` keeps it honest without Python libraries.
"""
import itertools, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'testdata/differential/results.json'

VALUES = {
    'plain': {'x': 'hello', 'y': 'a b', 'list': ['red', 'green'], 'keys': {'a': '1', 'b': '2'}},
    'reserved': {'x': '/f?q=1&r#s', 'y': "!$'()*+,;=", 'list': ['a/b', 'c:d'], 'keys': {'k/1': 'v?1', 'k2': '@x'}},
    'percent': {'x': '%41bc', 'y': '100%', 'list': ['%E4%B8%AD', '%zz'], 'keys': {'p%20': '%2F'}},
    'unicode': {'x': '中文😀', 'y': 'é ü', 'list': ['月兔', '𝄞'], 'keys': {'名': '值', 'e': '😀'}},
    'empty': {'x': '', 'y': '', 'list': [''], 'keys': {'a': ''}},
}
SPECS = ['x', 'x:1', 'x:3', 'x*', 'list', 'list*', 'keys', 'keys*', 'x,y', 'x,undef,y', 'undef',
         'list,x', 'keys,y', 'x:2,list*', 'empty_list', 'empty_keys']
OPS = ['', '+', '#', '.', '/', ';', '?', '&']


def cases():
    out = []
    for (label, values), spec, op in itertools.product(VALUES.items(), SPECS, OPS):
        variables = dict(values, empty_list=[], empty_keys={})
        out.append({'name': f'{label} {{{op}{spec}}}', 'template': f'/t{{{op}{spec}}}', 'variables': variables})
    out += [
        {'name': 'literal percent and unicode', 'template': '/%E4%B8%AD/中/{x}', 'variables': {'x': 'é'}},
        {'name': 'reserved prefix cuts a triplet', 'template': '{+x:4}', 'variables': {'x': '%E4%B8%ADz'}},
        {'name': 'reserved prefix keeps whole triplets', 'template': '{+x:9}', 'variables': {'x': '%E4%B8%ADz'}},
        {'name': 'associative insertion order', 'template': '{?f*}', 'variables': {'f': {'z': '1', 'a': '2'}}},
    ]
    return out


def ours(items):
    script = ("import {expand} from './sdk/index.mjs';"
              "const items = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
              .replace("require('fs')", "(await import('node:fs'))"))
    script += "console.log(JSON.stringify(items.map(c => { try { return expand(c.template, c.variables); } catch (e) { return 'ERROR ' + e.code; } })));"
    run = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT, input=json.dumps(items),
                         capture_output=True, text=True, check=True)
    return json.loads(run.stdout)


def references(items):
    import uritemplate
    from stduritemplate import StdUriTemplate
    def guard(f):
        try:
            return f()
        except Exception as error:  # reference libraries raise assorted types
            return 'ERROR ' + type(error).__name__
    return ([guard(lambda c=c: uritemplate.URITemplate(c['template']).expand(c['variables'])) for c in items],
            [guard(lambda c=c: StdUriTemplate.expand(c['template'], c['variables'])) for c in items])


def main():
    items = cases()
    mine = ours(items)
    if '--check' in sys.argv:
        baseline = json.loads(OUT.read_text(encoding='utf-8'))['cases']
        bad = [b['name'] for b, m in zip(baseline, mine) if b['ours'] != m]
        print(f'{len(items) - len(bad)}/{len(items)} match baseline')
        return 1 if bad else 0
    py, std = references(items)
    rows, summary = [], {'all_agree': 0, 'matches_uritemplate_only': 0, 'matches_std_only': 0, 'differs_from_both': 0}
    for case, m, a, b in zip(items, mine, py, std):
        key = ('all_agree' if m == a == b else 'matches_uritemplate_only' if m == a else
               'matches_std_only' if m == b else 'differs_from_both')
        summary[key] += 1
        rows.append({**case, 'ours': m, 'uritemplate': a, 'stduritemplate': b, 'agreement': key})
    OUT.write_text(json.dumps({'references': {'uritemplate': '4.2.0', 'std-uritemplate': '2.0.11'},
                               'summary': summary, 'cases': rows}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(summary))
    for row in rows:
        if row['agreement'] != 'all_agree':
            print(f"{row['agreement']:26} {row['template']:22} ours={row['ours']!r} uritemplate={row['uritemplate']!r} std={row['stduritemplate']!r}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
