// Same compiled target and workload; each peer retains its documented checks.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cpus, platform, arch } from 'node:os';
const reportDir = new URL('../reports/', import.meta.url);
const auditName = readdirSync(reportDir).filter(n => /^peer-audit-\d{8}\.json$/.test(n)).sort().at(-1);
if (!auditName) throw new Error('Run npm run compare:peers first');
const audit = JSON.parse(readFileSync(new URL(auditName, reportDir)));
if (audit.status !== 'passed') throw new Error('Peer audit must pass first');
const root = new URL('../', import.meta.url);
const version = readFileSync(new URL('moon.mod', root), 'utf8').match(/^version = "([^"]+)"/m)[1];
for (const name of readdirSync(root).filter(n => n.endsWith('.mbt') && !n.endsWith('_test.mbt') && !n.endsWith('_wbtest.mbt'))) {
  if (!readFileSync(new URL(name, root)).equals(readFileSync(new URL('_build/peer-audit/ours/' + name, root)))) throw new Error('Core changed; run npm run compare:peers');
}
const digest = spawnSync('python3', ['-c', 'import sys; sys.path.insert(0,"tools"); from pathlib import Path; from source_digest import source_digest; print(source_digest(Path.cwd()))'], {cwd: root, encoding: 'utf8'});
if (digest.status !== 0) throw new Error('Cannot fingerprint source');
const work = new URL('../_build/peer-audit/', import.meta.url);
const folder = new URL('benchmark/', work);
mkdirSync(folder, { recursive: true });
writeFileSync(new URL('moon.work', work), 'members = ["ours", "magic", "jsj", "consumer", "benchmark"]\n');
writeFileSync(new URL('moon.mod', folder), `name = "audit/benchmark"\nimport { "cjyhjy/uri_template@${version}", "Magic486/moon-uri-template@0.1.2", "JSJ222/moonuritemplate@0.2.0" }\n`);
writeFileSync(new URL('moon.pkg', folder), `import { "cjyhjy/uri_template" @ours, "Magic486/moon-uri-template" @magic, "JSJ222/moonuritemplate" @jsj }
pkgtype(kind: "foreign_library")
supported_targets = "js"
options(link: { "js": { "format": "esm" } })
`);
writeFileSync(new URL('bench.mbt', folder), `
#export_name("run")
pub fn run(peer : Int, reuse : Bool, scenario : Int, count : Int) -> Int {
  let mut source = "/users/{id}"
  let mut q = "中文 moon bit"
  let tags : Array[String] = ["sdk", "api", "test"]
  if scenario == 1 { source = "/users/{id}{?q,tags*}" }
  if scenario == 2 {
    let b = StringBuilder()
    for i = 0; i < 50; i = i + 1 { b.write_string("/s/{id}") }
    source = b.to_string()
  }
  if scenario == 3 {
    source = "{q}"
    let b = StringBuilder()
    for i = 0; i < 10000; i = i + 1 { b.write_string("😀") }
    q = b.to_string()
  }
  let limit = if scenario == 3 { 32 } else { 1048576 }
  let mut checksum = 0
  if peer == 0 {
    let v = @ours.Variables::from_entries([("id", @ours.Scalar("42")), ("q", @ours.Scalar(q)), ("tags", @ours.List(tags))]).unwrap()
    let limits = @ours.ExpansionLimits::new(max_output_bytes=limit)
    let t = @ours.parse_with_limits(source, @ours.ParseLimits::new()).unwrap()
    for i = 0; i < count; i = i + 1 {
      let current = if reuse { t } else { @ours.parse_with_limits(source, @ours.ParseLimits::new()).unwrap() }
      checksum = checksum + (match current.expand(v, limits~) { Ok(s) => s.length(); Err(_) => if scenario == 3 { 1 } else { -100000 } })
    }
  } else if peer == 1 {
    let v : Map[String, @magic.UriValue] = Map([("id", @magic.Scalar("42")), ("q", @magic.Scalar(q)), ("tags", @magic.List(tags))])
    try {
      let t = @magic.UriTemplate::parse(source)
      for i = 0; i < count; i = i + 1 {
        let current = if reuse { t } else { @magic.UriTemplate::parse(source) }
        checksum = checksum + (try { current.expand_with_limit(v, max_output_length=limit).length() } catch { _ => if scenario == 3 { 1 } else { -100000 } })
      }
    } catch { _ => return -100000 }
  } else {
    let v = [("id", @jsj.Scalar("42")), ("q", @jsj.Scalar(q)), ("tags", @jsj.List(tags))]
    let t = @jsj.parse(source).unwrap()
    for i = 0; i < count; i = i + 1 {
      let current = if reuse { t } else { @jsj.parse(source).unwrap() }
      checksum = checksum + (match current.expand(v, max_output=limit) { Ok(s) => s.length(); Err(_) => if scenario == 3 { 1 } else { -100000 } })
    }
  }
  checksum
}
`);
const build = spawnSync(fileURLToPath(new URL('./moon', import.meta.url)), ['build', '--target', 'js', '--release'], { cwd: folder, encoding: 'utf8' });
if (build.error || build.status !== 0) throw new Error(build.stdout + build.stderr);
const { run } = await import(new URL('_build/js/release/build/audit/benchmark/benchmark.js', work).href);
const samples = [];
const expected = [9, '/users/42?q=%E4%B8%AD%E6%96%87%20moon%20bit&tags=sdk&tags=api&tags=test'.length, 250, 1];
for (let scenario = 0; scenario < 4; scenario++) {
  const iterations = scenario === 3 ? 100 : scenario === 2 ? 500 : 10000;
  for (const reuse of [false, true]) {
    const values = [[], [], []];
    for (let peer = 0; peer < 3; peer++) for (let warm = 0; warm < 3; warm++) run(peer, reuse, scenario, Math.min(iterations, 100));
    for (let round = 0; round < 7; round++) {
      for (let step = 0; step < 3; step++) {
        const peer = (step + round) % 3, start = process.hrtime.bigint();
        const checksum = run(peer, reuse, scenario, iterations);
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        if (checksum !== expected[scenario] * iterations) throw new Error(`Checksum mismatch: ${peer}/${scenario}: ${checksum}`);
        values[peer].push(ms);
      }
    }
    samples.push({ scenario: ['scalar-path', 'unicode-query-list', '50-expressions', 'output-budget-failure'][scenario],
      reuse, iterations, expectedChecksum: expected[scenario] * iterations,
      peers: Object.fromEntries(['ours', 'magic', 'jsj'].map((name, peer) => {
        const sorted = [...values[peer]].sort((a,b) => a-b);
        return [name, { rawMs: values[peer], medianMs: sorted[3], maxMs: sorted[6] }];
      })) });
  }
}
const report = { status: 'passed', measuredAt: new Date().toISOString(), node: process.version, cpu: cpus()[0].model, platform: platform(), arch: arch(),
  scope: 'JS release core, 3 warmups, 7 rotated-order samples; setup included once per sample, parse-only cost is not isolated. Bounded public APIs, but input checking semantics differ. No allocation/RSS or cross-platform superiority claim.',
  sourceSha256: digest.stdout.trim(), peerAudit: audit.peers, samples };
writeFileSync(new URL('../reports/peer-benchmark.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
for (const s of samples) console.log(s.scenario, s.reuse ? 'reuse' : 'parse-each', Object.fromEntries(Object.entries(s.peers).map(([k,v]) => [k, +v.medianMs.toFixed(3)])));
