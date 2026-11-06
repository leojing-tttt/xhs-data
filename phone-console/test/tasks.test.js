import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadUsers } from '../server/auth.js';
import { createApp } from '../server/http.js';
import { TaskError, createTaskStore } from '../server/tasks.js';

const users = loadUsers(fileURLToPath(new URL('../config/users.json', import.meta.url)));

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('enqueue keeps the task queued until the phone starts it', async () => {
  let started = 0;
  const store = createTaskStore({
    execute() {
      started += 1;
      return new Promise(() => {});
    },
  });
  const task = store.submit({ type: 'xhs-search', serial: 'abc123', keyword: '咖啡', limit: 3 });
  assert.equal(task.status, 'queued');
  assert.equal(task.statusLabel, '排队');
  assert.equal(task.count, 0);
  assert.equal(started, 0);
  await tick();
  assert.equal(store.get(task.id).status, 'running');
  assert.equal(started, 1);
});

test('one phone cannot accept a second task while the first is queued or running', async () => {
  let started = 0;
  const store = createTaskStore({
    execute() {
      started += 1;
      return new Promise(() => {});
    },
  });
  const first = store.submit({ type: 'xhs-search', serial: 'phone-a', keyword: '咖啡', limit: 2 });
  assert.throws(
    () => store.submit({ type: 'xhs-search', serial: 'phone-a', keyword: '茶', limit: 2 }),
    (err) => err instanceof TaskError && err.status === 409 && err.message === '这台手机已经有任务。等它结束再提交。',
  );
  await tick();
  assert.equal(store.get(first.id).status, 'running');
  assert.throws(
    () => store.submit({ type: 'xhs-search', serial: 'phone-a', keyword: '茶', limit: 2 }),
    (err) => err instanceof TaskError && err.status === 409,
  );
  const other = store.submit({ type: 'xhs-search', serial: 'phone-b', keyword: '茶', limit: 1 });
  assert.equal(other.status, 'queued');
  await tick();
  assert.equal(started, 2);
  assert.equal(store.list().length, 2);
});

test('failure stays failed with the reason and is not retried', async () => {
  let started = 0;
  const store = createTaskStore({
    execute() {
      started += 1;
      return Promise.reject(new Error('小红书还没登录。请在这台手机上登录后再试。'));
    },
  });
  const task = store.submit({ type: 'xhs-search', serial: 'abc123', keyword: '咖啡', limit: 2 });
  await tick();
  await tick();
  const saved = store.get(task.id);
  assert.equal(saved.status, 'failed');
  assert.equal(saved.statusLabel, '失败');
  assert.equal(saved.error, '小红书还没登录。请在这台手机上登录后再试。');
  assert.equal(saved.count, 0);
  assert.deepEqual(saved.notes, []);
  assert.equal(started, 1);
  await tick();
  assert.equal(started, 1);
});

test('http submit enqueues and rejects a second task for the same phone', async () => {
  const store = createTaskStore({
    execute() {
      return new Promise(() => {});
    },
  });
  const server = createApp({
    users,
    sessionSecret: 'http-test-secret',
    taskStore: store,
    sessionManager: { start() {}, stop() {}, stopAll() {}, attach() {} },
    runAdb(args) {
      if (args.includes('devices')) {
        return Promise.resolve({
          stdout: 'List of devices attached\nabc123 device model:Pixel_8\n',
          stderr: '',
        });
      }
      return Promise.resolve({ stdout: 'Pixel 8\n', stderr: '' });
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  try {
    const login = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'leijing', password: 'leijing-local' }),
    });
    const cookie = login.headers.getSetCookie()[0].split(';')[0];
    const post = (keyword) => fetch(`http://127.0.0.1:${port}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'xhs-search', serial: 'abc123', keyword, limit: 2 }),
    });
    const first = await post('咖啡');
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.equal(body.status, 'queued');
    assert.equal(body.typeLabel, '小红书搜索');
    const second = await post('茶');
    assert.equal(second.status, 409);
    const denied = await second.json();
    assert.equal(denied.message, '这台手机已经有任务。等它结束再提交。');
    const page = await fetch(`http://127.0.0.1:${port}/app.js`);
    const source = await page.text();
    assert.match(source, /tab\('tasks', '任务'/);
    assert.match(source, /拿到 /);
  } finally {
    server.close();
  }
});
