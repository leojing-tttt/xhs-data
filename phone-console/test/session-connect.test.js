import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { SessionError, openScrcpyVideo } from '../server/session.js';

function listen(handler) {
  return new Promise((resolve) => {
    const server = net.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('waits until scrcpy sends the dummy byte instead of trusting adb forward', async () => {
  let accepts = 0;
  let live = null;
  const server = await listen((socket) => {
    accepts += 1;
    if (accepts < 3) {
      socket.end();
      return;
    }
    live = socket;
    socket.write(Buffer.from([0]));
  });
  try {
    const opened = await openScrcpyVideo(server.address().port, { attempts: 5, pauseMs: 10 });
    assert.equal(accepts, 3);
    live.write(Buffer.from([7]));
    const next = await opened.reader.read(1);
    assert.equal(next[0], 7);
    opened.socket.destroy();
  } finally {
    server.close();
  }
});

test('does not retry a scrcpy socket that sends an unexpected confirmation byte', async () => {
  let accepts = 0;
  const server = await listen((socket) => {
    accepts += 1;
    socket.write(Buffer.from([1]));
  });
  try {
    await assert.rejects(
      () => openScrcpyVideo(server.address().port, { attempts: 4, pauseMs: 10 }),
      (err) => err instanceof SessionError && err.status === 502 && err.message === 'scrcpy 连接确认异常。',
    );
    assert.equal(accepts, 1);
  } finally {
    server.close();
  }
});

test('reports the closed tunnel when every adb connection ends before the dummy byte', async () => {
  const server = await listen((socket) => socket.end());
  try {
    await assert.rejects(
      () => openScrcpyVideo(server.address().port, { attempts: 3, pauseMs: 5 }),
      (err) => err instanceof SessionError
        && err.status === 502
        && err.message === '连不上手机上的 scrcpy。stream ended',
    );
  } finally {
    server.close();
  }
});
