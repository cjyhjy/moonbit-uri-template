#!/usr/bin/env python3
"""Install the pinned official MoonBit toolchain inside this checkout only."""
import hashlib
import json
import os
import platform
import subprocess
import tarfile
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = json.loads((ROOT/'toolchain.lock.json').read_text())
INSTALL = ROOT/'.toolchain'
ENV = dict(os.environ, MOON_HOME=str(INSTALL), PATH=str(INSTALL/'bin')+os.pathsep+os.environ.get('PATH', ''))

def run(*args):
    subprocess.run(args, env=ENV, check=True)

def main():
    key = {('Darwin', 'arm64'): 'darwin-aarch64', ('Linux', 'x86_64'): 'linux-x86_64'}.get((platform.system(), platform.machine()))
    if key not in LOCK['archives']:
        raise SystemExit('Pinned bootstrap supports macOS arm64 and Linux x86_64; see README for other platforms.')
    moonc = INSTALL/'bin/moonc'
    if moonc.exists():
        current = subprocess.check_output([str(moonc), '-v'], env=ENV, text=True)
        if 'v'+LOCK['version']+' ' in current:
            print('Pinned toolchain already installed: '+current.strip())
            return
        raise SystemExit('Existing .toolchain has a different version. Move it aside before bootstrapping.')
    download = INSTALL/'downloads'
    download.mkdir(parents=True, exist_ok=True)
    version = urllib.parse.quote(LOCK['version'], safe='')
    archives = [
        (f'binaries/{version}/moonbit-{key}.tar.gz', 'compiler-pinned.tar.gz', LOCK['archives'][key]['sha256'], INSTALL),
        (f'cores/core-{version}.tar.gz', 'core-pinned.tar.gz', LOCK['core_sha256'], INSTALL/'lib'),
    ]
    for url_path, filename, checksum, destination in archives:
        target = download/filename
        if not target.exists():
            print('Downloading '+url_path, flush=True)
            urllib.request.urlretrieve('https://cli.moonbitlang.com/'+url_path, target)
        if hashlib.sha256(target.read_bytes()).hexdigest() != checksum:
            raise SystemExit('Checksum mismatch: '+str(target))
        destination.mkdir(parents=True, exist_ok=True)
        # Checksummed official archives; still reject traversal before extraction.
        with tarfile.open(target) as archive:
            for member in archive.getmembers():
                resolved = (destination/member.name).resolve()
                if destination.resolve() not in resolved.parents and resolved != destination.resolve():
                    raise SystemExit('Unsafe archive path: '+member.name)
                if member.issym() or member.islnk():
                    link = (resolved.parent/member.linkname).resolve()
                    if destination.resolve() not in link.parents and link != destination.resolve():
                        raise SystemExit('Unsafe archive link: '+member.name)
            archive.extractall(destination)
    for binary in (INSTALL/'bin').iterdir():
        if binary.is_file(): binary.chmod(binary.stat().st_mode | 0o111)
    tcc = INSTALL/'bin/internal/tcc'
    if tcc.exists(): tcc.chmod(tcc.stat().st_mode | 0o111)
    run(str(INSTALL/'bin/moon'), '-C', str(INSTALL/'lib/core'), 'bundle', '--warn-list', '-a', '--all')
    run(str(INSTALL/'bin/moon'), 'version', '--all')

if __name__ == '__main__': main()
