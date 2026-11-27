import type { SceneRef } from './state';

export interface InkSite {
  readonly scene: SceneRef;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Keep the infected identity after its monster dies, so the resident stays absent. */
export interface InfectedPerson extends InkSite {
  readonly defeated?: boolean;
}

export const INFECTION_RADIUS = 36;
export function sameScene(a: SceneRef, b: SceneRef): boolean {
  return a.kind === b.kind && (a.kind === 'wild' || (b.kind === 'city' && a.id === b.id));
}
export function inInfectionArea(center: { x: number; z: number }, p: { x: number; z: number }): boolean {
  return (center.x - p.x) ** 2 + (center.z - p.z) ** 2 <= INFECTION_RADIUS ** 2;
}
export function areaKey(p: InkSite): string {
  return [p.scene.kind === 'wild' ? 'wild' : p.scene.id, Math.round(p.x), Math.round(p.z)].join(':');
}
export function validInkSite(v: unknown): v is InkSite {
  const s = v as Partial<InkSite> | null;
  return (
    !!s &&
    (s.scene?.kind === 'wild' || (s.scene?.kind === 'city' && /^c-?\d+_-?\d+$/.test(s.scene.id))) &&
    [s.x, s.y, s.z].every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6)
  );
}
