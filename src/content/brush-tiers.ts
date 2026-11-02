// Brush upgrades, bought at any open studio (F). The save stores the tier index, so append new
// tiers at the end. `cost` is what it takes to reach this tier from the one before.
export interface BrushTier {
  readonly name: string;
  /** How far the brush reaches, metres. */
  readonly range: number;
  /** Seconds to colour one surface. */
  readonly secondsPerSurface: number;
  readonly cost: { readonly generic: number; readonly ink: number } | null;
}

export const BRUSH_TIERS = [
  { name: '基础笔刷', range: 6, secondsPerSurface: 1, cost: null },
  { name: '长柄笔刷', range: 10, secondsPerSurface: 0.7, cost: { generic: 40, ink: 30 } },
  { name: '宽头笔刷', range: 12, secondsPerSurface: 0.45, cost: { generic: 120, ink: 80 } },
] as const satisfies readonly BrushTier[];
