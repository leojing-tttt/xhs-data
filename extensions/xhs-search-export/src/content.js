(function () {
  const api = globalThis.XhsSearchExport;
  if (!api || window.__xhsSearchExportContent) return;
  window.__xhsSearchExportContent = true;

  const session = api.createSession();
  const host = document.createElement('div');
  host.id = 'xhs-search-export-root';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = [
    '.panel {',
    '  box-sizing: border-box;',
    '  width: 100%;',
    '  padding: 14px 14px 12px;',
    '  border: 1px solid #e6e6e6;',
    '  border-radius: 12px;',
    '  background: #fff;',
    '  color: #222;',
    '  font: 14px/1.5 system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;',
    '  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);',
    '}',
    '.title { margin: 0 0 6px; font-weight: 600; }',
    '.mode {',
    '  display: inline-block;',
    '  margin: 0 0 8px;',
    '  padding: 2px 8px;',
    '  border-radius: 999px;',
    '  background: #fff1f2;',
    '  color: #ff2442;',
    '  font-size: 12px;',
    '  font-weight: 600;',
    '}',
    '.mode.recommend { background: #f3f4f6; color: #111; }',
    '.count, .hint { margin: 0; }',
    '.hint { margin-top: 8px; color: #666; font-size: 12px; }',
    'button {',
    '  margin-top: 10px;',
    '  width: 100%;',
    '  border: 0;',
    '  border-radius: 8px;',
    '  padding: 8px 12px;',
    '  background: #ff2442;',
    '  color: #fff;',
    '  font: inherit;',
    '  cursor: pointer;',
    '}',
    'button:disabled { opacity: 0.6; cursor: default; }',
  ].join('\n');
  const panel = document.createElement('section');
  panel.className = 'panel';
  const title = document.createElement('p');
  title.className = 'title';
  title.textContent = '小红书导出';
  const body = document.createElement('div');
  panel.append(title, body);
  shadow.append(style, panel);

  let seenHref = location.href;

  function currentPage() {
    return api.describePage(location.href);
  }

  function ensureHost() {
    api.mountPanelHost(document, host);
    const rect = host.getBoundingClientRect();
    const offscreen = rect.height > 0 && (rect.top >= window.innerHeight || rect.bottom <= 0);
    if (!offscreen) return;
    const top = window.scrollY + Math.max(0, window.innerHeight - (host.offsetHeight || 120) - 24);
    const left = window.scrollX + Math.max(0, window.innerWidth - (host.offsetWidth || 260) - 24);
    host.style.setProperty('position', 'absolute', 'important');
    host.style.setProperty('top', top + 'px', 'important');
    host.style.setProperty('left', left + 'px', 'important');
    host.style.setProperty('right', 'auto', 'important');
    host.style.setProperty('bottom', 'auto', 'important');
  }

  function activeStore(page) {
    return session.storeFor(page);
  }

  let seenMode = '';

  function rememberLeaving(page) {
    if (!page.mode || page.mode === seenMode) return;
    if (seenMode) session.holdVisible(api.parseVisibleCards(document));
    seenMode = page.mode;
  }

  function paint(hintOverride) {
    const page = currentPage();
    if (!page.allowed) {
      host.remove();
      return;
    }
    rememberLeaving(page);
    const store = activeStore(page);
    if (page.mode === 'search') store.setKeyword(page.keyword);
    session.useVisibleCards(page, document);
    ensureHost();
    const view = api.panelView(store.list().length, page);
    title.textContent = view.title;
    if (hintOverride) view.hint = hintOverride;
    const parts = api.renderPanel(body, view);
    parts.button.addEventListener('click', function () {
      exportNotes();
    });
  }

  function exportNotes() {
    const page = currentPage();
    if (!page.allowed) {
      return { download: false, filename: '', message: page.message };
    }
    rememberLeaving(page);
    const store = activeStore(page);
    if (page.mode === 'search') store.setKeyword(page.keyword);
    session.useVisibleCards(page, document);
    const decision = api.decideExport({
      notes: store.list(),
      url: location.href,
      now: new Date(),
      keyword: page.keyword || store.keyword,
    });
    if (!decision.download) {
      paint(decision.message);
      return decision;
    }
    try {
      const bytes = api.workbookBytes(store.list(), globalThis.XLSX, { mode: page.mode });
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = decision.filename;
      link.rel = 'noopener';
      document.documentElement.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () {
        URL.revokeObjectURL(objectUrl);
      }, 1500);
      paint('已开始下载 ' + decision.filename);
      return decision;
    } catch (error) {
      const failed = { download: false, filename: '', message: '导出失败，请刷新页面后再试。' };
      paint(failed.message);
      return failed;
    }
  }

  window.addEventListener('message', function (event) {
    if (event.origin && event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== 'xhs-search-export') return;
    const page = currentPage();
    if (!page.allowed) {
      host.remove();
      return;
    }
    if (data.type === 'url-change') {
      if (page.mode === 'search') activeStore(page).setKeyword(page.keyword);
      paint();
      return;
    }
    const kind = data.type === 'feed-notes-response'
      ? 'recommend'
      : (data.type === 'search-notes-response' ? 'search' : '');
    if (!kind || kind !== page.mode) return;
    const store = activeStore(page);
    if (page.mode === 'search') store.setKeyword(page.keyword);
    store.ingestPayload(data.body);
    paint();
  });

  if (globalThis.chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      const page = currentPage();
      if (!message || message.type === 'xhs-export-state') {
        const view = api.panelView(page.allowed ? activeStore(page).list().length : 0, page);
        sendResponse({
          onSearchPage: page.allowed,
          onListPage: page.allowed,
          mode: page.mode,
          modeLabel: view.modeLabel,
          count: page.allowed ? activeStore(page).list().length : 0,
          countText: view.countText,
          hint: view.hint,
          keyword: page.keyword,
        });
        return;
      }
      if (message.type === 'xhs-export-run') {
        sendResponse(exportNotes());
      }
    });
  }

  function boot() {
    const page = currentPage();
    if (page.mode === 'search') activeStore(page).setKeyword(page.keyword);
    paint();
    setInterval(function () {
      const href = location.href;
      if (href !== seenHref) {
        seenHref = href;
        const next = currentPage();
        if (next.mode === 'search') activeStore(next).setKeyword(next.keyword);
        paint();
        return;
      }
      const current = currentPage();
      if (!current.allowed) return;
      rememberLeaving(current);
      const store = activeStore(current);
      if (!host.isConnected) paint();
      else if (!store.apiRecognized) session.useVisibleCards(current, document);
      else ensureHost();
    }, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
