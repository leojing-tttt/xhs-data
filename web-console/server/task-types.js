// Task kinds live here so a later kind can be added as data.
// This slice only runs xhs-search. An id in this list is not runnable
// until a runner handles it; run:false keeps the field without building it.

export const TASK_TYPES = [
  { id: 'xhs-search', label: '小红书搜索', run: true },
];

export function taskTypeById(id) {
  return TASK_TYPES.find((item) => item.id === id) || null;
}
