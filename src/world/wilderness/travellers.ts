import { hashInts, hashString, unit } from '../math/hash';
import { validSightings, type Sighting } from './traveller-options';
import type { Trail } from './paths';

export interface Journey {
  readonly trail: Trail;
  readonly lengths: Float64Array;
  readonly speed: number;
  readonly rest: number;
  readonly offset: number;
}

/** One traveller per main road, and occasional walkers on the quieter ruin tracks. */
export function journeyOn(seed: number, trail: Trail): Journey | null {
  const key = hashInts(seed, hashString(trail.id));
  if (trail.id.startsWith('r') && unit(key) >= 0.25) return null;
  const p = trail.pts;
  const lengths = new Float64Array(p.length / 2);
  for (let i = 1; i < lengths.length; i++) {
    const k = 2 * i;
    lengths[i] = lengths[i - 1]! + Math.hypot(p[k]! - p[k - 2]!, p[k + 1]! - p[k - 1]!);
  }
  const distance = lengths.at(-1) ?? 0;
  if (distance < 1) return null;
  const speed = 1.45 + unit(hashInts(key, 1)) * 0.4;
  const rest = 12 + unit(hashInts(key, 2)) * 12;
  const phase = unit(hashInts(key, 3));
  // In a new world the first walker is a short way ahead on the road out of spawn.
  const offset =
    trail.id === 'spawn'
      ? Math.min(distance / 2, 24 + phase * 22) / speed
      : phase * 2 * (distance / speed + rest);
  return { trail, lengths, speed, rest, offset };
}

export interface TravelLeg {
  at: number;
  from: number;
  to: number;
  /** Last known point of departure before choosing a stop along the way. */
  origin: number;
  /** Sightings from completed legs, captured when this one starts. */
  memory?: Sighting[];
}

export function validTravelLeg(value: unknown): value is TravelLeg {
  if (!value || typeof value !== 'object') return false;
  const p = value as TravelLeg;
  return (
    [p.at, p.from, p.to, p.origin].every((n) => Number.isFinite(n) && n >= 0) &&
    p.from !== p.to &&
    (p.memory === undefined || validSightings(p.memory))
  );
}

export function journeyTiming(j: Journey, clock: number, plan?: TravelLeg) {
  const length = j.lengths.at(-1)!;
  const active = plan && clock >= plan.at && Math.max(plan.from, plan.to) <= length ? plan : undefined;
  const first = active?.from ?? 0,
    last = active?.to ?? length;
  const span = Math.abs(last - first);
  return {
    first,
    last,
    span,
    begin: active?.at ?? -j.offset,
    leg: span / j.speed + j.rest,
    origin: active?.origin ?? first,
  };
}

export function travellerPose(j: Journey, clock: number, plan?: TravelLeg) {
  const length = j.lengths.at(-1)!;
  const { first, last, span, begin, leg, origin } = journeyTiming(j, clock, plan);
  const time = (clock - begin) % (2 * leg);
  const back = time >= leg;
  const elapsed = back ? time - leg : time;
  const from = back ? last : first,
    to = back ? first : last;
  const direction = Math.sign(to - from);
  const travelled = Math.min(span, elapsed * j.speed);
  const distance = travelled === span ? to : from + direction * travelled;
  // Find the non-empty segment containing the walker. Generated bridge approaches
  // can have repeated vertices, including at the end of a trail.
  let lo = 0,
    hi = j.lengths.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (j.lengths[mid]! < distance || j.lengths[mid] === 0) lo = mid;
    else hi = mid;
  }
  const k = lo * 2,
    p = j.trail.pts;
  const dx = p[k + 2]! - p[k]!,
    dz = p[k + 3]! - p[k + 1]!;
  const f = (distance - j.lengths[lo]!) / (j.lengths[hi]! - j.lengths[lo]!);
  return {
    x: p[k]! + dx * f,
    z: p[k + 1]! + dz * f,
    from,
    to,
    distance,
    origin: from === 0 || from === length ? from : origin,
    angle: Math.atan2(direction * dx, direction * dz),
    motion: travelled < span ? ('walk' as const) : ('idle' as const),
  };
}
