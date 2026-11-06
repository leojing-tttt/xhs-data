export const TASK_TYPES = [
  { id: 'xhs-search', label: '小红书搜索' },
];

export function getTaskType(id) {
  return TASK_TYPES.find((item) => item.id === id) || null;
}
