(function () {
  if (window.__xhsSearchExportMain) return;
  window.__xhsSearchExportMain = true;

  const SOURCE = 'xhs-search-export';
  const MARK = '__xhsSearchExportHook';

  function pageMode() {
    const host = location.hostname;
    if (host !== 'www.xiaohongshu.com' && host !== 'xiaohongshu.com') return '';
    const path = location.pathname || '/';
    if (path === '/search_result' || path.indexOf('/search_result/') === 0) return 'search';
    if (path === '/' || path === '/explore' || path === '/explore/') return 'recommend';
    return '';
  }

  function responseKind(url) {
    const text = String(url || '');
    if (text.indexOf('search/notes') !== -1) return 'search';
    if (text.indexOf('/homefeed') !== -1) return 'recommend';
    return '';
  }

  function emit(type, extra) {
    if (type !== 'url-change' && !pageMode()) return;
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
    const kind = responseKind(url);
    if (!kind || kind !== pageMode() || !body) return;
    const type = kind === 'recommend' ? 'feed-notes-response' : 'search-notes-response';
    emit(type, { url: String(url), body: body });
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
  const lastRequests = { search: null, recommend: null };
  const inflight = { search: 0, recommend: 0 };
  let sendingNext = false;
  let replayDepth = 0;

  function markStart(kind) {
    if (kind === 'search' || kind === 'recommend') inflight[kind] += 1;
  }

  function markEnd(kind) {
    if ((kind === 'search' || kind === 'recommend') && inflight[kind] > 0) inflight[kind] -= 1;
  }

  function bodyText(body) {
    if (body == null) return '';
    if (typeof body === 'string') return body;
    try {
      return JSON.stringify(body);
    } catch (error) {
      return '';
    }
  }

  function sameApi(left, right) {
    try {
      const base = location.href;
      const a = new URL(String(left), base);
      const b = new URL(String(right), base);
      return a.origin === b.origin && a.pathname === b.pathname;
    } catch (error) {
      return String(left) === String(right);
    }
  }

  function captureRequest(url, method, body) {
    const kind = responseKind(url);
    if (!kind || kind !== pageMode()) return;
    const record = {
      url: String(url),
      method: method || 'POST',
      body: bodyText(body),
    };
    lastRequests[kind] = record;
    markStart(kind);
    emit('page-request', { kind: kind, url: record.url, method: record.method, body: record.body });
  }

  function dispatchNext(request) {
    const kind = responseKind(request && request.url);
    const last = kind && lastRequests[kind];
    if (!kind || !last || !sameApi(last.url, request.url) || typeof request.body !== 'string') {
      emit('next-page-failed', {});
      return;
    }
    if (inflight[kind] > 0 || sendingNext) {
      emit('next-page-waiting', {});
      return;
    }
    sendingNext = true;
    markStart(kind);
    let xhr;
    try {
      xhr = new slots.XHR();
    } catch (error) {
      sendingNext = false;
      emit('next-page-failed', {});
      return;
    }
    const open = xhr.open;
    const send = xhr.send;
    try {
      open.call(xhr, request.method || 'POST', request.url, true);
      xhr.setRequestHeader('content-type', 'application/json;charset=UTF-8');
    } catch (error) {}
    remember(xhr, request.url);
    watch(xhr);
    xhr.addEventListener('loadend', function () {
      sendingNext = false;
      markEnd(kind);
    });
    try {
      replayDepth += 1;
      send.call(xhr, request.body);
    } catch (error) {
      sendingNext = false;
      markEnd(kind);
      emit('next-page-failed', {});
    } finally {
      replayDepth -= 1;
    }
    setTimeout(function () {
      if (!sendingNext) return;
      sendingNext = false;
      markEnd(kind);
    }, 8000);
  }

  function wrappedFetch(input, init) {
    let startedKind = '';
    try {
      const method = (init && init.method) || (input && input.method) || 'GET';
      const url = requestUrl(input, null);
      const kind = responseKind(url);
      const before = kind ? inflight[kind] : 0;
      captureRequest(url, method, init && init.body);
      if (kind && inflight[kind] > before) startedKind = kind;
    } catch (error) {}
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
        if (responseKind(url) && response && typeof response.clone === 'function') {
          response.clone().text().then(function (text) {
            publish(url, text);
          }).catch(function () {});
        }
      } catch (error) {}
      return response;
    }).finally(function () {
      if (startedKind) markEnd(startedKind);
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
        try {
          xhr.__xhsSearchExportMethod = method;
        } catch (error) {}
        return open.apply(xhr, arguments);
      };
    }
    if (typeof send === 'function') {
      xhr.send = function (body) {
        if (replayDepth > 0) return send.apply(xhr, arguments);
        captureRequest(xhr.__xhsSearchExportUrl || '', xhr.__xhsSearchExportMethod || 'POST', body);
        watch(xhr);
        const kind = responseKind(xhr.__xhsSearchExportUrl || '');
        xhr.addEventListener('loadend', function () {
          markEnd(kind);
        });
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
  window.addEventListener('message', function (event) {
    if (event.origin && event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== SOURCE || data.type !== 'send-next-page') return;
    dispatchNext(data.request || {});
  });
})();
