// Search-response parsing and next-page bodies.
// Pagination keys are the ones already rewritten by extensions/xhs-search-export.
// This file does not add sort, note-type, or publish-time fields.

export const EXCEL_COLUMNS = [
  '笔记ID',
  '标题',
  '作者',
  '作者ID',
  '点赞数',
  '笔记类型',
  '封面图',
  '笔记链接',
  '作者主页',
];

const LIKE_KEYS = ['liked_count', 'likedCount', 'like_count', 'likeCount', 'likes', 'like'];
const CURSOR_KEYS = ['cursor_score', 'cursorScore', 'cursor', 'next_cursor', 'nextCursor'];

export function searchPageUrl(keyword) {
  const url = new URL('https://www.xiaohongshu.com/search_result');
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('source', 'web_user_page');
  return url.href;
}

export function createNoteStore() {
  const notes = [];
  const index = new Map();
  return {
    add(list) {
      for (const note of list || []) {
        if (!note || !note.id) continue;
        const existing = index.get(note.id);
        if (!existing) {
          notes.push(note);
          index.set(note.id, note);
          continue;
        }
        fillMissing(existing, note);
      }
    },
    list() {
      return notes.slice();
    },
  };
}

export function parseSearchResponse(payload) {
  let data = payload;
  if (typeof payload === 'string') {
    const text = payload.trim();
    if (!text) return { recognized: false, notes: [] };
    try {
      data = JSON.parse(text);
    } catch {
      return { recognized: false, notes: [] };
    }
  }
  if (!data || typeof data !== 'object') return { recognized: false, notes: [] };
  const items = findItems(data);
  if (!items) return { recognized: false, notes: [] };
  const notes = [];
  const seen = new Set();
  for (const item of items) {
    const note = noteFromItem(item);
    if (!note || seen.has(note.id)) continue;
    seen.add(note.id);
    notes.push(note);
  }
  return { recognized: true, notes };
}

export function readPageState(payload) {
  const blank = { hasMore: null, cursor: '', cursorRaw: '', searchId: '' };
  let data = payload;
  if (typeof payload === 'string') {
    const text = payload.trim();
    if (!text) return blank;
    try {
      data = JSON.parse(text);
    } catch {
      return blank;
    }
  }
  if (!data || typeof data !== 'object') return blank;
  const roots = [data];
  if (data.data && typeof data.data === 'object') roots.push(data.data);
  let hasMore = null;
  let cursor = '';
  let cursorRaw = '';
  let searchId = '';
  if (typeof payload === 'string') {
    const found = cursorFromText(payload);
    if (found && found.value !== '') {
      cursor = String(found.value);
      cursorRaw = found.raw;
    }
  }
  for (const root of roots) {
    if (hasMore === null) {
      if (typeof root.has_more === 'boolean') hasMore = root.has_more;
      else if (typeof root.hasMore === 'boolean') hasMore = root.hasMore;
    }
    if (!cursor) {
      cursor = firstText(root, CURSOR_KEYS);
      if (cursor) cursorRaw = JSON.stringify(cursor);
    }
    if (!searchId) searchId = firstText(root, ['search_id', 'searchId']);
  }
  return { hasMore, cursor, cursorRaw, searchId };
}

export function buildNextPageRequest(last, state, capturedCount) {
  if (!last || !last.url || typeof last.body !== 'string' || !last.body) return null;
  let body = last.body;
  const presentCursor = CURSOR_KEYS.filter((key) => jsonField(body, key) != null);
  let changed = false;
  let cursorStuck = false;
  if (presentCursor.length) {
    const current = comparable(jsonField(body, presentCursor[0]));
    if (!state || !state.cursor || String(current) === String(state.cursor)) {
      cursorStuck = true;
    } else {
      const literal = state.cursorRaw || JSON.stringify(state.cursor);
      for (const key of presentCursor) body = replaceField(body, key, literal);
      changed = true;
    }
  }
  for (const key of ['page', 'page_num', 'pageNum']) {
    const raw = jsonField(body, key);
    if (raw == null || !/^-?\d+$/.test(raw)) continue;
    body = replaceField(body, key, String(Number(raw) + 1));
    changed = true;
    cursorStuck = false;
  }
  if (!changed) return cursorStuck ? { blocked: '游标没有继续往后' } : null;
  for (const key of ['note_index', 'noteIndex']) {
    if (jsonField(body, key) != null) body = replaceField(body, key, String(capturedCount));
  }
  for (const key of ['refresh_type', 'refreshType']) {
    if (jsonField(body, key) != null) body = replaceField(body, key, '3');
  }
  if (state && state.searchId) {
    for (const key of ['search_id', 'searchId']) {
      if (jsonField(body, key) != null) body = replaceField(body, key, JSON.stringify(state.searchId));
    }
  }
  if (body === last.body) return cursorStuck ? { blocked: '游标没有继续往后' } : null;
  return { url: last.url, method: last.method || 'POST', body };
}

export function cellsForNote(note) {
  return [
    note.id == null ? '' : String(note.id),
    note.title || '',
    note.author || '',
    note.authorId || '',
    note.likes == null || note.likes === '' ? '' : note.likes,
    note.type || '',
    note.cover || '',
    note.link || '',
    note.profile || '',
  ];
}

export function formatExportFilename(keyword, date) {
  const when = date instanceof Date ? date : new Date(date);
  const stamp = [
    String(when.getFullYear()),
    pad(when.getMonth() + 1),
    pad(when.getDate()),
  ].join('') + '-' + pad(when.getHours()) + pad(when.getMinutes());
  return `小红书搜索_${safeKeyword(keyword)}_${stamp}.xlsx`;
}

function findItems(data) {
  const roots = [data];
  if (data.data && typeof data.data === 'object') roots.push(data.data);
  for (const candidate of roots) {
    if (Array.isArray(candidate.items)) return candidate.items;
    if (Array.isArray(candidate.notes)) return candidate.notes;
  }
  return null;
}

function noteFromItem(item) {
  if (!item || typeof item !== 'object') return null;
  const modelType = readOwn(item, ['model_type', 'modelType']);
  if (modelType.present && modelType.value !== 'note') return null;
  const card = item.note_card || item.noteCard || item.note || item;
  if (!card || typeof card !== 'object') return null;
  if (card === item && !item.note_card && !item.noteCard && !item.note && !readOwn(item, ['display_title', 'displayTitle', 'title', 'note_id', 'noteId']).present) {
    return null;
  }
  return fieldsFromCard(card, item);
}

function fieldsFromCard(card, item) {
  const id = firstValue(
    card.note_id,
    card.noteId,
    card.id,
    item === card ? undefined : item.id,
    item.note_id,
    item.noteId,
  );
  if (id == null || id === '') return null;
  const user = card.user || card.user_info || card.userInfo || {};
  const titleField = readOwn(card, ['display_title', 'displayTitle', 'title']);
  const authorField = readOwn(user, ['nickname', 'nick_name', 'nickName', 'name']);
  const authorIdField = readOwn(user, ['user_id', 'userid', 'userId']);
  const likesField = readLikes(card, item);
  const typeField = readOwn(card, ['type', 'note_type', 'noteType']);
  const coverField = readCover(card);
  const token = firstValue(item.xsec_token, item.xsecToken, card.xsec_token, card.xsecToken);
  const explicitProfile = readOwn(user, ['profile_url', 'profileUrl', 'homepage']);
  const userToken = readOwn(user, ['xsec_token', 'xsecToken']);
  const note = {
    id: String(id),
    title: titleField.present ? String(titleField.value) : '',
    author: authorField.present ? String(authorField.value) : '',
    profile: buildProfile(
      authorIdField.present ? authorIdField.value : '',
      explicitProfile.present ? explicitProfile.value : '',
      userToken.present ? userToken.value : '',
    ),
    link: buildLink(String(id), token),
    likes: likesField.present ? likesField.value : null,
    authorId: authorIdField.present ? String(authorIdField.value) : '',
    type: typeField.present ? mapType(typeField.value) : '',
    cover: coverField.present ? String(coverField.value) : '',
  };
  return note;
}

function readLikes(card, item) {
  const containers = [];
  for (const source of [card, item]) {
    if (!source || typeof source !== 'object') continue;
    containers.push(source.interact_info, source.interactInfo, source.interaction, source);
  }
  for (const container of containers) {
    const found = readOwn(container, LIKE_KEYS);
    if (found.present || found.zero) return { present: true, value: found.value };
  }
  return { present: false, value: null };
}

function fillMissing(existing, incoming) {
  if ((existing.likes == null || existing.likes === '') && incoming.likes != null && incoming.likes !== '') {
    existing.likes = incoming.likes;
  }
  if (!existing.authorId && incoming.authorId) existing.authorId = incoming.authorId;
  if (!existing.type && incoming.type) existing.type = incoming.type;
  if (!existing.cover && incoming.cover) existing.cover = incoming.cover;
  if (!existing.profile && incoming.profile) existing.profile = incoming.profile;
  if (!existing.author && incoming.author) existing.author = incoming.author;
  if (!existing.title && incoming.title) existing.title = incoming.title;
  if (existing.link && incoming.link && incoming.link.length > existing.link.length) existing.link = incoming.link;
}

function readCover(card) {
  const cover = card.cover;
  const urlKeys = ['url_default', 'urlDefault', 'url', 'url_pre', 'urlPre'];
  if (cover && typeof cover === 'object') {
    const direct = readOwn(cover, urlKeys);
    if (direct.present) return direct;
    const nested = firstInfoUrl(cover.info_list || cover.infoList);
    if (nested.present) return nested;
  }
  if (typeof cover === 'string' && cover) return { present: true, value: cover };
  const images = card.image_list || card.imageList;
  if (Array.isArray(images)) {
    for (const image of images) {
      const direct = readOwn(image, urlKeys);
      if (direct.present) return direct;
      const nested = firstInfoUrl(image && (image.info_list || image.infoList));
      if (nested.present) return nested;
    }
  }
  return { present: false, value: undefined };
}

function firstInfoUrl(list) {
  if (!Array.isArray(list)) return { present: false, value: undefined };
  for (const info of list) {
    const found = readOwn(info, ['url']);
    if (found.present) return found;
  }
  return { present: false, value: undefined };
}

function readOwn(obj, keys) {
  if (!obj || typeof obj !== 'object') return { present: false, value: undefined };
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const value = obj[key];
    if (value == null || value === '') continue;
    if (value === 0 || value === '0') return { present: true, zero: true, value };
    return { present: true, value };
  }
  return { present: false, value: undefined };
}

function firstValue() {
  for (let i = 0; i < arguments.length; i += 1) {
    const value = arguments[i];
    if (value != null && value !== '') return value;
  }
  return undefined;
}

function firstText(root, keys) {
  for (const key of keys) {
    const value = root[key];
    if (value == null || value === '') continue;
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  return '';
}

function mapType(value) {
  const normalized = String(value).toLowerCase();
  if (normalized === 'normal' || normalized === 'image' || normalized === 'img') return '图文';
  if (normalized === 'video') return '视频';
  return String(value);
}

function buildLink(id, token) {
  const base = `https://www.xiaohongshu.com/explore/${id}`;
  if (token == null || token === '') return base;
  return `${base}?xsec_token=${encodeURIComponent(String(token))}&xsec_source=pc_search`;
}

function buildProfile(authorId, explicitUrl, token) {
  if (explicitUrl) {
    try {
      const url = new URL(String(explicitUrl), 'https://www.xiaohongshu.com');
      if (/^\/user\/profile\/[^/]+/.test(url.pathname)) return url.href;
    } catch {
      // Ignore a profile string that is not a URL. Fall through to the author id.
    }
  }
  if (authorId == null || authorId === '') return '';
  const base = `https://www.xiaohongshu.com/user/profile/${encodeURIComponent(String(authorId))}`;
  if (token == null || token === '') return base;
  return `${base}?xsec_token=${encodeURIComponent(String(token))}&xsec_source=pc_feed`;
}

function cursorFromText(text) {
  const specific = /"(cursor_score|cursorScore|next_cursor|nextCursor)"\s*:\s*("(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text);
  const itemsAt = text.indexOf('"items"');
  const head = itemsAt === -1 ? text : text.slice(0, itemsAt);
  const generic = /"(cursor)"\s*:\s*("(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(head);
  const match = specific || generic;
  if (!match) return null;
  const raw = match[2];
  if (raw.charAt(0) === '"') {
    try {
      return { value: JSON.parse(raw), raw };
    } catch {
      return { value: raw.slice(1, -1), raw };
    }
  }
  return { value: raw, raw };
}

function jsonField(body, key) {
  const match = new RegExp(`"${key}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`).exec(body);
  if (!match) return null;
  return match[1];
}

function comparable(raw) {
  if (!raw) return '';
  if (raw.charAt(0) === '"') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

function replaceField(body, key, rawLiteral) {
  const pattern = new RegExp(`("${key}"\\s*:\\s*)("(?:\\\\.|[^"\\\\])*"|-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`);
  if (!pattern.test(body)) return body;
  return body.replace(pattern, `$1${rawLiteral}`);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function safeKeyword(keyword) {
  const cleaned = String(keyword || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || '未命名';
}
