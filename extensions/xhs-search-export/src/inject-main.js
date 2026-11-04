(function () {
  if (window.__xhsSearchExportMain) return;
  window.__xhsSearchExportMain = true;

  const SOURCE = 'xhs-search-export';
  const MARK = '__xhsSearchExportHook';

  function onSearchPage() {
    const host = location.hostname;
    const knownHost = host === 'www.xiaohongshu.com' || host === 'xiaohongshu.com';
    const path = location.pathname || '';
    return knownHost && (path === '/search_result' || path.indexOf('/search_result/') === 0);
  }

  function interesting(url) {
    return typeof url === 'string' && url.indexOf('search/notes') !== -1;
  }

  function emit(type, extra) {
    if (type !== 'url-change' && !onSearchPage()) return;
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

  function publish(url, body) {
    if (!interesting(String(url)) || !body) return;
    emit('search-notes-response', { url: String(url), body: body });
  }

  function readXhrBody(xhr) {
    let body = '';
    try {
      body = xhr.responseText;
    } catch (error) {
      body = '';
    }
    if (!body && xhr.response && typeof xhr.response === 'object') {
      try {
        body = JSON.stringify(xhr.response);
      } catch (error) {
        body = '';
      }
    }
    return body;
  }

  const slots = {
    fetch: window.fetch,
    XHR: window.XMLHttpRequest,
  };

  function wrappedFetch() {
    const args = arguments;
    const current = slots.fetch;
    let pending;
    try {
      pending = typeof current === 'function' ? current.apply(this, args) : Promise.reject(new TypeError('fetch'));
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve(pending).then(function (response) {
      try {
        const url = requestUrl(args[0], response);
        if (interesting(url) && response && typeof response.clone === 'function') {
          response.clone().text().then(function (text) {
            publish(url, text);
          }).catch(function () {});
        }
      } catch (error) {}
      return response;
    });
  }
  wrappedFetch[MARK] = true;

  function remember(xhr, url) {
    try {
      xhr.__xhsSearchExportUrl = url;
    } catch (error) {}
  }

  function watch(xhr) {
    if (!xhr || xhr[MARK]) return xhr;
    try {
      xhr[MARK] = true;
    } catch (error) {}
    function finish() {
      if (xhr.__xhsSearchExportDone) return;
      const body = readXhrBody(xhr);
      if (!body) return;
      xhr.__xhsSearchExportDone = true;
      publish(xhr.__xhsSearchExportUrl || '', body);
    }
    xhr.addEventListener('load', finish);
    xhr.addEventListener('readystatechange', function () {
      if (xhr.readyState === 4) finish();
    });
    return xhr;
  }

  function WrappedXHR() {
    const Ctor = slots.XHR;
    const xhr = new Ctor();
    const open = xhr.open;
    const send = xhr.send;
    if (typeof open === 'function') {
      xhr.open = function (method, url) {
        remember(xhr, url);
        return open.apply(xhr, arguments);
      };
    }
    if (typeof send === 'function') {
      xhr.send = function () {
        watch(xhr);
        return send.apply(xhr, arguments);
      };
    }
    return xhr;
  }
  WrappedXHR[MARK] = true;
  try {
    WrappedXHR.prototype = slots.XHR.prototype;
  } catch (error) {}

  function trap(owner, name, slot, exposed) {
    const existing = Object.getOwnPropertyDescriptor(owner, name);
    if (existing && existing.get && existing.get[MARK]) return;
    const current = owner[name];
    if (typeof current === 'function' && current !== exposed) slots[slot] = current;
    function getter() {
      return exposed;
    }
    getter[MARK] = true;
    try {
      Object.defineProperty(owner, name, {
        configurable: true,
        enumerable: true,
        get: getter,
        set: function (value) {
          if (typeof value === 'function' && value !== exposed) slots[slot] = value;
        },
      });
    } catch (error) {}
  }

  function bindAll() {
    try {
      trap(window, 'fetch', 'fetch', wrappedFetch);
    } catch (error) {}
    try {
      trap(window, 'XMLHttpRequest', 'XHR', WrappedXHR);
    } catch (error) {}
  }

  bindAll();
  window.__xhsSearchExportTimer = setInterval(bindAll, 300);

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
