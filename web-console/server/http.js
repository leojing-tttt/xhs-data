import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { formOptions } from './form.js';

const FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/a3-components.css', 'a3-components.css'],
  ['/page.css', 'page.css'],
  ['/app.js', 'app.js'],
]);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

export function createHttpServer({ tasks, publicDir }) {
  return createServer(async (req, res) => {
    try {
      await route(req, res, tasks, publicDir);
    } catch (error) {
      const status = error && error.status ? error.status : 500;
      if (status === 500) console.error(error);
      sendJson(res, status, { error: status === 500 ? '服务内部错误' : error.message });
    }
  });
}

async function route(req, res, tasks, publicDir) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/api/form') {
    sendJson(res, 200, formOptions());
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/tasks') {
    sendJson(res, 200, { tasks: tasks.list() });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/tasks') {
    const body = await readJson(req);
    const created = tasks.create(body);
    if (!created.ok) {
      sendJson(res, 400, { error: created.error });
      return;
    }
    sendJson(res, 201, { task: created.task });
    return;
  }
  const download = /^\/api\/tasks\/(task_[a-z0-9]+)\/download$/.exec(url.pathname);
  if (req.method === 'GET' && download) {
    const file = tasks.fileFor(download[1]);
    if (!file || !existsSync(file.path)) {
      sendJson(res, 404, { error: '还没有可下载的 Excel' });
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': contentDisposition(file.filename),
    });
    createReadStream(file.path).pipe(res);
    return;
  }
  const one = /^\/api\/tasks\/(task_[a-z0-9]+)$/.exec(url.pathname);
  if (req.method === 'GET' && one) {
    const task = tasks.get(one[1]);
    if (!task) {
      sendJson(res, 404, { error: '没有这个任务' });
      return;
    }
    sendJson(res, 200, { task });
    return;
  }
  if (req.method === 'GET' && FILES.has(url.pathname)) {
    const name = FILES.get(url.pathname);
    const file = join(publicDir, name);
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(name)] || 'application/octet-stream' });
    res.end(body);
    return;
  }
  sendJson(res, 404, { error: '没有这个页面' });
}

function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 32 * 1024) {
        const error = new Error('请求太大');
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        const error = new Error('请求不是 JSON');
        error.status = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}
