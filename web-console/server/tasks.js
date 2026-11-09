import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateSearchForm } from './form.js';
import { formatExportFilename } from './notes.js';
import { taskTypeById } from './task-types.js';
import { workbookBytes } from './xlsx.js';

export const RESTART_MESSAGE = '进程重启，任务已停下，不会自动重试';

export function createTaskService({ dir, runner, now }) {
  if (!dir) throw new Error('缺少数据目录');
  if (typeof runner !== 'function') throw new Error('缺少任务执行器');
  mkdirSync(dir, { recursive: true });
  const clock = now || (() => new Date().toISOString());
  const items = loadItems(join(dir, 'tasks.json'), clock);
  const service = {
    dir,
    items,
    runner,
    now: clock,
    _pumping: false,
    _kickScheduled: false,
    _stopped: false,
    _drain: Promise.resolve(),
    create(input) {
      const parsed = validateSearchForm(input);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const task = {
        id: `task_${randomBytes(9).toString('hex')}`,
        type: parsed.value.type,
        status: 'queued',
        keyword: parsed.value.keyword,
        count: parsed.value.count,
        sort: parsed.value.sort,
        noteType: parsed.value.noteType,
        publishTime: parsed.value.publishTime,
        createdAt: clock(),
        startedAt: null,
        finishedAt: null,
        error: '',
        message: '',
        noteCount: 0,
        attempts: 0,
        file: '',
      };
      items.push(task);
      persist(dir, items);
      service.kick();
      return { ok: true, task: view(task) };
    },
    list() {
      return items.map(view).reverse();
    },
    get(id) {
      const task = items.find((item) => item.id === id);
      return task ? view(task) : null;
    },
    fileFor(id) {
      const task = items.find((item) => item.id === id);
      if (!task || task.status !== 'success' || !task.file) return null;
      return {
        path: task.file,
        filename: formatExportFilename(task.keyword, task.finishedAt || task.createdAt),
      };
    },
    kick() {
      if (service._stopped || service._pumping || service._kickScheduled) return;
      service._kickScheduled = true;
      service._drain = Promise.resolve().then(async () => {
        service._kickScheduled = false;
        if (service._stopped) return;
        service._pumping = true;
        try {
          await pump(service);
        } finally {
          service._pumping = false;
        }
        if (!service._stopped && items.some((task) => task.status === 'queued')) service.kick();
      });
    },
    async idle() {
      for (;;) {
        const drain = service._drain;
        if (drain) await drain;
        const busy = service._pumping || items.some((task) => task.status === 'queued' || task.status === 'running');
        if (!busy) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
    stop() {
      service._stopped = true;
    },
  };
  persist(dir, items);
  if (items.some((task) => task.status === 'queued')) service.kick();
  return service;
}

async function pump(service) {
  for (;;) {
    const next = service.items.find((task) => task.status === 'queued');
    if (!next || service._stopped) return;
    await execute(service, next);
  }
}

async function execute(service, task) {
  if (task.status !== 'queued') return;
  task.status = 'running';
  task.startedAt = service.now();
  task.attempts += 1;
  persist(service.dir, service.items);
  try {
    const result = await service.runner(task);
    if (task.status !== 'running') return;
    if (!result || !result.ok || !Array.isArray(result.notes) || result.notes.length === 0) {
      fail(service, task, (result && (result.error || result.message)) || '任务失败');
      return;
    }
    const fileDir = join(service.dir, 'files');
    mkdirSync(fileDir, { recursive: true });
    const file = join(fileDir, `${task.id}.xlsx`);
    writeFileSync(file, workbookBytes(result.notes));
    task.file = file;
    task.status = 'success';
    task.message = result.message || '';
    task.error = '';
    task.noteCount = result.notes.length;
    task.finishedAt = service.now();
    persist(service.dir, service.items);
  } catch (error) {
    fail(service, task, error && error.message ? error.message : '任务失败');
  }
}

function fail(service, task, error) {
  task.status = 'failed';
  task.error = error;
  task.message = '';
  task.noteCount = 0;
  task.finishedAt = service.now();
  persist(service.dir, service.items);
}

function view(task) {
  const known = taskTypeById(task.type);
  return {
    id: task.id,
    type: task.type,
    typeLabel: known ? known.label : task.type,
    status: task.status,
    keyword: task.keyword,
    count: task.count,
    sort: task.sort,
    noteType: task.noteType,
    publishTime: task.publishTime,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    error: task.error || '',
    message: task.message || '',
    noteCount: task.noteCount || 0,
    attempts: task.attempts || 0,
    download: task.status === 'success' && task.file ? `/api/tasks/${task.id}/download` : '',
  };
}

function loadItems(file, now) {
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) return [];
  let changed = false;
  for (const task of parsed) {
    if (task.status === 'running') {
      task.status = 'failed';
      task.error = RESTART_MESSAGE;
      task.finishedAt = now();
      task.attempts = task.attempts || 1;
      changed = true;
    }
  }
  return changed ? parsed : parsed;
}

function persist(dir, items) {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, 'tasks.json');
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(items, null, 2));
  renameSync(tmp, target);
}
