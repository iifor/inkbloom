// Travel between restored cities: from any restored city's tower door or gate, F goes to the
// next restored city. Pressing it again at the destination moves on, so the restored cities
// form a ring. Nothing about travel is saved except where the player ends up.

/** The restored city after `current` in a stable order, or null when there is nowhere to go. */
export function nextDestination(restored: readonly string[], current: string): string | null {
  const ring = [...restored].sort();
  if (!ring.includes(current) || ring.length < 2) return null;
  return ring[(ring.indexOf(current) + 1) % ring.length]!;
}
