import { spawnSync } from 'node:child_process';
import { cpus, platform, arch } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const build = spawnSync('./tools/moon', ['build', 'bench', '--target', 'js', '--release', '--deny-warn'], { cwd: root, stdio: 'inherit' });
if (build.status) process.exit(build.status);
const { measure } = await import('../_build/js/release/build/bench/bench.js');
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length / 2)];
const scenarios = [];
for (const [scenario, name, count] of [[0, 'scalar-path', 20000], [1, 'unicode-query-list', 20000], [2, '200-expression-template', 1000], [3, '100-item-unicode-list', 2000]]) {
  for (let i = 0; i < 3; i++) { measure(false, Math.min(count,1000), scenario); measure(true, Math.min(count,1000), scenario); }
  const results = { parseEachTime: [], reuseTemplate: [] };
  let checksum;
  for (let sample = 0; sample < 7; sample++) {
    for (const reuse of sample % 2 ? [true, false] : [false, true]) {
      const start = process.hrtime.bigint();
      const result = measure(reuse, count, scenario);
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      checksum ??= result;
      if (result !== checksum) throw new Error('Benchmark result mismatch for '+name);
      results[reuse ? 'reuseTemplate' : 'parseEachTime'].push(ms);
    }
  }
  scenarios.push({ name, iterationsPerSample:count, samples:results,
    medianMs:Object.fromEntries(Object.entries(results).map(([key,values])=>[key,median(values)])), checksum });
}
const toolchain = JSON.parse(readFileSync(new URL('../toolchain.lock.json',import.meta.url),'utf8')).version;
const report = { measuredAtUtc:new Date().toISOString(), node:process.version, platform:platform(), arch:arch(), cpu:cpus()[0]?.model, toolchain,
  scenarios, scope:'Pure MoonBit JS core; excludes CLI/JSON/process startup. Both modes include identical binding/setup cost once per batch. Reuse includes one initial parse. Seven alternating-order samples after warmup; observational, no timing gate.' };
writeFileSync(new URL('../reports/benchmark.json', import.meta.url), JSON.stringify(report,null,2)+'\n');
for (const scenario of scenarios) console.log(scenario.name+': '+JSON.stringify(scenario.medianMs));
