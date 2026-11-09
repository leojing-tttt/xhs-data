import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSearch, MIN_GAP_MS } from '../server/collect.js';

const searchUrl = 'https://edith.xiaohongshu.com/api/sns/web/v2/search/notes';

function note(id) {
  return {
    id,
    model_type: 'note',
    note_card: {
      type: 'normal',
      display_title: `标题${id}`,
      user: { nickname: '作者', user_id: `u-${id}` },
      interact_info: { liked_count: '1' },
    },
  };
}

function response(items, hasMore) {
  return JSON.stringify({ data: { has_more: hasMore, items } });
}

function session(pages) {
  let index = 0;
  const sent = [];
  return {
    sent,
    async take() {
      const page = pages[index];
      if (!page || !page.length) return null;
      return page.shift();
    },
    async sendNext(request) {
      sent.push(JSON.parse(JSON.stringify(request)));
      index += 1;
    },
    async close() {},
  };
}

test('条数已经够就不再翻页', async () => {
  const page = session([[
    { type: 'request', url: searchUrl, method: 'POST', body: '{"keyword":"大衣","page":1}' },
    { type: 'response', body: response([note('a'), note('b')], true) },
  ]]);
  const result = await collectSearch(page, 1, { sleep: async () => {}, now: () => 0, firstTimeoutMs: 50 });
  assert.equal(result.ok, true);
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].id, 'a');
  assert.equal(page.sent.length, 0);
});

test('下一页至少间隔 1 秒，并在没有更多时停下', async () => {
  let clock = 0;
  const sleeps = [];
  const page = session([
    [
      { type: 'request', url: searchUrl, method: 'POST', body: '{"keyword":"大衣","page":1,"page_size":20,"search_id":"sid"}' },
      { type: 'response', body: response([note('a')], true) },
    ],
    [
      { type: 'response', body: response([note('b')], false) },
    ],
  ]);
  const result = await collectSearch(page, 10, {
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    firstTimeoutMs: 1000,
    nextTimeoutMs: 1000,
    minGapMs: 0,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.notes.map((item) => item.id), ['a', 'b']);
  assert.ok(sleeps.length >= 1);
  assert.ok(sleeps.every((ms) => ms >= MIN_GAP_MS));
  assert.equal(page.sent.length, 1);
  assert.equal(page.sent[0].url, searchUrl);
  assert.equal(JSON.parse(page.sent[0].body).page, 2);
  assert.deepEqual(Object.keys(JSON.parse(page.sent[0].body)).sort(), ['keyword', 'page', 'page_size', 'search_id']);
  assert.match(result.message, /接口没有更多了/);
});

test('下一页超时不跳页，连续四次就停', async () => {
  const page = session([
    [
      { type: 'request', url: searchUrl, method: 'POST', body: '{"keyword":"大衣","page":1}' },
      { type: 'response', body: response([note('a')], true) },
    ],
  ]);
  const result = await collectSearch(page, 10, {
    sleep: async () => {},
    now: () => 0,
    firstTimeoutMs: 20,
    nextTimeoutMs: 20,
  });
  assert.equal(result.ok, true);
  assert.equal(result.notes.length, 1);
  assert.equal(page.sent.length, 4);
  assert.ok(page.sent.every((request) => JSON.parse(request.body).page === 2));
  assert.match(result.message, /没有等到下一页响应/);
});

test('没有搜索响应就失败，不编造笔记', async () => {
  const page = session([[]]);
  const result = await collectSearch(page, 10, { sleep: async () => {}, now: () => 0, firstTimeoutMs: 20 });
  assert.equal(result.ok, false);
  assert.equal(result.notes.length, 0);
  assert.match(result.error, /不会绕过/);
  assert.equal(page.sent.length, 0);
});
