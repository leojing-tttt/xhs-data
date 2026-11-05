(function () {
  const api = globalThis.XhsSearchExport;
  const statusEl = document.getElementById('status');
  const hintEl = document.getElementById('hint');
  const button = document.getElementById('export');

  function showBlocked(text) {
    statusEl.textContent = text;
    hintEl.textContent = '';
    button.hidden = true;
  }

  function showState(state) {
    const label = state.modeLabel ? state.modeLabel + ' · ' : '';
    statusEl.textContent = label + state.countText;
    hintEl.textContent = state.hint || '';
    button.hidden = false;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const tab = tabs && tabs[0];
    if (!tab || tab.id == null) {
      showBlocked(api.NOT_SEARCH_MESSAGE);
      return;
    }
    if (tab.url) {
      const gate = api.describePage(tab.url);
      if (!gate.allowed) {
        showBlocked(gate.message);
        return;
      }
    }

    chrome.tabs.sendMessage(tab.id, { type: 'xhs-export-state' }, function (state) {
      if (chrome.runtime.lastError || !state || !state.onSearchPage) {
        showBlocked(api.NOT_SEARCH_MESSAGE);
        return;
      }
      showState(state);
      button.addEventListener('click', function () {
        button.disabled = true;
        chrome.tabs.sendMessage(tab.id, { type: 'xhs-export-run' }, function (result) {
          button.disabled = false;
          if (chrome.runtime.lastError || !result) {
            hintEl.textContent = '没有完成导出。请刷新当前页面后再试。';
            return;
          }
          hintEl.textContent = result.download
            ? '已开始下载 ' + result.filename
            : result.message;
        });
      });
    });
  });
})();
