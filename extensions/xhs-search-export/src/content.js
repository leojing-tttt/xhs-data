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
    ':host { all: initial; }',
    '.panel {',
    '  position: fixed;',
    '  right: 24px;',
    '  bottom: 24px;',
    '  z-index: 2147483647;',
    '  width: 260px;',
    '  box-sizing: border-box;',
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

  let refreshTimer = 0;
  let observer = null;

  function currentPage() {
    return api.describePage(location.href);
  }

  function ensureHost() {
    if (host.isConnected) return;
    const parent = document.body || document.documentElement;
    if (parent) parent.appendChild(host);
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
    if (store.apiRecognized && observer) observer.disconnect();
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

  function schedulePaint() {
    if (store.apiRecognized) {
      if (observer) observer.disconnect();
      return;
    }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(paint, 400);
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
    if (!document.documentElement) return;
    observer = new MutationObserver(schedulePaint);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
