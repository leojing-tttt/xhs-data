import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRunner } from '../server/runner.js';
import { RESTART_MESSAGE, createTaskService } from '../server/tasks.js';
import { readSheetRows } from '../server/xlsx.js';
import { EXCEL_COLUMNS } from '../server/notes.js';

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'xhs-tasks-'));
}

function form(extra = {}) {
  return { keyword: '大衣', count: 10, sort: '综合', noteType: '不限', publishTime: '不限', ...extra };
}

const sample = {
  id: '66dee9a10000000012011511',
  title: '标题',
  author: '作者',
  authorId: 'user_1',
  likes: 5,
  type: '图文',
  cover: 'https://cdn.example.com/a.jpg',
  link: 'https://www.xiaohongshu.com/explore/66dee9a10000000012011511',
  profile: 'https://www.xiaohongshu.com/user/profile/user_1',
};

test('非法表单不建任务', async () => {
  const dir = await tempDir();
  try {
    let calls = 0;
    const service = createTaskService({ dir, runner: async () => { calls += 1; return { ok: false }; } });
    const created = service.create({ keyword: '', count: 5000 });
    assert.equal(created.ok, false);
    assert.equal(service.list().length, 0);
    assert.equal(calls, 0);
    service.stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('成功从排队到执行中再到成功，并写出 Excel', async () => {
  const dir = await tempDir();
  try {
    let seen = '';
    const service = createTaskService({
      dir,
      runner: async (task) => {
        seen = task.status;
        assert.equal(task.type, 'xhs-search');
        return { ok: true, notes: [sample], message: '目标 10 条，实际 1 条。' };
      },
    });
    const created = service.create(form());
    assert.equal(created.ok, true);
    assert.equal(created.task.status, 'queued');
    await service.idle();
    const task = service.get(created.task.id);
    assert.equal(seen, 'running');
    assert.equal(task.status, 'success');
    assert.equal(task.attempts, 1);
    assert.equal(task.noteCount, 1);
    assert.equal(task.download, `/api/tasks/${task.id}/download`);
    const rows = readSheetRows(readFileSync(service.fileFor(task.id).path));
    assert.deepEqual(rows[0], EXCEL_COLUMNS);
    assert.equal(rows[1][0], sample.id);
    service.stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('失败停在失败，不会自动再跑', async () => {
  const dir = await tempDir();
  try {
    let calls = 0;
    const service = createTaskService({
      dir,
      runner: async () => {
        calls += 1;
        throw new Error('页面没有结果');
      },
    });
    const created = service.create(form());
    await service.idle();
    assert.equal(calls, 1);
    const task = service.get(created.task.id);
    assert.equal(task.status, 'failed');
    assert.equal(task.attempts, 1);
    assert.equal(task.error, '页面没有结果');
    assert.equal(task.download, '');
    service.kick();
    await service.idle();
    assert.equal(calls, 1);
    assert.equal(service.get(created.task.id).status, 'failed');
    service.stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('同一时间只跑一条，第二条保持排队', async () => {
  const dir = await tempDir();
  try {
    let release = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    let started = 0;
    const service = createTaskService({
      dir,
      runner: async () => {
        started += 1;
        if (started === 1) await gate;
        return { ok: false, error: '停', notes: [] };
      },
    });
    const first = service.create(form({ keyword: '第一' }));
    const second = service.create(form({ keyword: '第二' }));
    await waitFor(() => service.get(first.task.id).status === 'running');
    assert.equal(service.get(second.task.id).status, 'queued');
    assert.equal(started, 1);
    release();
    await service.idle();
    assert.equal(started, 2);
    assert.equal(service.get(first.task.id).status, 'failed');
    assert.equal(service.get(second.task.id).status, 'failed');
    assert.equal(service.get(first.task.id).attempts, 1);
    assert.equal(service.get(second.task.id).attempts, 1);
    service.stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('非默认筛选失败，且不会打开浏览器', async () => {
  const dir = await tempDir();
  try {
    let opened = 0;
    const service = createTaskService({
      dir,
      runner: createRunner({
        openBrowser: async () => {
          opened += 1;
          throw new Error('不应该打开浏览器');
        },
      }),
    });
    const created = service.create(form({ sort: '最新', noteType: '视频', publishTime: '一天内' }));
    await service.idle();
    const task = service.get(created.task.id);
    assert.equal(opened, 0);
    assert.equal(task.status, 'failed');
    assert.equal(task.attempts, 1);
    assert.match(task.error, /不猜测参数名/);
    service.kick();
    await service.idle();
    assert.equal(opened, 0);
    assert.equal(service.get(created.task.id).attempts, 1);
    service.stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('重启时执行中的任务改为失败，排队的会继续，且不重复跑已失败的', async () => {
  const dir = await tempDir();
  const file = join(dir, 'tasks.json');
  const running = {
    id: 'task_running',
    type: 'xhs-search',
    status: 'running',
    keyword: '执行中',
    count: 10,
    sort: '综合',
    noteType: '不限',
    publishTime: '不限',
    createdAt: '2026-11-09T00:00:00.000Z',
    startedAt: '2026-11-09T00:00:01.000Z',
    finishedAt: null,
    error: '',
    message: '',
    noteCount: 0,
    attempts: 1,
    file: '',
  };
  const queued = { ...running, id: 'task_queued', status: 'queued', keyword: '排队', startedAt: null, attempts: 0 };
  writeFileSync(file, JSON.stringify([running, queued]));
  try {
    const seen = [];
    const service = createTaskService({
      dir,
      runner: async (task) => {
        seen.push(task.id);
        return { ok: false, error: '停', notes: [] };
      },
    });
    await service.idle();
    assert.deepEqual(seen, ['task_queued']);
    assert.equal(service.get('task_running').status, 'failed');
    assert.equal(service.get('task_running').error, RESTART_MESSAGE);
    assert.equal(service.get('task_running').attempts, 1);
    assert.equal(service.get('task_queued').status, 'failed');
    assert.equal(service.get('task_queued').attempts, 1);
    service.stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function waitFor(predicate) {
  const deadline = Date.now() + 2000;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() > deadline) return reject(new Error('等待任务状态超时'));
      setTimeout(tick, 5);
    };
    tick();
  });
}
