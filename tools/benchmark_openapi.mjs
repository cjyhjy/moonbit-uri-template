// Reproduce the migration budgets with the pinned GitHub and Cloudflare JSON files.
// Usage: node tools/benchmark_openapi.mjs GITHUB.json CLOUDFLARE.json
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const [mode, ...args] = process.argv.slice(2);
if (mode === '--parse') {
  const { parse_spec } = await import(pathToFileURL(args[0]));
  const text = readFileSync(args[1], 'utf8');
  const start = performance.now(); const paths = parse_spec(text);
  console.log(JSON.stringify({ parseMs: performance.now() - start, paths, maxRSSKiB: process.resourceUsage().maxRSS }));
} else if (mode === '--sdk') {
  const { compileOpenApi } = await import('../sdk/openapi.mjs');
  const text = readFileSync(args[0], 'utf8');
  const start = performance.now(); const api = compileOpenApi(text);
  const compileMs = performance.now() - start;
  const values = { owner: 'octo', repo: 'hello world', per_page: 10 };
  const expand = () => api.expand('repos/list-commits', values);
  if (expand() !== '/repos/octo/hello%20world/commits?per_page=10') throw Error('unexpected expansion');
  for (let i = 0; i < 2000; i++) expand();
  const hot = performance.now(); for (let i = 0; i < 20000; i++) expand();
  console.log(JSON.stringify({ compileMs, expandUs: (performance.now() - hot) / 20, operations: api.operations.length, maxRSSKiB: process.resourceUsage().maxRSS }));
} else {
  if (!mode || args.length !== 1) throw Error('expected GitHub and Cloudflare JSON paths');
  const files = [mode, args[0]];
  const hashes = ['3177ad6a86ca04c57a9bef3fc24e28a339efb8eb040c6f950af3d3ed2fee7fa3', '4ba217d8b7316bbc84a94370a216e6fb4ab77180cac82464f91e8969e19a48fd'];
  const documents = files.map((file, i) => {
    const bytes = readFileSync(file), sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== hashes[i]) throw Error('pinned document checksum mismatch: ' + file);
    return { name: i ? 'cloudflare' : 'github', bytes: bytes.length, sha256 };
  });
  const run = (command, argv, options = {}) => {
    const r = spawnSync(command, argv, { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024, ...options });
    if (r.error || r.status !== 0) throw Error(r.error?.message ?? r.stderr + r.stdout);
    return r.stdout;
  };
  const worker = argv => JSON.parse(run(process.execPath, [fileURLToPath(import.meta.url), ...argv]));
  const probe = mkdtempSync(join(tmpdir(), 'uri-openapi-parser-'));
  const report = { schemaVersion: 1, status: 'running', node: process.version, platform: process.platform, arch: process.arch,
    measuredAt: new Date().toISOString(), documents,
    methodology: 'Five independent Node processes per sample. Parse and SDK compile exclude file reads; CLI includes process startup and file reads. Expand is the mean of 20000 calls after 2000 warmups. RSS includes the process, source string and parsed document.',
    budgets: { githubCliMs: 1000, cloudflareCliMs: 2500, githubCompileMs: 300, expandUs: 20 } };
  try {
    writeFileSync(join(probe, 'moon.mod'), 'name = "probe/openapi_parse"\nversion = "0.0.0"\n');
    writeFileSync(join(probe, 'moon.pkg'), 'import { "moonbitlang/core/json" }\npkgtype(kind: "foreign_library")\nsupported_targets = "js"\noptions(link: { "js": { "format": "esm" } })\n');
    writeFileSync(join(probe, 'probe.mbt'), `///|\n#export_name("parse_spec")\npub fn parse_spec(source : String) -> Int {\n  let doc = @json.parse(source) catch { _ => return -1 }\n  match doc { Object(fields) => match fields.get("paths") { Some(Object(paths)) => paths.length(); _ => -2 }; _ => -3 }\n}\n`);
    run(join(root, 'tools/moon'), ['build', '--target', 'js', '--release', '--deny-warn'], { cwd: probe });
    copyFileSync(join(probe, '_build/js/release/build/openapi_parse.js'), join(probe, 'engine.mjs'));
    report.parse = Array.from({ length: 5 }, () => worker(['--parse', join(probe, 'engine.mjs'), files[1]]));
    report.sdk = Array.from({ length: 5 }, () => worker(['--sdk', files[0]]));
    report.cli = files.map((file, i) => ({ name: documents[i].name, samplesMs: Array.from({ length: 5 }, () => {
      const start = performance.now();
      const r = spawnSync(process.execPath, ['tools/cli.mjs', 'openapi', file, '--json'], { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
      const ms = performance.now() - start;
      if (r.error || ![0, 1].includes(r.status)) throw Error(r.error?.message ?? r.stderr);
      const result = JSON.parse(r.stdout || r.stderr);
      if (!result.complete || !result.operations.length) throw Error('incomplete CLI result');
      return ms;
    }) }));
    report.sourceSha256 = run('python3', ['-c', 'import sys;sys.path.insert(0,"tools");from source_digest import source_digest;from pathlib import Path;print(source_digest(Path(".")))']).trim();
    report.status = report.parse.every(s => s.paths === 2353) && report.sdk.every(s => s.compileMs <= 300 && s.expandUs <= 20) && report.cli.every((r, i) => r.samplesMs.every(ms => ms <= (i ? 2500 : 1000))) ? 'passed' : 'over-budget';
    writeFileSync(join(root, 'reports/openapi-performance.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'passed') process.exitCode = 1;
  } finally { rmSync(probe, { recursive: true, force: true }); }
}
