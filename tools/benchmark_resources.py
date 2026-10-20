#!/usr/bin/env python3
"""Fresh-process, pinned-peer timings and peak RSS; no compiler in measured child."""
import argparse
import datetime
import hashlib
import json
import platform
import resource
import shutil
import statistics
import subprocess
import sys
import time
from urllib.parse import quote
from pathlib import Path

from source_digest import source_digest

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "_build/peer-audit"
MODULES = {
    "ours": ("cjyhjy/uri_template", "0.2.0"),
    "magic": ("Magic486/moon-uri-template", "0.1.2"),
    "jsj": ("JSJ222/moonuritemplate", "0.2.0"),
}
# Fixed workloads, deliberately identical before/after optimization.
CASES = {
    "variables512": (500, 512, ("ours", "magic", "jsj")),
    "contract512": (1000, 512, ("ours", "jsj")),
    "session200-one": (1000, 201, ("ours", "jsj")),
    "session200-all": (200, 400, ("ours", "jsj")),
    "session200-shared": (200, 400, ("ours", "jsj")),
    "session200-retained": (1000, 201, ("ours", "jsj")),
    "batch200-one": (1000, 200, ("ours", "jsj")),
    "audit200": (1000, 100, ("ours", "jsj")),
}
MIXED_VALUE = "中文😀 /%20"
MIXED_URI = "/items/team%2Fa?" + "&".join(
    ["tags=" + quote(MIXED_VALUE, safe="-._~")] * 1024
    + ["k" + str(i) + "=" + quote(MIXED_VALUE, safe="-._~") for i in range(128)]
)
CASES["mixed-collections"] = (100, len(MIXED_URI), ("ours", "magic", "jsj"))


def source(peer, case, iterations):
    after = ""
    setup = """
  let entries = []
  let text = StringBuilder()
  for i = 0; i < 512; i = i + 1 {
    let name = "v" + i.to_string()
    entries.push((name, @p.Scalar("a")))
    text.write_string("{" + name + "}")
  }
"""
    if case.startswith("session"):
        setup = """
  let definitions = []
  let entries = []
  for i = 0; i < 200; i = i + 1 {
    let name = "v" + i.to_string()
    definitions.push((name, "{" + name + "}"))
    entries.push((name, @p.Scalar("a")))
  }
  let catalog = @p.compile_catalog(definitions).unwrap()
"""
        if peer == "ours":
            setup += "  let values = @p.Variables::from_entries(entries).unwrap()\n"
            change = "SetBinding"
        else:
            setup += "  let values = entries\n"
            change = "SetBinding"
        setup += """  let initial = catalog.start_session(values).unwrap()
  let patch_a = []
  let patch_b = []
"""
        size = 200 if case.endswith("all") else 1
        if case.endswith("shared"):
            setup = setup.replace('definitions.push((name, "{" + name + "}"))',
                                  'definitions.push((name, "{shared}"))')
            setup = setup.replace('entries.push((name, @p.Scalar("a")))',
                                  'if i == 0 { entries.push(("shared", @p.Scalar("a"))) }')
        setup += f"""  for i = 0; i < {size}; i = i + 1 {{
    let name = "v" + i.to_string()
    patch_a.push(@p.{change}(name, @p.Scalar("a")))
    patch_b.push(@p.{change}(name, @p.Scalar("b")))
  }}
"""
        if case.endswith("shared"):
            setup = setup.replace('patch_a.push(@p.SetBinding(name,', 'patch_a.push(@p.SetBinding("shared",')
            setup = setup.replace('patch_b.push(@p.SetBinding(name,', 'patch_b.push(@p.SetBinding("shared",')
        state = "let mut session = initial"
        total = "total_bytes" if peer == "ours" else "total_length"
        step = f"""
    let update = session.update(if i % 2 == 0 {{ patch_b }} else {{ patch_a }}).unwrap()
    session = update.session()
    checksum = checksum + session.{total}() + update.recomputed()
"""
        # Full value check outside the clock prevents plausible length-only success.
        check = """
  let first = initial.update(patch_b).unwrap()
  for (name, uri) in first.session().links() {
    if uri != (if NAME_TEST { "b" } else { "a" }) { abort("bad updated URI") }
  }
  for (_, uri) in initial.links() { if uri != "a" { abort("mutated snapshot") } }
""".replace("NAME_TEST", 'name == "v0"' if size == 1 and not case.endswith("shared") else "true")
        if case.endswith("retained"):
            state += "\n    let history = [initial]"
            step += "\n    history.push(session)"
            after = f"""
    if history.length() != count + 1 {{ abort("missing retained snapshots") }}
    for snapshot in history {{
      if snapshot.{total}() != 200 {{ abort("old snapshot size changed") }}
    }}
    for (name, uri) in history[1].links() {{
      if uri != (if name == "v0" {{ "b" }} else {{ "a" }}) {{ abort("old snapshot content changed") }}
    }}
"""
    elif case in ("audit200", "batch200-one"):
        state = ""
        setup = """
  let definitions = []
  for i = 0; i < 200; i = i + 1 {
    let name = "v" + i.to_string()
    definitions.push((name, SOURCE))
  }
  let catalog = @p.compile_catalog(definitions).unwrap()
"""
        if case == "audit200":
            setup = setup.replace("SOURCE", 'if i % 2 == 0 { "{+x}" } else { "{x}" }')
            policy = ('@p.TemplatePolicy::new(allow_reserved=false)' if peer == "ours" else
                      '{ ..@p.permissive_policy(), allow_reserved: false }')
            setup += f"  let policy : @p.TemplatePolicy = {policy}\n"
            field = "total_findings" + ("" if peer == "ours" else "()")
            step = f"checksum = checksum + catalog.audit(policy).unwrap().{field}"
            check = f'  if catalog.audit(policy).unwrap().{field} != 100 {{ abort("wrong audit findings") }}'
        else:
            setup = setup.replace("SOURCE", '"{" + name + "}"')
            # Both alternatives are prepared once: no catalog compilation, full
            # input reconstruction or artificial session restart inside timing.
            setup += """  let requests_a : Array[@p.CatalogRequest] = []
  let requests_b : Array[@p.CatalogRequest] = []
  for i = 0; i < 200; i = i + 1 {
    let name = "v" + i.to_string()
    let a = [(name, @p.Scalar("a"))]
    let b = [(name, @p.Scalar(if i == 0 { "b" } else { "a" }))]
    REQUESTS
  }
"""
            req = ('requests_a.push(@p.CatalogRequest::new(name, @p.Variables::from_entries(a).unwrap()))\n'
                   'requests_b.push(@p.CatalogRequest::new(name, @p.Variables::from_entries(b).unwrap()))'
                   if peer == "ours" else
                   'requests_a.push({ name, bindings: a })\nrequests_b.push({ name, bindings: b })')
            setup = setup.replace("REQUESTS", req)
            method = "expand_batch" if peer == "ours" else "expand_requests"
            step = f"""
    let outputs = catalog.{method}(if i % 2 == 0 {{ requests_b }} else {{ requests_a }}).unwrap()
    for uri in outputs {{ checksum = checksum + uri.length() }}
"""
            check = f"""
  let outputs = catalog.{method}(requests_b).unwrap()
  if outputs.length() != 200 {{ abort("missing batch output") }}
  for index, uri in outputs {{
    if uri != (if index == 0 {{ "b" }} else {{ "a" }}) {{ abort("wrong batch output") }}
  }}
"""
    else:
        state = ""
        if case == "mixed-collections":
            assoc = "@p.OrderedEntries::from_entries(pairs).unwrap()" if peer == "ours" else "pairs"
            setup = f"""
  let pairs = []
  for i = 0; i < 128; i = i + 1 {{ pairs.push(("k" + i.to_string(), "{MIXED_VALUE}")) }}
  let entries = [
    ("id", @p.Scalar("team/a")),
    ("tags", @p.List(Array::make(1024, "{MIXED_VALUE}"))),
    ("filters", @p.Assoc({assoc})),
  ]
  let text = StringBuilder()
  text.write_string("/items/{{id}}{{?tags*,filters*}}")
"""
        if peer == "ours":
            setup += """  let values = @p.Variables::from_entries(entries).unwrap()
  let template = @p.parse_with_limits(text.to_string(), @p.ParseLimits::new()).unwrap()
  let limits = @p.ExpansionLimits::new()
"""
            expand = "template.expand(values, limits~).unwrap()"
        elif peer == "jsj":
            setup += """  let values = entries
  let template = @p.parse(text.to_string()).unwrap()
"""
            expand = "template.expand(values, max_output=1048576).unwrap()"
        else:
            setup += """  let values = Map(entries)
  let template = @p.UriTemplate::parse(text.to_string())
"""
            expand = "template.expand_with_limit(values, max_output_length=1048576)"
        if case == "contract512":
            setup += "  let rules : Array[@p.BindingRule] = []\n  let required : Array[String] = []\n"
            setup += "  for (name, _) in entries {\n"
            setup += ('    rules.push({ name, kind: @p.ScalarKind })\n'
                      if peer == "ours" else
                      '    rules.push({ name, kind: @p.TextValue, required: true })\n')
            setup += "    required.push(name)\n  }\n"
            setup += ("  let contract = template.with_contract(rules, required~).unwrap()\n"
                      if peer == "ours" else
                      "  let contract = template.with_contract(rules).unwrap()\n")
            step = "contract.validate(values).unwrap()\n    checksum = checksum + 512"
            bad = ('@p.Variables::from_entries([("v0", @p.List([]))]).unwrap()'
                   if peer == "ours" else '[("v0", @p.List([]))]')
            check = f"""
  if contract.validate({bad}) is Ok(_) {{ abort("invalid contract accepted") }}
  if contract.expand(values).unwrap().length() != 512 {{ abort("bad contract output") }}
"""
        else:
            step = f"checksum = checksum + {expand}.length()"
            if case == "mixed-collections":
                check = f'  if {expand} != {json.dumps(MIXED_URI)} {{ abort("incorrect mixed Unicode expansion") }}'
            else:
                check = f"""
  let actual = {expand}
  if actual.length() != 512 {{ abort("bad expansion length") }}
  for c in actual.iter() {{ if c != 'a' {{ abort("bad expansion content") }} }}
"""
    expected = CASES[case][1]
    # Setup and correctness probes are excluded from the inner clock but included in RSS.
    # Warm-up uses the identical loop with an independent session snapshot.
    main = ('try { exercise() } catch { _ => abort("benchmark failed") }'
            if peer == "magic" else "exercise()")
    return f"""fn exercise() -> Unit {"raise" if peer == "magic" else ""} {{
{setup}
{check}
  for round = 0; round < 4; round = round + 1 {{
    {state}
    let count = if round == 3 {{ {iterations} }} else {{ 50 }}
    let mut checksum = 0
    let start = @bench.monotonic_clock_start()
    for i = 0; i < count; i = i + 1 {{
      {step}
    }}
    let elapsed_us = @bench.monotonic_clock_end(start)
{after}
    if checksum != count * {expected} {{ abort("bad checksum") }}
    if round == 3 {{
      println(checksum)
      println(elapsed_us)
    }}
  }}
}}
fn main {{
  {main}
}}
"""


def measure_child(command):
    """This helper is a fresh Python process with exactly one child."""
    started = time.perf_counter()
    result = subprocess.run(command, capture_output=True, text=True, timeout=120)
    wall_ms = (time.perf_counter() - started) * 1000
    rss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    lines = result.stdout.strip().splitlines()
    if len(lines) != 2:
        raise RuntimeError("Unexpected benchmark output: " + result.stdout)
    return {
        "checksum": int(lines[0]),
        "elapsedMs": float(lines[1]) / 1000,
        "processWallMs": wall_ms,
        "peakRssBytes": int(rss if sys.platform == "darwin" else rss * 1024),
    }


def run(output, targets, rounds):
    if sys.platform not in ("darwin", "linux"):
        raise RuntimeError("RSS units are only normalized on macOS and Linux")
    audit_path = sorted((ROOT / "reports").glob("peer-audit-????????.json"))[-1]
    audit = json.loads(audit_path.read_text())
    if audit["status"] != "passed":
        raise RuntimeError("Run compare:peers first")
    for p in ROOT.glob("*.mbt"):
        if not p.name.endswith(("_test.mbt", "_wbtest.mbt")):
            if p.read_bytes() != (WORK / "ours" / p.name).read_bytes():
                raise RuntimeError("Core changed; run compare:peers")
    for peer in ("magic", "jsj"):
        pin = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=WORK/peer, text=True).strip()
        dirty = subprocess.check_output(["git", "status", "--porcelain"], cwd=WORK/peer, text=True).strip()
        if pin != audit["peers"][peer]["commit"] or dirty:
            raise RuntimeError("Peer checkout changed: " + peer)
    report = {
        "status": "running",
        "measuredAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "sourceSha256": source_digest(ROOT),
        "gitHead": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "cpu": (subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"], text=True).strip()
                if sys.platform == "darwin" else platform.processor()),
        "node": subprocess.check_output(["node", "--version"], text=True).strip(),
        "toolchain": audit["toolchain"],
        "peers": {p: audit["peers"][p]["commit"] for p in ("magic", "jsj")},
        "method": {
            "rounds": rounds, "warmupsPerProcess": 3, "warmupIterations": 50,
            "elapsedMs": "Monotonic time inside each fresh release executable, setup excluded.",
            "peakRssBytes": "Whole child process peak, including setup/warmups/runtime. Not library allocation or timed-window RSS.",
            "processWallMs": "Fresh executable startup plus setup, warmup and measured loop; compiler excluded.",
            "execution": "One peer per executable; rounds rotate peer order; sequential execution.",
            "semantics": "Public bounded APIs retain each library's checks. Limits and input representations differ.",
            "coverage": "One host; no claim of all-platform superiority. Magic lacks matching public contract/session APIs.",
        },
        "samples": [],
    }
    def save():
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    save()
    previous_workspace = (WORK / "moon.work").read_bytes()
    try:
        members = ["ours", "magic", "jsj"]
        for case, (iterations, _, peers) in CASES.items():
            for peer in peers:
                name = "resources_" + peer + "_" + case.replace("-", "_")
                folder = WORK / name
                folder.mkdir(exist_ok=True)
                module, version = MODULES[peer]
                (folder/"moon.mod").write_text(f'name = "audit/{name}"\nimport {{ "{module}@{version}" }}\n')
                (folder/"moon.pkg").write_text(
                    f'import {{ "{module}" @p, "moonbitlang/core/bench" @bench }}\n'
                    'pkgtype(kind: "executable")\n')
                (folder/"main.mbt").write_text(source(peer, case, iterations))
                members.append(name)
        (WORK/"moon.work").write_text("members = " + json.dumps(members) + "\n")
        for target in targets:
            commands = {}
            build = subprocess.run([str(ROOT/"tools/moon"), "build", "--target", target, "--release"],
                                   cwd=WORK/members[3], capture_output=True, text=True)
            if build.returncode:
                raise RuntimeError(build.stdout + build.stderr)
            for name in members[3:]:
                suffix = {"native": "exe", "js": "js", "wasm": "wasm", "wasm-gc": "wasm"}[target]
                binary = WORK/f"_build/{target}/release/build/audit/{name}/{name}.{suffix}"
                command = ([shutil.which("node")] if target == "js" else
                           [str(ROOT/".toolchain/bin/moonrun")] if target.startswith("wasm") else [])
                commands[name] = (command + [str(binary)], hashlib.sha256(binary.read_bytes()).hexdigest())
            for case, (iterations, expected, peers) in CASES.items():
                item = {"target": target, "scenario": case, "iterations": iterations,
                        "expectedChecksum": iterations * expected, "peers": {}}
                report["samples"].append(item)
                for peer in peers:
                    name = "resources_" + peer + "_" + case.replace("-", "_")
                    command, binary_sha = commands[name]
                    item["peers"][peer] = {"binarySha256": binary_sha, "command": command, "raw": []}
                for round_index in range(rounds):
                    for offset in range(len(peers)):
                        peer = peers[(offset + round_index) % len(peers)]
                        data = item["peers"][peer]
                        helper = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--child",
                                                 json.dumps(data["command"])], capture_output=True, text=True, timeout=135)
                        if helper.returncode:
                            raise RuntimeError(helper.stdout + helper.stderr)
                        sample = json.loads(helper.stdout)
                        if sample["checksum"] != item["expectedChecksum"]:
                            raise RuntimeError("Checksum mismatch")
                        data["raw"].append(sample)
                    save()
                for data in item["peers"].values():
                    for key in ("elapsedMs", "processWallMs", "peakRssBytes"):
                        data[key] = {"median": statistics.median(s[key] for s in data["raw"]),
                                     "min": min(s[key] for s in data["raw"]),
                                     "max": max(s[key] for s in data["raw"])}
                print(target, case, {p: round(d["elapsedMs"]["median"], 3) for p, d in item["peers"].items()}, flush=True)
                save()
        report["status"] = "passed"
    except BaseException as error:
        report["status"] = "failed"
        report["error"] = str(error)
        raise
    finally:
        (WORK/"moon.work").write_bytes(previous_workspace)
        save()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--child", help=argparse.SUPPRESS)
    parser.add_argument("--output", type=Path, default=ROOT/"reports/peer-resources.json")
    parser.add_argument("--targets", nargs="+", choices=("js", "wasm", "wasm-gc", "native"),
                        default=["js", "wasm", "wasm-gc", "native"])
    parser.add_argument("--rounds", type=int, default=5)
    args = parser.parse_args()
    if args.child:
        print(json.dumps(measure_child(json.loads(args.child))))
    else:
        if args.rounds < 3:
            parser.error("At least three independent processes per peer are required")
        run(args.output, args.targets, args.rounds)
