// Anything the model sees can end up in a published round summary, memory note, or handoff, so the
// model and the retrospective see an error only as a stable category. Raw messages can carry stacks,
// local paths, the model URL or endpoint details; they stay in the private events.jsonl.
const ERROR_CATEGORIES = [
  ['control_unavailable', /Control missing or disabled/],
  ['off_game_blocked', /Off-game (link|navigation) blocked/],
  ['save_notice_missing', /"Game saved" notice/],
  ['warm_memory_too_long', /Warm memory exceeds/],
  ['invalid_cold_key', /Cold key must use/],
  ['cold_note_too_long', /Cold note too long/],
  ['cold_storage_full', /Cold storage is full/],
  ['browser_closed', /(page|context|browser) has been closed|Target closed/i],
  ['timeout', /timeout|timed out/i],
  ['connection', /ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|network/i],
  ['aborted', /abort/i],
];
export function errorCategory(message) {
  const text = String(message ?? '');
  return ERROR_CATEGORIES.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other';
}
