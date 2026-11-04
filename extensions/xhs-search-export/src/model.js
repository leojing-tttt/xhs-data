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
  const NOT_SEARCH_MESSAGE = '当前页面不是小红书搜索结果页';
  const OPTIONAL_COLUMNS = ['作者ID', '点赞数', '笔记类型', '封面图'];
  const TEXT_COLUMNS = new Set(['笔记ID', '标题', '作者', '作者ID', '笔记类型', '封面图', '笔记链接']);

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
    if (Object.prototype.hasOwnProperty.call(item, 'model_type') && item.model_type !== 'note') {
      return null;
    }
    const card = item.note_card || item.note || item;
    if (!card || typeof card !== 'object') return null;
    if (card === item && !item.note_card && !item.note && !item.display_title && !item.title && !item.note_id) {
      return null;
    }
    return fieldsFromCard(card, item);
  }

  function fieldsFromCard(card, item) {
    const id = firstValue(card.note_id, card.id, item === card ? undefined : item.id, item.note_id);
    if (id == null || id === '') return null;
    const user = card.user || card.user_info || {};
    const titleField = readOwn(card, ['display_title', 'title']);
    const authorField = readOwn(user, ['nickname', 'nick_name', 'nickName', 'name']);
    const authorIdField = readOwn(user, ['user_id', 'userid', 'userId']);
    const likesField = readLikes(card);
    const typeField = readOwn(card, ['type', 'note_type']);
    const coverField = readCover(card);
    const token = firstValue(item.xsec_token, card.xsec_token);
    const note = {
      id: String(id),
      title: titleField.present ? String(titleField.value) : '',
      author: authorField.present ? String(authorField.value) : '',
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
    const fromInteract = readOwn(card.interact_info, ['liked_count', 'likedCount']);
    if (fromInteract.present) return fromInteract;
    return readOwn(card, ['liked_count', 'likedCount']);
  }

  function readCover(card) {
    const cover = card.cover;
    if (cover && typeof cover === 'object') {
      const direct = readOwn(cover, ['url_default', 'url', 'url_pre']);
      if (direct.present) return direct;
      const nested = firstInfoUrl(cover.info_list);
      if (nested.present) return nested;
    }
    if (typeof cover === 'string' && cover) return { present: true, value: cover };
    if (Array.isArray(card.image_list)) {
      for (const image of card.image_list) {
        const direct = readOwn(image, ['url_default', 'url', 'url_pre']);
        if (direct.present) return direct;
        const nested = firstInfoUrl(image && image.info_list);
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

    const notes = [];
    for (const entry of found.values()) {
      const author = authorFrom(entry.root);
      const cover = coverFrom(entry.root, entry.id);
      const note = {
        id: entry.id,
        title: entry.title,
        author: author.author,
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
      return { author: elementText(link), authorId: match[1] };
    }
    return { author: '', authorId: '' };
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
    for (const header of OPTIONAL_COLUMNS) {
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
      case '点赞数': return note.likes == null ? '' : note.likes;
      case '笔记类型': return note.type || '';
      case '封面图': return note.cover || '';
      case '笔记链接': return note.link || '';
      default: return '';
    }
  }

  function workbookBytes(notes, XLSXImpl) {
    const XLSX = XLSXImpl || (typeof globalThis !== 'undefined' ? globalThis.XLSX : null);
    if (!XLSX || !XLSX.utils) {
      throw new Error('缺少本地 xlsx 库');
    }
    const table = toTable(notes);
    const sheet = XLSX.utils.aoa_to_sheet([table.headers].concat(table.rows));
    forceTextColumns(XLSX, sheet, table.headers);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, '搜索结果');
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

  function formatExportFilename(keyword, date) {
    const when = date instanceof Date ? date : new Date(date);
    const stamp = [
      String(when.getFullYear()),
      pad(when.getMonth() + 1),
      pad(when.getDate()),
    ].join('') + '-' + pad(when.getHours()) + pad(when.getMinutes());
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

  function describePage(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      return { allowed: false, keyword: '', message: NOT_SEARCH_MESSAGE };
    }
    const path = parsed.pathname || '';
    const allowed = parsed.protocol === 'https:'
      && parsed.hostname === 'www.xiaohongshu.com'
      && (path === '/search_result' || path.startsWith('/search_result/'));
    if (!allowed) {
      return { allowed: false, keyword: '', message: NOT_SEARCH_MESSAGE };
    }
    return {
      allowed: true,
      keyword: parsed.searchParams.get('keyword') || '',
      message: '',
    };
  }

  function decideExport(options) {
    const notes = (options && options.notes) || [];
    const page = describePage(options && options.url);
    if (!page.allowed) {
      return { download: false, filename: '', message: page.message };
    }
    if (!notes.length) {
      return { download: false, filename: '', message: EMPTY_EXPORT_MESSAGE };
    }
    const keyword = options && options.keyword ? options.keyword : page.keyword;
    return {
      download: true,
      filename: formatExportFilename(keyword, options.now || new Date()),
      message: '',
    };
  }

  function panelView(count) {
    return {
      countText: '已捕获 ' + count + ' 条笔记',
      buttonText: '导出 Excel',
      hint: count === 0 ? EMPTY_EXPORT_MESSAGE : '',
    };
  }

  function renderPanel(container, view) {
    const doc = container.ownerDocument;
    container.textContent = '';
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
    container.append(count, button, hint);
    return { count, button, hint };
  }

  return {
    EMPTY_EXPORT_MESSAGE,
    NOT_SEARCH_MESSAGE,
    createStore,
    parseSearchResponse,
    parseVisibleCards,
    toTable,
    workbookBytes,
    formatExportFilename,
    describePage,
    decideExport,
    panelView,
    renderPanel,
  };
});
