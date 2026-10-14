import { spawnSync } from 'node:child_process';
import { cpus, platform, arch } from 'node:os';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const build = spawnSync('./tools/moon', ['build', 'bench', '--target', 'js', '--release', '--deny-warn'], { cwd: root, stdio: 'inherit' });
if (build.status) process.exit(build.status);
const { measure } = await import('../_build/js/release/build/bench/bench.js');
const count = 20000;
for (let i = 0; i < 3; i++) { measure(false, 1000); measure(true, 1000); }
const results = { parseEachTime: [], reuseTemplate: [] };
let checksum;
for (let sample = 0; sample < 7; sample++) {
  // Alternate order to reduce warmup / scheduling bias.
  for (const reuse of sample % 2 ? [true, false] : [false, true]) {
    const start = process.hrtime.bigint();
    const result = measure(reuse, count);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    checksum ??= result;
    if (result !== checksum) throw new Error('Benchmark result mismatch');
    results[reuse ? 'reuseTemplate' : 'parseEachTime'].push(ms);
  }
}
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length / 2)];
const report = { measuredAtUtc: new Date().toISOString(), node: process.version, platform:platform(), arch:arch(), cpu:cpus()[0]?.model,
  iterationsPerSample:count, samples:results, medianMs: Object.fromEntries(Object.entries(results).map(([k,v])=>[k,median(v)])), checksum,
  scope:'Pure MoonBit JS core; excludes CLI/JSON/startup; one query template with Unicode and list values. Observational, no timing gate.' };
writeFileSync(new URL('../reports/benchmark.json', import.meta.url), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.medianMs));
