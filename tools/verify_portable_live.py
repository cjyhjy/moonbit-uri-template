#!/usr/bin/env python3
"""Run the real downstream app from an extracted, checksum-verified distribution."""
import hashlib
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
release = json.loads((ROOT / "reports/release.json").read_text())
archive = ROOT / release["archive"]
archive_sha = hashlib.sha256(archive.read_bytes()).hexdigest()
if archive_sha != release["sha256"]:
    raise SystemExit("Archive checksum mismatch")
report_path = ROOT / "reports/github-integration-portable-live.json"
with tempfile.TemporaryDirectory(prefix="uri-real-consumer-") as temp:
    with zipfile.ZipFile(archive) as zipped:
        for name in zipped.namelist():
            path = Path(name)
            if path.is_absolute() or ".." in path.parts:
                raise SystemExit("Unsafe archive path")
        zipped.extractall(temp)
    installed = Path(temp) / ("moonbit-uri-template-" + release["version"])
    checksums = json.loads((installed / "SHA256SUMS.json").read_text())
    for name, expected in checksums.items():
        if hashlib.sha256((installed / name).read_bytes()).hexdigest() != expected:
            raise SystemExit("Extracted file changed: " + name)
    result = subprocess.run([
        "node", "integrations/github-audit/main.mjs", "--gh",
        "integrations/github-audit/requests.json", str(report_path),
    ], cwd=installed)
    if not report_path.exists():
        raise SystemExit("Consumer produced no report")
    report = json.loads(report_path.read_text())
    report["portableArchiveSha256"] = archive_sha
    report["consumerMode"] = "fresh extracted archive; no source-checkout imports"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    if result.returncode or report["status"] != "passed":
        raise SystemExit("Real downstream run failed; see recorded report")
    if (report.get("executionPath") != "typed-catalog-sdk"
            or not report.get("sdk", {}).get("inspection", {}).get("ok")
            or len(report["sdk"]["inspection"].get("requests", [])) != 9
            or len(report.get("responses", [])) != 9):
        raise SystemExit("Live evidence must exercise the typed catalog SDK for all nine requests")
    links_path = ROOT / "reports/github-links-portable-live.json"
    result = subprocess.run(["node", "integrations/github-audit/link-selection.mjs", "--gh", str(links_path)], cwd=installed)
    if not links_path.exists(): raise SystemExit("Incremental consumer produced no report")
    links = json.loads(links_path.read_text())
    links["portableArchiveSha256"] = archive_sha
    links["consumerMode"] = "fresh extracted archive; no source-checkout imports"
    links_path.write_text(json.dumps(links, ensure_ascii=False, indent=2) + "\n")
    if (result.returncode or links.get("status") != "passed" or links.get("executionPath") != "incremental-catalog-sdk"
            or links.get("networkCalls") != 5 or links["update"]["recomputed"] != 2
            or len(links["initial"]["responses"]) != 3 or len(links["refreshed"]["responses"]) != 2
            or not links.get("oldSnapshotPreserved")):
        raise SystemExit("Incremental real downstream run failed")
print("Portable downstream: nine audit responses plus five incremental-client responses verified")
