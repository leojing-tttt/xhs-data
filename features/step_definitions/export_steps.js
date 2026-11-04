const { Given, When, Then, Before } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
  const bytes = model.workbookBytes(notes, XLSX);
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

When('搜索关键词变为{string}', function (keyword) {
  this.store.setKeyword(keyword);
});

When('渲染页内面板', function () {
  const view = model.panelView(this.store.list().length);
  const dom = new JSDOM('<!DOCTYPE html><div id="host"></div>');
  const host = dom.window.document.getElementById('host');
  this.panel = model.renderPanel(host, view);
  this.notice = view.hint || this.notice;
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
  assert.ok(this.panel.count.textContent.includes(text), this.panel.count.textContent);
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
