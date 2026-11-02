// Deterministic integer hashing. Every generated thing in the world is a function of
// (seed, salt, coordinates), so any chunk can be produced in any order with the same result.

/** FNV-1a over a string, as an unsigned 32-bit integer. */
export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Final avalanche step (murmur3 fmix32). */
function mix(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash any number of integers together with a seed. */
export function hashInts(seed: number, ...values: number[]): number {
  let h = mix(seed >>> 0);
  for (const v of values) h = mix(h ^ Math.imul((v | 0) + 0x9e3779b9, 0x27d4eb2d));
  return h;
}

/** Hash a salt name plus integer coordinates. Salts keep independent layers uncorrelated. */
export function hashAt(seed: number, salt: string, ...values: number[]): number {
  return hashInts(seed ^ hashString(salt), ...values);
}

/** Map a 32-bit hash to [0, 1). */
export const unit = (h: number): number => (h >>> 0) / 4294967296;
