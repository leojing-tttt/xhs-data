import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNextPageRequest, createNoteStore, parseSearchResponse, readPageState, searchPageUrl } from '../server/notes.js';
import { pageHookSource } from '../server/page-hook.js';

const searchUrl = 'https://edith.xiaohongshu.com/api/sns/web/v2/search/notes';

test('搜索地址只有关键词和扩展里已有的 source', () => {
  const url = new URL(searchPageUrl('大平层 装修'));
  assert.equal(url.origin + url.pathname, 'https://www.xiaohongshu.com/search_result');
  assert.equal(url.searchParams.get('keyword'), '大平层 装修');
  assert.equal(url.searchParams.get('source'), 'web_user_page');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['keyword', 'source']);
});

test('解析搜索响应，丢掉不是笔记的行，点赞 0 保留', () => {
  const payload = {
    data: {
      has_more: true,
      items: [
        { id: 'query-1', model_type: 'rec_query' },
        { id: 'query-2', model_type: 'hot_query' },
        {
          id: '66dee9a10000000012011511',
          model_type: 'note',
          xsec_token: 'tok en',
          note_card: {
            type: 'normal',
            display_title: '大平层装修避坑',
            user: { user_id: 'user_1', nickname: '装修日记' },
            interact_info: { liked_count: '0' },
            cover: { url_default: 'https://cdn.example.com/a.jpg' },
          },
        },
        {
          id: 'video0001',
          model_type: 'note',
          note_card: {
            type: 'video',
            display_title: '视频',
            user: { nickname: '视频作者', user_id: 'user_2' },
            interact_info: { liked_count: '1.2万' },
          },
        },
      ],
    },
  };
  const parsed = parseSearchResponse(payload);
  assert.equal(parsed.recognized, true);
  assert.equal(parsed.notes.length, 2);
  assert.equal(parsed.notes[0].id, '66dee9a10000000012011511');
  assert.equal(parsed.notes[0].likes, '0');
  assert.equal(parsed.notes[0].type, '图文');
  assert.equal(parsed.notes[0].author, '装修日记');
  assert.equal(parsed.notes[0].authorId, 'user_1');
  assert.equal(parsed.notes[0].cover, 'https://cdn.example.com/a.jpg');
  assert.equal(parsed.notes[0].link, 'https://www.xiaohongshu.com/explore/66dee9a10000000012011511?xsec_token=tok%20en&xsec_source=pc_search');
  assert.equal(parsed.notes[0].profile, 'https://www.xiaohongshu.com/user/profile/user_1');
  assert.equal(parsed.notes[1].type, '视频');
  assert.equal(parsed.notes[1].likes, '1.2万');
});

test('后到的点赞可以补上，已有的不覆盖', () => {
  const first = parseSearchResponse({
    data: {
      items: [{
        id: 'n1',
        model_type: 'note',
        note_card: { display_title: '标题', user: { nickname: '作者' } },
      }],
    },
  });
  const second = parseSearchResponse({
    data: {
      items: [{
        id: 'n1',
        model_type: 'note',
        note_card: {
          display_title: '新标题',
          user: { nickname: '新作者', user_id: 'u2' },
          interact_info: { liked_count: 3 },
        },
      }],
    },
  });
  const store = createNoteStore();
  store.add(first.notes);
  store.add(second.notes);
  const note = store.list()[0];
  assert.equal(note.title, '标题');
  assert.equal(note.author, '作者');
  assert.equal(note.likes, 3);
  assert.equal(note.authorId, 'u2');
});

test('下一页只推进已有翻页字段，长整数游标按原文写回', () => {
  const body = '{"keyword":"大衣","page":1,"page_size":20,"search_id":"sid","cursor_score":"1"}';
  const raw = '{"cursor_score":9223372036854775807,"has_more":true,"search_id":"sid-2","items":[]}';
  const state = readPageState(raw);
  assert.equal(state.cursorRaw, '9223372036854775807');
  assert.equal(state.hasMore, true);
  assert.equal(state.searchId, 'sid-2');
  const next = buildNextPageRequest({ url: searchUrl, method: 'POST', body }, state, 20);
  assert.equal(next.url, searchUrl);
  assert.match(next.body, /"page":2/);
  assert.match(next.body, /"cursor_score":9223372036854775807/);
  assert.match(next.body, /"search_id":"sid-2"/);
  const keys = Object.keys(JSON.parse(next.body)).sort();
  assert.deepEqual(keys, ['cursor_score', 'keyword', 'page', 'page_size', 'search_id']);
});

test('请求里没有的筛选字段不会被补上', () => {
  const body = '{"keyword":"大衣","page":1,"page_size":20,"search_id":"sid"}';
  const next = buildNextPageRequest(
    { url: searchUrl, method: 'POST', body },
    { hasMore: true, cursor: '', cursorRaw: '', searchId: 'sid' },
    20,
  );
  assert.deepEqual(Object.keys(JSON.parse(next.body)).sort(), ['keyword', 'page', 'page_size', 'search_id']);
  assert.equal(JSON.parse(next.body).page, 2);
  assert.equal(JSON.parse(next.body).keyword, '大衣');
});

test('游标没变就停，不改写出新的请求', () => {
  const body = '{"keyword":"大衣","cursor_score":"same"}';
  const next = buildNextPageRequest(
    { url: searchUrl, method: 'POST', body },
    { hasMore: true, cursor: 'same', cursorRaw: '"same"', searchId: '' },
    20,
  );
  assert.equal(next.blocked, '游标没有继续往后');
  assert.equal(next.url, undefined);
});

test('页面钩子只认 search/notes，不写筛选参数', () => {
  const source = pageHookSource();
  assert.match(source, /search\/notes/);
  assert.match(source, /XMLHttpRequest/);
  assert.doesNotMatch(source, /sort_type|publish_time|note_type|filter_note|homefeed|explore\//);
});
