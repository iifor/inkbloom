// Travel: restored cities and ink marks form a ring. F at any stop (a restored city's tower
// door or gate, or a mark) goes to the next one. Nothing about travel is saved except where
// the player ends up.

/** The restored city after `current` in a stable order, or null when there is nowhere to go. */
export function nextDestination(restored: readonly string[], current: string): string | null {
  const ring = [...restored].sort();
  if (!ring.includes(current) || ring.length < 2) return null;
  return ring[(ring.indexOf(current) + 1) % ring.length]!;
}
