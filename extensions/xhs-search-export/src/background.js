const SITE = /^https?:\/\/(?:www\.)?xiaohongshu\.com(?:\/|$)/i;

function inject(tabId, url) {
  if (tabId == null || !url || !SITE.test(url)) return;
  const target = { tabId: tabId, allFrames: false };
  chrome.scripting.executeScript({
    target: target,
    files: ['src/inject-main.js'],
    world: 'MAIN',
    injectImmediately: true,
  }).catch(function () {});
  chrome.scripting.executeScript({
    target: target,
    files: ['src/model.js', 'src/content.js', 'vendor/xlsx.full.min.js'],
    injectImmediately: true,
  }).catch(function () {});
}

function injectOpenTabs() {
  chrome.tabs.query({
    url: [
      'https://www.xiaohongshu.com/*',
      'https://xiaohongshu.com/*',
      'http://www.xiaohongshu.com/*',
      'http://xiaohongshu.com/*',
    ],
  }, function (tabs) {
    (tabs || []).forEach(function (tab) {
      inject(tab.id, tab.url);
    });
  });
}

chrome.runtime.onInstalled.addListener(injectOpenTabs);
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  inject(tabId, changeInfo.url || (tab && tab.url));
});
