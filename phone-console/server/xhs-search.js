const PACKAGE = 'com.xingin.xhs';
const DUMP_PATH = '/sdcard/pc-window.xml';

const CHROME = new Set([
  '全部', '用户', '商品', '图片', '视频', '筛选', '综合', '最新', '最热',
  '搜索', '关注', '发现', '附近', '我', '首页', '消息', '市集', '推荐',
]);

const LOGIN_MARKS = ['手机号登录', '验证码登录', '获取验证码', '其他登录方式', '一键登录'];
const EMPTY_MARKS = ['没有找到相关内容', '暂无相关内容', '换个词搜索', '无相关结果', '没有更多内容'];

const NOTE_URL = /https?:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item)\/([0-9A-Za-z]{16,32})/;
const USER_URL = /https?:\/\/(?:www\.)?xiaohongshu\.com\/user\/profile\/[0-9A-Za-z]+/;

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)));
}

function attrsOf(raw) {
  const attrs = {};
  const re = /([\w:-]+)="([^"]*)"/g;
  let match = re.exec(raw);
  while (match) {
    attrs[match[1]] = decodeXml(match[2]);
    match = re.exec(raw);
  }
  return attrs;
}

export function parseUiTree(xml) {
  const root = { children: [] };
  const stack = [root];
  const re = /<node\b([^>]*)>|<\/node>/g;
  let match = re.exec(xml);
  while (match) {
    if (match[0].startsWith('</')) {
      if (stack.length > 1) stack.pop();
    } else {
      let body = match[1];
      const selfClosing = /\/\s*$/.test(body);
      body = body.replace(/\/\s*$/, '');
      const attrs = attrsOf(body);
      const node = {
        text: attrs.text || '',
        desc: attrs['content-desc'] || '',
        id: attrs['resource-id'] || '',
        className: attrs.class || '',
        clickable: attrs.clickable === 'true',
        bounds: attrs.bounds || '',
        children: [],
      };
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
    }
    match = re.exec(xml);
  }
  return root;
}

function boundsOf(raw) {
  const match = String(raw || '').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (!match) return null;
  const y1 = Number(match[2]);
  const y2 = Number(match[4]);
  const x1 = Number(match[1]);
  const x2 = Number(match[3]);
  return { x1, y1, x2, y2, h: y2 - y1, w: x2 - x1 };
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

function isLike(text) {
  return /^(\d+(\.\d+)?)([万wW])?$/.test(text);
}

function collectTextNodes(node, out = []) {
  if (node.text && node.text.trim() && !/EditText/.test(node.className || '')) {
    out.push({ text: node.text.trim(), y: boundsOf(node.bounds)?.y1 ?? 0 });
  }
  for (const child of node.children || []) collectTextNodes(child, out);
  return out;
}

function findUrls(node, found = { noteId: '', noteUrl: '', authorUrl: '' }) {
  const blobs = [node.text, node.desc, node.id];
  for (const blob of blobs) {
    if (!blob) continue;
    if (!found.noteUrl) {
      const note = blob.match(NOTE_URL);
      if (note) {
        found.noteUrl = note[0];
        found.noteId = note[1];
      }
    }
    if (!found.authorUrl) {
      const user = blob.match(USER_URL);
      if (user) found.authorUrl = user[0];
    }
  }
  for (const child of node.children || []) findUrls(child, found);
  return found;
}

function noteFromCard(card) {
  const texts = collectTextNodes(card)
    .filter((item) => item.text && !CHROME.has(item.text))
    .sort((a, b) => a.y - b.y || a.text.length - b.text.length);
  const like = [...texts].reverse().find((item) => isLike(item.text));
  const words = texts.filter((item) => !isLike(item.text));
  const title = words[0]?.text || '';
  if (!title) return null;
  const urls = findUrls(card);
  return {
    noteId: urls.noteId,
    title,
    author: words[1]?.text || '',
    authorUrl: urls.authorUrl,
    likes: like?.text || '',
    noteUrl: urls.noteUrl,
  };
}

function isList(node) {
  return /RecyclerView|ListView|GridView/.test(node.className || '');
}

export function readSearchPage(xml) {
  const tree = parseUiTree(String(xml || ''));
  const lists = [];
  walk(tree, (node) => {
    if (isList(node)) lists.push(node);
  });
  let notes = [];
  for (const list of lists) {
    const cards = [];
    for (const child of list.children) {
      const box = boundsOf(child.bounds);
      if (box && (box.h < 120 || box.w < 160)) continue;
      const note = noteFromCard(child);
      if (note) cards.push(note);
    }
    if (cards.length > notes.length) notes = cards;
  }
  const visible = [];
  walk(tree, (node) => {
    const text = (node.text || '').trim();
    if (text && !visible.includes(text)) visible.push(text);
  });
  if (notes.length) return { kind: 'notes', notes, visible };
  if (visible.some((text) => LOGIN_MARKS.some((mark) => text.includes(mark)))) {
    return { kind: 'login', notes: [], visible };
  }
  if (visible.some((text) => EMPTY_MARKS.some((mark) => text.includes(mark)))) {
    return { kind: 'empty', notes: [], visible };
  }
  const sample = visible.filter((text) => !CHROME.has(text)).slice(0, 8).join(' / ').slice(0, 120);
  return {
    kind: 'unreadable',
    notes: [],
    visible,
    reason: `没有读到已加载的笔记。页面上看到：${sample || '空白'}`,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function adb(runAdb, args, timeoutMs) {
  try {
    return await runAdb(args, { timeoutMs });
  } catch (err) {
    if (err && err.code === 'ENOENT') throw new Error('这台电脑上没有 adb。先安装 Android platform-tools。');
    if (err && err.code === 'ETIMEDOUT') throw new Error('adb 超时，没有读到页面。');
    throw new Error(String(err && err.message ? err.message : 'adb 失败。').slice(0, 200));
  }
}

async function dumpUi(runAdb, serial) {
  await adb(runAdb, ['-s', serial, 'shell', 'uiautomator', 'dump', DUMP_PATH], 25000);
  const result = await adb(runAdb, ['-s', serial, 'shell', 'cat', DUMP_PATH], 10000);
  const xml = String(result.stdout || '');
  if (!xml.includes('<hierarchy') && !xml.includes('<node')) {
    throw new Error('读不到页面。uiautomator 没有返回界面。');
  }
  return xml;
}

async function swipeUp(runAdb, serial) {
  const size = await adb(runAdb, ['-s', serial, 'shell', 'wm', 'size'], 8000);
  const match = String(size.stdout || '').match(/(\d+)x(\d+)/);
  const width = match ? Number(match[1]) : 1080;
  const height = match ? Number(match[2]) : 2400;
  const x = String(Math.round(width / 2));
  const y1 = String(Math.round(height * 0.78));
  const y2 = String(Math.round(height * 0.32));
  await adb(runAdb, ['-s', serial, 'shell', 'input', 'swipe', x, y1, x, y2, '350'], 8000);
}

export async function searchXiaohongshu({
  runAdb,
  serial,
  keyword,
  limit,
  pause = wait,
}) {
  const state = await adb(runAdb, ['-s', serial, 'get-state'], 8000);
  if (String(state.stdout || '').trim() !== 'device') {
    throw new Error('这台手机不在线。');
  }
  let installed;
  try {
    installed = await adb(runAdb, ['-s', serial, 'shell', 'pm', 'path', PACKAGE], 8000);
  } catch (err) {
    if (err && /adb 超时|没有 adb/.test(err.message || '')) throw err;
    throw new Error('这台手机没有安装小红书。');
  }
  if (!String(installed.stdout || '').includes(PACKAGE)) {
    throw new Error('这台手机没有安装小红书。');
  }

  const uri = `xhsdiscover://search/result?keyword=${encodeURIComponent(keyword)}`;
  const started = await adb(runAdb, [
    '-s', serial, 'shell', 'am', 'start',
    '-a', 'android.intent.action.VIEW',
    '-p', PACKAGE,
    '-d', uri,
  ], 15000);
  const startText = `${started.stdout || ''}\n${started.stderr || ''}`;
  if (/Error:/i.test(startText)) {
    throw new Error(`打不开小红书搜索。${startText.trim().slice(0, 160)}`);
  }

  const notes = [];
  const seen = new Set();
  let stagnant = 0;
  let unread = 0;
  for (let round = 0; round < 8 && notes.length < limit; round += 1) {
    if (round > 0) {
      await swipeUp(runAdb, serial);
      await pause(700);
    } else {
      await pause(1200);
    }
    const xml = await dumpUi(runAdb, serial);
    const page = readSearchPage(xml);
    if (page.kind === 'login') {
      throw new Error('小红书还没登录。请在这台手机上登录后再试。');
    }
    if (page.kind === 'empty') return notes.slice(0, limit);
    if (page.kind === 'unreadable') {
      unread += 1;
      if (notes.length === 0 && unread >= 3) throw new Error(page.reason);
      continue;
    }
    unread = 0;
    let added = 0;
    for (const note of page.notes) {
      const key = note.noteId || `${note.title}\0${note.author}\0${note.likes}`;
      if (seen.has(key)) continue;
      seen.add(key);
      notes.push(note);
      added += 1;
      if (notes.length >= limit) break;
    }
    if (added === 0) {
      stagnant += 1;
      if (stagnant >= 2) break;
    } else {
      stagnant = 0;
    }
  }
  if (!notes.length) throw new Error('没有读到已加载的笔记。');
  return notes.slice(0, limit);
}
