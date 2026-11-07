import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Protocol matches Genymobile/scrcpy v5.0.1 (Streamer.java + control_msg.c).
export const SCRCPY_VERSION = '5.0.1';
export const SCRCPY_SERVER_SHA256 = '764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536';
export const H264_CODEC_ID = 0x68323634;

export const PACKET_FLAG_CONFIG = 1n << 62n;
export const PACKET_FLAG_KEY_FRAME = 1n << 61n;
export const PTS_MASK = (1n << 61n) - 1n;

export const KEYCODE = {
  home: 3,
  back: 4,
  up: 19,
  down: 20,
  left: 21,
  right: 22,
  power: 26,
  enter: 66,
  del: 67,
};

const TEXT_MAX_BYTES = 300;
const START_CODE = Buffer.from([0, 0, 0, 1]);

export class ByteReader {
  constructor() {
    this.chunks = [];
    this.length = 0;
    this.waiters = [];
    this.ended = false;
    this.endError = null;
  }

  push(chunk) {
    if (!chunk || !chunk.length || this.ended) return;
    const copy = Buffer.from(chunk);
    this.chunks.push(copy);
    this.length += copy.length;
    this._drain();
  }

  end(err) {
    if (this.ended) return;
    this.ended = true;
    this.endError = err || null;
    this._drain();
  }

  read(n) {
    if (n === 0) return Promise.resolve(Buffer.alloc(0));
    if (this.length >= n) return Promise.resolve(this._take(n));
    if (this.ended) return Promise.reject(this.endError || new Error('stream ended'));
    return new Promise((resolve, reject) => {
      this.waiters.push({ n, resolve, reject });
    });
  }

  _take(n) {
    const out = Buffer.alloc(n);
    let filled = 0;
    while (filled < n) {
      const head = this.chunks[0];
      const need = n - filled;
      if (head.length <= need) {
        head.copy(out, filled);
        filled += head.length;
        this.chunks.shift();
      } else {
        head.copy(out, filled, 0, need);
        this.chunks[0] = head.subarray(need);
        filled += need;
      }
    }
    this.length -= n;
    return out;
  }

  _drain() {
    while (this.waiters.length) {
      const waiter = this.waiters[0];
      if (this.length < waiter.n) {
        if (!this.ended) return;
        this.waiters.shift();
        waiter.reject(this.endError || new Error('stream ended'));
        continue;
      }
      this.waiters.shift();
      waiter.resolve(this._take(waiter.n));
    }
  }
}

export async function readDeviceName(reader) {
  const raw = await reader.read(64);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
}

export async function readCodecId(reader) {
  const raw = await reader.read(4);
  return raw.readUInt32BE(0);
}

export async function readVideoUnit(reader) {
  const header = await reader.read(12);
  if (header[0] & 0x80) {
    return {
      kind: 'session',
      width: header.readInt32BE(4),
      height: header.readInt32BE(8),
      clientResize: (header[3] & 0x01) === 1,
    };
  }
  const flags = header.readBigUInt64BE(0);
  const size = header.readUInt32BE(8);
  if (size > 8 * 1024 * 1024) {
    throw new Error(`video packet too large: ${size}`);
  }
  const data = await reader.read(size);
  return {
    kind: 'packet',
    config: (flags & PACKET_FLAG_CONFIG) !== 0n,
    keyFrame: (flags & PACKET_FLAG_KEY_FRAME) !== 0n,
    pts: flags & PTS_MASK,
    data,
  };
}

function uint64(value) {
  const big = typeof value === 'bigint' ? value : BigInt(value);
  return BigInt.asUintN(64, big);
}

function pressureToU16(pressure) {
  if (pressure <= 0) return 0;
  if (pressure >= 1) return 0xffff;
  const scaled = Math.round(pressure * 0x10000);
  return Math.min(0xffff, scaled);
}

export function encodeKeycode(action, keycode, repeat = 0, metaState = 0) {
  const buf = Buffer.alloc(14);
  buf[0] = 0;
  buf[1] = action & 0xff;
  buf.writeUInt32BE(keycode >>> 0, 2);
  buf.writeUInt32BE(repeat >>> 0, 6);
  buf.writeUInt32BE(metaState >>> 0, 10);
  return buf;
}

export function encodeKeyTap(name) {
  const keycode = KEYCODE[name];
  if (!keycode) {
    const error = new Error(`unknown key: ${name}`);
    error.code = 'unknown-key';
    throw error;
  }
  return [encodeKeycode(0, keycode), encodeKeycode(1, keycode)];
}

export function encodeText(text) {
  const payload = Buffer.from(String(text), 'utf8');
  if (payload.length > TEXT_MAX_BYTES) {
    const error = new Error('text too long');
    error.code = 'text-too-long';
    throw error;
  }
  const buf = Buffer.alloc(5 + payload.length);
  buf[0] = 1;
  buf.writeUInt32BE(payload.length, 1);
  payload.copy(buf, 5);
  return buf;
}

export function encodeTouch({
  action,
  x,
  y,
  width,
  height,
  pointerId = -2,
  pressure,
  actionButton = 0,
  buttons = 0,
}) {
  const buf = Buffer.alloc(32);
  buf[0] = 2;
  buf[1] = action & 0xff;
  buf.writeBigUInt64BE(uint64(pointerId), 2);
  buf.writeInt32BE(x | 0, 10);
  buf.writeInt32BE(y | 0, 14);
  buf.writeUInt16BE(width & 0xffff, 18);
  buf.writeUInt16BE(height & 0xffff, 20);
  const usedPressure = pressure === undefined ? (action === 1 ? 0 : 1) : pressure;
  buf.writeUInt16BE(pressureToU16(usedPressure), 22);
  buf.writeUInt32BE(actionButton >>> 0, 24);
  buf.writeUInt32BE(buttons >>> 0, 28);
  return buf;
}

function isAnnexB(data) {
  return data.length >= 4
    && data[0] === 0
    && data[1] === 0
    && (data[2] === 1 || (data[2] === 0 && data[3] === 1));
}

function hexByte(value) {
  return (value & 0xff).toString(16).padStart(2, '0').toUpperCase();
}

export function codecStringFromAnnexB(data) {
  const nals = splitAnnexB(data);
  for (const nal of nals) {
    if (nal.length >= 4 && (nal[0] & 0x1f) === 7) {
      return `avc1.${hexByte(nal[1])}${hexByte(nal[2])}${hexByte(nal[3])}`;
    }
  }
  return null;
}

function splitAnnexB(data) {
  const nals = [];
  let cursor = 0;
  while (cursor < data.length) {
    let start = -1;
    for (let index = cursor; index + 3 < data.length; index += 1) {
      if (data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 1) {
        start = index + 3;
        break;
      }
      if (
        index + 4 < data.length
        && data[index] === 0
        && data[index + 1] === 0
        && data[index + 2] === 0
        && data[index + 3] === 1
      ) {
        start = index + 4;
        break;
      }
    }
    if (start < 0) break;
    let next = data.length;
    for (let index = start; index + 3 < data.length; index += 1) {
      const three = data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 1;
      const four = index + 4 < data.length
        && data[index] === 0
        && data[index + 1] === 0
        && data[index + 2] === 0
        && data[index + 3] === 1;
      if (three || four) {
        next = index;
        break;
      }
    }
    nals.push(data.subarray(start, next));
    cursor = next;
  }
  return nals;
}

function parseAvcC(data) {
  const profile = data[1];
  const compat = data[2];
  const level = data[3];
  const lengthSize = (data[4] & 0x03) + 1;
  let offset = 5;
  const numSps = data[offset] & 0x1f;
  offset += 1;
  const nals = [];
  for (let index = 0; index < numSps; index += 1) {
    if (offset + 2 > data.length) throw new Error('truncated sps length');
    const length = data.readUInt16BE(offset);
    offset += 2;
    if (offset + length > data.length) throw new Error('truncated sps');
    nals.push(data.subarray(offset, offset + length));
    offset += length;
  }
  if (offset >= data.length) throw new Error('truncated pps count');
  const numPps = data[offset];
  offset += 1;
  for (let index = 0; index < numPps; index += 1) {
    if (offset + 2 > data.length) throw new Error('truncated pps length');
    const length = data.readUInt16BE(offset);
    offset += 2;
    if (offset + length > data.length) throw new Error('truncated pps');
    nals.push(data.subarray(offset, offset + length));
    offset += length;
  }
  const parts = [];
  for (const nal of nals) parts.push(START_CODE, nal);
  return {
    lengthSize,
    annexb: Buffer.concat(parts),
    codecString: `avc1.${hexByte(profile)}${hexByte(compat)}${hexByte(level)}`,
  };
}

export function normalizeCodecConfig(payload) {
  const data = Buffer.from(payload);
  if (isAnnexB(data)) {
    return {
      mode: 'annexb',
      lengthSize: 4,
      annexb: data,
      codecString: codecStringFromAnnexB(data),
    };
  }
  if (data.length >= 7 && data[0] === 1) {
    try {
      return { mode: 'avcc', ...parseAvcC(data) };
    } catch {
      return { mode: 'annexb', lengthSize: 4, annexb: data, codecString: null };
    }
  }
  return {
    mode: 'annexb',
    lengthSize: 4,
    annexb: data,
    codecString: codecStringFromAnnexB(data),
  };
}

export function lengthPrefixedToAnnexB(packet, lengthSize) {
  const data = Buffer.from(packet);
  if (!data.length) return data;
  const parts = [];
  let offset = 0;
  while (offset + lengthSize <= data.length) {
    let length = 0;
    for (let index = 0; index < lengthSize; index += 1) {
      length = (length << 8) | data[offset + index];
    }
    offset += lengthSize;
    if (length < 0 || offset + length > data.length) break;
    parts.push(START_CODE, data.subarray(offset, offset + length));
    offset += length;
  }
  if (!parts.length || offset !== data.length) {
    if (!parts.length) return data;
  }
  if (!parts.length) return data;
  return Buffer.concat(parts);
}

export function toAnnexBFrame(packet, stream) {
  if (!stream || stream.mode !== 'avcc') return Buffer.from(packet);
  return lengthPrefixedToAnnexB(packet, stream.lengthSize);
}

export async function resolveServerJar(root) {
  const override = process.env.SCRCPY_SERVER;
  const file = override || path.join(root, 'vendor', 'scrcpy-server-v5.0.1');
  const data = await readFile(file);
  if (!override) {
    const digest = createHash('sha256').update(data).digest('hex');
    if (digest !== SCRCPY_SERVER_SHA256) {
      throw new Error('bundled scrcpy server checksum does not match v5.0.1');
    }
  }
  return file;
}
