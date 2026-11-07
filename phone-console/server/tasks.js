import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isSafeSerial } from './devices.js';
import { getTaskType } from './task-types.js';
import { isXhsResultNote } from './xhs-search.js';

const STATUS_LABEL = {
  queued: '排队',
  running: '执行中',
  succeeded: '成功',
  failed: '失败',
};

const ACTIVE = new Set(['queued', 'running']);

export class TaskError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function blankNote(note = {}) {
  return {
    noteId: typeof note.noteId === 'string' ? note.noteId : '',
    title: typeof note.title === 'string' ? note.title : '',
    author: typeof note.author === 'string' ? note.author : '',
    authorUrl: typeof note.authorUrl === 'string' ? note.authorUrl : '',
    publishedAt: typeof note.publishedAt === 'string' ? note.publishedAt : '',
    likes: typeof note.likes === 'string' ? note.likes : '',
    noteUrl: typeof note.noteUrl === 'string' ? note.noteUrl : '',
  };
}

function toPublic(task) {
  let notes = Array.isArray(task.notes) ? task.notes.map(blankNote) : [];
  if (task.type === 'xhs-search') notes = notes.filter(isXhsResultNote);
  return {
    id: task.id,
    type: task.type,
    typeLabel: getTaskType(task.type)?.label || task.type,
    serial: task.serial,
    keyword: task.keyword,
    limit: task.limit,
    status: task.status,
    statusLabel: STATUS_LABEL[task.status] || task.status,
    error: task.error || '',
    count: notes.length,
    notes,
    createdAt: task.createdAt,
    startedAt: task.startedAt || '',
    finishedAt: task.finishedAt || '',
  };
}

function cleanKeyword(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

export function createTaskStore({ execute, file = '', now = () => new Date() } = {}) {
  if (typeof execute !== 'function') throw new Error('task store needs an executor');
  const tasks = [];
  let interrupted = false;

  if (file) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      const stored = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
      for (const raw of stored) {
        if (!raw || typeof raw.id !== 'string') continue;
        const task = {
          id: raw.id,
          type: raw.type,
          serial: raw.serial,
          keyword: raw.keyword,
          limit: raw.limit,
          status: raw.status,
          error: raw.error || '',
          notes: Array.isArray(raw.notes) ? raw.notes.map(blankNote) : [],
          createdAt: raw.createdAt,
          startedAt: raw.startedAt || '',
          finishedAt: raw.finishedAt || '',
        };
        if (ACTIVE.has(task.status)) {
          task.status = 'failed';
          task.error = '服务重启了，任务已停下，没有自动重试。';
          task.finishedAt = now().toISOString();
          interrupted = true;
        }
        tasks.push(task);
      }
    } catch (err) {
      if (err && err.code !== 'ENOENT') console.error('task store load failed:', err.message || err);
    }
    if (interrupted) persist();
  }

  function persist() {
    if (!file) return;
    const dir = path.dirname(file);
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ tasks }, null, 2));
    renameSync(tmp, file);
  }

  function trim() {
    while (tasks.length > 100) {
      let index = -1;
      for (let i = tasks.length - 1; i >= 0; i -= 1) {
        if (!ACTIVE.has(tasks[i].status)) {
          index = i;
          break;
        }
      }
      if (index === -1) break;
      tasks.splice(index, 1);
    }
  }

  function settleFailure(task, err) {
    if (task.status !== 'running' && task.status !== 'queued') return;
    task.status = 'failed';
    task.error = String(err && err.message ? err.message : '任务失败。').slice(0, 300);
    task.finishedAt = now().toISOString();
    persist();
    console.error(`task ${task.id} failed: ${task.error}`);
  }

  function pump() {
    for (const task of tasks) {
      if (task.status !== 'queued') continue;
      if (tasks.some((item) => item !== task && item.serial === task.serial && item.status === 'running')) {
        continue;
      }
      task.status = 'running';
      task.startedAt = now().toISOString();
      persist();
      Promise.resolve()
        .then(() => execute(task))
        .then((notes) => {
          if (task.status !== 'running') return;
          if (!Array.isArray(notes)) throw new Error('任务没有返回笔记。');
          task.notes = notes.map(blankNote);
          task.status = 'succeeded';
          task.error = '';
          task.finishedAt = now().toISOString();
          trim();
          persist();
        })
        .catch((err) => settleFailure(task, err));
    }
  }

  function submit({ type, serial, keyword, limit }) {
    if (!getTaskType(type)) throw new TaskError(400, '没有这种任务。');
    if (!isSafeSerial(serial)) throw new TaskError(400, '请选择一台手机。');
    const text = cleanKeyword(keyword);
    if (!text) throw new TaskError(400, '请填写关键词。');
    if (text.length > 40) throw new TaskError(400, '关键词太长。');
    if (/[\u0000-\u001f;&|`$<>]/.test(text)) throw new TaskError(400, '关键词里有不能用的符号。');
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) {
      throw new TaskError(400, '条数要在 1 到 30 之间。');
    }
    if (tasks.some((task) => task.serial === serial && ACTIVE.has(task.status))) {
      throw new TaskError(409, '这台手机已经有任务。等它结束再提交。');
    }
    const task = {
      id: randomBytes(8).toString('hex'),
      type,
      serial,
      keyword: text,
      limit,
      status: 'queued',
      error: '',
      notes: [],
      createdAt: now().toISOString(),
      startedAt: '',
      finishedAt: '',
    };
    tasks.unshift(task);
    trim();
    persist();
    queueMicrotask(pump);
    return toPublic(task);
  }

  return {
    submit,
    list() {
      return tasks.map(toPublic);
    },
    get(id) {
      const task = tasks.find((item) => item.id === id);
      return task ? toPublic(task) : null;
    },
  };
}
