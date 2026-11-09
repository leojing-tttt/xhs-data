(function () {
  var form = document.getElementById('search-form');
  var errorBox = document.getElementById('form-error');
  var body = document.getElementById('task-body');
  var empty = document.getElementById('task-empty');
  var submit = document.getElementById('submit');
  var timer = 0;

  var statusText = {
    queued: '排队',
    running: '执行中',
    success: '成功',
    failed: '失败',
  };
  var statusClass = {
    queued: 'a3-tag a3-tag-default',
    running: 'a3-tag a3-tag-info',
    success: 'a3-tag a3-tag-success',
    failed: 'a3-tag a3-tag-danger',
  };

  function showError(message) {
    errorBox.hidden = !message;
    errorBox.textContent = message || '';
  }

  function payloadFromForm() {
    var keyword = document.getElementById('keyword').value.trim();
    var count = document.getElementById('count').value.trim();
    if (!keyword) return { error: '请填写关键词' };
    if (!/^\d+$/.test(count)) return { error: '请填写 1 到 2000 的整数' };
    var countValue = Number(count);
    if (countValue < 1 || countValue > 2000) return { error: '请填写 1 到 2000 的整数' };
    return {
      value: {
        type: 'xhs-search',
        keyword: keyword,
        count: count,
        sort: document.getElementById('sort').value,
        noteType: document.getElementById('note-type').value,
        publishTime: document.getElementById('publish-time').value,
      },
    };
  }

  function cell(text) {
    var td = document.createElement('td');
    td.textContent = text == null ? '' : String(text);
    return td;
  }

  function render(tasks) {
    body.replaceChildren();
    empty.hidden = tasks.length > 0;
    tasks.forEach(function (task) {
      var tr = document.createElement('tr');
      tr.append(
        cell(task.typeLabel || task.type),
        cell(task.keyword),
        cell(task.count),
        cell(task.sort),
        cell(task.noteType),
        cell(task.publishTime),
      );
      var status = document.createElement('td');
      var tag = document.createElement('span');
      tag.className = statusClass[task.status] || 'a3-tag a3-tag-default';
      var dot = document.createElement('span');
      dot.className = 'a3-tag-dot';
      tag.append(dot, document.createTextNode(statusText[task.status] || task.status));
      status.append(tag);
      tr.append(status);
      var result = document.createElement('td');
      result.className = 'console-result';
      result.textContent = task.error || task.message || '';
      if (task.download && /^\/api\/tasks\/task_[a-z0-9]+\/download$/.test(task.download)) {
        var link = document.createElement('a');
        link.className = 'a3-table-link';
        link.href = task.download;
        link.textContent = task.error || task.message ? ' 下载 Excel' : '下载 Excel';
        result.append(link);
      }
      tr.append(result);
      body.append(tr);
    });
    var busy = tasks.some(function (task) { return task.status === 'queued' || task.status === 'running'; });
    if (busy && !timer) timer = window.setInterval(load, 1500);
    if (!busy && timer) {
      window.clearInterval(timer);
      timer = 0;
    }
  }

  function load() {
    return fetch('/api/tasks').then(function (response) {
      return response.json();
    }).then(function (data) {
      render(data.tasks || []);
    }).catch(function () {
      showError('任务列表没有读出来');
    });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var parsed = payloadFromForm();
    if (parsed.error) {
      showError(parsed.error);
      return;
    }
    showError('');
    submit.disabled = true;
    fetch('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.value),
    }).then(function (response) {
      return response.json().then(function (data) {
        return { ok: response.ok, data: data };
      });
    }).then(function (result) {
      if (!result.ok) {
        showError((result.data && result.data.error) || '没有创建任务');
        return;
      }
      return load();
    }).catch(function () {
      showError('没有创建任务');
    }).finally(function () {
      submit.disabled = false;
    });
  });

  document.getElementById('refresh').addEventListener('click', load);
  load();
})();
