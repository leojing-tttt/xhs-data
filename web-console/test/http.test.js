import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startConsole } from '../server/index.js';
import { EXCEL_COLUMNS } from '../server/notes.js';
import { readSheetRows } from '../server/xlsx.js';

const sample = {
  id: '66dee9a10000000012011511',
  title: '标题',
  author: '作者',
  authorId: 'user_1',
  likes: 0,
  type: '图文',
  cover: 'https://cdn.example.com/a.jpg',
  link: 'https://www.xiaohongshu.com/explore/66dee9a10000000012011511',
  profile: 'https://www.xiaohongshu.com/user/profile/user_1',
};

test('接口拒绝超限条数，成功任务可以下载 Excel', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xhs-http-'));
  const app = await startConsole({
    dataDir: dir,
    port: 0,
    runner: async (task) => {
      assert.equal(task.type, 'xhs-search');
      assert.equal(task.count, 2);
      return { ok: true, notes: [sample], message: '目标 2 条，实际 1 条。' };
    },
  });
  try {
    const bad = await fetch(`${app.url}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keyword: '大衣', count: 2001 }),
    });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /1 到 2000/);

    const created = await fetch(`${app.url}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        keyword: '大衣',
        count: 2,
        sort: '综合',
        noteType: '不限',
        publishTime: '不限',
      }),
    });
    assert.equal(created.status, 201);
    await app.tasks.idle();
    const listed = await (await fetch(`${app.url}/api/tasks`)).json();
    assert.equal(listed.tasks[0].status, 'success');
    const file = await fetch(`${app.url}${listed.tasks[0].download}`);
    assert.equal(file.status, 200);
    assert.match(file.headers.get('content-type'), /spreadsheetml/);
    const rows = readSheetRows(Buffer.from(await file.arrayBuffer()));
    assert.deepEqual(rows[0], EXCEL_COLUMNS);
    assert.equal(rows[1][0], sample.id);
    assert.equal(rows[1][4], '0');
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
