const KNOWN_STATES = new Set([
  'device',
  'offline',
  'unauthorized',
  'recovery',
  'sideload',
  'bootloader',
  'connecting',
  'authorizing',
  'host',
  'rescue',
  'no permissions',
]);

const SERIAL_RE = /^[A-Za-z0-9._:-]{1,80}$/;

export function isSafeSerial(serial) {
  return typeof serial === 'string' && SERIAL_RE.test(serial) && !serial.startsWith('-');
}

export function parseAdbDevicesList(text) {
  const devices = [];
  const lines = String(text ?? '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('List of devices') || trimmed.startsWith('*')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const serial = parts[0];
    let state;
    let rest;
    if (parts[1] === 'no' && parts[2] === 'permissions') {
      state = 'no permissions';
      rest = parts.slice(3);
    } else {
      state = parts[1];
      rest = parts.slice(2);
    }
    if (!serial || serial.startsWith('*')) continue;
    let model = '';
    let product = '';
    for (const token of rest) {
      if (token.startsWith('model:')) model = token.slice('model:'.length);
      else if (token.startsWith('product:')) product = token.slice('product:'.length);
    }
    devices.push({
      serial,
      model,
      product,
      state: KNOWN_STATES.has(state) ? state : state,
    });
  }
  return devices;
}

export async function listDevices(run) {
  try {
    const { stdout } = await run(['devices', '-l']);
    const devices = parseAdbDevicesList(stdout).filter((device) => isSafeSerial(device.serial));
    for (const device of devices) {
      if (device.state !== 'device') continue;
      try {
        const result = await run(
          ['-s', device.serial, 'shell', 'getprop', 'ro.product.model'],
          { timeoutMs: 4000 },
        );
        const model = String(result.stdout || '').trim();
        if (model && !model.includes('\n')) device.model = model;
      } catch {
        // Keep the model token from `adb devices -l`.
      }
    }
    return { devices, adbError: null, detail: '' };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { devices: [], adbError: 'not-found', detail: '' };
    }
    return {
      devices: [],
      adbError: 'failed',
      detail: String(err && err.message ? err.message : '').slice(0, 300),
    };
  }
}

export function adbErrorMessage(adbError) {
  if (adbError === 'not-found') {
    return '这台电脑上没有 adb。先安装 Android platform-tools，再刷新。';
  }
  if (adbError === 'failed') {
    return 'adb 执行失败。确认本机能运行 adb 之后再刷新。';
  }
  return '';
}
