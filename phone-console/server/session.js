import { randomBytes, randomInt } from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { adbBin } from './adb.js';
import { isSafeSerial } from './devices.js';
import {
  ByteReader,
  H264_CODEC_ID,
  SCRCPY_VERSION,
  encodeKeyTap,
  encodeText,
  encodeTouch,
  normalizeCodecConfig,
  readCodecId,
  readDeviceName,
  readVideoUnit,
  resolveServerJar,
  toAnnexBFrame,
} from './scrcpy.js';

export class SessionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function openSocket(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setNoDelay(true);
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };
    socket.once('error', fail);
    socket.once('connect', () => {
      settled = true;
      socket.on('error', () => {});
      resolve(socket);
    });
  });
}

function connectReader(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setNoDelay(true);
    const reader = new ByteReader();
    let settled = false;
    const fail = (err) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(err);
        return;
      }
      reader.end(err);
    };
    socket.on('data', (chunk) => reader.push(chunk));
    socket.on('error', fail);
    socket.on('close', () => {
      if (!settled) {
        settled = true;
        reject(new Error('stream ended'));
        return;
      }
      reader.end();
    });
    socket.once('connect', () => {
      if (settled) return;
      settled = true;
      resolve({ socket, reader });
    });
  });
}

// adb forward accepts the host TCP connection before the phone is listening,
// then closes it. scrcpy sends one 0x00 byte once its socket is really up.
export async function openScrcpyVideo(port, {
  isAborted = () => false,
  onSocket = () => {},
  attempts = 100,
  pauseMs = 100,
} = {}) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (isAborted()) throw new SessionError(504, '等待手机画面超时。');
    let opened;
    try {
      opened = await connectReader(port);
      onSocket(opened.socket);
      const dummy = await opened.reader.read(1);
      if (dummy[0] !== 0) throw new SessionError(502, 'scrcpy 连接确认异常。');
      return opened;
    } catch (err) {
      try { opened?.socket.destroy(); } catch { /* already closed */ }
      if (err instanceof SessionError) throw err;
      if (isAborted()) throw new SessionError(504, '等待手机画面超时。');
      last = err;
      if (attempt + 1 < attempts) await delay(pauseMs);
    }
  }
  throw new SessionError(502, `连不上手机上的 scrcpy。${last ? last.message : ''}`);
}

async function retryConnect(port, isAborted, connect) {
  let last = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (isAborted()) throw new SessionError(504, '等待手机画面超时。');
    try {
      return await connect(port);
    } catch (err) {
      last = err;
      await delay(100);
    }
  }
  throw new SessionError(502, `连不上手机上的 scrcpy。${last ? last.message : ''}`);
}

function tail(logs) {
  const text = logs.join('').trim().split('\n').slice(-4).join(' ').replace(/\s+/g, ' ').trim();
  return text ? ` ${text.slice(-240)}` : '';
}

function writeMsg(viewer, message) {
  if (!viewer) return;
  if (message.type === 'text') viewer.sendText(JSON.stringify(message.data));
  else viewer.sendBinary(Buffer.concat([Buffer.from([message.keyFrame ? 1 : 0]), message.data]));
}

export function createSessionManager({ runAdb, root }) {
  const sessions = new Map();

  function stop(id) {
    const session = sessions.get(id);
    if (!session || session.stopped) return;
    session.stopped = true;
    sessions.delete(id);
    try { session.viewer?.close(1000, 'stop'); } catch { /* already closed */ }
    try { session.videoSocket?.destroy(); } catch { /* already closed */ }
    try { session.controlSocket?.destroy(); } catch { /* already closed */ }
    try { session.child?.kill('SIGTERM'); } catch { /* already gone */ }
    if (session.port) {
      runAdb(['-s', session.serial, 'forward', '--remove', `tcp:${session.port}`], { timeoutMs: 5000 })
        .catch(() => {});
    }
  }

  function stopAll() {
    for (const id of [...sessions.keys()]) stop(id);
  }

  function emit(session, message) {
    if (session.stopped) return;
    if (!session.viewer) {
      if (message.type === 'binary' && !message.keyFrame) return;
      session.pending.push(message);
      if (session.pending.length > 8) session.pending.shift();
      return;
    }
    if (
      message.type === 'binary'
      && !message.keyFrame
      && session.viewer.bufferedAmount > 1_500_000
    ) {
      return;
    }
    writeMsg(session.viewer, message);
  }

  async function pump(session) {
    try {
      while (!session.stopped) {
        const unit = await readVideoUnit(session.videoReader);
        if (session.stopped) return;
        if (unit.kind === 'session') {
          if (unit.width <= 0 || unit.height <= 0) continue;
          session.width = unit.width;
          session.height = unit.height;
          emit(session, {
            type: 'text',
            data: { type: 'session', width: unit.width, height: unit.height },
          });
          continue;
        }
        if (unit.config) {
          const normalized = normalizeCodecConfig(unit.data);
          session.stream = normalized;
          session.configAnnex = normalized.annexb;
          if (normalized.codecString) {
            session.codecString = normalized.codecString;
            emit(session, {
              type: 'text',
              data: { type: 'codec', codecString: normalized.codecString },
            });
          }
          continue;
        }
        let annex = toAnnexBFrame(unit.data, session.stream);
        if (unit.keyFrame && session.configAnnex && session.configAnnex.length) {
          annex = Buffer.concat([session.configAnnex, annex]);
        }
        emit(session, { type: 'binary', keyFrame: unit.keyFrame, data: annex });
      }
    } catch (err) {
      if (session.stopped) return;
      console.error(`scrcpy stream ended for ${session.serial}:`, err.message || err);
      try {
        session.viewer?.sendText(JSON.stringify({
          type: 'error',
          message: '画面中断了。回到列表重新打开这台手机。',
        }));
      } catch { /* viewer already gone */ }
      stop(session.id);
    }
  }

  function handleClient(session, packet) {
    if (!packet || packet.binary) return;
    let message;
    try {
      message = JSON.parse(packet.data.toString('utf8'));
    } catch {
      return;
    }
    try {
      if (message.type === 'touch') {
        if (!session.width || !session.height) {
          session.viewer?.sendText(JSON.stringify({
            type: 'error',
            message: '画面尺寸还没到，稍等一下再点。',
          }));
          return;
        }
        const action = message.action === 'down' ? 0 : message.action === 'up' ? 1 : 2;
        const x = clampInt(message.x, 0, session.width - 1);
        const y = clampInt(message.y, 0, session.height - 1);
        if (x === null || y === null) return;
        session.controlSocket.write(encodeTouch({
          action,
          x,
          y,
          width: session.width,
          height: session.height,
          pressure: action === 1 ? 0 : 1,
        }));
        return;
      }
      if (message.type === 'key') {
        for (const buf of encodeKeyTap(message.code)) session.controlSocket.write(buf);
        return;
      }
      if (message.type === 'text') {
        const text = String(message.text || '');
        if (!text) return;
        session.controlSocket.write(encodeText(text));
      }
    } catch (err) {
      const tooLong = err && err.code === 'text-too-long';
      const unknown = err && err.code === 'unknown-key';
      if (!tooLong && !unknown) return;
      session.viewer?.sendText(JSON.stringify({
        type: 'error',
        message: tooLong ? '文字太长，请分段发送。' : '不认识这个按键。',
      }));
    }
  }

  function attach(id, viewer) {
    const session = sessions.get(id);
    if (!session || session.stopped) {
      viewer.close(1008, 'gone');
      return;
    }
    if (session.viewer) {
      viewer.close(1008, 'busy');
      return;
    }
    session.viewer = viewer;
    viewer.sendText(JSON.stringify({
      type: 'hello',
      serial: session.serial,
      deviceName: session.deviceName,
      codec: 'h264',
      scrcpy: SCRCPY_VERSION,
    }));
    if (session.width && session.height) {
      viewer.sendText(JSON.stringify({
        type: 'session',
        width: session.width,
        height: session.height,
      }));
    }
    if (session.codecString) {
      viewer.sendText(JSON.stringify({ type: 'codec', codecString: session.codecString }));
    }
    for (const message of session.pending) writeMsg(viewer, message);
    session.pending = [];
    viewer.onMessage((packet) => handleClient(session, packet));
    viewer.onClose(() => {
      if (session.viewer === viewer) stop(id);
    });
  }

  async function destroyAttempt(session) {
    try { session.videoSocket?.destroy(); } catch { /* ignore */ }
    try { session.controlSocket?.destroy(); } catch { /* ignore */ }
    try { session.child?.kill('SIGTERM'); } catch { /* ignore */ }
    if (session.port && session.serial) {
      try {
        await runAdb(
          ['-s', session.serial, 'forward', '--remove', `tcp:${session.port}`],
          { timeoutMs: 5000 },
        );
      } catch { /* forward may already be gone */ }
    }
  }

  async function start(serial, model = '') {
    if (!isSafeSerial(serial)) throw new SessionError(400, '序列号不合法。');
    stopAll();
    let state = '';
    try {
      const result = await runAdb(['-s', serial, 'get-state'], { timeoutMs: 8000 });
      state = String(result.stdout || '').trim();
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        throw new SessionError(503, '这台电脑上没有 adb。先安装 Android platform-tools。');
      }
      throw new SessionError(404, '没有这台手机。插上之后刷新列表。');
    }
    if (state !== 'device') {
      throw new SessionError(409, '这台手机还不能控制。请在手机上允许 USB 调试，并确认它已在线。');
    }

    const session = {
      id: randomBytes(16).toString('hex'),
      serial,
      model,
      scid: randomInt(1, 0x7fffffff).toString(16).padStart(8, '0'),
      port: 0,
      deviceName: '',
      width: 0,
      height: 0,
      codecString: null,
      stream: null,
      configAnnex: null,
      pending: [],
      viewer: null,
      stopped: false,
      child: null,
      videoSocket: null,
      controlSocket: null,
      videoReader: null,
    };
    let published = false;
    let aborted = false;
    const logs = [];
    const takeLog = (chunk) => {
      logs.push(chunk.toString('utf8'));
      if (logs.join('').length > 8000) {
        const kept = logs.join('').slice(-4000);
        logs.splice(0, logs.length, kept);
      }
    };

    try {
      const jar = await resolveServerJar(root);
      session.port = await freePort();
      const socketName = `scrcpy_${session.scid}`;
      await runAdb(['-s', serial, 'forward', `tcp:${session.port}`, `localabstract:${socketName}`]);
      await runAdb(
        ['-s', serial, 'push', jar, '/data/local/tmp/scrcpy-server.jar'],
        { timeoutMs: 60000 },
      );
      const child = spawn(adbBin(), [
        '-s', serial,
        'shell',
        'CLASSPATH=/data/local/tmp/scrcpy-server.jar',
        'app_process',
        '/',
        'com.genymobile.scrcpy.Server',
        SCRCPY_VERSION,
        `scid=${session.scid}`,
        'log_level=info',
        'audio=false',
        'control=true',
        'video=true',
        'video_codec=h264',
        'max_size=1280',
        'max_fps=30',
        'video_bit_rate=4000000',
        'tunnel_forward=true',
        'stay_awake=true',
        'power_on=true',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      session.child = child;
      child.stdout.on('data', takeLog);
      child.stderr.on('data', takeLog);

      await new Promise((resolve, reject) => {
        let done = false;
        const finish = (err) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (err) reject(err);
          else resolve();
        };
        const timer = setTimeout(() => {
          aborted = true;
          try { session.videoSocket?.destroy(); } catch { /* ignore */ }
          try { session.controlSocket?.destroy(); } catch { /* ignore */ }
          finish(new SessionError(504, `等待手机画面超时。确认手机已解锁。${tail(logs)}`));
        }, 12000);
        child.once('error', (err) => {
          aborted = true;
          if (err.code === 'ENOENT') {
            finish(new SessionError(503, '这台电脑上没有 adb。先安装 Android platform-tools。'));
            return;
          }
          finish(err);
        });
        child.once('exit', (code) => {
          if (!done) {
            aborted = true;
            finish(new SessionError(502, `scrcpy 没有跑起来（退出码 ${code}）。${tail(logs)}`));
          }
        });
        (async () => {
          const video = await openScrcpyVideo(session.port, {
            isAborted: () => aborted,
            onSocket(socket) {
              session.videoSocket = socket;
            },
          });
          session.videoReader = video.reader;
          if (aborted) return;
          const controlSocket = await retryConnect(session.port, () => aborted, openSocket);
          session.controlSocket = controlSocket;
          controlSocket.on('data', () => {});
          const deviceName = await readDeviceName(video.reader);
          const codecId = await readCodecId(video.reader);
          if (codecId !== H264_CODEC_ID) {
            throw new SessionError(502, `手机回了不认识的视频编码 0x${codecId.toString(16)}。这一版只收 H.264。`);
          }
          session.deviceName = deviceName;
          finish(null);
        })().catch((err) => {
          aborted = true;
          const detail = err instanceof SessionError ? '' : tail(logs);
          const message = err instanceof SessionError
            ? err.message
            : `打开画面失败。${err.message || ''}${detail}`;
          finish(err instanceof SessionError ? err : new SessionError(502, message));
        });
      });

      child.on('exit', () => {
        if (!session.stopped) stop(session.id);
      });
      session.controlSocket.on('close', () => {
        if (!session.stopped) stop(session.id);
      });
      sessions.set(session.id, session);
      published = true;
      pump(session);
      return {
        id: session.id,
        serial: session.serial,
        model: session.model || model,
        deviceName: session.deviceName,
        scrcpy: SCRCPY_VERSION,
      };
    } catch (err) {
      if (!published) await destroyAttempt(session);
      if (err instanceof SessionError) throw err;
      if (err && err.code === 'ENOENT') {
        throw new SessionError(503, '这台电脑上没有 adb。先安装 Android platform-tools。');
      }
      throw new SessionError(502, `打开手机失败。${String(err.message || '').slice(0, 240)}`);
    }
  }

  return {
    start,
    stop,
    stopAll,
    attach,
    get(id) {
      return sessions.get(id) || null;
    },
  };
}

function clampInt(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, Math.round(number)));
}
