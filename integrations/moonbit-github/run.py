#!/usr/bin/env python3
"""Run the MoonBit GitHub example using published Mooncakes dependencies.

From a clone: python3 tools/bootstrap.py, then run this file. A C compiler and
system TLS libraries are required (Xcode Command Line Tools on macOS; gcc and
libssl3 on Ubuntu). The first run downloads the hash-pinned GitHub description
and Mooncakes dependencies. By default it only prints a URL plan. --live sends
three public, read-only HTTPS requests using the native MoonBit binary.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import urllib.request

CLIENT = Path(__file__).resolve().parent
ROOT = CLIENT.parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--live', action='store_true', help='execute the planned read-only GitHub HTTPS requests')
    parser.add_argument('--requests', type=Path, default=CLIENT/'requests.json', help='client request configuration (default: bundled three-operation example)')
    args = parser.parse_args()
    metadata = json.loads((CLIENT/'upstream.json').read_text())
    cache = CLIENT/'_build/inputs'
    cache.mkdir(parents=True, exist_ok=True)
    description = cache/(metadata['sha256']+'.json')
    if not description.exists():
        url = f"https://raw.githubusercontent.com/{metadata['repository']}/{metadata['commit']}/{metadata['path']}"
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read(33554433)
        if len(data) > 33554432 or hashlib.sha256(data).hexdigest() != metadata['sha256']:
            raise RuntimeError('GitHub description checksum or size mismatch')
        description.write_bytes(data)
    if hashlib.sha256(description.read_bytes()).hexdigest() != metadata['sha256']:
        raise RuntimeError('cached description checksum mismatch; remove that cache file and retry')
    subprocess.run([str(ROOT/'tools/moon'), 'build', '--target', 'native'], cwd=CLIENT, stdout=sys.stderr, check=True)
    executable = CLIENT/'_build/native/debug/build/cmd/main/main.exe'
    command = [str(executable), str(description), str(args.requests.resolve())]
    if args.live:
        command.append('--live')
    return subprocess.run(command, cwd=CLIENT).returncode


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print('Native example could not run: '+str(error), file=sys.stderr)
        raise SystemExit(2)
