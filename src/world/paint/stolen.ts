// The colours a monster carries: it took them from the place it haunts, so it wears the most
// vivid of that place's original colours. Pure; callers pass the colours of the place (a
// block's surfaces, a wilderness chunk's pigment sources and biome).
import { PALETTE, color } from '@/content/palette';

/** How colourful a palette entry is (0 for greys and creams, up to about 0.8). */
export function chroma(index: number): number {
  const c = PALETTE[index]?.rgb;
  if (!c) return 0;
  return Math.max(...c) - Math.min(...c);
}

/** Below this a colour is too dull to read on a black ink body. */
const DULL = 0.25;

/**
 * Up to `k` colours, most common first after weighting by how vivid each is. Dull colours only
 * count when nothing vivid is there; with nothing at all it falls back to red.
 */
export function stolenColors(colors: Iterable<number>, k = 2): number[] {
  const score = new Map<number, number>();
  for (const c of colors) score.set(c, (score.get(c) ?? 0) + 1);
  const ranked = [...score]
    .map(([c, n]) => ({ c, s: n * Math.max(0.05, chroma(c)) }))
    .sort((a, b) => b.s - a.s || a.c - b.c);
  const vivid = ranked.filter((r) => chroma(r.c) >= DULL);
  const out = (vivid.length ? vivid : ranked).slice(0, k).map((r) => r.c);
  return out.length ? out : [color('red')];
}
