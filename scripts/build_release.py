"""Build a release without embedding the developer's local paths in Rust binaries."""
from pathlib import Path
import os
import shlex
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    env = dict(os.environ)
    encoded = env.pop('CARGO_ENCODED_RUSTFLAGS', None)
    flags = encoded.split('\x1f') if encoded else shlex.split(env.pop('RUSTFLAGS', ''))
    # Dependency panic locations can expose CARGO_HOME, even in stripped builds.
    paths = [(Path.home(), '/build/home'), (ROOT.parent, '/build/workspace')]
    if env.get('CARGO_HOME'):
        paths.append((Path(env['CARGO_HOME']), '/build/cargo'))
    if env.get('RUSTUP_HOME'):
        paths.append((Path(env['RUSTUP_HOME']), '/build/rustup'))
    for source, replacement in paths:
        for prefix in {str(source.resolve()), source.resolve().as_posix()}:
            flags.append(f'--remap-path-prefix={prefix}={replacement}')
    env['CARGO_ENCODED_RUSTFLAGS'] = '\x1f'.join(flags)
    cli = ROOT / 'node_modules' / '@tauri-apps' / 'cli' / 'tauri.js'
    subprocess.run(['node', str(cli), 'build', *sys.argv[1:]], cwd=ROOT, env=env, check=True)


if __name__ == '__main__':
    main()
