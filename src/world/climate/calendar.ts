// The world's calendar: a pure function of the play clock. A day lasts `TUNING.day.length`
// seconds, a season `TUNING.season.days` days, and the year starts on the first day of spring.
// As in the traditional calendar, the equinoxes and solstices fall in the middle of their
// seasons, so midsummer is the longest day. Everything that changes with the time of day or the
// time of year reads it from here.
import { TUNING } from '@/content/tuning';
import { smoothstep } from '../math/noise';

/** Earth's axial tilt, radians: how far the sun's path moves north and south over a year. */
const TILT = (23.44 * Math.PI) / 180;

export interface Calendar {
  /** Whole days since the year the world started in began (startDay counts). */
  readonly day: number;
  /** Hour of the day, 0..24. */
  readonly hour: number;
  /** How far through the year, 0..1: 0 the first day of spring, 0.125 the spring equinox,
   * 0.375 midsummer, 0.625 the autumn equinox, 0.875 midwinter. */
  readonly yearPhase: number;
  /** 0 spring, 1 summer, 2 autumn, 3 winter (an index into `SEASONS`). */
  readonly season: number;
  /** Day within the season, from 1. */
  readonly seasonDay: number;
  /** The sun's declination, radians: positive in summer, when it stands higher and sets later. */
  readonly declination: number;
}

/**
 * Which two season looks are showing at `yearPhase`, and how far from the first to the second
 * (0..1). Each look is held in the middle of its season; the change happens around the turn.
 * The renderer does the same in GLSL, shifted a little per place (`TUNING.season.stagger`).
 */
export function seasonBlend(yearPhase: number): { from: number; to: number; t: number } {
  const p = ((((yearPhase - 0.125) % 1) + 1) % 1) * 4;
  const from = Math.floor(p) % 4;
  const f = p - Math.floor(p);
  return { from, to: (from + 1) % 4, t: f * f * (3 - 2 * f) };
}

/** Meadow tufts return through the first half of spring and die back through late autumn.
 * The ground stays bare for the entire calendar winter, including days without snow. */
export function grassCoverAt(yearPhase: number): number {
  return smoothstep(0, 0.125, yearPhase) * (1 - smoothstep(0.625, 0.75, yearPhase));
}

export function calendarAt(clock: number): Calendar {
  const S = TUNING.season;
  const days = S.startDay + (TUNING.day.startHour + (clock / TUNING.day.length) * 24) / 24;
  const day = Math.floor(days);
  const year = S.days * 4;
  const yearPhase = (((days / year) % 1) + 1) % 1;
  const dayOfYear = ((day % year) + year) % year;
  return {
    day,
    hour: (days - day) * 24,
    yearPhase,
    season: Math.floor(dayOfYear / S.days),
    seasonDay: (dayOfYear % S.days) + 1,
    declination: TILT * Math.sin(2 * Math.PI * (yearPhase - 0.125)),
  };
}
