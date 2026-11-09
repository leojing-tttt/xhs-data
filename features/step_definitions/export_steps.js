const { Given, When, Then, Before } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const model = require('../../extensions/xhs-search-export/src/model');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

Before(function () {
  this.store = model.createStore();
  this.notice = '';
  this.exportResult = null;
  this.table = null;
  this.workbookCheck = null;
  this.pageUrl = '';
  this.now = new Date(2026, 10, 4, 3, 56, 0);
  this.keywordOverride = null;
  this.document = null;
  this.filename = null;
  this.page = null;
  this.panel = null;
  this.payloadText = '';
});

function readFixture(name) {
  const full = path.join(FIXTURES, name);
  if (!fs.existsSync(full)) {
    throw new Error('夹具不存在: ' + name);
  }
  return fs.readFileSync(full, 'utf8');
}

function noteAt(world, index) {
  const notes = world.store.list();
  assert.ok(notes[index - 1], '没有第 ' + index + ' 条笔记');
  return notes[index - 1];
}

Given('已有搜索接口响应夹具{string}', function (name) {
  this.payloadText = readFixture(name);
});

Given('已有可见卡片夹具{string}', function (name) {
  const html = readFixture(name);
  this.document = new JSDOM(html, {
    url: 'https://www.xiaohongshu.com/search_result?keyword=test',
  }).window.document;
});

Given('当前页面地址为{string}', function (url) {
  this.pageUrl = url;
});

Given('本地时间为{string}', function (stamp) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(stamp);
  if (!match) {
    throw new Error('时间格式无法解析: ' + stamp);
  }
  this.now = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    0
  );
});

Given('当前没有捕获到笔记', function () {
  assert.equal(this.store.list().length, 0);
});

Given('当前搜索关键词为{string}', function (keyword) {
  this.store.setKeyword(keyword);
});

Given('搜索关键词为{string}', function (keyword) {
  this.keywordOverride = keyword;
});

When('解析该搜索响应', function () {
  this.store.ingestPayload(this.payloadText);
});

When('再解析搜索接口响应夹具{string}', function (name) {
  this.store.ingestPayload(readFixture(name));
});

When('映射为Excel行并生成工作簿', function () {
  const notes = this.store.list();
  this.table = model.toTable(notes);
  const XLSX = require('../../extensions/xhs-search-export/vendor/xlsx.full.min.js');
  const bytes = model.workbookBytes(notes, XLSX, { mode: this.page && this.page.mode });
  const book = XLSX.read(bytes, { type: 'array' });
  const sheetName = book.SheetNames[0];
  this.workbookCheck = {
    sheetName,
    aoa: XLSX.utils.sheet_to_json(book.Sheets[sheetName], { header: 1, raw: false }),
  };
});

When('用户请求导出', function () {
  this.exportResult = model.decideExport({
    notes: this.store.list(),
    url: this.pageUrl,
    now: this.now,
    keyword: this.keywordOverride,
  });
  this.notice = this.exportResult.message || '';
  this.filename = this.exportResult.download ? this.exportResult.filename : null;
});

When('生成导出文件名', function () {
  this.filename = model.formatExportFilename(this.keywordOverride, this.now);
});

When('判断扩展是否可用', function () {
  this.page = model.describePage(this.pageUrl);
  this.notice = this.page.message || '';
});

When('解析该搜索响应并在无法识别时回退可见卡片', function () {
  const result = this.store.ingestPayload(this.payloadText);
  if (!result.recognized) {
    this.store.useVisibleCards(this.document);
  }
});

When('按可见卡片刷新捕获', function () {
  this.store.useVisibleCards(this.document);
});

When('页面换掉请求方法后又收到该搜索响应', async function () {
  const payload = this.payloadText;
  const messages = [];
  const nativeFetch = function (url) {
    return Promise.resolve({
      url: String(url),
      clone() {
        return this;
      },
      text() {
        return Promise.resolve(payload);
      },
    });
  };
  const location = {
    hostname: 'www.xiaohongshu.com',
    pathname: '/search_result',
    origin: 'https://www.xiaohongshu.com',
    href: 'https://www.xiaohongshu.com/search_result?keyword=test',
  };
  const history = { pushState() {}, replaceState() {} };
  const sandbox = {
    window: {
      location,
      history,
      addEventListener() {},
      postMessage(data) {
        messages.push(data);
      },
      fetch: nativeFetch,
    },
    setInterval,
    clearInterval,
    location,
    history,
  };
  function XMLHttpRequest() {}
  XMLHttpRequest.prototype.open = function () {};
  XMLHttpRequest.prototype.send = function () {};
  sandbox.XMLHttpRequest = XMLHttpRequest;
  sandbox.window.XMLHttpRequest = XMLHttpRequest;
  vm.createContext(sandbox);
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'extensions', 'xhs-search-export', 'src', 'inject-main.js'),
    'utf8'
  );
  vm.runInContext(source, sandbox);
  sandbox.window.fetch = function (url) {
    return nativeFetch(url);
  };
  await new Promise((resolve) => setTimeout(resolve, 350));
  await sandbox.window.fetch('https://edith.xiaohongshu.com/api/sns/web/v1/search/notes');
  await new Promise((resolve) => setTimeout(resolve, 30));
  if (sandbox.window.__xhsSearchExportTimer) {
    clearInterval(sandbox.window.__xhsSearchExportTimer);
  }
  const message = messages.find((item) => item && item.type === 'search-notes-response');
  assert.ok(message, '换掉请求方法后没有再读到搜索响应');
  this.store.ingestPayload(message.body);
});

When('搜索关键词变为{string}', function (keyword) {
  this.store.setKeyword(keyword);
});

When('渲染页内面板', function () {
  const page = this.pageUrl ? model.describePage(this.pageUrl) : null;
  const view = model.panelView(this.store.list().length, page);
  const dom = new JSDOM('<!DOCTYPE html><div id="host"></div>');
  const host = dom.window.document.getElementById('host');
  this.panel = model.renderPanel(host, view);
  this.panelTitle = view.title;
  this.notice = view.hint || this.notice;
});

function exportSession(world) {
  if (!world.exportSession) world.exportSession = model.createSession();
  return world.exportSession;
}

When('把该响应作为{string}记入当前列表', function (label) {
  const page = model.describePage(this.pageUrl);
  const kind = label === '推荐' ? 'recommend' : 'search';
  exportSession(this).ingest(page, this.payloadText, kind);
  this.page = page;
  this.store = exportSession(this).storeFor(page);
});

When('查看当前列表', function () {
  const page = model.describePage(this.pageUrl);
  this.page = page;
  this.store = exportSession(this).storeFor(page);
});

When('把这些卡片记成刚离开的列表', function () {
  exportSession(this).holdVisible(model.parseVisibleCards(this.document));
});

When('用仍在页面上的卡片刷新当前列表', function () {
  const page = model.describePage(this.pageUrl);
  this.page = page;
  exportSession(this).useVisibleCards(page, this.document);
  this.store = exportSession(this).storeFor(page);
});

Then('捕获到{int}条笔记', function (count) {
  assert.equal(this.store.list().length, count);
});

Then('第{int}条笔记的笔记ID为{string}', function (index, id) {
  assert.equal(noteAt(this, index).id, id);
});

Then('第{int}条笔记的标题为{string}', function (index, title) {
  assert.equal(noteAt(this, index).title, title);
});

Then('第{int}条笔记的作者为{string}', function (index, author) {
  assert.equal(noteAt(this, index).author, author);
});

Then('第{int}条笔记的作者ID为{string}', function (index, authorId) {
  assert.equal(noteAt(this, index).authorId, authorId);
});

Then('第{int}条笔记的作者主页为{string}', function (index, profile) {
  assert.equal(noteAt(this, index).profile || '', profile);
});

Then('第{int}条笔记的点赞数为{string}', function (index, likes) {
  assert.equal(String(noteAt(this, index).likes), likes);
});

Then('第{int}条笔记的笔记类型为{string}', function (index, type) {
  assert.equal(noteAt(this, index).type, type);
});

Then('第{int}条笔记的封面图为{string}', function (index, cover) {
  assert.equal(noteAt(this, index).cover, cover);
});

Then('第{int}条笔记的笔记链接为{string}', function (index, link) {
  assert.equal(noteAt(this, index).link, link);
});

Then('笔记ID依次为{string}', function (csv) {
  assert.deepEqual(
    this.store.list().map((note) => note.id),
    csv.split(',')
  );
});

Then('表头依次为{string}', function (csv) {
  assert.deepEqual(this.table.headers, csv.split(','));
});

Then('表头包含{string}', function (header) {
  assert.ok(this.table.headers.includes(header), this.table.headers.join(','));
});

Then('数据行数为{int}', function (count) {
  assert.equal(this.table.rows.length, count);
});

Then('第{int}条数据的标题为{string}', function (index, title) {
  const column = this.table.headers.indexOf('标题');
  assert.equal(this.table.rows[index - 1][column], title);
});

Then('第{int}条数据的作者主页为{string}', function (index, profile) {
  const column = this.table.headers.indexOf('作者主页');
  assert.ok(column >= 0, this.table.headers.join(','));
  assert.equal(this.table.rows[index - 1][column] || '', profile);
});

Then('工作簿工作表名为{string}', function (name) {
  assert.equal(this.workbookCheck.sheetName, name);
});

Then('工作簿第1行表头与导出表头一致', function () {
  assert.deepEqual(this.workbookCheck.aoa[0], this.table.headers);
});

Then('工作簿第2行笔记ID为{string}', function (id) {
  const headers = this.workbookCheck.aoa[0];
  const column = headers.indexOf('笔记ID');
  assert.equal(String(this.workbookCheck.aoa[1][column]), id);
});

Then('会生成文件', function () {
  assert.equal(this.exportResult.download, true);
});

Then('不生成文件', function () {
  assert.equal(this.exportResult.download, false);
  assert.equal(this.filename, null);
});

Then('文件名为{string}', function (name) {
  assert.equal(this.filename, name);
});

Then('提示包含{string}', function (text) {
  assert.ok(String(this.notice).includes(text), String(this.notice));
});

Then('面板文案包含{string}', function (text) {
  const parts = [this.panelTitle, this.panel.mode, this.panel.count, this.panel.targetLabel, this.panel.hint]
    .filter(Boolean)
    .map((node) => (typeof node === 'string' ? node : node.textContent))
    .join('\n');
  assert.ok(parts.includes(text), parts);
});

Then('目标条数输入为{string}', function (value) {
  assert.ok(this.panel.target, '面板上没有条数输入');
  assert.equal(this.panel.target.value, value);
});

When('解析导出条数{string}', function (raw) {
  this.targetParsed = model.parseExportTarget(raw);
});

Then('采用条数{int}', function (count) {
  assert.equal(this.targetParsed.ok, true);
  assert.equal(this.targetParsed.target, count);
});

Given('已记下页面自己的{string}请求{string}', function (label, name) {
  const page = model.describePage(this.pageUrl);
  const kind = label === '推荐' ? 'recommend' : 'search';
  const request = JSON.parse(readFixture(name));
  exportSession(this).notePageRequest(Object.assign({}, page, { mode: kind }), request);
});

Given('后续页面依次返回{string}', function (list) {
  this.nextPages = list.split(',').map((item) => item.trim()).filter(Boolean);
});

Given('补齐过程中改去{string}', function (url) {
  this.leaveTo = url;
});

Given('下一页第一次没有响应', function () {
  this.dropFirstResponse = 1;
});

When('按目标条数{string}补齐当前列表', async function (target) {
  const session = exportSession(this);
  const page = model.describePage(this.pageUrl);
  this.page = page;
  this.sentRequests = [];
  this.scrolls = 0;
  this.progressLog = [];
  this.gaps = [];
  let inFlight = 0;
  this.maxInFlight = 0;
  let clock = 0;
  const script = (this.nextPages || []).slice();
  this.exportResult = await model.collectUntil(session, page, {
    target: target,
    minGapMs: 1000,
    now: function () { return clock; },
    sleep: function (ms) {
      clock += ms;
      this.gaps.push(ms);
      return Promise.resolve();
    }.bind(this),
    pageNow: function () {
      return model.describePage(this.pageUrl);
    }.bind(this),
    onProgress: function (text) {
      this.progressLog.push(text);
    }.bind(this),
    send: async function (request) {
      inFlight += 1;
      this.maxInFlight = Math.max(this.maxInFlight, inFlight);
      this.sentRequests.push(request);
      if (this.leaveTo) this.pageUrl = this.leaveTo;
      if (this.dropFirstResponse) {
        this.dropFirstResponse -= 1;
        inFlight -= 1;
        return { timedOut: true };
      }
      const next = script.shift();
      if (next) session.ingest(page, readFixture(next), page.mode);
      inFlight -= 1;
      return { timedOut: false };
    }.bind(this),
    scroll: async function () {
      this.scrolls += 1;
      const next = script.shift();
      if (next) session.ingest(page, readFixture(next), page.mode);
    }.bind(this),
  });
  this.notice = this.exportResult.message || '';
  this.filename = this.exportResult.download ? this.exportResult.filename || 'export.xlsx' : null;
  this.store = session.storeFor(page);
});

Then('没有继续要下一页', function () {
  assert.equal((this.sentRequests || []).length, 0);
  assert.equal(this.scrolls || 0, 0);
});

Then('请求了{int}次下一页', function (count) {
  assert.equal(this.sentRequests.length, count);
});

Then('滚动了{int}次', function (count) {
  assert.equal(this.scrolls, count);
});

Then('下一页请求地址包含{string}', function (text) {
  assert.ok(this.sentRequests.some((request) => String(request.url).includes(text)), JSON.stringify(this.sentRequests));
});

Then('第{int}次下一页请求体包含{string}', function (index, text) {
  assert.ok(this.sentRequests[index - 1], '没有第 ' + index + ' 次请求');
  assert.ok(String(this.sentRequests[index - 1].body).includes(text), this.sentRequests[index - 1].body);
});

Then('第{int}条数据的点赞数为{string}', function (index, likes) {
  const headers = this.workbookCheck.aoa[0];
  const column = headers.indexOf('点赞数');
  assert.ok(column >= 0, '没有点赞数列');
  const cell = this.workbookCheck.aoa[index][column];
  assert.equal(cell == null ? '' : String(cell), likes);
});

Then('下一页请求体包含{string}', function (text) {
  assert.ok(this.sentRequests.some((request) => String(request.body).includes(text)), this.sentRequests.map((request) => request.body).join('\n'));
});

Then('加载过程出现{string}', function (text) {
  assert.ok(this.progressLog.some((line) => line.includes(text)), this.progressLog.join(' | '));
});

Then('下一页没有并发', function () {
  assert.equal(this.maxInFlight, 1);
});

Then('相邻下一页至少间隔{int}毫秒', function (ms) {
  assert.ok(this.gaps.length >= 1, '没有间隔');
  this.gaps.forEach((gap) => assert.ok(gap >= ms, String(gap)));
});

Then('提示不包含{string}', function (text) {
  assert.equal(String(this.notice).includes(text), false, String(this.notice));
});

Then('面板包含按钮{string}', function (label) {
  assert.equal(this.panel.button.textContent, label);
});

Then('可以导出', function () {
  assert.equal(this.page.allowed, true);
});

Then('不可导出', function () {
  assert.equal(this.page.allowed, false);
});

Then('关键词为{string}', function (keyword) {
  assert.equal(this.page.keyword, keyword);
});

Then('当前列表为{string}', function (label) {
  assert.equal(this.page.label, label);
});

When('检查扩展清单是否注入{string}', function (url) {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'extensions', 'xhs-search-export', 'manifest.json'),
    'utf8'
  ));
  this.injected = model.manifestInjects(manifest, url);
});

Then('会注入内容脚本', function () {
  assert.equal(this.injected, true);
});

Then('当前站点为{string}', function (label) {
  assert.equal(this.page.siteLabel, label);
});

Then('捕获到{int}条视频', function (count) {
  assert.equal(this.store.list().length, count);
});

Then('第{int}条视频的视频ID为{string}', function (index, id) {
  assert.equal(noteAt(this, index).id, id);
});

Then('第{int}条视频的标题为{string}', function (index, title) {
  assert.equal(noteAt(this, index).title, title);
});

Then('第{int}条视频的作者为{string}', function (index, author) {
  assert.equal(noteAt(this, index).author, author);
});

Then('第{int}条视频的作者ID为{string}', function (index, authorId) {
  assert.equal(noteAt(this, index).authorId, authorId);
});

Then('第{int}条视频的点赞数为{string}', function (index, likes) {
  assert.equal(String(noteAt(this, index).likes), likes);
});

Then('第{int}条视频的视频链接为{string}', function (index, link) {
  assert.equal(noteAt(this, index).link, link);
});

Then('表头不包含{string}', function (header) {
  assert.equal(this.table.headers.includes(header), false, this.table.headers.join(','));
});

Then('第{int}行{string}单元格为{string}', function (index, header, value) {
  const column = this.table.headers.indexOf(header);
  assert.ok(column >= 0, this.table.headers.join(','));
  const cell = this.table.rows[index - 1][column];
  assert.equal(cell == null ? '' : String(cell), value);
});

Then('工作簿首条{string}为{string}', function (header, value) {
  const headers = this.workbookCheck.aoa[0];
  const column = headers.indexOf(header);
  assert.ok(column >= 0, headers.join(','));
  assert.equal(String(this.workbookCheck.aoa[1][column]), value);
});

Then('目标条数上限为{string}', function (value) {
  assert.equal(this.panel.target.max, value);
});

When('抖音搜索页拦截到该搜索响应', async function () {
  const payload = this.payloadText;
  const messages = [];
  const nativeFetch = function (url) {
    return Promise.resolve({
      url: String(url),
      clone() {
        return this;
      },
      text() {
        return Promise.resolve(payload);
      },
    });
  };
  const location = {
    hostname: 'www.douyin.com',
    pathname: '/search/装修',
    origin: 'https://www.douyin.com',
    href: 'https://www.douyin.com/search/装修',
  };
  const history = { pushState() {}, replaceState() {} };
  const sandbox = {
    URL,
    window: {
      location,
      history,
      addEventListener() {},
      postMessage(data) {
        messages.push(data);
      },
      fetch: nativeFetch,
    },
    setInterval,
    clearInterval,
    location,
    history,
  };
  function XMLHttpRequest() {}
  XMLHttpRequest.prototype.open = function () {};
  XMLHttpRequest.prototype.send = function () {};
  sandbox.XMLHttpRequest = XMLHttpRequest;
  sandbox.window.XMLHttpRequest = XMLHttpRequest;
  vm.createContext(sandbox);
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'extensions', 'xhs-search-export', 'src', 'inject-main.js'),
    'utf8'
  );
  vm.runInContext(source, sandbox);
  sandbox.window.fetch = function (url) {
    return nativeFetch(url);
  };
  await new Promise((resolve) => setTimeout(resolve, 350));
  const calls = [
    'https://www.douyin.com/aweme/v1/web/comment/list/?aweme_id=1',
    'https://www.douyin.com/aweme/v1/web/discover/search/?keyword=a',
    'https://www.douyin.com/aweme/v1/web/general/search/single/?offset=0',
    'https://www.douyin.com/aweme/v1/web/search/item/?offset=0',
  ];
  for (const url of calls) {
    await sandbox.window.fetch(url);
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
  if (sandbox.window.__xhsSearchExportTimer) {
    clearInterval(sandbox.window.__xhsSearchExportTimer);
  }
  const found = messages.filter((item) => item && item.type === 'search-notes-response');
  assert.equal(found.length, 2, JSON.stringify(messages.map((item) => item && item.type)));
  this.store.ingestPayload(found[0].body);
});

When('挂载页内面板到文档', function () {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
    url: 'https://www.xiaohongshu.com/search_result?keyword=test',
  });
  this.mountedHost = model.mountPanelHost(dom.window.document);
  this.mountedDocument = dom.window.document;
});

Then('面板挂在文档根节点上', function () {
  assert.equal(this.mountedHost.parentNode, this.mountedDocument.documentElement);
});

Then('面板使用固定定位', function () {
  assert.equal(this.mountedHost.style.position, 'fixed');
});
