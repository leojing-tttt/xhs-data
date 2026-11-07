import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { listDevices, parseAdbDevicesList } from '../server/devices.js';

function fixture(name) {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

test('parses mixed adb devices -l output', () => {
  const devices = parseAdbDevicesList(fixture('adb-devices-mixed.txt'));
  assert.deepEqual(devices, [
    {
      serial: 'R5CT1234567',
      model: 'SM_S9110',
      product: 'dm3q',
      state: 'device',
    },
    {
      serial: '192.168.1.20:5555',
      model: 'Pixel_6_Pro',
      product: 'raven',
      state: 'device',
    },
    {
      serial: 'emulator-5554',
      model: '',
      product: '',
      state: 'offline',
    },
    {
      serial: 'ABCDEF012345',
      model: '',
      product: '',
      state: 'unauthorized',
    },
    {
      serial: 'ZXCVBN',
      model: '',
      product: '',
      state: 'no permissions',
    },
  ]);
});

test('empty adb output is an empty device list', () => {
  assert.deepEqual(parseAdbDevicesList(fixture('adb-devices-empty.txt')), []);
  assert.deepEqual(parseAdbDevicesList(''), []);
  assert.deepEqual(parseAdbDevicesList('List of devices attached\n\n'), []);
});

test('live list prefers getprop model and keeps the list when getprop fails', async () => {
  const stdout = fixture('adb-devices-mixed.txt');
  const calls = [];
  const devices = await listDevices(async (args) => {
    calls.push(args);
    if (args[0] === 'devices') return { stdout, stderr: '' };
    if (args[0] === '-s' && args[1] === 'R5CT1234567') return { stdout: 'SM-S9110\n', stderr: '' };
    throw new Error('getprop failed');
  });
  assert.equal(devices.adbError, null);
  assert.equal(devices.devices[0].model, 'SM-S9110');
  assert.equal(devices.devices[1].model, 'Pixel_6_Pro');
  assert.equal(devices.devices.find((item) => item.serial === 'ABCDEF012345').state, 'unauthorized');
  assert.ok(calls.some((args) => args[0] === 'devices' && args[1] === '-l'));
});

test('missing adb is reported separately from an empty phone list', async () => {
  const result = await listDevices(async () => {
    const error = new Error('spawn adb ENOENT');
    error.code = 'ENOENT';
    throw error;
  });
  assert.equal(result.adbError, 'not-found');
  assert.deepEqual(result.devices, []);
});
