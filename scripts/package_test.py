"""Collect the release executable, its player runtime and installer into out/."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--label', default='', help='Optional suffix for a separate test build')
    label = parser.parse_args().label
    if label and not re.fullmatch(r'[A-Za-z0-9_-]+', label):
        raise SystemExit('Use letters, digits, underscores or hyphens for the build label')
    suffix = f'-{label}' if label else ''
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    target = Path(os.environ.get('CARGO_TARGET_DIR', ROOT / 'src-tauri' / 'target'))
    if not target.is_absolute():
        target = ROOT / target
    release = target / 'release'
    executable = release / 'moodframe.exe'
    runtime = ROOT / 'native' / 'frameviewer' / 'media-runtime'
    if not executable.is_file() or not (runtime / 'MoodframeMedia.exe').is_file():
        raise SystemExit('Build the release app and native player first: npm run build:app')
    output = ROOT / 'out'
    portable = output / f'Moodframe-v{version}{suffix}'
    portable.mkdir(parents=True, exist_ok=True)
    shutil.copy2(executable, portable / 'Moodframe.exe')
    shutil.copytree(runtime, portable / 'media', dirs_exist_ok=True)
    (portable / 'START-HERE.txt').write_text(
        f'Moodframe {version}\n\nRun Moodframe.exe. Keep the media folder beside it.\n'
        'Windows x64 and Microsoft Edge WebView2 Runtime are required.\n'
        'Use the setup EXE if WebView2 is missing.\n', encoding='utf-8')
    files = []
    for installer in (release / 'bundle' / 'nsis').glob(f'*{version}*.exe'):
        destination = output / (installer.stem + suffix + installer.suffix)
        shutil.copy2(installer, destination)
        files.append(destination)
    files.append(portable / 'Moodframe.exe')
    checksums = []
    for file in files:
        with file.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        checksums.append(f'{digest}  {file.relative_to(output).as_posix()}')
        print(file)
    (output / f'SHA256SUMS{suffix}.txt').write_text('\n'.join(checksums) + '\n', encoding='utf-8')

if __name__ == '__main__':
    main()
