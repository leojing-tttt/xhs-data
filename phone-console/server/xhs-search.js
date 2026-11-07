const PACKAGE = 'com.xingin.xhs';
const DUMP_PATH = '/sdcard/pc-window.xml';

const CHROME = new Set([
  '全部', '用户', '商品', '图片', '视频', '筛选', '综合', '最新', '最热',
  '搜索', '关注', '发现', '附近', '我', '首页', '消息', '市集', '推荐',
]);

const LOGIN_MARKS = ['手机号登录', '验证码登录', '获取验证码', '其他登录方式', '一键登录'];
const EMPTY_MARKS = ['没有找到相关内容', '暂无相关内容', '换个词搜索', '无相关结果', '没有更多内容'];

const USER_URL = /https?:\/\/(?:www\.)?xiaohongshu\.com\/user\/profile\/[0-9A-Za-z]+/;
const NON_NOTE = new Set([
  '大家都在搜', '相关搜索', '猜你想搜', '你可能想搜', '热门搜索', '购物狂欢',
]);
const BADGE = new Set(['广告', '赞助', '品牌合作', '直播', '直播中', '置顶', '赞']);

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
  return /^\d+(?:\.\d+)?[万wW]$|^\d+$/.test(text);
}

function isDuration(text) {
  return /^\d{1,2}:\d{2}$/.test(text);
}

function isDateRange(text) {
  return /^\d{1,2}\.\d{1,2}\s*[-~～到至]\s*\d{1,2}\.\d{1,2}$/.test(text);
}

function isPublishTime(text) {
  return /^(?:刚刚|昨天|前天|\d+\s*(?:分钟|小时|天|周|个月|年)前|\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}月\d{1,2}日|编辑于\s*.+)$/.test(text);
}

function linkFromBlob(blob) {
  if (!blob) return null;
  const explore = String(blob).match(/https?:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item)\/([0-9A-Za-z]{16,32})/);
  if (explore) {
    return { noteId: explore[1], noteUrl: `https://www.xiaohongshu.com/explore/${explore[1]}` };
  }
  const scheme = String(blob).match(/xhsdiscover:\/\/(?:item|note|explore|discovery\/item)\/([0-9A-Za-z]{16,32})/);
  if (scheme) {
    return { noteId: scheme[1], noteUrl: `https://www.xiaohongshu.com/explore/${scheme[1]}` };
  }
  const short = String(blob).match(/https?:\/\/xhslink\.com\/[0-9A-Za-z/._~-]+/);
  if (short) return { noteId: '', noteUrl: short[0] };
  return null;
}

export function isXhsResultNote(note) {
  const title = String(note?.title || '').trim();
  return Boolean(title) && !NON_NOTE.has(title);
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
      const note = linkFromBlob(blob);
      if (note) {
        found.noteUrl = note.noteUrl;
        found.noteId = note.noteId;
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
  if (texts.some((item) => NON_NOTE.has(item.text))) return null;
  const like = [...texts].reverse().find((item) => isLike(item.text));
  const dated = texts.some((item) => isDateRange(item.text));
  const rest = texts.filter((item) => !isDateRange(item.text) && !BADGE.has(item.text));
  if (dated && !like && rest.every((item) => item.text.length <= 8)) return null;
  const time = texts.find((item) => isPublishTime(item.text));
  const words = texts.filter((item) => (
    item !== like
    && item !== time
    && !BADGE.has(item.text)
    && !isDuration(item.text)
    && !isDateRange(item.text)
  ));
  const title = words[0]?.text || '';
  if (!title || NON_NOTE.has(title)) return null;
  const urls = findUrls(card);
  return {
    noteId: urls.noteId,
    title,
    author: words[1]?.text || '',
    authorUrl: urls.authorUrl,
    publishedAt: time?.text || '',
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

const SKIP_MODEL = new Set([
  'ads', 'ad', 'advertisement', 'hot_query', 'recommend_query',
  'questionnaire', 'dsl', 'banner', 'event', 'search_recommend',
]);

const SCREEN_FALLBACK = '没有读到小红书自己的搜索响应，已改用屏幕上的文字。';

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function publishText(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string' && !/^\d{10,13}$/.test(value.trim())) return value.trim();
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  const ms = n < 1e12 ? n * 1000 : n;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
}

function likeText(card) {
  const info = card.interact_info || card.interactInfo || {};
  const value = info.liked_count ?? info.likedCount ?? card.liked_count ?? card.likedCount;
  if (value === undefined || value === null || value === '') return '';
  return String(value);
}

function noteFromResponseNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  const model = String(node.model_type || node.modelType || '').toLowerCase();
  if (model && model !== 'note') return null;
  const card = node.note_card || node.noteCard || node.note;
  const source = card && typeof card === 'object' ? card : node;
  const id = firstText(node.id, node.note_id, node.noteId, source.id, source.note_id, source.noteId);
  if (!/^[0-9A-Za-z]{16,32}$/.test(id)) return null;
  const user = source.user || source.author || {};
  const title = firstText(source.display_title, source.displayTitle, source.title);
  const author = firstText(user.nickname, user.nick_name, user.nickName, user.name);
  const publishedAt = publishText(source.time ?? source.create_time ?? source.createTime ?? source.publish_time ?? source.publishTime);
  const likes = likeText(source);
  if (!title && !author && !likes && !publishedAt) return null;
  if (!isXhsResultNote({ title: title || '笔记' })) return null;
  if (NON_NOTE.has(title)) return null;
  return {
    noteId: id,
    title,
    author,
    authorUrl: '',
    publishedAt,
    likes,
    noteUrl: `https://www.xiaohongshu.com/explore/${id}`,
  };
}

export function notesFromSearchResponse(payload) {
  const root = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const notes = [];
  const seen = new Set();
  function walk(node, depth) {
    if (!node || typeof node !== 'object' || depth > 12) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const model = String(node.model_type || node.modelType || '').toLowerCase();
    if (SKIP_MODEL.has(model)) return;
    const note = noteFromResponseNode(node);
    if (note && !seen.has(note.noteId)) {
      seen.add(note.noteId);
      notes.push(note);
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') walk(value, depth + 1);
    }
  }
  walk(root, 0);
  return notes;
}

export function notesFromCapture(raw) {
  if (raw == null || raw === '') return [];
  if (typeof raw === 'object') return notesFromSearchResponse(raw);
  const text = String(raw).trim();
  if (!text) return [];
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return notesFromSearchResponse(JSON.parse(text));
    } catch {
      return [];
    }
  }
  return [];
}

async function captureLog(runAdb, serial) {
  const result = await adb(runAdb, ['-s', serial, 'logcat', '-d', '-t', '500'], 8000);
  return String(result.stdout || '');
}

function takeNew(list, seen, incoming, limit) {
  let added = 0;
  for (const note of incoming) {
    const key = note.noteId || `${note.title}\0${note.author}\0${note.likes}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(note);
    added += 1;
    if (list.length >= limit) break;
  }
  return added;
}

export async function searchXiaohongshu({
  runAdb,
  serial,
  keyword,
  limit,
  pause = wait,
  readResponses = null,
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

  const screenNotes = [];
  const responseNotes = [];
  const screenSeen = new Set();
  const responseSeen = new Set();
  let sawResponse = false;
  let stagnant = 0;
  let unread = 0;
  let round = 0;
  const read = readResponses || (() => captureLog(runAdb, serial));
  try {
    await adb(runAdb, ['-s', serial, 'logcat', '-c'], 5000);
  } catch {
    // 清不掉旧日志也继续。后面只认这次读到的搜索响应。
  }

  while ((sawResponse ? responseNotes.length : screenNotes.length) < limit) {
    if (round > 0) {
      await swipeUp(runAdb, serial);
      await pause(700);
    } else {
      await pause(1200);
    }
    round += 1;
    const xml = await dumpUi(runAdb, serial);
    const page = readSearchPage(xml);
    if (page.kind === 'login') {
      throw new Error('小红书还没登录。请在这台手机上登录后再试。');
    }
    const captured = notesFromCapture(await read());
    const responseAdded = takeNew(responseNotes, responseSeen, captured, limit);
    if (captured.length) sawResponse = true;
    if (sawResponse) {
      if (page.kind === 'empty' && responseAdded === 0) break;
      if (responseAdded === 0) {
        stagnant += 1;
        if (stagnant >= 2) break;
      } else {
        stagnant = 0;
      }
      continue;
    }
    if (page.kind === 'empty') {
      return {
        notes: screenNotes.slice(0, limit),
        reason: screenNotes.length ? SCREEN_FALLBACK : '',
      };
    }
    if (page.kind === 'unreadable') {
      unread += 1;
      if (screenNotes.length === 0 && unread >= 3) throw new Error(page.reason);
      if (unread >= 3) break;
      continue;
    }
    unread = 0;
    const added = takeNew(screenNotes, screenSeen, page.notes, limit);
    if (added === 0) {
      stagnant += 1;
      if (stagnant >= 2) break;
    } else {
      stagnant = 0;
    }
  }
  if (sawResponse) {
    if (!responseNotes.length) throw new Error('没有读到已加载的笔记。');
    return { notes: responseNotes.slice(0, limit), reason: '' };
  }
  if (!screenNotes.length) throw new Error('没有读到已加载的笔记。');
  return { notes: screenNotes.slice(0, limit), reason: SCREEN_FALLBACK };
}
