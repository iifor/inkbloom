// Discovered usable village altars and ink marks form a travel ring. Hold E at an altar,
// or F at a mark, to reach the next stop. Only the player's final position is saved.

/** The restored city after `current` in a stable order, or null when there is nowhere to go. */
export function nextDestination(restored: readonly string[], current: string): string | null {
  const ring = [...restored].sort();
  if (!ring.includes(current) || ring.length < 2) return null;
  return ring[(ring.indexOf(current) + 1) % ring.length]!;
}
