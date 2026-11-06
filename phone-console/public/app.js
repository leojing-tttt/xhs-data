const app = document.querySelector('#app');

const state = {
  me: null,
  view: 'login',
  devices: [],
  adbError: null,
  adbMessage: '',
  adbDetail: '',
  listError: '',
  opening: '',
  session: null,
  scrcpy: '',
  poll: 0,
  taskTypes: [],
  tasks: [],
  taskDevices: [],
  openTaskId: '',
  taskError: '',
};

const ICONS = {
  back: ['M9 15L3 9M3 9L9 3M3 9H15C18.3137 9 21 11.6863 21 15C21 18.3137 18.3137 21 15 21H12'],
  left: ['M10.5 19.5L3 12M3 12L10.5 4.5M3 12H21'],
  home: ['M2.25 12L11.2045 3.04549C11.6438 2.60615 12.3562 2.60615 12.7955 3.04549L21.75 12M4.5 9.75V19.875C4.5 20.4963 5.00368 21 5.625 21H9.75V16.125C9.75 15.5037 10.2537 15 10.875 15H13.125C13.7463 15 14.25 15.5037 14.25 16.125V21H18.375C18.9963 21 19.5 20.4963 19.5 19.875V9.75M8.25 21H16.5'],
  refresh: ['M16.0228 9.34841H21.0154V9.34663M2.98413 19.6444V14.6517M2.98413 14.6517L7.97677 14.6517M2.98413 14.6517L6.16502 17.8347C7.15555 18.8271 8.41261 19.58 9.86436 19.969C14.2654 21.1483 18.7892 18.5364 19.9685 14.1353M4.03073 9.86484C5.21 5.46374 9.73377 2.85194 14.1349 4.03121C15.5866 4.4202 16.8437 5.17312 17.8342 6.1655L21.0154 9.34663M21.0154 4.3558V9.34663'],
  phone: ['M10.5 1.5H8.25C7.00736 1.5 6 2.50736 6 3.75V20.25C6 21.4926 7.00736 22.5 8.25 22.5H15.75C16.9926 22.5 18 21.4926 18 20.25V3.75C18 2.50736 16.9926 1.5 15.75 1.5H13.5M10.5 1.5V3H13.5V1.5M10.5 1.5H13.5M10.5 20.25H13.5'],
  power: ['M12 2v10', 'M18.4 6.6a9 9 0 1 1-12.77.04'],
};

const STATE_LABEL = {
  device: '在线',
  offline: '离线',
  unauthorized: '未授权',
  'no permissions': '无权限',
  recovery: '恢复模式',
  sideload: '旁加载',
  bootloader: 'Bootloader',
  connecting: '连接中',
  authorizing: '等待授权',
};

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child);
  }
  return node;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

function stateLabel(value) {
  return STATE_LABEL[value] || value || '未知';
}

function stateHint(value) {
  if (value === 'unauthorized' || value === 'authorizing') return '在手机上点允许 USB 调试';
  if (value === 'no permissions') return '这台电脑还没有权限访问 USB';
  if (value === 'offline') return '线还在，但手机没有应答';
  return '';
}

async function api(path, options = {}) {
  const quiet = options.quiet === true;
  const { quiet: _quiet, ...request } = options;
  const response = await fetch(path, {
    ...request,
    headers: {
      ...(request.body ? { 'content-type': 'application/json' } : {}),
      ...(request.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (response.status === 401 && path !== '/api/login') {
    if (!quiet) {
      stopPoll();
      state.me = null;
      state.view = 'login';
      renderLogin('登录已过期，请重新进入。');
    }
    const error = new Error('unauthorized');
    error.status = 401;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(data?.message || '请求失败');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function stopPoll() {
  if (state.poll) {
    clearInterval(state.poll);
    state.poll = 0;
  }
}

function renderLogin(message = '') {
  stopPoll();
  document.title = '登录 · 手机控制台';
  app.replaceChildren(el('main', { class: 'login' }, [
    el('section', { class: 'login-brand' }, [
      el('p', { class: 'eyebrow', text: '本机 · 登录后可见设备' }),
      el('h1', {}, [
        el('span', { text: '手机' }),
        el('span', { text: '控制台' }),
      ]),
      el('div', { class: 'lede' }, [
        el('p', { text: '登录之后，才能看见插在这台电脑上的 Android。' }),
        el('p', { text: '画面和点击，都走这台机器上的 scrcpy。' }),
      ]),
    ]),
    el('section', { class: 'login-form' }, [
      el('form', {}, [
        el('label', {}, [
          el('span', { text: '账号' }),
          el('input', { type: 'text', name: 'username', autocomplete: 'username', autofocus: 'true' }),
        ]),
        el('label', {}, [
          el('span', { text: '密码' }),
          el('input', { type: 'password', name: 'password', autocomplete: 'current-password' }),
        ]),
        el('button', { class: 'primary', type: 'submit', text: '进入' }),
        el('p', { class: 'form-error', role: 'alert', text: message }),
      ]),
      el('p', { class: 'fine', text: '账号写在这台机器的 config/users.json。用户中心接上之前，只有这里的人能看见设备。' }),
    ]),
  ]));

  const form = app.querySelector('form');
  const error = app.querySelector('.form-error');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) {
      error.textContent = '请填写账号和密码。';
      return;
    }
    const button = form.querySelector('button');
    button.disabled = true;
    error.textContent = '';
    try {
      const me = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      state.me = me;
      await showDevices();
    } catch (err) {
      error.textContent = err.status === 401 ? '账号或密码不对。' : (err.message || '登录失败。');
      button.disabled = false;
    }
  });
}

function shell({ title, extra, active, onRefresh }) {
  const tab = (id, label, show) => el('button', {
    class: active === id ? 'text-btn on' : 'text-btn',
    type: 'button',
    text: label,
    onclick: show,
  });
  return el('div', { class: 'shell' }, [
    el('header', { class: 'topbar' }, [
      el('div', { class: 'brand-row' }, [
        el('p', { class: 'brand-mark', text: '手机控制台' }),
        el('nav', { class: 'nav' }, [
          tab('devices', '设备', () => showDevices()),
          tab('tasks', '任务', () => showTasks()),
        ]),
      ]),
      el('div', { class: 'who' }, [
        el('span', { text: state.me?.displayName || state.me?.username || '' }),
        el('button', {
          class: 'text-btn',
          type: 'button',
          text: '退出',
          onclick: async () => {
            stopPoll();
            await fetch('/api/logout', { method: 'POST' });
            state.me = null;
            renderLogin();
          },
        }),
      ]),
    ]),
    el('main', { class: 'page' }, [
      el('div', { class: 'page-head' }, [
        el('div', {}, [
          el('h2', { text: title }),
          extra || null,
        ]),
        el('button', {
          class: 'ghost',
          type: 'button',
          onclick: () => onRefresh(),
        }, [icon('refresh'), el('span', { text: '刷新' })]),
      ]),
      el('div', { id: 'list-slot' }),
      el('p', { class: 'foot', text: state.scrcpy ? `画面与控制：上游 scrcpy ${state.scrcpy}` : '' }),
    ]),
  ]);
}

function renderDeviceList() {
  const slot = document.querySelector('#list-slot');
  if (!slot) return;
  slot.replaceChildren();
  if (state.adbMessage) {
    const banner = el('div', { class: 'banner', role: 'alert' }, [
      el('span', { text: state.adbMessage }),
    ]);
    if (state.adbDetail) banner.append(el('small', { text: state.adbDetail }));
    slot.append(banner);
  }
  if (state.listError) {
    slot.append(el('div', { class: 'banner', role: 'alert', text: state.listError }));
  }
  if (!state.devices.length && !state.adbMessage) {
    slot.append(el('section', { class: 'empty' }, [
      el('div', {}, [
        el('div', { class: 'empty-mark' }, [icon('phone')]),
        el('h2', { text: '还没有手机' }),
      ]),
      el('div', { class: 'empty-copy' }, [
        el('p', { text: '把 Android 用数据线插到这台电脑，在手机上打开开发者选项，并允许 USB 调试。无线 adb 已经连上的手机会出现在这里，这一版不负责配对。' }),
      ]),
    ]));
    return;
  }
  const list = el('ul', { class: 'device-list' });
  const ordered = [...state.devices].sort((a, b) => {
    const rank = (item) => (item.state === 'device' ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return a.serial.localeCompare(b.serial);
  });
  for (const device of ordered) {
    const hint = stateHint(device.state);
    const stateNode = el('div', {}, [
      el('span', { class: `state ${device.state === 'device' ? 'device' : ''}`, text: stateLabel(device.state) }),
    ]);
    if (hint) stateNode.append(el('span', { class: 'hint', text: hint }));
    const open = device.state === 'device'
      ? el('button', {
        class: 'primary',
        type: 'button',
        disabled: state.opening === device.serial,
        text: state.opening === device.serial ? '正在打开' : '打开',
        onclick: () => openDevice(device),
      })
      : el('span', { class: 'hint', text: '不能打开' });
    list.append(el('li', { class: 'device-row', 'data-state': device.state }, [
      el('span', { class: 'serial', text: device.serial }),
      el('span', { class: 'model', text: device.model || '未知型号' }),
      stateNode,
      open,
    ]));
  }
  slot.append(list);
}

async function refreshDevices() {
  try {
    const data = await api('/api/devices');
    state.devices = data.devices || [];
    state.adbError = data.adbError;
    state.adbMessage = data.message || '';
    state.adbDetail = data.detail || '';
    state.listError = '';
    renderDeviceList();
  } catch (err) {
    if (err.status === 401) return;
    state.listError = err.message || '读设备失败。';
    renderDeviceList();
  }
}

async function showDevices() {
  state.view = 'devices';
  document.title = '设备 · 手机控制台';
  if (!state.scrcpy) {
    try {
      const meta = await api('/api/meta');
      state.scrcpy = meta.scrcpy || '';
    } catch {
      state.scrcpy = '';
    }
  }
  app.replaceChildren(shell({
    title: '插在这台机器上的手机',
    extra: el('p', { text: '序列号、型号、状态。在线的才能打开。' }),
    active: 'devices',
    onRefresh: () => refreshDevices(),
  }));
  await refreshDevices();
  stopPoll();
  state.poll = setInterval(refreshDevices, 4000);
}

async function openDevice(device) {
  state.opening = device.serial;
  state.listError = '';
  renderDeviceList();
  try {
    const session = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ serial: device.serial, model: device.model || '' }),
    });
    state.session = { ...session, model: session.model || device.model || '' };
    stopPoll();
    renderConsole();
  } catch (err) {
    if (err.status === 401) return;
    state.listError = err.message || '打开失败。';
    state.opening = '';
    renderDeviceList();
  }
}

let ws = null;
let decoder = null;
let codecString = '';
let videoSize = null;
let configuredFor = '';
let sawKey = false;
let timestamp = 0;
let pressing = false;

function closeStream() {
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  if (decoder) {
    try { decoder.close(); } catch { /* already closed */ }
    decoder = null;
  }
  codecString = '';
  videoSize = null;
  configuredFor = '';
  sawKey = false;
  timestamp = 0;
  pressing = false;
}

async function leaveConsole() {
  const id = state.session?.id;
  closeStream();
  state.session = null;
  state.opening = '';
  if (id) {
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE', keepalive: true });
    } catch { /* the server also stops when the socket closes */ }
  }
  await showDevices();
}

function renderConsole() {
  state.view = 'console';
  const session = state.session;
  document.title = `${session.serial} · 手机控制台`;
  const canvas = el('canvas', { tabindex: '0', 'aria-label': '手机画面' });
  const overlay = el('p', { class: 'overlay', text: '正在连接画面…' });
  const status = (text) => {
    overlay.hidden = !text;
    overlay.textContent = text || '';
  };

  const back = el('button', { class: 'back', type: 'button' }, [icon('left'), el('span', { text: '返回列表' })]);
  back.addEventListener('click', () => leaveConsole());

  const send = (payload) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  };

  const keyButton = (code, label, iconName, className = '') => {
    const button = el('button', { type: 'button', class: className }, [icon(iconName), el('span', { text: label })]);
    button.addEventListener('click', () => send({ type: 'key', code }));
    return button;
  };

  const textInput = el('input', { type: 'text', name: 'text', autocomplete: 'off', placeholder: '输入后发送到手机' });
  const composer = el('form', { class: 'composer' }, [
    el('label', {}, [
      el('span', { text: '文字' }),
      textInput,
    ]),
    el('button', { class: 'primary', type: 'submit', text: '发送' }),
  ]);
  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = textInput.value;
    if (!text) return;
    send({ type: 'text', text });
    textInput.value = '';
  });

  app.replaceChildren(el('section', { class: 'console' }, [
    el('header', { class: 'console-top' }, [
      el('div', {}, [
        back,
        el('h2', { text: session.serial }),
        el('p', { class: 'sub', text: [session.deviceName, session.model].filter(Boolean).join(' · ') || '等待设备名' }),
      ]),
      el('span', { class: 'state device', text: '控制中' }),
    ]),
    el('div', { class: 'stage-wrap' }, [
      el('div', { class: 'bezel' }, [canvas, overlay]),
    ]),
    el('aside', { class: 'rail' }, [
      keyButton('back', '返回', 'back'),
      keyButton('home', '主页', 'home'),
      keyButton('power', '电源', 'power', 'power'),
      composer,
      el('p', { class: 'rail-note', text: '在画面上点按。按住拖动就是滑动。方向键、回车和退格作用在画面上，先点一下画面。' }),
    ]),
  ]));

  const ctx = canvas.getContext('2d', { alpha: false });
  const pointFromEvent = (event) => {
    if (!videoSize) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = Math.round(((event.clientX - rect.left) / rect.width) * videoSize.width);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * videoSize.height);
    return {
      x: Math.min(videoSize.width - 1, Math.max(0, x)),
      y: Math.min(videoSize.height - 1, Math.max(0, y)),
    };
  };

  canvas.addEventListener('pointerdown', (event) => {
    canvas.focus();
    canvas.setPointerCapture(event.pointerId);
    pressing = true;
    const point = pointFromEvent(event);
    if (point) send({ type: 'touch', action: 'down', ...point });
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!pressing) return;
    const point = pointFromEvent(event);
    if (point) send({ type: 'touch', action: 'move', ...point });
  });
  const endPointer = (event) => {
    if (!pressing) return;
    pressing = false;
    const point = pointFromEvent(event);
    if (point) send({ type: 'touch', action: 'up', ...point });
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('keydown', (event) => {
    const map = {
      Backspace: 'del',
      Enter: 'enter',
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };
    const code = map[event.key];
    if (!code) return;
    send({ type: 'key', code });
    event.preventDefault();
  });

  const paint = (frame) => {
    const width = frame.displayWidth || frame.codedWidth;
    const height = frame.displayHeight || frame.codedHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.aspectRatio = `${width} / ${height}`;
    }
    ctx.drawImage(frame, 0, 0, width, height);
  };

  const ensureDecoder = () => {
    if (!('VideoDecoder' in window)) {
      status('这个浏览器不能解码 H.264。请用 Chrome 或 Edge 打开。');
      return false;
    }
    if (!codecString || !videoSize) return false;
    const key = `${codecString}:${videoSize.width}x${videoSize.height}`;
    if (decoder && decoder.state === 'configured' && configuredFor === key) return true;
    if (decoder) {
      try { decoder.close(); } catch { /* replacing */ }
    }
    decoder = new VideoDecoder({
      output(frame) {
        paint(frame);
        frame.close();
        status('');
      },
      error() {
        status('画面解码失败。请用桌面版 Chrome 或 Edge，或重新打开这台手机。');
        try { decoder.close(); } catch { /* closed */ }
        decoder = null;
        configuredFor = '';
        sawKey = false;
      },
    });
    try {
      decoder.configure({
        codec: codecString,
        codedWidth: videoSize.width,
        codedHeight: videoSize.height,
        optimizeForLatency: true,
      });
    } catch {
      status('这个浏览器不接受这路 H.264。请换 Chrome 或 Edge。');
      decoder = null;
      return false;
    }
    configuredFor = key;
    return true;
  };

  const applySize = (width, height) => {
    const changed = !videoSize || videoSize.width !== width || videoSize.height !== height;
    videoSize = { width, height };
    canvas.style.aspectRatio = `${width} / ${height}`;
    if (changed) {
      sawKey = false;
      configuredFor = '';
      if (decoder) {
        try { decoder.close(); } catch { /* closed */ }
        decoder = null;
      }
    }
  };

  const onBinary = (buffer) => {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 2) return;
    const key = bytes[0] === 1;
    const data = bytes.subarray(1);
    if (!key && !sawKey) return;
    if (!ensureDecoder()) return;
    if (key) sawKey = true;
    timestamp += 33000;
    try {
      decoder.decode(new EncodedVideoChunk({
        type: key ? 'key' : 'delta',
        timestamp,
        data,
      }));
    } catch {
      status('画面解码失败。');
    }
  };

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/api/sessions/${session.id}/stream`);
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (event) => {
    if (typeof event.data === 'string') {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'hello') {
        const sub = app.querySelector('.sub');
        const name = [message.deviceName, session.model].filter(Boolean).join(' · ');
        if (sub && name) sub.textContent = name;
        status('正在接收画面…');
      } else if (message.type === 'session') {
        applySize(message.width, message.height);
      } else if (message.type === 'codec') {
        codecString = message.codecString;
      } else if (message.type === 'error') {
        status(message.message || '画面出错了。');
      }
      return;
    }
    onBinary(event.data);
  };
  ws.onerror = () => status('画面连接失败。');
  ws.onclose = () => {
    if (state.view === 'console') status('连接已断开。可以返回列表再打开。');
  };
}

function taskStatusClass(status) {
  if (status === 'failed') return 'status-failed';
  if (status === 'queued') return 'status-queued';
  return 'status-ok';
}

function renderTaskForm() {
  const type = el('select', { id: 'task-type', name: 'type' });
  for (const item of state.taskTypes) {
    type.append(el('option', { value: item.id, text: item.label }));
  }
  const keyword = el('input', {
    id: 'task-keyword',
    type: 'text',
    name: 'keyword',
    maxlength: '40',
    autocomplete: 'off',
  });
  const limit = el('input', {
    id: 'task-limit',
    type: 'number',
    name: 'limit',
    min: '1',
    max: '30',
    value: '10',
  });
  const device = el('select', { id: 'task-device', name: 'serial' });
  const error = el('p', { id: 'task-error', class: 'form-error', role: 'alert', text: state.taskError });
  const form = el('form', { class: 'task-form' }, [
    el('label', {}, [el('span', { text: '种类' }), type]),
    el('label', {}, [el('span', { text: '关键词' }), keyword]),
    el('label', {}, [el('span', { text: '条数' }), limit]),
    el('label', {}, [el('span', { text: '手机' }), device]),
    el('button', { class: 'primary', type: 'submit', text: '提交' }),
    error,
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    error.textContent = '';
    button.disabled = true;
    try {
      await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          type: type.value,
          keyword: keyword.value,
          limit: Number(limit.value),
          serial: device.value,
        }),
      });
      keyword.value = '';
      await refreshTasks();
    } catch (err) {
      error.textContent = err.message || '提交失败。';
    } finally {
      button.disabled = false;
    }
  });
  return form;
}

function fillTaskDevices() {
  const select = document.querySelector('#task-device');
  if (!select) return;
  const current = select.value;
  const busy = new Set(
    state.tasks.filter((task) => task.status === 'queued' || task.status === 'running').map((task) => task.serial),
  );
  const online = state.taskDevices.filter((device) => device.state === 'device');
  select.replaceChildren();
  if (!online.length) {
    select.append(el('option', { value: '', text: '没有在线的手机' }));
    return;
  }
  let selectable = 0;
  for (const device of online) {
    const label = device.model ? `${device.model} · ${device.serial}` : device.serial;
    const option = el('option', {
      value: device.serial,
      text: busy.has(device.serial) ? `${label}（有任务）` : label,
    });
    if (busy.has(device.serial)) option.disabled = true;
    else selectable += 1;
    select.append(option);
  }
  if (!selectable) select.prepend(el('option', { value: '', text: '没有空闲的手机' }));
  const idle = [...select.options].find((option) => option.value && !option.disabled);
  if (current && [...select.options].some((option) => option.value === current && !option.disabled)) {
    select.value = current;
  } else if (idle) {
    select.value = idle.value;
  } else {
    select.value = '';
  }
}

function noteCell(text) {
  return el('td', { text: text || '' });
}

function renderTaskDetail(task) {
  const slot = document.querySelector('#task-detail');
  if (!slot) return;
  if (!task) {
    slot.replaceChildren();
    return;
  }
  const table = el('table', { class: 'notes' }, [
    el('thead', {}, [
      el('tr', {}, ['笔记 ID', '标题', '作者', '作者主页', '点赞', '笔记链接'].map((label) => el('th', { text: label }))),
    ]),
    el('tbody', {}, (task.notes || []).map((note) => el('tr', {}, [
      noteCell(note.noteId),
      noteCell(note.title),
      noteCell(note.author),
      el('td', {}, note.authorUrl ? [el('a', { href: note.authorUrl, target: '_blank', rel: 'noreferrer', text: note.authorUrl })] : []),
      noteCell(note.likes),
      el('td', {}, note.noteUrl ? [el('a', { href: note.noteUrl, target: '_blank', rel: 'noreferrer', text: note.noteUrl })] : []),
    ]))),
  ]);
  const head = [
    el('p', { class: 'count', text: `拿到 ${task.count} 条` }),
  ];
  if (task.error) head.push(el('div', { class: 'banner', role: 'alert', text: task.error }));
  slot.replaceChildren(el('section', { class: 'task-detail' }, [
    el('h3', { text: `${task.typeLabel} · ${task.keyword}` }),
    ...head,
    table,
  ]));
}

function renderTaskList() {
  const slot = document.querySelector('#task-list');
  if (!slot) return;
  fillTaskDevices();
  if (!state.tasks.length) {
    slot.replaceChildren(el('p', { class: 'hint', text: '还没有任务。' }));
    renderTaskDetail(null);
    return;
  }
  const list = el('ul', { class: 'task-list' });
  for (const task of state.tasks) {
    const open = task.id === state.openTaskId;
    list.append(el('li', { class: open ? 'task-row on' : 'task-row' }, [
      el('span', { text: task.keyword }),
      el('span', { class: 'serial', text: task.serial }),
      el('span', { class: taskStatusClass(task.status), text: task.statusLabel }),
      el('span', { text: `拿到 ${task.count} 条` }),
      el('button', {
        class: 'ghost',
        type: 'button',
        text: open ? '收起' : '结果',
        onclick: () => {
          state.openTaskId = open ? '' : task.id;
          renderTaskList();
        },
      }),
    ]));
  }
  slot.replaceChildren(list);
  renderTaskDetail(state.tasks.find((task) => task.id === state.openTaskId) || null);
}

async function refreshTasks() {
  if (state.view !== 'tasks') return;
  try {
    const [listed, devices] = await Promise.all([
      api('/api/tasks'),
      api('/api/devices'),
    ]);
    state.tasks = listed.tasks || [];
    state.taskDevices = devices.devices || [];
    state.taskError = '';
    const error = document.querySelector('#task-error');
    if (error && !error.textContent) error.textContent = '';
    renderTaskList();
  } catch (err) {
    if (err.status === 401) return;
    const error = document.querySelector('#task-error');
    if (error) error.textContent = err.message || '读任务失败。';
  }
}

async function showTasks() {
  state.view = 'tasks';
  document.title = '任务 · 手机控制台';
  stopPoll();
  if (!state.scrcpy) {
    try {
      const meta = await api('/api/meta');
      state.scrcpy = meta.scrcpy || '';
    } catch {
      state.scrcpy = '';
    }
  }
  app.replaceChildren(shell({
    title: '任务',
    extra: el('p', { text: '一台手机同时只跑一个。失败会停住，并写明原因。' }),
    active: 'tasks',
    onRefresh: () => refreshTasks(),
  }));
  const slot = document.querySelector('#list-slot');
  try {
    if (!state.taskTypes.length) {
      const types = await api('/api/task-types');
      state.taskTypes = types.types || [];
    }
    slot.append(
      renderTaskForm(),
      el('div', { id: 'task-list' }),
      el('div', { id: 'task-detail' }),
    );
    await refreshTasks();
    state.poll = setInterval(() => {
      refreshTasks().catch(() => {});
    }, 2000);
  } catch (err) {
    if (err.status === 401) return;
    slot.replaceChildren(el('div', { class: 'banner', role: 'alert', text: err.message || '打不开任务。' }));
  }
}

window.addEventListener('pagehide', () => {
  const id = state.session?.id;
  if (!id) return;
  fetch(`/api/sessions/${id}`, { method: 'DELETE', keepalive: true });
});

try {
  const me = await api('/api/me', { quiet: true });
  state.me = me;
  await showDevices();
} catch (err) {
  renderLogin(err.status === 401 ? '' : '暂时连不上控制台。');
}
