"""Build the playback-only FrameViewer extraction without changing its source repo."""
from pathlib import Path
import os
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'native' / 'frameviewer'
SDK = Path(os.environ.get('FRAMEVIEWER_SOURCE', ROOT.parent / 'trie_frameviewer'))
QT = Path(os.environ.get('QT_ROOT', SDK / '.tools' / 'Qt' / '6.8.3' / 'msvc2022_64'))
FFMPEG = Path(os.environ.get('FFMPEG_ROOT', SDK / '.tools' / 'ffmpeg'))
ENV = {key.upper(): value for key, value in os.environ.items()}
ENV['PATH'] = str(QT / 'bin') + os.pathsep + str(FFMPEG / 'bin') + os.pathsep + ENV.get('PATH', '')

def run(args):
    subprocess.run([str(arg) for arg in args], cwd=ROOT, env=ENV, check=True)

def main():
    if not (QT / 'bin' / 'windeployqt.exe').exists() or not (FFMPEG / 'include').exists():
        raise SystemExit('Qt 6.8.3 / FFmpeg SDK missing. Set QT_ROOT and FFMPEG_ROOT, or FRAMEVIEWER_SOURCE to your trie_frameviewer checkout.')
    build = SOURCE / 'media-build'
    runtime = SOURCE / 'media-runtime'
    run(['cmake', '-S', SOURCE, '-B', build, '-G', 'Visual Studio 18 2026', '-A', 'x64',
         f'-DCMAKE_PREFIX_PATH={QT}', f'-DFFMPEG_ROOT={FFMPEG}'])
    run(['cmake', '--build', build, '--config', 'Release', '--parallel', '4', '--', '/nodeReuse:false'])
    try:
        run(['ctest', '--test-dir', build, '-C', 'Release', '--output-on-failure'])
    finally:
        for name in ['test-results.txt']:
            report = build / name
            if report.exists():
                print(report.read_text(encoding='utf-8'), flush=True)
    run(['cmake', '--install', build, '--config', 'Release', '--prefix', runtime])
    run([QT / 'bin' / 'windeployqt.exe', '--release', '--no-translations', '--no-quick-import', runtime / 'MoodframeMedia.exe'])
    run([__import__('sys').executable, ROOT / 'scripts' / 'test_media_engine.py', runtime])
    print(f'Media backend runtime ready: {runtime}')

if __name__ == '__main__':
    main()
