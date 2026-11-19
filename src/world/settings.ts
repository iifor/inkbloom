// Per-browser preferences (not part of any world save).
import type { KeyValue } from './store';

export interface Settings {
  /** Multiplier on mouse look speed. */
  sensitivity: number;
  /** Field of view in degrees. */
  fov: number;
  /** 'high' renders at up to 1.5× device pixels, 'low' at 1×. */
  quality: 'high' | 'low';
  /** 0..1 */
  volume: number;
  music: number;
  sfx: number;
  /** Environment/calendar rate only; simulation and cooldowns stay at real speed. */
  timeScale: number;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  fov: 78,
  quality: 'high',
  volume: 0.8,
  music: 0.6,
  sfx: 1,
  timeScale: 1,
};
export const TIME_SCALES = [1, 10, 60, 240, 720] as const;
export const validTimeScale = (v: unknown): number =>
  TIME_SCALES.includes(v as (typeof TIME_SCALES)[number]) ? (v as number) : 1;
export const SETTING_LIMITS = { sensitivity: [0.3, 3], fov: [60, 100], volume: [0, 1] } as const;

const KEY = 'inkbloom:settings';
const clamp = (v: unknown, [lo, hi]: readonly [number, number], d: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v as number)) : d;

export function loadSettings(kv: KeyValue): Settings {
  let raw: Partial<Settings> = {};
  try {
    const parsed: unknown = JSON.parse(kv.getItem(KEY) ?? '{}');
    if (parsed && typeof parsed === 'object') raw = parsed as Partial<Settings>;
  } catch {
    // unreadable settings are just defaults
  }
  return {
    sensitivity: clamp(raw.sensitivity, SETTING_LIMITS.sensitivity, DEFAULT_SETTINGS.sensitivity),
    fov: clamp(raw.fov, SETTING_LIMITS.fov, DEFAULT_SETTINGS.fov),
    quality: raw.quality === 'low' ? 'low' : 'high',
    volume: clamp(raw.volume, SETTING_LIMITS.volume, DEFAULT_SETTINGS.volume),
    music: clamp(raw.music, SETTING_LIMITS.volume, DEFAULT_SETTINGS.music),
    sfx: clamp(raw.sfx, SETTING_LIMITS.volume, DEFAULT_SETTINGS.sfx),
    timeScale: validTimeScale(raw.timeScale),
  };
}

export function saveSettings(kv: KeyValue, s: Settings): void {
  kv.setItem(KEY, JSON.stringify(s));
}
