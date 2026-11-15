"""Exercise the deployed, windowless engine over its real production wire protocol."""
from pathlib import Path
import json
import os
import queue
import struct
import subprocess
import sys
import tempfile
import threading
import time

def read_exact(stream, size):
    data = bytearray()
    while len(data) < size:
        chunk = stream.read(size - len(data))
        if not chunk:
            raise EOFError('Media backend closed its output')
        data.extend(chunk)
    return bytes(data)

class Client:
    def __init__(self, runtime):
        self.events = queue.Queue()
        self.errors = bytearray()
        environment = {k: v for k, v in os.environ.items() if not k.upper().startswith(('QT_', 'QML_'))}
        windows = Path(os.environ.get('WINDIR', 'C:/Windows'))
        environment['PATH'] = os.pathsep.join(map(str, [runtime, windows / 'System32', windows]))
        environment['QT_FORCE_STDERR_LOGGING'] = '1'
        environment['QT_PLUGIN_PATH'] = str(runtime)
        self.process = subprocess.Popen([str(runtime / 'MoodframeMedia.exe')], cwd=runtime, env=environment,
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                        creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._stderr, daemon=True).start()
        self.wait(lambda event: event.get('event') == 'ready')

    def _stderr(self):
        while chunk := self.process.stderr.read(1024):
            self.errors.extend(chunk)

    def _read(self):
        try:
            while True:
                magic, kind, size = struct.unpack('<4sII', read_exact(self.process.stdout, 12))
                assert magic == b'MFM1' and size <= 512 * 1024 * 1024
                body = read_exact(self.process.stdout, size)
                if kind == 1:
                    event = json.loads(body)
                else:
                    assert kind == 2
                    length, = struct.unpack_from('<I', body)
                    event = json.loads(body[4:4+length])
                    event.update(event='frame', pixels=body[4+length:], wire=body)
                self.events.put(event)
        except Exception as error:
            self.events.put({'event': 'reader-error', 'error': str(error)})

    def send(self, **message):
        self.process.stdin.write(json.dumps(message, ensure_ascii=False).encode('utf-8') + b'\n')
        self.process.stdin.flush()

    def ack(self, event):
        self.send(type='ack', session=event['session'], packet=event['packet'])

    def wait(self, predicate, timeout=10, ack=True):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            event = self.events.get(timeout=max(.001, end-time.monotonic()))
            if event['event'] == 'reader-error':
                raise AssertionError(event | {'stderr': self.errors.decode(errors='replace')})
            matched = predicate(event)
            if event['event'] == 'frame' and ack:
                self.ack(event)
            if matched:
                return event
        raise AssertionError('Timed out waiting for engine event')

    def close(self):
        if self.process.poll() is None:
            self.send(type='quit')
            self.process.wait(timeout=5)
        assert self.process.returncode == 0, self.errors.decode(errors='replace')

def main():
    runtime = Path(sys.argv[1]).resolve()
    assert not any(runtime.glob('Qt6Quick*.dll')) and not (runtime/'MoodframePlayer.exe').exists()
    with tempfile.TemporaryDirectory(prefix='moodframe-media-') as directory:
        clip = Path(directory) / 'trích mẫu #01.mp4'
        subprocess.run([str(runtime/'ffmpeg.exe'), '-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
                        'testsrc2=size=640x360:rate=24', '-t', '3', '-c:v', 'mpeg4', '-g', '48', str(clip)],
                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0, check=True)
        client = Client(runtime)
        try:
            client.send(type='open', session='cold-start-uuid', path=str(clip))
            client.wait(lambda e: e.get('event') == 'state' and e.get('loaded'))
            first = client.wait(lambda e: e['event'] == 'frame')
            artifacts = Path(__file__).resolve().parents[1] / 'artifacts'
            artifacts.mkdir(exist_ok=True)
            (artifacts / 'native-frame.bin').write_bytes(first['wire'])
            assert first['session'] == 'cold-start-uuid'
            assert (first['width'], first['height'], first['format']) == (640, 360, 'yuv420')
            assert sum(p['length'] for p in first['planes']) == len(first['pixels']) == 640*360*3//2
            assert len(first['matrix']) == 16
            client.send(type='control', session=first['session'], control='pause')
            identities = {}
            for target in [60, 3, 47, 0, 71, 36, 36]:
                client.send(type='control', session=first['session'], control='preview', value=target)
                client.send(type='control', session=first['session'], control='finishScrub')
                frame = client.wait(lambda e: e['event'] == 'frame' and e['index'] == target)
                if target in identities:
                    assert identities[target] == frame['identity'], 'Seek did not reuse the frame cache'
                identities[target] = frame['identity']
            client.send(type='close', session=first['session'])
            closed = client.wait(lambda e: e['event'] == 'closed')
            assert not closed['loaded'] and closed['cacheMiB'] == 0
            pid = client.process.pid
            client.send(type='open', session='warm-start-uuid', path=str(clip))
            second = client.wait(lambda e: e['event'] == 'frame' and e['session'] == 'warm-start-uuid', ack=False)
            assert client.process.pid == pid
            client.send(type='close', session='cold-start-uuid')
            client.send(type='control', session='warm-start-uuid', control='preview', value=24)
            client.send(type='control', session='warm-start-uuid', control='finishScrub')
            time.sleep(.1)
            buffered = []
            while not client.events.empty():
                event = client.events.get_nowait()
                assert event['event'] != 'frame', 'Unacknowledged frames must apply backpressure'
                buffered.append(event)
            client.ack(second)
            client.wait(lambda e: e['event'] == 'frame' and e['index'] == 24)
            client.send(type='close', session='warm-start-uuid')
            client.wait(lambda e: e['event'] == 'closed')
            client.send(type='open', session='bad-file', path=str(Path(directory)/'missing.mp4'))
            failure = client.wait(lambda e: e['event'] == 'state' and bool(e.get('error')))
            assert not failure['loaded'] and failure['error']
        finally:
            client.close()
    print('PASS: clean-runtime startup, binary YUV frames, exact scrubbing, cache reuse, warm reopen, stale-session isolation, bounded delivery, decode errors, shutdown')

if __name__ == '__main__':
    main()
