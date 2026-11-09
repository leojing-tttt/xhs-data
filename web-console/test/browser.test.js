import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { withChromePage } from '../server/browser.js';
import { startConsole } from '../server/index.js';
import { createRunner } from '../server/runner.js';

test('本机 Chrome 能在空白页执行脚本', { timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xhs-chrome-'));
  try {
    const value = await withChromePage(async ({ evaluate }) => evaluate('1+1'), {
      userDataDir: dir,
      headless: true,
    });
    assert.equal(value, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('页面提交空关键词和越界条数会提示，非默认筛选失败且不打开小红书', { timeout: 40000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xhs-page-'));
  const chromeDir = await mkdtemp(join(tmpdir(), 'xhs-page-chrome-'));
  let opened = 0;
  const app = await startConsole({
    dataDir: dir,
    port: 0,
    runner: createRunner({
      openBrowser: async () => {
        opened += 1;
        throw new Error('不应该打开浏览器');
      },
    }),
  });
  try {
    await withChromePage(async ({ evaluate }) => {
      await waitFor(async () => (await evaluate('document.querySelector("h1") && document.querySelector("h1").textContent')) === '小红书搜索');
      const defaults = await evaluate(`({
        count: document.getElementById('count').value,
        sort: document.getElementById('sort').value,
        noteType: document.getElementById('note-type').value,
        publishTime: document.getElementById('publish-time').value,
        type: document.getElementById('task-type').value,
        location: document.body.innerText.includes('地区')
      })`);
      assert.equal(defaults.count, '100');
      assert.equal(defaults.sort, '综合');
      assert.equal(defaults.noteType, '不限');
      assert.equal(defaults.publishTime, '不限');
      assert.equal(defaults.type, '小红书搜索');
      assert.equal(defaults.location, false);
      await evaluate('document.getElementById("search-form").requestSubmit()');
      await waitFor(async () => (await evaluate('document.getElementById("form-error").textContent')) === '请填写关键词');
      await evaluate(`
        document.getElementById('keyword').value = '大衣';
        document.getElementById('count').value = '2001';
        document.getElementById('search-form').requestSubmit();
      `);
      await waitFor(async () => String(await evaluate('document.getElementById("form-error").textContent')).includes('1 到 2000'));
      await evaluate(`
        document.getElementById('count').value = '100';
        document.getElementById('sort').value = '最新';
        document.getElementById('search-form').requestSubmit();
      `);
      await waitFor(async () => String(await evaluate('document.body.innerText')).includes('不猜测'));
      const status = await evaluate('document.querySelector(".a3-tag").textContent');
      assert.equal(status, '失败');
    }, { userDataDir: chromeDir, headless: true, url: app.url });
    assert.equal(opened, 0);
    const tasks = app.tasks.list();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, 'failed');
    assert.equal(tasks[0].attempts, 1);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
    await rm(chromeDir, { recursive: true, force: true });
  }
});

async function waitFor(fn) {
  const deadline = Date.now() + 10000;
  let last;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw last || new Error('页面没有出现预期内容');
}
