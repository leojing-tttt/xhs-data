import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  ByteReader,
  H264_CODEC_ID,
  PACKET_FLAG_CONFIG,
  PACKET_FLAG_KEY_FRAME,
  SCRCPY_SERVER_SHA256,
  SCRCPY_VERSION,
  codecStringFromAnnexB,
  encodeKeyTap,
  encodeText,
  encodeTouch,
  lengthPrefixedToAnnexB,
  normalizeCodecConfig,
  readCodecId,
  readDeviceName,
  readVideoUnit,
} from '../server/scrcpy.js';

test('pins the upstream scrcpy 5.0.1 server binary', async () => {
  assert.equal(SCRCPY_VERSION, '5.0.1');
  const jar = await readFile(new URL('../vendor/scrcpy-server-v5.0.1', import.meta.url));
  assert.equal(createHash('sha256').update(jar).digest('hex'), SCRCPY_SERVER_SHA256);
});

test('control messages match the scrcpy 5.0.1 binary layout', () => {
  const touch = encodeTouch({
    action: 0,
    pointerId: -42,
    x: 100,
    y: 200,
    width: 1080,
    height: 1920,
    pressure: 1,
    actionButton: 1,
    buttons: 1,
  });
  assert.equal(
    touch.toString('hex'),
    '0200ffffffffffffffd600000064000000c804380780ffff0000000100000001',
  );

  const finger = encodeTouch({ action: 0, x: 1, y: 2, width: 100, height: 200 });
  assert.equal(finger.subarray(2, 10).toString('hex'), 'fffffffffffffffe');
  assert.equal(finger[22], 0xff);
  assert.equal(finger[23], 0xff);

  const [down, up] = encodeKeyTap('back');
  assert.equal(down.toString('hex'), '0000000000040000000000000000');
  assert.equal(up.toString('hex'), '0001000000040000000000000000');
  const [powerDown] = encodeKeyTap('power');
  assert.equal(powerDown.readUInt32BE(2), 26);
  const [homeDown] = encodeKeyTap('home');
  assert.equal(homeDown.readUInt32BE(2), 3);

  assert.equal(encodeText('ab').toString('hex'), '01000000026162');
  assert.throws(() => encodeText('a'.repeat(301)), { code: 'text-too-long' });
});

test('demuxes a scrcpy video header split across chunks', async () => {
  const name = Buffer.alloc(64);
  name.write('Pixel 7');
  const codec = Buffer.alloc(4);
  codec.writeUInt32BE(H264_CODEC_ID);
  const session = Buffer.alloc(12);
  session[0] = 0x80;
  session.writeInt32BE(1080, 4);
  session.writeInt32BE(1920, 8);
  const configHeader = Buffer.alloc(12);
  configHeader.writeBigUInt64BE(PACKET_FLAG_CONFIG, 0);
  configHeader.writeUInt32BE(4, 8);
  const configBody = Buffer.from([0, 0, 0, 1]);
  const keyHeader = Buffer.alloc(12);
  keyHeader.writeBigUInt64BE(PACKET_FLAG_KEY_FRAME | 1000n, 0);
  keyHeader.writeUInt32BE(3, 8);
  const keyBody = Buffer.from([9, 10, 11]);
  const deltaHeader = Buffer.alloc(12);
  deltaHeader.writeBigUInt64BE(2000n, 0);
  deltaHeader.writeUInt32BE(2, 8);
  const deltaBody = Buffer.from([1, 2]);
  const blob = Buffer.concat([
    name, codec, session, configHeader, configBody, keyHeader, keyBody, deltaHeader, deltaBody,
  ]);

  const reader = new ByteReader();
  for (let offset = 0; offset < blob.length; offset += 3) {
    reader.push(blob.subarray(offset, offset + 3));
  }
  reader.end();

  assert.equal(await readDeviceName(reader), 'Pixel 7');
  assert.equal(await readCodecId(reader), H264_CODEC_ID);
  const sessionUnit = await readVideoUnit(reader);
  assert.deepEqual(sessionUnit, { kind: 'session', width: 1080, height: 1920, clientResize: false });
  const config = await readVideoUnit(reader);
  assert.equal(config.kind, 'packet');
  assert.equal(config.config, true);
  assert.equal(config.keyFrame, false);
  assert.equal(config.data.toString('hex'), '00000001');
  const key = await readVideoUnit(reader);
  assert.equal(key.keyFrame, true);
  assert.equal(key.config, false);
  assert.equal(key.pts, 1000n);
  assert.deepEqual([...key.data], [9, 10, 11]);
  const delta = await readVideoUnit(reader);
  assert.equal(delta.keyFrame, false);
  assert.equal(delta.pts, 2000n);
  assert.deepEqual([...delta.data], [1, 2]);
});

test('converts avcC codec config and length-prefixed frames to Annex-B', () => {
  const avcC = Buffer.from('0142001effe1000367420001000268ce', 'hex');
  const normalized = normalizeCodecConfig(avcC);
  assert.equal(normalized.mode, 'avcc');
  assert.equal(normalized.lengthSize, 4);
  assert.equal(normalized.codecString, 'avc1.42001E');
  assert.equal(normalized.annexb.toString('hex'), '000000016742000000000168ce');
  const frame = lengthPrefixedToAnnexB(Buffer.from('0000000209f0', 'hex'), 4);
  assert.equal(frame.toString('hex'), '0000000109f0');

  const annex = Buffer.from('000000016742001e0000000168ce06', 'hex');
  const passthrough = normalizeCodecConfig(annex);
  assert.equal(passthrough.mode, 'annexb');
  assert.equal(codecStringFromAnnexB(annex), 'avc1.42001E');
});
