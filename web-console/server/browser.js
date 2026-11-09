import { spawn } from 'node:child_process';
import { accessSync, constants, mkdirSync } from 'node:fs';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { searchPageUrl } from './notes.js';
import { pageHookSource } from './page-hook.js';

export function chromeBinary() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/opt/google/chrome/chrome',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next installed binary. The PATH wrapper pins one shared profile.
    }
  }
  throw new Error('这台电脑上没有找到 Chrome');
}

export function browserHeadless(explicit) {
  if (explicit != null) return Boolean(explicit);
  if (process.env.XHS_BROWSER_HEADLESS === '1') return true;
  if (process.env.XHS_BROWSER_HEADLESS === '0') return false;
  return !process.env.DISPLAY;
}

export async function launchSearchBrowser({ keyword, userDataDir, headless } = {}) {
  if (!keyword) throw new Error('缺少关键词');
  const opened = await launchChrome({
    userDataDir,
    headless: browserHeadless(headless),
    hookSource: pageHookSource(),
    navigateTo: searchPageUrl(keyword),
  });
  return sessionFrom(opened);
}

export async function withChromePage(callback, options = {}) {
  const opened = await launchChrome({
    userDataDir: options.userDataDir,
    headless: options.headless !== false,
    hookSource: options.hookSource || '',
    navigateTo: options.url || '',
  });
  try {
    return await callback({
      evaluate: opened.evaluate,
      close: opened.close,
    });
  } finally {
    await opened.close();
  }
}

function sessionFrom(opened) {
  const queue = [];
  return {
    async take(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const href = await opened.evaluate('location.href');
          if (typeof href === 'string' && href.startsWith('chrome-error://')) {
            throw new Error('打不开小红书页面');
          }
          const raw = await opened.evaluate('window.__xhsWebConsole && window.__xhsWebConsole.take()');
          if (raw) queue.push(...JSON.parse(raw));
        } catch (error) {
          if (error && error.message === '打不开小红书页面') throw error;
        }
        if (queue.length) return queue.shift();
        const left = deadline - Date.now();
        if (left <= 0) break;
        await delay(Math.min(200, left));
      }
      return null;
    },
    async sendNext(request) {
      const installed = await opened.evaluate('Boolean(window.__xhsWebConsole)');
      if (!installed) throw new Error('页面里没有挂上搜索响应钩子');
      const payload = JSON.stringify(JSON.stringify(request));
      await opened.evaluate(`window.__xhsWebConsole.sendNext(${payload})`);
    },
    close: () => opened.close(),
  };
}

async function launchChrome({ userDataDir, headless, hookSource, navigateTo }) {
  if (typeof WebSocket !== 'function') throw new Error('需要 Node.js 22 的 WebSocket');
  mkdirSync(userDataDir || '/tmp/xhs-web-console-chrome', { recursive: true });
  const dir = userDataDir || '/tmp/xhs-web-console-chrome';
  const port = await freePort();
  const binary = chromeBinary();
  const args = [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*',
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    'about:blank',
  ];
  if (headless) args.push('--headless=new', '--disable-gpu');
  let stderr = '';
  const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-2000);
  });
  let socket;
  try {
    const version = await waitForVersion(port, child, () => stderr);
    socket = await openSocket(version.webSocketDebuggerUrl);
    const page = await waitForPage(port);
    const attached = await rpc(socket, 'Target.attachToTarget', {
      targetId: page.id,
      flatten: true,
    });
    const sessionId = attached.sessionId;
    await rpc(socket, 'Page.enable', {}, sessionId);
    await rpc(socket, 'Runtime.enable', {}, sessionId);
    if (hookSource) {
      await rpc(socket, 'Page.addScriptToEvaluateOnNewDocument', { source: hookSource }, sessionId);
    }
    if (navigateTo) await rpc(socket, 'Page.navigate', { url: navigateTo }, sessionId);
    return {
      evaluate: (expression) => evaluate(socket, sessionId, expression),
      async close() {
        await closeChrome(socket, child, page.id);
      },
    };
  } catch (error) {
    await closeChrome(socket, child);
    throw error;
  }
}

async function evaluate(socket, sessionId, expression) {
  const result = await rpc(socket, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception && result.exceptionDetails.exception.description
      || result.exceptionDetails.text
      || '页面脚本执行失败';
    throw new Error(text);
  }
  return result.result ? result.result.value : undefined;
}

async function closeChrome(socket, child, targetId) {
  if (socket && socket.readyState === WebSocket.OPEN && targetId) {
    try {
      await rpc(socket, 'Target.closeTarget', { targetId });
    } catch {
      // The process kill below is the fallback.
    }
  }
  if (socket) {
    try { socket.close(); } catch { /* already closed */ }
  }
  if (child && child.exitCode == null && !child.killed) {
    child.kill('SIGTERM');
    const exited = await waitForExit(child, 3000);
    if (!exited) child.kill('SIGKILL');
  }
}

function rpc(socket, method, params, sessionId) {
  const id = socket._nextId = (socket._nextId || 0) + 1;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket._pending.delete(id);
      reject(new Error(`Chrome 没有响应 ${method}`));
    }, 15000);
    socket._pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    const message = { id, method, params: params || {} };
    if (sessionId) message.sessionId = sessionId;
    socket.send(JSON.stringify(message));
  });
}

function openSocket(url) {
  const socket = new WebSocket(url);
  socket._pending = new Map();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('连接 Chrome 调试端口超时'));
    }, 10000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('连接 Chrome 调试端口失败'));
    });
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message.id || !socket._pending.has(message.id)) return;
      const pending = socket._pending.get(message.id);
      socket._pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'Chrome 调试命令失败'));
      else pending.resolve(message.result || {});
    });
  });
}

async function waitForPage(port) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const list = await response.json();
        const page = list.find((item) => item.type === 'page');
        if (page) return page;
      }
    } catch {
      // The port is up before the first tab is listed.
    }
    await delay(100);
  }
  throw new Error('Chrome 没有打开页面');
}

async function waitForVersion(port, child, stderr) {
  const deadline = Date.now() + 15000;
  let last = '';
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Chrome 已退出（${child.exitCode}）${stderr() ? ` ${stderr()}` : ''}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return await response.json();
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error.message;
    }
    await delay(200);
  }
  throw new Error(`Chrome 调试端口没有起来${last ? `：${last}` : ''}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode != null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
