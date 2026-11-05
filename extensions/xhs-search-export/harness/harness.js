(function () {
  const api = globalThis.XhsSearchExport;
  const result = document.getElementById('result');
  try {
    const store = api.createStore();
    store.setKeyword('大平层装修');
    store.ingestPayload(JSON.stringify({
      data: {
        items: [
          {
            id: '66dee9a10000000012011511',
            model_type: 'note',
            note_card: {
              type: 'normal',
              display_title: '大平层装修避坑',
              user: { nickname: '装修日记', user_id: 'user_1' },
              interact_info: { liked_count: '128' },
              cover: { url_default: 'https://cdn.example.com/cover-a.jpg' },
            },
          },
        ],
      },
    }));
    const view = api.panelView(store.list().length);
    const parts = api.renderPanel(document.getElementById('panel'), view);
    const when = new Date(2026, 10, 4, 3, 56, 0);
    const decision = api.decideExport({
      notes: store.list(),
      url: 'https://www.xiaohongshu.com/search_result?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82%E8%A3%85%E4%BF%AE',
      now: when,
    });
    const bytes = api.workbookBytes(store.list(), globalThis.XLSX);
    const book = XLSX.read(bytes, { type: 'array' });
    const sheet = book.Sheets[book.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
    result.textContent = JSON.stringify({
      countText: parts.count.textContent,
      buttonText: parts.button.textContent,
      download: decision.download,
      filename: decision.filename,
      sheetName: book.SheetNames[0],
      header: rows[0],
      noteId: rows[1][0],
    });
  } catch (error) {
    result.textContent = JSON.stringify({ error: String(error && error.stack || error) });
  }
})();
