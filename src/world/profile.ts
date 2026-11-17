// The player's character: a name and a look, kept per browser like the settings, so it carries
// across worlds. Chosen on the character screen before the first game; null until then.
// Later the world server keeps it per player (docs/game-design.md section 10).
import { CHARACTER_KEYS, type CharacterKey, HAIR_COLORS, type Look, SKIN_TONES } from '@/content/characters';
import { PALETTE } from '@/content/palette';
import type { KeyValue } from './store';

export interface Profile {
  name: string;
  look: Look;
}

export const NAME_MAX = 12;
export const DEFAULT_NAME = '旅人';

const KEY = 'inkbloom:profile';

const index = (v: unknown, count: number): number | null =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < count ? (v as number) : null;

/** A profile read back from storage, or null if there is none or it no longer makes sense. */
export function loadProfile(kv: KeyValue): Profile | null {
  type Raw = { name?: unknown; look?: Record<string, unknown> } | null;
  let raw: Raw;
  try {
    raw = JSON.parse(kv.getItem(KEY) ?? 'null') as Raw;
  } catch {
    return null;
  }
  const l = raw?.look;
  if (!l || !CHARACTER_KEYS.includes(l.character as CharacterKey)) return null;
  const skin = index(l.skin, SKIN_TONES.length);
  const hair = index(l.hair, HAIR_COLORS.length);
  const accent = index(l.accent, PALETTE.length);
  if (skin === null || hair === null || accent === null || !PALETTE[accent]!.paintable) return null;
  return {
    name: cleanName(raw?.name),
    look: { character: l.character as CharacterKey, skin, hair, accent },
  };
}

export function saveProfile(kv: KeyValue, p: Profile): void {
  kv.setItem(KEY, JSON.stringify({ name: cleanName(p.name), look: p.look }));
}

/** Trimmed, at most NAME_MAX characters, never empty. */
export function cleanName(v: unknown): string {
  const s = typeof v === 'string' ? [...v.trim()].slice(0, NAME_MAX).join('') : '';
  return s || DEFAULT_NAME;
}
