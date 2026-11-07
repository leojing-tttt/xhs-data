import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { exportFilename, notesWorkbook } from '../server/xlsx.js';

const execFileAsync = promisify(execFile);

test('excel uses chinese headers and one row per note without filling blanks', async () => {
  const book = notesWorkbook([{
    title: '经期安全感被这条安睡裤拿捏住',
    noteUrl: 'https://www.xiaohongshu.com/explore/abc123def456abc123def456',
    author: '青柠',
    publishedAt: '3天前',
    likes: '10',
  }, {
    title: '另一篇没有时间',
    noteUrl: '',
    author: '阿禾',
    publishedAt: '',
    likes: '',
  }]);
  assert.equal(book.readUInt32LE(0), 0x04034b50);
  const dir = mkdtempSync(path.join(tmpdir(), 'xhs-xlsx-'));
  const file = path.join(dir, 'notes.xlsx');
  writeFileSync(file, book);
  try {
    await execFileAsync('unzip', ['-t', file]);
    const { stdout } = await execFileAsync('unzip', ['-p', file, 'xl/worksheets/sheet1.xml']);
    for (const header of ['笔记标题', '笔记链接', '作者姓名', '发布时间', '点赞数']) {
      assert.match(stdout, new RegExp(header));
    }
    assert.equal([...stdout.matchAll(/<row /g)].length, 3);
    assert.match(stdout, /经期安全感被这条安睡裤拿捏住/);
    assert.match(stdout, /https:\/\/www\.xiaohongshu\.com\/explore\/abc123def456abc123def456/);
    assert.match(stdout, /另一篇没有时间/);
    assert.match(stdout, /<t><\/t>/);
    assert.doesNotMatch(stdout, /未知|暂无|1970-/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(exportFilename('安睡裤'), '小红书搜索-安睡裤.xlsx');
});
