(function () {
  if (window.__xhsSearchExportMain) return;
  window.__xhsSearchExportMain = true;

  const SOURCE = 'xhs-search-export';

  function onSearchPage() {
    return location.hostname === 'www.xiaohongshu.com'
      && (location.pathname === '/search_result' || location.pathname.indexOf('/search_result/') === 0);
  }

  function interesting(url) {
    return typeof url === 'string' && url.indexOf('search/notes') !== -1;
  }

  function emit(type, extra) {
    if (!onSearchPage()) return;
    const message = { source: SOURCE, type: type };
    if (extra) {
      Object.keys(extra).forEach(function (key) {
        message[key] = extra[key];
      });
    }
    window.postMessage(message, location.origin);
  }

  function requestUrl(input, response) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    if (response && typeof response.url === 'string') return response.url;
    return '';
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function () {
      const args = arguments;
      let pending;
      try {
        pending = originalFetch.apply(this, args);
      } catch (error) {
        return Promise.reject(error);
      }
      return Promise.resolve(pending).then(function (response) {
        try {
          const url = requestUrl(args[0], response);
          if (interesting(url) && response && typeof response.clone === 'function') {
            response.clone().text().then(function (text) {
              emit('search-notes-response', { url: String(url), body: text });
            }).catch(function () {});
          }
        } catch (error) {}
        return response;
      });
    };
  }

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__xhsSearchExportUrl = url;
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try {
        const url = this.__xhsSearchExportUrl || '';
        if (!interesting(String(url))) return;
        let body = '';
        try {
          body = this.responseText;
        } catch (error) {
          body = '';
        }
        if (!body && this.response && typeof this.response === 'object') {
          try {
            body = JSON.stringify(this.response);
          } catch (error) {
            body = '';
          }
        }
        if (body) emit('search-notes-response', { url: String(url), body: body });
      } catch (error) {}
    });
    return xhrSend.apply(this, arguments);
  };

  function notifyUrl() {
    emit('url-change', { href: location.href });
  }

  const pushState = history.pushState;
  const replaceState = history.replaceState;
  if (typeof pushState === 'function') {
    history.pushState = function () {
      const result = pushState.apply(this, arguments);
      notifyUrl();
      return result;
    };
  }
  if (typeof replaceState === 'function') {
    history.replaceState = function () {
      const result = replaceState.apply(this, arguments);
      notifyUrl();
      return result;
    };
  }
  window.addEventListener('popstate', notifyUrl);
})();
