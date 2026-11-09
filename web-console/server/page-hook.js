// Runs inside the Xiaohongshu tab. It records the page's own search/notes
// traffic and replays that captured request for the next page.
// It does not invent a request and it does not add filter fields.

export function isSearchNotesUrl(url) {
  return String(url || '').indexOf('search/notes') !== -1;
}

export function pageHookSource() {
  return `(function () {
  if (window.__xhsWebConsole) return;
  var state = {
    events: [],
    inflight: 0,
    sending: false,
    slots: { fetch: window.fetch, XHR: window.XMLHttpRequest }
  };
  var MARK = '__xhsWebConsoleHook';

  function allowed() {
    var host = location.hostname;
    if (host !== 'www.xiaohongshu.com' && host !== 'xiaohongshu.com') return false;
    var path = location.pathname || '/';
    if (path === '/search_result' || path.indexOf('/search_result/') === 0) return true;
    if (path === '/search_result_ai' || path.indexOf('/search_result_ai/') === 0) return true;
    return false;
  }

  function isSearch(url) {
    return String(url || '').indexOf('search/notes') !== -1;
  }

  function emit(event) {
    state.events.push(event);
  }

  function requestUrl(input, response) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    if (response && typeof response.url === 'string') return response.url;
    return '';
  }

  function bodyText(body) {
    if (body == null) return '';
    if (typeof body === 'string') return body;
    try { return JSON.stringify(body); } catch (error) { return ''; }
  }

  function sameApi(left, right) {
    try {
      var a = new URL(String(left), location.href);
      var b = new URL(String(right), location.href);
      return a.origin === b.origin && a.pathname === b.pathname;
    } catch (error) {
      return String(left) === String(right);
    }
  }

  function readXhrBody(xhr) {
    var body = '';
    try { body = xhr.responseText; } catch (error) { body = ''; }
    if (!body && xhr.response && typeof xhr.response === 'object') {
      try { body = JSON.stringify(xhr.response); } catch (error) { body = ''; }
    }
    return body;
  }

  function capture(url, method, body) {
    if (!allowed() || !isSearch(url)) return;
    state.lastUrl = String(url);
    state.inflight += 1;
    emit({ type: 'request', url: String(url), method: method || 'POST', body: bodyText(body) });
  }

  function publish(url, body) {
    if (!allowed() || !isSearch(url) || !body) return;
    emit({ type: 'response', url: String(url), body: body });
  }

  function markEnd() {
    if (state.inflight > 0) state.inflight -= 1;
  }

  function dispatchNext(request) {
    if (!request || typeof request.body !== 'string' || !request.url || !isSearch(request.url)) {
      emit({ type: 'next-failed' });
      return;
    }
    if (!state.lastUrl || !sameApi(state.lastUrl, request.url)) {
      emit({ type: 'next-failed' });
      return;
    }
    if (state.inflight > 0 || state.sending) {
      emit({ type: 'next-waiting' });
      return;
    }
    state.sending = true;
    state.inflight += 1;
    var xhr;
    try { xhr = new state.slots.XHR(); } catch (error) {
      state.sending = false;
      markEnd();
      emit({ type: 'next-failed' });
      return;
    }
    try {
      xhr.open(request.method || 'POST', request.url, true);
      xhr.setRequestHeader('content-type', 'application/json;charset=UTF-8');
    } catch (error) {}
    function finish() {
      if (xhr.__xhsDone) return;
      var body = readXhrBody(xhr);
      if (!body) return;
      xhr.__xhsDone = true;
      publish(request.url, body);
    }
    xhr.addEventListener('load', finish);
    xhr.addEventListener('readystatechange', function () {
      if (xhr.readyState === 4) finish();
    });
    xhr.addEventListener('loadend', function () {
      state.sending = false;
      markEnd();
    });
    try { xhr.send(request.body); } catch (error) {
      state.sending = false;
      markEnd();
      emit({ type: 'next-failed' });
    }
    setTimeout(function () {
      if (!state.sending) return;
      state.sending = false;
      markEnd();
    }, 8000);
  }

  function wrappedFetch(input, init) {
    var started = false;
    try {
      var method = (init && init.method) || (input && input.method) || 'GET';
      var url = requestUrl(input, null);
      var before = state.inflight;
      capture(url, method, init && init.body);
      started = state.inflight > before;
    } catch (error) {}
    var args = arguments;
    var current = state.slots.fetch;
    var pending;
    try {
      pending = typeof current === 'function' ? current.apply(this, args) : Promise.reject(new TypeError('fetch'));
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve(pending).then(function (response) {
      try {
        var url = requestUrl(args[0], response);
        if (isSearch(url) && response && typeof response.clone === 'function') {
          response.clone().text().then(function (text) { publish(url, text); }).catch(function () {});
        }
      } catch (error) {}
      return response;
    }).finally(function () {
      if (started) markEnd();
    });
  }
  wrappedFetch[MARK] = true;

  function WrappedXHR() {
    var xhr = new state.slots.XHR();
    var open = xhr.open;
    var send = xhr.send;
    if (typeof open === 'function') {
      xhr.open = function (method, url) {
        try { xhr.__xhsUrl = url; xhr.__xhsMethod = method; } catch (error) {}
        return open.apply(xhr, arguments);
      };
    }
    if (typeof send === 'function') {
      xhr.send = function (body) {
        var url = xhr.__xhsUrl || '';
        var before = state.inflight;
        capture(url, xhr.__xhsMethod || 'POST', body);
        var tracked = state.inflight > before;
        function finish() {
          if (xhr.__xhsDone) return;
          var text = readXhrBody(xhr);
          if (!text) return;
          xhr.__xhsDone = true;
          publish(url, text);
        }
        xhr.addEventListener('load', finish);
        xhr.addEventListener('readystatechange', function () {
          if (xhr.readyState === 4) finish();
        });
        xhr.addEventListener('loadend', function () {
          if (tracked) markEnd();
        });
        return send.apply(xhr, arguments);
      };
    }
    return xhr;
  }
  WrappedXHR[MARK] = true;
  try { WrappedXHR.prototype = state.slots.XHR.prototype; } catch (error) {}

  function trap(name, slot, exposed) {
    var existing = Object.getOwnPropertyDescriptor(window, name);
    if (existing && existing.get && existing.get[MARK]) return;
    var current = window[name];
    if (typeof current === 'function' && current !== exposed) state.slots[slot] = current;
    function getter() { return exposed; }
    getter[MARK] = true;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get: getter,
        set: function (value) {
          if (typeof value === 'function' && value !== exposed) state.slots[slot] = value;
        }
      });
    } catch (error) {}
  }

  function bindAll() {
    try { trap('fetch', 'fetch', wrappedFetch); } catch (error) {}
    try { trap('XMLHttpRequest', 'XHR', WrappedXHR); } catch (error) {}
  }

  bindAll();
  window.__xhsWebConsoleTimer = setInterval(bindAll, 300);
  window.__xhsWebConsole = {
    take: function () {
      if (!state.events.length) return '';
      return JSON.stringify(state.events.splice(0, state.events.length));
    },
    sendNext: function (payload) {
      var request = typeof payload === 'string' ? JSON.parse(payload) : payload;
      dispatchNext(request || {});
    }
  };
})();`;
}
