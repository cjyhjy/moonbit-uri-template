// Tests the public package exports from a clean, offline local-tarball install.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
function run(cmd, args, cwd = root) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error(`${cmd} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
const out = join(root, '_build/releases');
mkdirSync(out, { recursive: true });
const pack = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', out]))[0];
for (const f of ['sdk/index.mjs', 'sdk/index.d.mts', 'dist/engine.mjs', 'dist/licenses/moonbit-core-LICENSE'])
  if (!pack.files.some(x => x.path === f)) throw new Error('missing package file ' + f);
if (pack.files.some(x => /(^|\/)(reports|\.git|node_modules|\.toolchain)\//.test(x.path)))
  throw new Error('private or development files leaked into SDK package');
const temporary = mkdtempSync(join(tmpdir(), 'uri-sdk-consumer-'));
try {
  writeFileSync(join(temporary, 'package.json'), '{"private":true,"type":"module"}\n');
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(out, pack.filename)], temporary);
  const source = `import assert from 'node:assert/strict';
import { compileTemplate, compileCatalog } from 'moonbit-uri-template';
const repo = compileTemplate('https://api.github.com/repos/{owner}/{repo}{?page}', {required:['owner','repo']});
assert.equal(repo.expand({owner:'moonbitlang',repo:'core'}), 'https://api.github.com/repos/moonbitlang/core');
assert.deepEqual(repo.expandMany([{owner:'a',repo:'b'},{owner:'c',repo:'d',page:'2'}]), ['https://api.github.com/repos/a/b','https://api.github.com/repos/c/d?page=2']);
assert.equal(repo.tryExpand({owenr:'a',repo:'b'}).ok, false);
assert.deepEqual(repo.analyze().profiles.map(p => p.name), ['owner','repo','page']);
assert.equal(repo.compare(repo).requiresReview, false);
assert.deepEqual(repo.compare(compileTemplate('https://api.github.com/repos/{+owner}/{repo}{?page}')).variableChanges[0].after.operators, ['+']);
const catalog = compileCatalog({ repo: {template:'/repos/{owner}/{repo}',required:['owner','repo']} });
const jobs = [{template:'repo',variables:{owner:'moonbitlang',repo:'core'}}];
assert.deepEqual(catalog.expandMany(jobs), ['/repos/moonbitlang/core']);
assert.equal(catalog.measureMany(jobs).totalBytes, 23);
assert.equal(catalog.inspect(jobs).ok, true);
assert.equal(catalog.inspect([{template:'repo',variables:{owner:'a'}}]).ok, false);
assert.equal(catalog.audit({allowReserved:false}).ok, true);
assert.equal(catalog.compare(catalog).requiresReview, false);
console.log('installed SDK passed');`;
  writeFileSync(join(temporary, 'consumer.mjs'), source);
  run('node', ['consumer.mjs'], temporary);
  run('node', ['node_modules/moonbit-uri-template/tools/cli.mjs', 'validate', '/{id}'], temporary);
  run('node', ['node_modules/moonbit-uri-template/tools/cli.mjs', 'compare', '/{id}', '/{id}', '--json'], temporary);
  const types = readFileSync(join(root, 'sdk/typecheck.mts'), 'utf8').replace("'./index.mjs'", "'moonbit-uri-template'");
  writeFileSync(join(temporary, 'consumer.mts'), types);
  run(join(root, 'node_modules/.bin/tsc'), ['--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2022', 'consumer.mts'], temporary);
  const report = { status: 'passed', artifact: '_build/releases/' + pack.filename,
    sha256: createHash('sha256').update(readFileSync(join(out, pack.filename))).digest('hex'),
    sourceSha256: run('python3', ['-c', 'from pathlib import Path; import sys; sys.path.insert(0,"tools"); from source_digest import source_digest; print(source_digest(Path.cwd()))']).trim(),
    node: process.version, typescript: run(join(root, 'node_modules/.bin/tsc'), ['--version']).trim(),
    cleanLocalInstall: true, offlineInstall: true, published: false,
    checks: ['ESM public export', 'compiled reuse', 'batch', 'contract failure', 'analysis and comparison', 'typed catalog batch inspection audit and comparison', 'installed CLI comparison', 'TypeScript positive and expected-error cases'],
    files: pack.files.map(x => x.path) };
  writeFileSync(join(root, 'reports/sdk-package.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('SDK tarball: clean offline install, runtime and TypeScript checks passed');
} finally { rmSync(temporary, { recursive: true, force: true }); }
