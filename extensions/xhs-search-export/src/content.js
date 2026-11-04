(function () {
  const api = globalThis.XhsSearchExport;
  if (!api || window.__xhsSearchExportContent) return;
  window.__xhsSearchExportContent = true;

  const store = api.createStore();
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
  title.textContent = '小红书搜索导出';
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

  function paint(hintOverride) {
    const page = currentPage();
    if (!page.allowed) {
      host.remove();
      return;
    }
    store.setKeyword(page.keyword);
    if (!store.apiRecognized) store.useVisibleCards(document);
    ensureHost();
    const view = api.panelView(store.list().length);
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
    store.setKeyword(page.keyword);
    if (!store.apiRecognized) store.useVisibleCards(document);
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
      const bytes = api.workbookBytes(store.list(), globalThis.XLSX);
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
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'xhs-search-export') return;
    const page = currentPage();
    if (!page.allowed) {
      host.remove();
      return;
    }
    if (data.type === 'url-change') {
      store.setKeyword(page.keyword);
      paint();
      return;
    }
    if (data.type === 'search-notes-response') {
      store.setKeyword(page.keyword);
      store.ingestPayload(data.body);
      paint();
    }
  });

  if (globalThis.chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      const page = currentPage();
      if (!message || message.type === 'xhs-export-state') {
        const view = api.panelView(page.allowed ? store.list().length : 0);
        sendResponse({
          onSearchPage: page.allowed,
          count: page.allowed ? store.list().length : 0,
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
    if (page.allowed) store.setKeyword(page.keyword);
    paint();
    setInterval(function () {
      const href = location.href;
      if (href !== seenHref) {
        seenHref = href;
        const next = currentPage();
        if (next.allowed) store.setKeyword(next.keyword);
        paint();
        return;
      }
      if (!currentPage().allowed) return;
      if (!host.isConnected) paint();
      else if (!store.apiRecognized) store.useVisibleCards(document);
      else ensureHost();
    }, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
