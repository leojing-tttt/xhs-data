import assert from 'node:assert/strict';
import test from 'node:test';
import { readSearchPage, searchXiaohongshu } from '../server/xhs-search.js';

const SEARCH_XML = `
<hierarchy rotation="0">
  <node text="" class="android.widget.FrameLayout" bounds="[0,0][1080,2400]">
    <node text="咖啡" class="android.widget.EditText" bounds="[40,80][800,160]" />
    <node text="" class="androidx.recyclerview.widget.RecyclerView" bounds="[0,200][1080,2400]">
      <node clickable="true" bounds="[20,220][520,980]" text="" content-desc="">
        <node text="周末去喝的手冲" class="android.widget.TextView" bounds="[40,700][500,780]" />
        <node text="阿禾" class="android.widget.TextView" bounds="[40,820][200,880]" />
        <node text="128" class="android.widget.TextView" bounds="[400,820][500,880]" />
      </node>
      <node clickable="true" bounds="[540,220][1040,980]" text="" content-desc="https://www.xiaohongshu.com/explore/abc123def456abc123def456">
        <node text="另一篇" class="android.widget.TextView" bounds="[560,700][1000,780]" />
        <node text="1.2万" class="android.widget.TextView" bounds="[880,820][1020,880]" />
      </node>
    </node>
  </node>
</hierarchy>`;

test('search page keeps only fields that are actually on screen', () => {
  const page = readSearchPage(SEARCH_XML);
  assert.equal(page.kind, 'notes');
  assert.deepEqual(page.notes[0], {
    noteId: '',
    title: '周末去喝的手冲',
    author: '阿禾',
    authorUrl: '',
    likes: '128',
    noteUrl: '',
  });
  assert.equal(page.notes[1].title, '另一篇');
  assert.equal(page.notes[1].author, '');
  assert.equal(page.notes[1].likes, '1.2万');
  assert.equal(page.notes[1].noteId, 'abc123def456abc123def456');
  assert.equal(page.notes[1].noteUrl, 'https://www.xiaohongshu.com/explore/abc123def456abc123def456');
  assert.equal(page.notes[1].authorUrl, '');
});

test('login screen is not treated as a successful empty search', () => {
  const page = readSearchPage(`
    <hierarchy>
      <node text="手机号登录" class="android.widget.TextView" bounds="[0,400][1080,500]" />
      <node text="获取验证码" class="android.widget.TextView" bounds="[0,600][1080,700]" />
    </hierarchy>`);
  assert.equal(page.kind, 'login');
  assert.deepEqual(page.notes, []);
});

function fakePhone(pages) {
  const calls = [];
  let dumps = 0;
  const runAdb = async (args) => {
    calls.push(args);
    const text = args.join(' ');
    if (text.includes('get-state')) return { stdout: 'device\n', stderr: '' };
    if (text.includes('pm path')) return { stdout: 'package:/data/app/com.xingin.xhs\n', stderr: '' };
    if (text.includes('am start')) return { stdout: 'Starting: Intent { }\n', stderr: '' };
    if (text.includes('uiautomator')) return { stdout: 'UI hierchary dumped to: /sdcard/pc-window.xml\n', stderr: '' };
    if (text.includes('cat')) {
      const xml = pages[Math.min(dumps, pages.length - 1)];
      dumps += 1;
      return { stdout: xml, stderr: '' };
    }
    if (text.includes('wm size')) return { stdout: 'Physical size: 1080x2400\n', stderr: '' };
    if (text.includes('input swipe')) return { stdout: '', stderr: '' };
    throw new Error(`unexpected adb ${text}`);
  };
  return { runAdb, calls };
}

test('unreadable page fails and does not invent notes', async () => {
  const phone = fakePhone([
    '<hierarchy><node text="设置" class="android.widget.TextView" bounds="[0,0][100,40]" /></hierarchy>',
  ]);
  await assert.rejects(
    () => searchXiaohongshu({
      runAdb: phone.runAdb,
      serial: 'abc123',
      keyword: '咖啡',
      limit: 3,
      pause: async () => {},
    }),
    (err) => /没有读到已加载的笔记/.test(err.message) && !/http/.test(err.message),
  );
  const flat = phone.calls.flat().join(' ');
  assert.match(flat, /am start/);
  assert.match(flat, /xhsdiscover:\/\/search\/result\?keyword=/);
  assert.doesNotMatch(flat, /curl|api\.xiaohongshu/);
});

test('login on the phone fails the search instead of succeeding', async () => {
  const phone = fakePhone([`
    <hierarchy>
      <node text="手机号登录" class="android.widget.TextView" bounds="[0,400][400,480]" />
    </hierarchy>`]);
  await assert.rejects(
    () => searchXiaohongshu({
      runAdb: phone.runAdb,
      serial: 'abc123',
      keyword: '咖啡',
      limit: 2,
      pause: async () => {},
    }),
    /小红书还没登录/,
  );
  assert.equal(phone.calls.some((args) => args.includes('swipe')), false);
});

test('loaded notes are returned and missing fields stay empty', async () => {
  const phone = fakePhone([SEARCH_XML]);
  const notes = await searchXiaohongshu({
    runAdb: phone.runAdb,
    serial: 'abc123',
    keyword: '咖啡',
    limit: 1,
    pause: async () => {},
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, '周末去喝的手冲');
  assert.equal(notes[0].noteId, '');
  assert.equal(notes[0].noteUrl, '');
  assert.equal(notes[0].authorUrl, '');
});
