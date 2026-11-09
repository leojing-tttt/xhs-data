import assert from 'node:assert/strict';
import test from 'node:test';
import { EXCEL_COLUMNS } from '../server/notes.js';
import { readSheetRows, workbookBytes } from '../server/xlsx.js';

test('Excel 固定九列，笔记 ID 按文本，点赞 0 写成 0', () => {
  const bytes = workbookBytes([{
    id: '66dee9a10000000012011511',
    title: '标题<a&b>',
    author: '作者',
    authorId: 'user_1',
    likes: 0,
    type: '图文',
    cover: 'https://cdn.example.com/a.jpg',
    link: 'https://www.xiaohongshu.com/explore/66dee9a10000000012011511',
    profile: 'https://www.xiaohongshu.com/user/profile/user_1',
  }], { date: new Date('2026-11-09T03:56:00') });
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  assert.match(bytes.toString('utf8'), /搜索结果/);
  const rows = readSheetRows(bytes);
  assert.deepEqual(rows[0], EXCEL_COLUMNS);
  assert.deepEqual(rows[1], [
    '66dee9a10000000012011511',
    '标题<a&b>',
    '作者',
    'user_1',
    '0',
    '图文',
    'https://cdn.example.com/a.jpg',
    'https://www.xiaohongshu.com/explore/66dee9a10000000012011511',
    'https://www.xiaohongshu.com/user/profile/user_1',
  ]);
  assert.doesNotMatch(rows[1][0], /e\+/i);
});

test('缺了的点赞留空，万位字符串保持原文', () => {
  const rows = readSheetRows(workbookBytes([{
    id: 'n1',
    title: '甲',
    author: '乙',
    likes: '1.2万',
    link: 'https://www.xiaohongshu.com/explore/n1',
    profile: '',
  }]));
  assert.equal(rows[1][4], '1.2万');
  const empty = readSheetRows(workbookBytes([{
    id: 'n2',
    title: '丙',
    author: '丁',
    likes: null,
    link: 'https://www.xiaohongshu.com/explore/n2',
    profile: '',
  }]));
  assert.equal(empty[1][4], '');
  assert.equal(empty[0].length, 9);
});
