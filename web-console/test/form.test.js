import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  COUNT_MESSAGE,
  DEFAULT_COUNT,
  FILTER_UNSUPPORTED_MESSAGE,
  KEYWORD_MESSAGE,
  NOTE_TYPES,
  PUBLISH_TIMES,
  SORTS,
  unsupportedOfficialFilters,
  validateSearchForm,
} from '../server/form.js';
import { TASK_TYPES } from '../server/task-types.js';

const html = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

test('条数默认 100，合法范围是 1 到 2000', () => {
  assert.equal(DEFAULT_COUNT, 100);
  assert.equal(validateSearchForm({ keyword: '大衣' }).ok, false);
  assert.equal(validateSearchForm({ keyword: '大衣', count: '' }).error, COUNT_MESSAGE);
  for (const count of [0, -1, 1.5, '1.5', '100abc', 2001, '2001']) {
    const result = validateSearchForm({ keyword: '大衣', count });
    assert.equal(result.ok, false, String(count));
    assert.equal(result.error, COUNT_MESSAGE);
  }
  assert.equal(validateSearchForm({ keyword: '大衣', count: 1 }).value.count, 1);
  assert.equal(validateSearchForm({ keyword: '大衣', count: 2000 }).value.count, 2000);
  assert.equal(validateSearchForm({ keyword: '大衣', count: '100' }).value.count, 100);
});

test('关键词必填，筛选只接受列出的值，缺省是综合 / 不限 / 不限', () => {
  assert.equal(validateSearchForm({ keyword: '  ', count: 100 }).error, KEYWORD_MESSAGE);
  assert.equal(validateSearchForm({ keyword: '大衣', count: 100, sort: '热度' }).error, '请选择排序');
  assert.equal(validateSearchForm({ keyword: '大衣', count: 100, noteType: '全部' }).error, '请选择笔记类型');
  assert.equal(validateSearchForm({ keyword: '大衣', count: 100, publishTime: '一月内' }).error, '请选择发布时间');
  const value = validateSearchForm({ keyword: ' 大衣 ', count: 100 }).value;
  assert.deepEqual(value, {
    type: 'xhs-search',
    keyword: '大衣',
    count: 100,
    sort: '综合',
    noteType: '不限',
    publishTime: '不限',
  });
});

test('地区、已看过和抖音都不会进任务', () => {
  assert.equal(validateSearchForm({ keyword: '大衣', count: 10, location: '上海' }).error, '这一版没有地区，也没有已看过或未看过');
  assert.equal(validateSearchForm({ keyword: '大衣', count: 10, seen: false }).error, '这一版没有地区，也没有已看过或未看过');
  assert.equal(validateSearchForm({ keyword: '大衣', count: 10, type: 'douyin-search' }).error, '这一版不做抖音');
  assert.equal(validateSearchForm({ keyword: '大衣', count: 10, type: 'xhs-user' }).error, '未知任务类型。这一版只有小红书搜索');
});

test('还没启用的任务类型不能跑', () => {
  TASK_TYPES.push({ id: 'xhs-later', label: '以后再做', run: false });
  try {
    const result = validateSearchForm({ type: 'xhs-later', keyword: '大衣', count: 10 });
    assert.equal(result.ok, false);
    assert.match(result.error, /还没有做/);
  } finally {
    TASK_TYPES.pop();
  }
});

test('非默认官方筛选直接拒绝，且不写出参数名猜测', () => {
  assert.equal(unsupportedOfficialFilters({ sort: '综合', noteType: '不限', publishTime: '不限' }), '');
  for (const value of [
    { sort: '最新', noteType: '不限', publishTime: '不限' },
    { sort: '最多点赞', noteType: '不限', publishTime: '不限' },
    { sort: '最多评论', noteType: '不限', publishTime: '不限' },
    { sort: '最多收藏', noteType: '不限', publishTime: '不限' },
    { sort: '综合', noteType: '视频', publishTime: '不限' },
    { sort: '综合', noteType: '图文', publishTime: '不限' },
    { sort: '综合', noteType: '直播', publishTime: '不限' },
    { sort: '综合', noteType: '不限', publishTime: '一天内' },
    { sort: '综合', noteType: '不限', publishTime: '一周内' },
    { sort: '综合', noteType: '不限', publishTime: '半年内' },
  ]) {
    assert.equal(unsupportedOfficialFilters(value), FILTER_UNSUPPORTED_MESSAGE);
  }
  assert.match(FILTER_UNSUPPORTED_MESSAGE, /不猜测参数名/);
  assert.doesNotMatch(FILTER_UNSUPPORTED_MESSAGE, /sort_type|note_type|publish_time|filter_note/);
});

test('页面字段和默认值跟校验一致，没有地区和已看过', () => {
  assert.match(html, /value="100"/);
  assert.match(html, /小红书搜索/);
  for (const label of [...SORTS, ...NOTE_TYPES, ...PUBLISH_TIMES]) {
    assert.match(html, new RegExp(label));
  }
  assert.doesNotMatch(html, /地区|已看过|未看过|抖音|ant-design|antd/);
  assert.match(html, /a3-btn-primary/);
  assert.match(html, /a3-components\.css/);
});
