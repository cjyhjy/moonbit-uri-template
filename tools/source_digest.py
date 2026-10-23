"""Shared fingerprint for verification and portable packaging (includes UI sources)."""
import hashlib
from pathlib import Path

def source_digest(root: Path) -> str:
    entries = []
    entries.append(root/'.moonignore')
    for folder in ('openapi', 'adapter', 'cmd', 'examples', 'testdata', 'tools', 'bench', 'playground', 'integrations', 'sdk'):
        base = root/folder
        if base.exists():
            entries.extend(p for p in base.rglob('*') if p.is_file() and '__pycache__' not in p.parts)
    entries.extend(p for p in root.iterdir() if p.is_file() and p.suffix in ('.mbt', '.mbti', '.pkg', '.mod', '.json'))
    hashed = hashlib.sha256()
    for path in sorted(set(entries)):
        hashed.update(str(path.relative_to(root)).encode()+b'\0'+path.read_bytes()+b'\0')
    return hashed.hexdigest()
