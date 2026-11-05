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
  const parts = [this.panel.mode, this.panel.count, this.panel.hint]
    .filter(Boolean)
    .map((node) => node.textContent)
    .join('\n');
  assert.ok(parts.includes(text), parts);
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
