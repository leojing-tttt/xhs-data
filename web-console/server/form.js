import { taskTypeById, TASK_TYPES } from './task-types.js';

export const DEFAULT_COUNT = 100;
export const MIN_COUNT = 1;
export const MAX_COUNT = 2000;
export const SORTS = ['综合', '最新', '最多点赞', '最多评论', '最多收藏'];
export const NOTE_TYPES = ['不限', '视频', '图文', '直播'];
export const PUBLISH_TIMES = ['不限', '一天内', '一周内', '半年内'];
export const SEARCH_TASK_TYPE = 'xhs-search';

export const COUNT_MESSAGE = '请填写 1 到 2000 的整数';
export const KEYWORD_MESSAGE = '请填写关键词';
export const FILTER_UNSUPPORTED_MESSAGE = [
  '排序、笔记类型、发布时间不能从现有搜索响应钩子套用。',
  '钩子只复用页面自己的 search/notes 请求，并且只推进请求里已经有的翻页字段（page、cursor、search_id、refresh_type）。',
  '钩子里没有这些筛选项的官方参数名，这一版不猜测参数名，也不在本地另排顺序或挑笔记来假装已经按官方条件筛过。',
  '请改回排序「综合」、笔记类型「不限」、发布时间「不限」。',
].join('');

const BANNED_FIELDS = ['location', 'region', 'seen', 'unseen', 'seenStatus'];

export function formOptions() {
  return {
    type: SEARCH_TASK_TYPE,
    types: TASK_TYPES.map((item) => ({ id: item.id, label: item.label })),
    defaults: {
      count: DEFAULT_COUNT,
      sort: SORTS[0],
      noteType: NOTE_TYPES[0],
      publishTime: PUBLISH_TIMES[0],
    },
    sorts: SORTS,
    noteTypes: NOTE_TYPES,
    publishTimes: PUBLISH_TIMES,
    count: { min: MIN_COUNT, max: MAX_COUNT },
  };
}

export function validateSearchForm(input) {
  const body = input && typeof input === 'object' ? input : {};
  for (const key of BANNED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      return { ok: false, error: '这一版没有地区，也没有已看过或未看过' };
    }
  }

  const type = body.type == null || body.type === '' ? SEARCH_TASK_TYPE : String(body.type);
  if (/douyin|抖音/i.test(type)) {
    return { ok: false, error: '这一版不做抖音' };
  }
  const known = taskTypeById(type);
  if (!known) {
    return { ok: false, error: '未知任务类型。这一版只有小红书搜索' };
  }
  if (!known.run) {
    return { ok: false, error: `任务类型「${known.label}」还没有做` };
  }

  const keyword = body.keyword == null ? '' : String(body.keyword).trim();
  if (!keyword) return { ok: false, error: KEYWORD_MESSAGE };

  if (body.count == null || body.count === '') {
    return { ok: false, error: COUNT_MESSAGE };
  }
  const countText = String(body.count).trim();
  if (!/^\d+$/.test(countText)) return { ok: false, error: COUNT_MESSAGE };
  const count = Number(countText);
  if (count < MIN_COUNT || count > MAX_COUNT) return { ok: false, error: COUNT_MESSAGE };

  const sort = body.sort == null || body.sort === '' ? SORTS[0] : String(body.sort);
  if (!SORTS.includes(sort)) return { ok: false, error: '请选择排序' };
  const noteType = body.noteType == null || body.noteType === '' ? NOTE_TYPES[0] : String(body.noteType);
  if (!NOTE_TYPES.includes(noteType)) return { ok: false, error: '请选择笔记类型' };
  const publishTime = body.publishTime == null || body.publishTime === '' ? PUBLISH_TIMES[0] : String(body.publishTime);
  if (!PUBLISH_TIMES.includes(publishTime)) return { ok: false, error: '请选择发布时间' };

  return {
    ok: true,
    value: {
      type,
      keyword,
      count,
      sort,
      noteType,
      publishTime,
    },
  };
}

// Default 综合 / 不限 / 不限 means "do not add filters".
// Any other official filter is refused. Parameter names are not guessed.
export function unsupportedOfficialFilters(value) {
  if (!value) return FILTER_UNSUPPORTED_MESSAGE;
  if (value.sort === '综合' && value.noteType === '不限' && value.publishTime === '不限') return '';
  return FILTER_UNSUPPORTED_MESSAGE;
}
