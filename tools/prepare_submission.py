#!/usr/bin/env python3
"""Collect current review evidence without publishing or changing the application."""
import datetime
import hashlib
import json
import shutil
import zipfile
from pathlib import Path
from source_digest import source_digest

ROOT = Path(__file__).resolve().parent.parent
sha = lambda data: hashlib.sha256(data).hexdigest()
load = lambda name: json.loads((ROOT / name).read_text())
verification = load("reports/verification.json")
release = load("reports/release.json")
digest = source_digest(ROOT)
if verification.get("status") != "passed" or verification["source_sha256"] != digest:
    raise SystemExit("Current source has not passed verification")
if release.get("source_sha256") != digest or not release.get("tested_from_extracted_archive"):
    raise SystemExit("Current release has not passed extracted-archive tests")
archive = ROOT / release["archive"]
if sha(archive.read_bytes()) != release["sha256"]:
    raise SystemExit("Release archive changed")
live = load("reports/github-integration-portable-live.json")
links = load("reports/github-links-portable-live.json")
if (links.get("status") != "passed" or links.get("evidence") != "live-github-api"
        or links.get("portableArchiveSha256") != release["sha256"]
        or links.get("executionPath") != "incremental-catalog-sdk"
        or links.get("networkCalls") != 5 or links.get("update", {}).get("recomputed") != 2
        or not links.get("oldSnapshotPreserved")
        or links.get("rejectedPatch", {}).get("networkCalls") != 0):
    raise SystemExit("Incremental real consumer evidence is missing or stale")
faults = load("reports/integration-faults.json")
upgrades = load("reports/integration-upgrades.json")
browser = load("reports/playground-browser.json")
engine = sha((ROOT / "dist/engine.mjs").read_bytes())
manifest = sha((ROOT / "integrations/github-audit/requests.json").read_bytes())
for record in (live, links, faults, upgrades):
    if record["status"] != "passed" or record["engineSha256"] != engine or record["manifestSha256"] != manifest:
        raise SystemExit("Integration evidence is failed or stale")
for record in (faults, upgrades):
    if record.get("sourceSha256") != digest:
        raise SystemExit("Fault/upgrade evidence does not match all current source dependencies")
if browser.get("status") != "passed":
    raise SystemExit("Browser acceptance has not passed")
for name, expected in {**browser["sourceFiles"], **browser["screenshots"]}.items():
    if sha((ROOT / name).read_bytes()) != expected:
        raise SystemExit("Browser evidence is stale: " + name)
if live.get("evidence") != "live-github-api" or len(live["responses"]) != 9:
    raise SystemExit("Nine real GitHub responses are required")
if live.get("portableArchiveSha256") != release["sha256"]:
    raise SystemExit("Real consumer evidence does not match the portable archive")
if live.get("executionPath") != "typed-catalog-sdk":
    raise SystemExit("Real consumer evidence must use the typed catalog SDK")
if (upgrades.get("evidence") != "intentional-upgrade-rehearsal"
        or len(upgrades.get("results", [])) != 6
        or upgrades.get("reviewerSha256") != sha((ROOT / "integrations/github-audit/upgrade.mjs").read_bytes())
        or upgrades.get("contractsSha256") != sha((ROOT / "integrations/github-audit/contracts.mjs").read_bytes())):
    raise SystemExit("Upgrade review evidence is missing or stale")
peer_path = sorted((ROOT / "reports").glob("peer-audit-????????.json"))[-1]
peer = json.loads(peer_path.read_text())
benchmark = load("reports/peer-benchmark.json")
if peer["status"] != "passed" or peer["ours_source_sha256"] != digest:
    raise SystemExit("Peer audit is stale")
if benchmark["status"] != "passed" or benchmark["sourceSha256"] != digest:
    raise SystemExit("Peer benchmark is stale")
destination = ROOT / "_build/submission"
destination.mkdir(exist_ok=True)
bundle = destination / "moonbit-uri-template-review-0.2.0"
if bundle.exists():
    shutil.rmtree(bundle)  # generated directory only, never source/user documents
bundle.mkdir()
files = [
    "docs/RESUBMISSION.md", "docs/REVIEW_EVIDENCE.md", "docs/ORGANIZER_EMAIL.txt",
    "docs/COMPARISON.md", "docs/PERFORMANCE.md", "docs/API.md", "docs/SDK.md", "docs/OPTIMIZATION.md",
    "integrations/github-audit/README.md",
    "reports/verification.json", "reports/release.json", "reports/peer-benchmark.json",
    "reports/github-links-portable-live.json",
    "reports/github-integration-portable-live.json", "reports/integration-faults.json", "reports/integration-upgrades.json",
    "reports/history/github-integration-anonymous-failed.json",
    "reports/tests-js.log", "reports/tests-wasm.log", "reports/tests-wasm-gc.log",
    "reports/tests-native.log", "reports/tests-cli.log", "reports/tests-workflow.log",
    "reports/tests-sdk.log", "reports/sdk-package.json", "reports/sdk-package.log",
    "reports/tests-playground.log", "reports/playground-browser.json",
    "reports/playground-desktop.png", "reports/playground-mobile.png", "reports/playground-mobileResult.png",
    "reports/release-cli.log", str(peer_path.relative_to(ROOT)),
]
files += sorted(str(p.relative_to(ROOT)) for p in (ROOT / "reports").glob("peer-*-" + peer_path.stem[-8:] + ".log"))
for name in files:
    target = bundle / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / name, target)
shutil.copyfile(archive, bundle / archive.name)
(bundle / "READ_FIRST.txt").write_text(
    "Start with docs/RESUBMISSION.md and docs/REVIEW_EVIDENCE.md.\n"
    "The portable release includes the full Mooncakes source archive.\n"
    "This is a local review package, not a published release or submitted application.\n"
    "The technical supplement and draft email are AI-assisted; the entrant must independently write the application proposal as required by the form.\n",
    encoding="utf8",
)
checksums = {str(p.relative_to(bundle)): sha(p.read_bytes()) for p in sorted(bundle.rglob("*")) if p.is_file()}
(bundle / "SHA256SUMS.json").write_text(json.dumps(checksums, indent=2) + "\n")
output = destination / (bundle.name + ".zip")
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zipped:
    for path in sorted(bundle.rglob("*")):
        if path.is_file():
            zipped.write(path, path.relative_to(bundle.parent))
with zipfile.ZipFile(output) as zipped:
    assert zipped.testzip() is None
    for name, expected in checksums.items():
        assert sha(zipped.read(bundle.name + "/" + name)) == expected
(ROOT / "reports/submission.json").write_text(json.dumps({
    "status": "prepared", "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "sourceSha256": digest, "archive": str(output.relative_to(ROOT)), "sha256": sha(output.read_bytes()),
    "published": False, "formSubmitted": False, "emailSent": False,
    "files": list(checksums),
}, indent=2) + "\n")
print(output)
