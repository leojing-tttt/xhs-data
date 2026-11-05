(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.XhsSearchExport = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const EMPTY_EXPORT_MESSAGE = '还没有捕获到笔记。请先在搜索结果页向下浏览，等笔记出现在列表里后再导出。';
  const RECOMMEND_EMPTY_MESSAGE = '还没有捕获到笔记。请先在推荐页向下浏览，等笔记出现在列表里后再导出。';
  const NOT_SEARCH_MESSAGE = '当前页面不是小红书推荐页或搜索结果页';
  const OPTIONAL_COLUMNS = ['作者ID', '点赞数', '笔记类型', '封面图'];
  const TEXT_COLUMNS = new Set(['笔记ID', '标题', '作者', '作者ID', '作者主页', '笔记类型', '封面图', '笔记链接']);

  function createStore() {
    const notes = [];
    const index = new Map();
    let apiRecognized = false;
    let keyword = null;

    function reset() {
      notes.length = 0;
      index.clear();
      apiRecognized = false;
    }

    function addNotes(list) {
      let added = 0;
      for (const note of list) {
        if (!note || !note.id || index.has(note.id)) continue;
        index.set(note.id, note);
        notes.push(note);
        added += 1;
      }
      return added;
    }

    return {
      get apiRecognized() {
        return apiRecognized;
      },
      list() {
        return notes.slice();
      },
      get keyword() {
        return keyword || '';
      },
      setKeyword(next) {
        const value = next == null ? '' : String(next);
        if (keyword === null) {
          keyword = value;
          return;
        }
        if (!value || value === keyword) return;
        keyword = value;
        reset();
      },
      ingestPayload(payload) {
        const parsed = parseSearchResponse(payload);
        if (!parsed.recognized) {
          return { recognized: false, added: 0 };
        }
        apiRecognized = true;
        return { recognized: true, added: addNotes(parsed.notes) };
      },
      useVisibleCards(document) {
        if (apiRecognized) {
          return { used: false, added: 0 };
        }
        const visible = parseVisibleCards(document);
        return { used: true, added: addNotes(visible) };
      },
    };
  }

  function parseSearchResponse(payload) {
    let data = payload;
    if (typeof payload === 'string') {
      const text = payload.trim();
      if (!text) return { recognized: false, notes: [] };
      try {
        data = JSON.parse(text);
      } catch (error) {
        return { recognized: false, notes: [] };
      }
    }
    if (!data || typeof data !== 'object') {
      return { recognized: false, notes: [] };
    }
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
    const modelType = ownField(item, ['model_type', 'modelType']);
    if (modelType.present && modelType.value !== 'note') return null;
    const card = item.note_card || item.noteCard || item.note || item;
    if (!card || typeof card !== 'object') return null;
    if (card === item && !item.note_card && !item.noteCard && !item.note && !ownField(item, ['display_title', 'displayTitle', 'title', 'note_id', 'noteId']).present) {
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
      item.noteId
    );
    if (id == null || id === '') return null;
    const user = card.user || card.user_info || card.userInfo || {};
    const titleField = readOwn(card, ['display_title', 'displayTitle', 'title']);
    const authorField = readOwn(user, ['nickname', 'nick_name', 'nickName', 'name']);
    const authorIdField = readOwn(user, ['user_id', 'userid', 'userId']);
    const likesField = readLikes(card);
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
        userToken.present ? userToken.value : ''
      ),
      link: buildLink(String(id), token),
      present: {
        作者ID: authorIdField.present,
        点赞数: likesField.present,
        笔记类型: typeField.present,
        封面图: coverField.present,
      },
    };
    if (authorIdField.present) note.authorId = String(authorIdField.value);
    if (likesField.present) note.likes = likesField.value;
    if (typeField.present) note.type = mapType(typeField.value);
    if (coverField.present) note.cover = String(coverField.value);
    return note;
  }

  function readLikes(card) {
    const interact = card.interact_info || card.interactInfo;
    const fromInteract = readOwn(interact, ['liked_count', 'likedCount']);
    if (fromInteract.present) return fromInteract;
    return readOwn(card, ['liked_count', 'likedCount']);
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

  function ownField(obj, keys) {
    return readOwn(obj, keys);
  }

  function readOwn(obj, keys) {
    if (!obj || typeof obj !== 'object') return { present: false, value: undefined };
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      const value = obj[key];
      if (value == null || value === '') continue;
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

  function mapType(value) {
    const normalized = String(value).toLowerCase();
    if (normalized === 'normal' || normalized === 'image' || normalized === 'img') return '图文';
    if (normalized === 'video') return '视频';
    return String(value);
  }

  function buildLink(id, token) {
    const base = 'https://www.xiaohongshu.com/explore/' + id;
    if (token == null || token === '') return base;
    return base + '?xsec_token=' + encodeURIComponent(String(token)) + '&xsec_source=pc_search';
  }

  function buildProfile(authorId, explicitUrl, token) {
    if (explicitUrl) {
      try {
        const url = new URL(String(explicitUrl), 'https://www.xiaohongshu.com');
        if (/^\/user\/profile\/[^/]+/.test(url.pathname)) return url.href;
      } catch (error) {}
    }
    if (authorId == null || authorId === '') return '';
    const base = 'https://www.xiaohongshu.com/user/profile/' + encodeURIComponent(String(authorId));
    if (token == null || token === '') return base;
    return base + '?xsec_token=' + encodeURIComponent(String(token)) + '&xsec_source=pc_feed';
  }

  function parseVisibleCards(document) {
    if (!document || typeof document.querySelectorAll !== 'function') return [];
    const found = new Map();
    const anchors = document.querySelectorAll('a[href]');
    for (const anchor of anchors) {
      const url = absoluteUrl(anchor.getAttribute('href') || '');
      if (!url) continue;
      const id = noteIdFromUrl(url);
      if (!id) continue;
      let entry = found.get(id);
      if (!entry) {
        const token = url.searchParams.get('xsec_token');
        const link = url.hostname === 'www.xiaohongshu.com'
          ? url.href
          : buildLink(id, token);
        entry = { id, title: '', link, root: cardRoot(anchor) };
        found.set(id, entry);
      }
      const text = elementText(anchor);
      if (text.length > entry.title.length) entry.title = text;
      if (!entry.title) {
        const image = anchor.querySelector('img');
        const alt = image && (image.getAttribute('alt') || '').trim();
        if (alt) entry.title = alt;
      }
    }

    const numbered = document.querySelectorAll('[data-note-id]');
    for (const node of numbered) {
      const id = String(node.getAttribute('data-note-id') || '').trim();
      if (!id || !/^[0-9a-zA-Z]+$/.test(id) || found.has(id)) continue;
      const titleNode = node.querySelector('.title, a.title');
      const image = node.querySelector('img');
      const alt = image && (image.getAttribute('alt') || '').trim();
      found.set(id, {
        id,
        title: elementText(titleNode || node) || alt || '',
        link: buildLink(id, ''),
        root: node,
      });
    }

    const notes = [];
    for (const entry of found.values()) {
      const author = authorFrom(entry.root);
      const cover = coverFrom(entry.root, entry.id);
      const note = {
        id: entry.id,
        title: entry.title,
        author: author.author,
        profile: author.profile || buildProfile(author.authorId, ''),
        link: entry.link,
        present: {
          作者ID: Boolean(author.authorId),
          点赞数: false,
          笔记类型: false,
          封面图: Boolean(cover),
        },
      };
      if (author.authorId) note.authorId = author.authorId;
      if (cover) note.cover = cover;
      notes.push(note);
    }
    return notes;
  }

  function absoluteUrl(href) {
    try {
      return new URL(href, 'https://www.xiaohongshu.com');
    } catch (error) {
      return null;
    }
  }

  function noteIdFromUrl(url) {
    const match = url.pathname.match(/^\/(?:explore|search_result|discovery\/item)\/([0-9a-zA-Z]+)/);
    return match ? match[1] : '';
  }

  function elementText(element) {
    const raw = element.innerText || element.textContent || '';
    return String(raw).replace(/\s+/g, ' ').trim();
  }

  function cardRoot(anchor) {
    let node = anchor;
    for (let depth = 0; depth < 6 && node.parentElement; depth += 1) {
      node = node.parentElement;
      if (node.querySelector('a[href*="/user/profile/"]')) return node;
      const tag = node.tagName;
      if (tag === 'SECTION' || tag === 'ARTICLE') return node;
    }
    return node;
  }

  function authorFrom(root) {
    const links = root.querySelectorAll('a[href]');
    for (const link of links) {
      const url = absoluteUrl(link.getAttribute('href') || '');
      if (!url) continue;
      const match = url.pathname.match(/^\/user\/profile\/([0-9a-zA-Z]+)/);
      if (!match) continue;
      return { author: elementText(link), authorId: match[1], profile: url.href };
    }
    return { author: '', authorId: '', profile: '' };
  }

  function coverFrom(root, noteId) {
    const links = root.querySelectorAll('a[href]');
    for (const link of links) {
      const url = absoluteUrl(link.getAttribute('href') || '');
      if (!url || noteIdFromUrl(url) !== noteId) continue;
      const image = link.querySelector('img');
      const src = image && image.getAttribute('src');
      if (src) return src;
    }
    const images = root.querySelectorAll('img');
    for (const image of images) {
      if (image.closest('a[href*="/user/profile/"]')) continue;
      const src = image.getAttribute('src');
      if (src) return src;
    }
    return '';
  }

  function toTable(notes) {
    const headers = ['笔记ID', '标题', '作者'];
    if (notes.some((note) => note.present && note.present['作者ID'])) headers.push('作者ID');
    headers.push('作者主页');
    for (const header of OPTIONAL_COLUMNS) {
      if (header === '作者ID') continue;
      if (notes.some((note) => note.present && note.present[header])) headers.push(header);
    }
    headers.push('笔记链接');
    return {
      headers,
      rows: notes.map((note) => headers.map((header) => cellValue(note, header))),
    };
  }

  function cellValue(note, header) {
    switch (header) {
      case '笔记ID': return note.id;
      case '标题': return note.title || '';
      case '作者': return note.author || '';
      case '作者ID': return note.authorId || '';
      case '作者主页': return note.profile || '';
      case '点赞数': return note.likes == null ? '' : note.likes;
      case '笔记类型': return note.type || '';
      case '封面图': return note.cover || '';
      case '笔记链接': return note.link || '';
      default: return '';
    }
  }

  function workbookBytes(notes, XLSXImpl, options) {
    const XLSX = XLSXImpl || (typeof globalThis !== 'undefined' ? globalThis.XLSX : null);
    if (!XLSX || !XLSX.utils) {
      throw new Error('缺少本地 xlsx 库');
    }
    const table = toTable(notes);
    const sheet = XLSX.utils.aoa_to_sheet([table.headers].concat(table.rows));
    forceTextColumns(XLSX, sheet, table.headers);
    const book = XLSX.utils.book_new();
    const mode = options && options.mode;
    XLSX.utils.book_append_sheet(book, sheet, mode === 'recommend' ? '推荐' : '搜索结果');
    return XLSX.write(book, { bookType: 'xlsx', type: 'array' });
  }

  function forceTextColumns(XLSX, sheet, headers) {
    if (!sheet['!ref']) return;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      if (!TEXT_COLUMNS.has(headers[column])) continue;
      for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: column });
        const cell = sheet[address];
        if (!cell || cell.v == null) continue;
        cell.t = 's';
        cell.v = String(cell.v);
        delete cell.w;
      }
    }
  }

  function formatExportFilename(keyword, date, mode) {
    const when = date instanceof Date ? date : new Date(date);
    const stamp = [
      String(when.getFullYear()),
      pad(when.getMonth() + 1),
      pad(when.getDate()),
    ].join('') + '-' + pad(when.getHours()) + pad(when.getMinutes());
    if (mode === 'recommend') return '小红书推荐_' + stamp + '.xlsx';
    return '小红书搜索_' + safeKeyword(keyword) + '_' + stamp + '.xlsx';
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

  const SEARCH_HOSTS = {
    'www.xiaohongshu.com': true,
    'xiaohongshu.com': true,
  };

  function describePage(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      return { allowed: false, keyword: '', message: NOT_SEARCH_MESSAGE };
    }
    const path = parsed.pathname || '';
    const protocolOk = parsed.protocol === 'https:' || parsed.protocol === 'http:';
    const mode = protocolOk && SEARCH_HOSTS[parsed.hostname] ? pageMode(path) : '';
    if (!mode) {
      return { allowed: false, mode: '', label: '', keyword: '', message: NOT_SEARCH_MESSAGE };
    }
    return {
      allowed: true,
      mode: mode,
      label: mode === 'recommend' ? '推荐' : '搜索',
      keyword: mode === 'search' ? (parsed.searchParams.get('keyword') || '') : '',
      message: '',
    };
  }

  function pageMode(path) {
    if (path === '/search_result' || path.startsWith('/search_result/')) return 'search';
    if (path === '/' || path === '/explore' || path === '/explore/') return 'recommend';
    return '';
  }

  function createSession() {
    const search = createStore();
    const recommend = createStore();
    let held = null;
    return {
      storeFor(page) {
        return page && page.mode === 'recommend' ? recommend : search;
      },
      ingest(page, payload, kind) {
        if (!page || !page.allowed || page.mode !== kind) {
          return { recognized: false, added: 0 };
        }
        return this.storeFor(page).ingestPayload(payload);
      },
      holdVisible(notes) {
        held = new Set((notes || []).map(function (note) { return note.id; }));
      },
      useVisibleCards(page, document) {
        const store = this.storeFor(page);
        if (!page || !page.allowed || store.apiRecognized) return { used: false, added: 0 };
        const visible = parseVisibleCards(document);
        if (held && visible.length && visible.every(function (note) { return held.has(note.id); })) {
          return { used: false, added: 0 };
        }
        held = null;
        const before = store.list().length;
        store.useVisibleCards(document);
        return { used: true, added: store.list().length - before };
      },
    };
  }

  function matchesContentScript(pattern, urlString) {
    const parsedPattern = /^(\*|https|http):\/\/([^/]+)(\/.*)$/.exec(pattern);
    if (!parsedPattern) return false;
    let url;
    try {
      url = new URL(urlString);
    } catch (error) {
      return false;
    }
    const scheme = url.protocol.replace(':', '');
    if (parsedPattern[1] !== '*' && parsedPattern[1] !== scheme) return false;
    if (!hostMatches(parsedPattern[2], url.hostname)) return false;
    return globMatch(parsedPattern[3], url.pathname + url.search);
  }

  function hostMatches(pattern, hostname) {
    if (pattern === '*') return true;
    if (pattern.indexOf('*.') === 0) {
      const rest = pattern.slice(2);
      return hostname === rest || hostname.slice(-(rest.length + 1)) === '.' + rest;
    }
    return pattern === hostname;
  }

  function globMatch(pattern, text) {
    let expression = '^';
    for (let index = 0; index < pattern.length; index += 1) {
      const character = pattern[index];
      if (character === '*') expression += '.*';
      else if (/[\\^$.*+?()[\]{}|]/.test(character)) expression += '\\' + character;
      else expression += character;
    }
    return new RegExp(expression + '$').test(text);
  }

  function manifestInjects(manifest, urlString) {
    const scripts = (manifest && manifest.content_scripts) || [];
    function entryFor(file) {
      for (let index = 0; index < scripts.length; index += 1) {
        const files = scripts[index].js || [];
        if (files.indexOf(file) !== -1) return scripts[index];
      }
      return null;
    }
    const main = entryFor('src/inject-main.js');
    const ui = entryFor('src/content.js');
    if (!main || !ui) return false;
    if (main.world !== 'MAIN') return false;
    if (main.run_at !== 'document_start' || ui.run_at !== 'document_start') return false;
    const permissions = (manifest && manifest.host_permissions) || [];
    if (!permissions.some((pattern) => matchesContentScript(pattern, urlString))) return false;
    return [main, ui].every((entry) => (entry.matches || []).some((pattern) => matchesContentScript(pattern, urlString)));
  }

  function mountPanelHost(document, host) {
    const node = host || document.createElement('div');
    node.id = 'xhs-search-export-root';
    node.setAttribute('data-xhs-search-export', '1');
    function place() {
      node.style.setProperty('position', 'fixed', 'important');
      node.style.setProperty('right', '24px', 'important');
      node.style.setProperty('bottom', '24px', 'important');
      node.style.setProperty('top', 'auto', 'important');
      node.style.setProperty('left', 'auto', 'important');
      node.style.setProperty('z-index', '2147483647', 'important');
      node.style.setProperty('width', '260px', 'important');
      node.style.setProperty('height', 'auto', 'important');
      node.style.setProperty('margin', '0', 'important');
      node.style.setProperty('inset', 'auto 24px 24px auto', 'important');
      node.style.setProperty('display', 'block', 'important');
      node.style.setProperty('visibility', 'visible', 'important');
      node.style.setProperty('opacity', '1', 'important');
      node.style.setProperty('background', 'transparent', 'important');
      node.style.setProperty('border', '0', 'important');
      node.style.setProperty('padding', '0', 'important');
      node.style.setProperty('overflow', 'visible', 'important');
    }
    place();
    const root = document.documentElement;
    if (root && node.parentNode !== root) root.appendChild(node);
    try {
      if (typeof node.showPopover === 'function') {
        node.popover = 'manual';
        if (typeof node.matches !== 'function' || !node.matches(':popover-open')) {
          node.showPopover();
        }
        place();
      }
    } catch (error) {}
    return node;
  }

  function decideExport(options) {
    const notes = (options && options.notes) || [];
    const page = describePage(options && options.url);
    if (!page.allowed) {
      return { download: false, filename: '', message: page.message };
    }
    if (!notes.length) {
      return { download: false, filename: '', message: emptyMessage(page.mode) };
    }
    const keyword = options && options.keyword ? options.keyword : page.keyword;
    return {
      download: true,
      filename: formatExportFilename(keyword, options.now || new Date(), page.mode),
      message: '',
    };
  }

  function emptyMessage(mode) {
    return mode === 'recommend' ? RECOMMEND_EMPTY_MESSAGE : EMPTY_EXPORT_MESSAGE;
  }

  function panelView(count, page) {
    const mode = page && page.mode === 'recommend' ? 'recommend' : 'search';
    const label = mode === 'recommend' ? '推荐' : '搜索';
    return {
      mode: mode,
      modeLabel: label,
      title: mode === 'recommend' ? '导出推荐' : '导出搜索',
      countText: '已捕获 ' + count + ' 条笔记',
      buttonText: '导出 Excel',
      hint: count === 0
        ? emptyMessage(mode)
        : (mode === 'recommend'
          ? '当前只导出推荐列表，不会带上搜索结果。'
          : '当前只导出这次搜索，不会带上推荐页。'),
    };
  }

  function renderPanel(container, view) {
    const doc = container.ownerDocument;
    container.textContent = '';
    const mode = doc.createElement('p');
    mode.className = 'mode' + (view.mode === 'recommend' ? ' recommend' : '');
    mode.setAttribute('data-role', 'mode');
    mode.textContent = view.modeLabel || '搜索';
    const count = doc.createElement('p');
    count.setAttribute('data-role', 'count');
    count.textContent = view.countText;
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute('data-role', 'export');
    button.textContent = view.buttonText;
    const hint = doc.createElement('p');
    hint.setAttribute('data-role', 'hint');
    hint.textContent = view.hint || '';
    container.append(mode, count, button, hint);
    return { mode, count, button, hint };
  }

  return {
    EMPTY_EXPORT_MESSAGE,
    RECOMMEND_EMPTY_MESSAGE,
    NOT_SEARCH_MESSAGE,
    createStore,
    createSession,
    parseSearchResponse,
    parseVisibleCards,
    toTable,
    workbookBytes,
    formatExportFilename,
    describePage,
    decideExport,
    panelView,
    renderPanel,
    matchesContentScript,
    manifestInjects,
    mountPanelHost,
  };
});
