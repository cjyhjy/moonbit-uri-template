// Fresh-process before/after OpenAPI checks using identical hash-pinned inputs.
// node tools/benchmark_openapi_memory.mjs [--before] [BASELINE_COMMIT]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, platform, arch, cpus } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (process.argv[2] === '--worker') {
  const { checkOpenAPI } = await import(pathToFileURL(process.argv[3]));
  const start = performance.now();
  const text = readFileSync(process.argv[4], 'utf8');
  const result = checkOpenAPI(text, 'input.json', { maxBytes: 67108864 });
  const output = JSON.stringify(result);
  const elapsedMs = performance.now() - start;
  const maxRSSMiB = process.resourceUsage().maxRSS / 1024;
  assert.equal(result.complete, true);
  console.log(JSON.stringify({ elapsedMs, maxRSSMiB, outputSha256: hash(output),
    operations: result.operations.length, diagnostics: result.diagnostics.length }));
} else {
  const args = process.argv.slice(2), beforeOnly = args[0] === '--before';
  if (beforeOnly) args.shift();
  assert.ok(args.length <= 1, 'expected optional baseline commit');
  const baseline = execFileSync('git', ['rev-parse', '--verify', `${args[0] ?? '2e189a2'}^{commit}`], {cwd:root, encoding:'utf8'}).trim();
  const git = name => execFileSync('git', ['show', `${baseline}:${name}`], {cwd:root, encoding:'utf8'});
  const temporary = mkdtempSync(join(tmpdir(), 'uri-openapi-memory-'));
  const report = { schemaVersion: 1, status: 'running', baseline, beforeOnly,
    measuredAt: new Date().toISOString(), node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
    methodology: 'Five independent fresh Node processes per variant and document. Alternate before/after order each round; sequential execution. Same compiled MoonBit engine and SDK. Time includes file read, check, source locations and JSON output serialization, excludes module import/startup. Peak RSS is whole-process high water mark including startup and input; no forced GC. Input files are cached official descriptions with verified SHA-256. Full serialized reports must match byte-for-byte. These fixed-machine samples are not universal guarantees.',
    engineSha256: hash(readFileSync(join(root, 'dist/engine.mjs'))),
    sources: {}, documents: [],
  };
  const outputPath = join(root, beforeOnly ? '_build/openapi-memory-before.json' : 'reports/openapi-memory.json');
  const save = () => writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
  const median = xs => [...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
  try {
    // Only the input/position layer differs; all semantic dependencies are shared.
    for (const name of ['sdk/openapi.mjs', 'sdk/index.mjs', 'tools/yaml-source.mjs', 'tools/project.mjs'])
      assert.equal(hash(git(name)), hash(readFileSync(join(root,name))), `shared dependency changed: ${name}`);
    for (const name of ['tools/json-source.mjs', 'tools/openapi.mjs']) {
      const source = git(name);
      report.sources[name] = { before: hash(source), after: hash(readFileSync(join(root,name))) };
      let rewritten = source;
      if (name.endsWith('/openapi.mjs')) {
        for (const dependency of ['../sdk/openapi.mjs', './yaml-source.mjs', './project.mjs'])
          rewritten = rewritten.replace(`'${dependency}'`, JSON.stringify(new URL(dependency, new URL('tools/openapi.mjs', pathToFileURL(root))).href));
      }
      writeFileSync(join(temporary, name.split('/').at(-1)), rewritten);
    }
    save();
    for (const [name, expectedHash] of [
      ['github', '3177ad6a86ca04c57a9bef3fc24e28a339efb8eb040c6f950af3d3ed2fee7fa3'],
      ['cloudflare', '4ba217d8b7316bbc84a94370a216e6fb4ab77180cac82464f91e8969e19a48fd'],
    ]) {
      const file = join(root, '_build/openapi-public', name + '.json'), bytes = readFileSync(file);
      assert.equal(hash(bytes), expectedHash, 'input checksum mismatch');
      const row = { name, bytes: bytes.length, sha256: expectedHash, before: [], after: [] };
      for (let round = 0; round < 5; round++) {
        for (const variant of beforeOnly ? ['before'] : round % 2 ? ['after','before'] : ['before','after']) {
          const modulePath = variant === 'before' ? join(temporary, 'openapi.mjs') : join(root, 'tools/openapi.mjs');
          const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', modulePath, file],
            {cwd:root, encoding:'utf8', timeout:60000, maxBuffer:1048576});
          if (r.error || r.status !== 0) throw Error(r.error?.message ?? r.stderr);
          row[variant].push(JSON.parse(r.stdout));
        }
      }
      const samples = [...row.before, ...row.after];
      assert.equal(new Set(samples.map(x=>x.outputSha256)).size, 1, 'full output differs');
      row.medians = {};
      for (const variant of beforeOnly ? ['before'] : ['before','after'])
        row.medians[variant] = Object.fromEntries(['elapsedMs','maxRSSMiB'].map(metric => [metric,median(row[variant].map(x=>x[metric]))]));
      if (!beforeOnly) row.reductionPercent = Object.fromEntries(['elapsedMs','maxRSSMiB'].map(metric =>
        [metric, (1-row.medians.after[metric]/row.medians.before[metric])*100]));
      report.documents.push(row); save();
      console.log(JSON.stringify({name, medians:row.medians, reductionPercent:row.reductionPercent}));
    }
    report.sourceSha256 = execFileSync('python3', ['-c', 'from pathlib import Path;import sys;sys.path.insert(0,"tools");from source_digest import source_digest;print(source_digest(Path.cwd()))'], {cwd:root,encoding:'utf8'}).trim();
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = error.message; throw error;
  } finally { save(); rmSync(temporary, {recursive:true,force:true}); }
}
