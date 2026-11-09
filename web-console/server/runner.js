import { collectSearch } from './collect.js';
import { unsupportedOfficialFilters } from './form.js';

export function createRunner({ openBrowser, collect = collectSearch, firstTimeoutMs, nextTimeoutMs } = {}) {
  if (typeof openBrowser !== 'function') throw new Error('缺少浏览器');
  return async function run(task) {
    const blocked = unsupportedOfficialFilters(task);
    if (blocked) return { ok: false, error: blocked, notes: [] };
    const session = await openBrowser({ keyword: task.keyword });
    try {
      return await collect(session, task.count, { firstTimeoutMs, nextTimeoutMs });
    } finally {
      if (session && typeof session.close === 'function') await session.close();
    }
  };
}
