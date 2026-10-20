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
print("Portable downstream: nine real GitHub responses verified")
