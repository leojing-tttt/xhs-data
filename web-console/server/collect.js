import { buildNextPageRequest, createNoteStore, parseSearchResponse, readPageState } from './notes.js';

export const MIN_GAP_MS = 1000;
export const NO_RESPONSE_MESSAGE = '没有读到页面自己的搜索结果。若页面在等登录、验证码或频控，这一版不会绕过，也不会自动重试。';
export const NO_NOTES_MESSAGE = '没有从页面自己的搜索结果里读到笔记。若页面在等登录、验证码或频控，这一版不会绕过，也不会自动重试。';

export async function collectSearch(session, count, options = {}) {
  const requestedGap = options.minGapMs == null ? MIN_GAP_MS : Number(options.minGapMs);
  const gap = Math.max(MIN_GAP_MS, Number.isFinite(requestedGap) ? requestedGap : MIN_GAP_MS);
  const firstTimeout = options.firstTimeoutMs ?? 180000;
  const nextTimeout = options.nextTimeoutMs ?? 8000;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const store = createNoteStore();
  let current = null;
  let pageState = { hasMore: null, cursor: '', cursorRaw: '', searchId: '' };
  let recognized = false;

  const sawFirst = await readUntil(session, firstTimeout, now, (event) => {
    if (event.type === 'request' && event.body) {
      current = {
        url: event.url,
        method: event.method || 'POST',
        body: String(event.body),
      };
    }
    if (event.type === 'response' && event.body) {
      const parsed = parseSearchResponse(event.body);
      if (!parsed.recognized) return false;
      recognized = true;
      store.add(parsed.notes);
      pageState = readPageState(event.body);
      return true;
    }
    return false;
  });

  if (!sawFirst || !recognized) {
    return { ok: false, error: NO_RESPONSE_MESSAGE, notes: [], message: '' };
  }

  let emptyRounds = 0;
  let timedOutRounds = 0;
  let reason = '';
  let lastTick = now();

  while (store.list().length < count) {
    if (pageState.hasMore === false) {
      reason = '接口没有更多了';
      break;
    }
    const request = buildNextPageRequest(current, pageState, store.list().length);
    if (!request || request.blocked || !request.url) {
      reason = request && request.blocked ? request.blocked : '没有从页面自己的请求里找到可以往后翻的字段';
      break;
    }
    const elapsed = now() - lastTick;
    if (elapsed < gap) await sleep(gap - elapsed);
    const previous = current;
    current = request;
    lastTick = now();
    const before = store.list().length;
    await session.sendNext(request);
    const got = await readUntil(session, nextTimeout, now, (event) => {
      if (event.type === 'request' && event.body) {
        current = {
          url: event.url,
          method: event.method || 'POST',
          body: String(event.body),
        };
      }
      if (event.type !== 'response' || !event.body) return false;
      const parsed = parseSearchResponse(event.body);
      if (!parsed.recognized) return false;
      store.add(parsed.notes);
      pageState = readPageState(event.body);
      return true;
    });
    if (!got) {
      current = previous;
      timedOutRounds += 1;
      if (timedOutRounds >= 4) {
        reason = '没有等到下一页响应';
        break;
      }
      continue;
    }
    if (store.list().length <= before) {
      emptyRounds += 1;
      timedOutRounds = 0;
      if (emptyRounds >= 3) {
        reason = '连续几次没有新笔记';
        break;
      }
    } else {
      emptyRounds = 0;
      timedOutRounds = 0;
    }
  }

  const notes = store.list().slice(0, count);
  if (!notes.length) {
    return {
      ok: false,
      error: reason ? `${NO_NOTES_MESSAGE}${reason}` : NO_NOTES_MESSAGE,
      notes: [],
      message: '',
    };
  }
  const parts = [`目标 ${count} 条，实际 ${notes.length} 条`];
  if (reason && notes.length < count) parts.push(reason);
  return {
    ok: true,
    notes,
    message: `${parts.join('。')}。`,
    error: '',
  };
}

async function readUntil(session, timeoutMs, now, accept) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const remaining = Math.max(1, deadline - now());
    const event = await session.take(remaining);
    if (!event) return false;
    if (accept(event)) return true;
  }
  return false;
}
