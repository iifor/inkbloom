// Temperature through the year and up the hills. For now only the daily mean (no weather, no
// day/night swing): it sets where snow lies. The renderer does the snow line in GLSL from the
// same numbers (ground-level temperature and `TUNING.season.lapse`).
import { TUNING } from '@/content/tuning';
import { smoothstep } from '../math/noise';

/** Daily mean temperature, °C, `height` metres up, at `yearPhase` (see `calendarAt`). */
export function meanTemperature(yearPhase: number, height = 0): number {
  const S = TUNING.season;
  return S.meanTemp + S.tempSwing * Math.sin(2 * Math.PI * (yearPhase - 0.125)) - S.lapse * height;
}

/** How much of the ground lies under snow at a daily mean temperature, 0..1. */
export function snowCover(temp: number): number {
  return smoothstep(1, -3, temp);
}
