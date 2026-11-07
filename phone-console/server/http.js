import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAdb } from './adb.js';
import {
  authenticate,
  clearSessionCookie,
  createSessionToken,
  readCookie,
  readSessionToken,
  sessionCookie,
} from './auth.js';
import { adbErrorMessage, isSafeSerial, listDevices } from './devices.js';
import { SCRCPY_VERSION } from './scrcpy.js';
import { createSessionManager, SessionError } from './session.js';
import { TASK_TYPES } from './task-types.js';
import { createTaskStore } from './tasks.js';
import { acceptWebSocket, rejectUpgrade } from './ws.js';
import { searchXiaohongshu } from './xhs-search.js';
import { exportFilename, notesWorkbook } from './xlsx.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export function appRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function sendBytes(res, status, body, headers) {
  res.writeHead(status, {
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

function readBody(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const error = new Error('请求太大。');
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try {
    const value = JSON.parse(raw.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      const error = new Error('请求格式不对。');
      error.status = 400;
      throw error;
    }
    return value;
  } catch (err) {
    if (err.status) throw err;
    const error = new Error('请求格式不对。');
    error.status = 400;
    throw error;
  }
}

export function createApp(options = {}) {
  const root = options.root || appRoot();
  const users = options.users || [];
  const secret = options.sessionSecret || 'test-secret';
  const run = options.runAdb || runAdb;
  const manager = options.sessionManager || createSessionManager({ runAdb: run, root });
  const publicDir = path.resolve(options.publicDir || path.join(root, 'public'));
  const tasks = options.taskStore || createTaskStore({
    file: options.taskFile || '',
    execute: options.taskExecute || ((task) => searchXiaohongshu({
      runAdb: run,
      serial: task.serial,
      keyword: task.keyword,
      limit: task.limit,
    })),
  });

  function currentUser(req) {
    const token = readCookie(req.headers.cookie || '', 'pc_session');
    const session = readSessionToken(token, secret);
    if (!session) return null;
    const user = users.find((item) => item.username === session.username);
    if (!user) return null;
    return {
      username: user.username,
      displayName: user.displayName || user.username,
    };
  }

  async function route(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/api/meta' && req.method === 'GET') {
      sendJson(res, 200, { scrcpy: SCRCPY_VERSION });
      return;
    }

    if (url.pathname === '/api/login' && req.method === 'POST') {
      const body = await readJson(req);
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const user = authenticate(users, username, password);
      if (!user) {
        sendJson(res, 401, { error: 'invalid-login', message: '账号或密码不对。' });
        return;
      }
      const token = createSessionToken(user.username, secret);
      res.setHeader('set-cookie', sessionCookie(token));
      sendJson(res, 200, user);
      return;
    }

    if (url.pathname === '/api/logout' && req.method === 'POST') {
      res.setHeader('set-cookie', clearSessionCookie());
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/me' && req.method === 'GET') {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: 'unauthorized', message: '请先登录。' });
        return;
      }
      sendJson(res, 200, user);
      return;
    }

    if (url.pathname === '/api/devices' && req.method === 'GET') {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: 'unauthorized', message: '请先登录。' });
        return;
      }
      const result = await listDevices(run);
      sendJson(res, 200, {
        devices: result.devices,
        adbError: result.adbError,
        message: adbErrorMessage(result.adbError),
        detail: result.detail,
      });
      return;
    }

    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([a-f0-9]{32})$/);
    if (sessionMatch && req.method === 'DELETE') {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: 'unauthorized', message: '请先登录。' });
        return;
      }
      manager.stop(sessionMatch[1]);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/sessions' && req.method === 'POST') {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: 'unauthorized', message: '请先登录。' });
        return;
      }
      const body = await readJson(req);
      const info = await manager.start(typeof body.serial === 'string' ? body.serial : '', body.model || '');
      sendJson(res, 200, info);
      return;
    }

    if (url.pathname === '/api/task-types' && req.method === 'GET') {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: 'unauthorized', message: '请先登录。' });
        return;
      }
      sendJson(res, 200, { types: TASK_TYPES });
      return;
    }

    if (url.pathname === '/api/tasks' && req.method === 'GET') {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: 'unauthorized', message: '请先登录。' });
        return;
      }
      sendJson(res, 200, { tasks: tasks.list() });
      return;
    }

    const exportMatch = url.pathname.match(/^\/api\/tasks\/([a-f0-9]{16})\/export$/);
    if (exportMatch && req.method === 'GET') {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: 'unauthorized', message: '请先登录。' });
        return;
      }
      const task = tasks.get(exportMatch[1]);
      if (!task) {
        sendJson(res, 404, { error: 'not-found', message: '没有这个任务。' });
        return;
      }
      const filename = exportFilename(task.keyword);
      sendBytes(res, 200, notesWorkbook(task.notes), {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="xhs-notes.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      });
      return;
    }

    const taskMatch = url.pathname.match(/^\/api\/tasks\/([a-f0-9]{16})$/);
    if (taskMatch && req.method === 'GET') {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: 'unauthorized', message: '请先登录。' });
        return;
      }
      const task = tasks.get(taskMatch[1]);
      if (!task) {
        sendJson(res, 404, { error: 'not-found', message: '没有这个任务。' });
        return;
      }
      sendJson(res, 200, task);
      return;
    }

    if (url.pathname === '/api/tasks' && req.method === 'POST') {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: 'unauthorized', message: '请先登录。' });
        return;
      }
      const body = await readJson(req);
      const serial = typeof body.serial === 'string' ? body.serial : '';
      if (!isSafeSerial(serial)) {
        sendJson(res, 400, { error: 'request', message: '请选择一台手机。' });
        return;
      }
      const listed = await listDevices(run);
      if (listed.adbError) {
        sendJson(res, 503, { error: 'adb', message: adbErrorMessage(listed.adbError) });
        return;
      }
      const online = listed.devices.some((device) => device.serial === serial && device.state === 'device');
      if (!online) {
        sendJson(res, 404, { error: 'request', message: '这台手机不在线。插上之后再选。' });
        return;
      }
      const task = tasks.submit({
        type: body.type,
        serial,
        keyword: body.keyword,
        limit: body.limit,
      });
      sendJson(res, 200, task);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 404, { error: 'not-found', message: '没有这个接口。' });
      return;
    }
    await serveStatic(req, res, url.pathname, publicDir);
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      const status = err.status || 500;
      const message = err instanceof SessionError || err.status ? err.message : '服务出错了。';
      if (status >= 500 && !(err instanceof SessionError)) {
        console.error(err);
      }
      sendJson(res, status, { error: 'request', message: message || '服务出错了。' });
    });
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const match = url.pathname.match(/^\/api\/sessions\/([a-f0-9]{32})\/stream$/);
    if (!match) {
      rejectUpgrade(socket, 404, '没有这个画面通道。');
      return;
    }
    if (!currentUser(req)) {
      rejectUpgrade(socket, 401, '请先登录。');
      return;
    }
    const viewer = acceptWebSocket(req, socket, head);
    if (!viewer) {
      rejectUpgrade(socket, 400, '无法升级连接。');
      return;
    }
    manager.attach(match[1], viewer);
  });

  server.sessionManager = manager;
  server.taskStore = tasks;
  server.requestTimeout = 30000;
  return server;
}

async function serveStatic(req, res, pathname, publicDir) {
  let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  try {
    rel = decodeURIComponent(rel);
  } catch {
    sendJson(res, 400, { error: 'bad-path', message: '路径不对。' });
    return;
  }
  if (rel.includes('\0')) {
    sendJson(res, 400, { error: 'bad-path', message: '路径不对。' });
    return;
  }
  const file = path.resolve(publicDir, rel);
  if (file !== publicDir && !file.startsWith(`${publicDir}${path.sep}`)) {
    sendJson(res, 403, { error: 'forbidden', message: '不能读这个文件。' });
    return;
  }
  let info;
  try {
    info = await stat(file);
  } catch {
    sendJson(res, 404, { error: 'not-found', message: '没有这个页面。' });
    return;
  }
  if (!info.isFile()) {
    sendJson(res, 404, { error: 'not-found', message: '没有这个页面。' });
    return;
  }
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(req.method === 'HEAD' ? 200 : 200, {
    'content-type': type,
    'content-length': info.size,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'",
    'referrer-policy': 'same-origin',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}
