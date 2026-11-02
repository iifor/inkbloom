// Per-browser preferences (not part of any world save).
import type { KeyValue } from './store';

export interface Settings {
  /** Multiplier on mouse look speed. */
  sensitivity: number;
  /** Field of view in degrees. */
  fov: number;
  /** 'high' renders at up to 1.5× device pixels, 'low' at 1×. */
  quality: 'high' | 'low';
}

export const DEFAULT_SETTINGS: Settings = { sensitivity: 1, fov: 78, quality: 'high' };
export const SETTING_LIMITS = { sensitivity: [0.3, 3], fov: [60, 100] } as const;

const KEY = 'inkbloom:settings';
const clamp = (v: unknown, [lo, hi]: readonly [number, number], d: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v as number)) : d;

export function loadSettings(kv: KeyValue): Settings {
  let raw: Partial<Settings> = {};
  try {
    raw = JSON.parse(kv.getItem(KEY) ?? '{}') as Partial<Settings>;
  } catch {
    // unreadable settings are just defaults
  }
  return {
    sensitivity: clamp(raw.sensitivity, SETTING_LIMITS.sensitivity, DEFAULT_SETTINGS.sensitivity),
    fov: clamp(raw.fov, SETTING_LIMITS.fov, DEFAULT_SETTINGS.fov),
    quality: raw.quality === 'low' ? 'low' : 'high',
  };
}

export function saveSettings(kv: KeyValue, s: Settings): void {
  kv.setItem(KEY, JSON.stringify(s));
}
