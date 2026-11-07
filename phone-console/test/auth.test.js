import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  authenticate,
  createSessionToken,
  loadUsers,
  readSessionToken,
} from '../server/auth.js';
import { createApp } from '../server/http.js';

const users = loadUsers(fileURLToPath(new URL('../config/users.json', import.meta.url)));

test('configured account accepts the local password and rejects a wrong one', () => {
  const ok = authenticate(users, 'leijing', 'leijing-local');
  assert.deepEqual(ok, { username: 'leijing', displayName: '雷靖' });
  assert.equal(authenticate(users, 'leijing', 'wrong-password'), null);
  assert.equal(authenticate(users, 'someone-else', 'leijing-local'), null);
  assert.equal(authenticate(users, 'leijing', ''), null);
});

test('session token expires and rejects tampering', () => {
  const secret = 'test-secret';
  const now = 1_700_000_000_000;
  const token = createSessionToken('leijing', secret, now);
  assert.deepEqual(readSessionToken(token, secret, now + 1000), { username: 'leijing' });
  assert.equal(readSessionToken(token, secret, now + 13 * 60 * 60 * 1000), null);
  assert.equal(readSessionToken(token, 'other-secret', now + 1000), null);
  const [body, sig] = token.split('.');
  const flipped = `${body.slice(0, -1)}${body.endsWith('A') ? 'B' : 'A'}.${sig}`;
  assert.equal(readSessionToken(flipped, secret, now + 1000), null);
  assert.equal(readSessionToken(`${body}.${sig}x`, secret, now + 1000), null);
});

test('wrong password stays out and does not set a session cookie', async () => {
  let adbCalled = false;
  const server = createApp({
    users,
    sessionSecret: 'http-test-secret',
    runAdb() {
      adbCalled = true;
      return Promise.resolve({ stdout: '', stderr: '' });
    },
    sessionManager: { start() {}, stop() {}, stopAll() {}, attach() {} },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  try {
    const bad = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'leijing', password: 'nope' }),
    });
    assert.equal(bad.status, 401);
    const body = await bad.json();
    assert.equal(body.message, '账号或密码不对。');
    const setCookie = bad.headers.getSetCookie?.() || [];
    assert.equal(setCookie.length, 0);

    const hidden = await fetch(`http://127.0.0.1:${port}/api/devices`);
    assert.equal(hidden.status, 401);
    assert.equal(adbCalled, false);

    const good = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'leijing', password: 'leijing-local' }),
    });
    assert.equal(good.status, 200);
    const cookies = good.headers.getSetCookie();
    assert.match(cookies[0], /pc_session=/);
    assert.match(cookies[0], /HttpOnly/i);
    assert.match(cookies[0], /SameSite=Lax/i);
    const me = await good.json();
    assert.equal(me.displayName, '雷靖');

    const cookie = cookies[0].split(';')[0];
    const devices = await fetch(`http://127.0.0.1:${port}/api/devices`, {
      headers: { cookie },
    });
    assert.equal(devices.status, 200);
    assert.equal(adbCalled, true);
  } finally {
    server.close();
  }
});

test('login page is served in Chinese', async () => {
  const server = createApp({
    users,
    sessionSecret: 'http-test-secret',
    sessionManager: { start() {}, stop() {}, stopAll() {}, attach() {} },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /手机控制台/);
    assert.match(html, /lang="zh-CN"/);
    const script = await fetch(`http://127.0.0.1:${port}/app.js`);
    const source = await script.text();
    assert.match(source, /账号或密码不对/);
    assert.match(source, /还没有手机/);
    assert.equal(readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8').includes('还没有手机'), true);
  } finally {
    server.close();
  }
});
