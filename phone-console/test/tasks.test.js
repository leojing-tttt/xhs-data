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

test('xhs search accepts 400 notes and rejects a count above 2000', () => {
  const store = createTaskStore({
    execute() {
      return new Promise(() => {});
    },
  });
  const asked = store.submit({ type: 'xhs-search', serial: 'phone-a', keyword: '咖啡', limit: 400 });
  assert.equal(asked.limit, 400);
  assert.equal(asked.status, 'queued');
  const top = store.submit({ type: 'xhs-search', serial: 'phone-b', keyword: '咖啡', limit: 2000 });
  assert.equal(top.limit, 2000);
  assert.throws(
    () => store.submit({ type: 'xhs-search', serial: 'phone-c', keyword: '咖啡', limit: 2001 }),
    (err) => err instanceof TaskError && err.status === 400 && err.message === '条数要在 1 到 2000 之间。',
  );
});

test('a screen fallback keeps the reason on a succeeded task', async () => {
  const store = createTaskStore({
    execute() {
      return {
        notes: [{
          title: '屏幕标题',
          author: '阿禾',
          publishedAt: '',
          likes: '1',
          noteUrl: '',
          noteId: '',
          authorUrl: '',
        }],
        reason: '没有读到小红书自己的搜索响应，已改用屏幕上的文字。',
      };
    },
  });
  const task = store.submit({ type: 'xhs-search', serial: 'abc123', keyword: '咖啡', limit: 1 });
  await tick();
  await tick();
  const saved = store.get(task.id);
  assert.equal(saved.status, 'succeeded');
  assert.match(saved.error, /搜索响应/);
  assert.equal(saved.notes[0].title, '屏幕标题');
  assert.equal(saved.notes[0].noteUrl, '');
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
    assert.match(source, /导出 Excel/);
    assert.match(source, /发布时间/);
    assert.match(source, /max: '2000'/);
    assert.match(source, /value: '10'/);
  } finally {
    server.close();
  }
});

test('task excel export is one row per note and omits non-note rows', async () => {
  const store = createTaskStore({
    execute() {
      return [
        {
          title: '经期安全感被这条安睡裤拿捏住',
          author: '青柠',
          publishedAt: '3天前',
          likes: '10',
          noteUrl: '',
          noteId: '',
          authorUrl: '',
        },
        {
          title: '大家都在搜',
          author: '安睡裤排行榜前十名',
          publishedAt: '',
          likes: '',
          noteUrl: '',
        },
        {
          title: '购物狂欢',
          author: '10.10-11.11',
          publishedAt: '',
          likes: '',
          noteUrl: '',
        },
      ];
    },
  });
  const server = createApp({
    users,
    sessionSecret: 'http-test-secret',
    taskStore: store,
    sessionManager: { start() {}, stop() {}, stopAll() {}, attach() {} },
    runAdb() {
      return Promise.resolve({ stdout: 'List of devices attached\nabc123 device model:ALT_AL10\n', stderr: '' });
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
    const created = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'xhs-search', serial: 'abc123', keyword: '安睡裤', limit: 3 }),
    });
    const task = await created.json();
    await tick();
    await tick();
    const saved = store.get(task.id);
    assert.equal(saved.status, 'succeeded');
    assert.equal(saved.count, 1);
    assert.deepEqual(saved.notes.map((note) => note.title), ['经期安全感被这条安睡裤拿捏住']);
    assert.equal(saved.notes[0].publishedAt, '3天前');
    assert.equal(saved.notes[0].noteUrl, '');
    const denied = await fetch(`http://127.0.0.1:${port}/api/tasks/${task.id}/export`);
    assert.equal(denied.status, 401);
    const exported = await fetch(`http://127.0.0.1:${port}/api/tasks/${task.id}/export`, { headers: { cookie } });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type'), /spreadsheetml\.sheet/);
    const bytes = Buffer.from(await exported.arrayBuffer());
    const xml = bytes.toString('utf8');
    assert.match(xml, /笔记标题/);
    assert.match(xml, /经期安全感被这条安睡裤拿捏住/);
    assert.match(xml, /3天前/);
    assert.doesNotMatch(xml, /大家都在搜|购物狂欢/);
    assert.equal([...xml.matchAll(/<row /g)].length, 2);
  } finally {
    server.close();
  }
});
