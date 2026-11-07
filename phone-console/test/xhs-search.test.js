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
    publishedAt: '',
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

const MIXED_XML = `
<hierarchy rotation="0">
  <node text="" class="androidx.recyclerview.widget.RecyclerView" bounds="[0,200][1080,2400]">
    <node clickable="true" bounds="[20,220][1040,520]" text="">
      <node text="购物狂欢" class="android.widget.TextView" bounds="[40,260][400,340]" />
      <node text="10.10-11.11" class="android.widget.TextView" bounds="[40,360][400,440]" />
    </node>
    <node clickable="true" bounds="[20,540][520,1300]" text="">
      <node text="广告" class="android.widget.TextView" bounds="[40,560][140,620]" />
      <node text="经期安全感被这条安睡裤拿捏住" class="android.widget.TextView" bounds="[40,980][500,1120]" />
      <node text="青柠" class="android.widget.TextView" bounds="[40,1160][160,1220]" />
      <node text="3天前" class="android.widget.TextView" bounds="[180,1160][300,1220]" />
      <node text="10" class="android.widget.TextView" bounds="[360,1160][480,1220]" />
    </node>
    <node clickable="true" bounds="[540,540][1040,1300]" text="" content-desc="xhsdiscover://item/abc123def456abc123def456">
      <node text="1:17" class="android.widget.TextView" bounds="[560,560][680,620]" />
      <node text="安睡裤测评第一弹来了" class="android.widget.TextView" bounds="[560,980][1020,1100]" />
      <node text="蘑古力" class="android.widget.TextView" bounds="[560,1160][760,1220]" />
      <node text="61" class="android.widget.TextView" bounds="[860,1160][980,1220]" />
    </node>
    <node clickable="true" bounds="[20,1320][1040,1600]" text="">
      <node text="大家都在搜" class="android.widget.TextView" bounds="[40,1360][360,1440]" />
      <node text="安睡裤排行榜前十名" class="android.widget.TextView" bounds="[40,1480][520,1560]" />
    </node>
    <node clickable="true" bounds="[20,1620][520,2200]" text="" content-desc="https://www.xiaohongshu.com/discovery/item/bbb123def456abc123def456">
      <node text="另一篇没有时间" class="android.widget.TextView" bounds="[40,1960][480,2080]" />
      <node text="阿禾" class="android.widget.TextView" bounds="[40,2100][200,2160]" />
    </node>
    <node clickable="true" bounds="[540,1620][1040,2200]" text="" content-desc="http://xhslink.com/a/Ab12Cd">
      <node text="短链那一篇" class="android.widget.TextView" bounds="[560,1960][1000,2080]" />
      <node text="李戛" class="android.widget.TextView" bounds="[560,2100][760,2160]" />
      <node text="1.7万" class="android.widget.TextView" bounds="[860,2100][1000,2160]" />
    </node>
  </node>
</hierarchy>`;

test('search results keep visible note fields and drop non-note rows', () => {
  const page = readSearchPage(MIXED_XML);
  assert.equal(page.kind, 'notes');
  assert.deepEqual(page.notes.map((note) => note.title), [
    '经期安全感被这条安睡裤拿捏住',
    '安睡裤测评第一弹来了',
    '另一篇没有时间',
    '短链那一篇',
  ]);
  assert.deepEqual(page.notes[0], {
    noteId: '',
    title: '经期安全感被这条安睡裤拿捏住',
    author: '青柠',
    authorUrl: '',
    publishedAt: '3天前',
    likes: '10',
    noteUrl: '',
  });
  assert.equal(page.notes[1].author, '蘑古力');
  assert.equal(page.notes[1].publishedAt, '');
  assert.equal(page.notes[1].likes, '61');
  assert.equal(page.notes[1].noteId, 'abc123def456abc123def456');
  assert.equal(page.notes[1].noteUrl, 'https://www.xiaohongshu.com/explore/abc123def456abc123def456');
  assert.equal(page.notes[2].author, '阿禾');
  assert.equal(page.notes[2].publishedAt, '');
  assert.equal(page.notes[2].likes, '');
  assert.equal(page.notes[2].noteUrl, 'https://www.xiaohongshu.com/explore/bbb123def456abc123def456');
  assert.equal(page.notes[3].noteUrl, 'http://xhslink.com/a/Ab12Cd');
  assert.equal(page.notes[3].likes, '1.7万');
  assert.equal(page.notes.some((note) => note.title === '大家都在搜' || note.title === '购物狂欢'), false);
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

function notePage(title, likes) {
  return `
    <hierarchy>
      <node class="androidx.recyclerview.widget.RecyclerView" bounds="[0,200][1080,2400]">
        <node clickable="true" bounds="[20,220][520,980]">
          <node text="${title}" class="android.widget.TextView" bounds="[40,700][500,780]" />
          <node text="作者" class="android.widget.TextView" bounds="[40,820][200,880]" />
          <node text="${likes}" class="android.widget.TextView" bounds="[400,820][500,880]" />
        </node>
      </node>
    </hierarchy>`;
}

test('search keeps scrolling past eight screens until the requested count', async () => {
  const pages = Array.from({ length: 12 }, (_, index) => notePage(`笔记${index}`, String(index + 1)));
  const phone = fakePhone(pages);
  const notes = await searchXiaohongshu({
    runAdb: phone.runAdb,
    serial: 'abc123',
    keyword: '咖啡',
    limit: 12,
    pause: async () => {},
  });
  assert.equal(notes.length, 12);
  assert.equal(notes[11].title, '笔记11');
  assert.equal(phone.calls.filter((args) => args.includes('swipe')).length, 11);
});

test('search stops when further screens add no notes and does not invent any', async () => {
  const phone = fakePhone([notePage('只有这一篇', '3')]);
  const notes = await searchXiaohongshu({
    runAdb: phone.runAdb,
    serial: 'abc123',
    keyword: '咖啡',
    limit: 400,
    pause: async () => {},
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, '只有这一篇');
  assert.equal(phone.calls.filter((args) => args.includes('swipe')).length, 2);
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
