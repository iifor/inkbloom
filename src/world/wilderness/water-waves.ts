export const BANK_LAP_RATE = 0.68;

/** The shore shader and its sound use the same world-space wave phase. */
export function bankWavePhase(x: number, z: number, time: number): number {
  const phase = time * BANK_LAP_RATE + 0.22 * Math.sin(0.48 * x + 0.31 * z) + 0.15 * Math.sin(0.64 * z - 0.27 * x);
  return phase - Math.floor(phase);
}
