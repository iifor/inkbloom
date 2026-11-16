// Lessons the player only needs once or twice ("right click switches restore / graffiti").
// Remembered per browser, not per world: they are about the player, so a second world does
// not teach the same things again. Storage can be missing (private windows); then lessons
// are simply shown again next time.
const KEY = 'inkbloom:hints';

let seen: Record<string, number> | null = null;

function load(): Record<string, number> {
  if (seen) return seen;
  try {
    const raw = localStorage.getItem(KEY);
    seen = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    seen = {};
  }
  return seen;
}

/**
 * Whether lesson `id` should still be shown (fewer than `times` showings so far). If it should,
 * it is counted as shown.
 */
export function lesson(id: string, times = 1): boolean {
  const s = load();
  const n = s[id] ?? 0;
  if (n >= times) return false;
  s[id] = n + 1;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // remembered for this session only
  }
  return true;
}

/** Whether lesson `id` has been shown fewer than `times` times (does not count a showing). */
export function lessonDue(id: string, times = 1): boolean {
  return (load()[id] ?? 0) < times;
}
