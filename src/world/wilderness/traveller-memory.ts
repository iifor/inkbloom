import { peacefulVillage, savedProgress, type WorldState } from '../state';
import type { Entrance, Wilderness } from './generator';
import { journeyTiming, travellerPose, type Journey } from './travellers';
import { MEMORY_LIMIT, type Sighting, type StopKind } from './traveller-options';

export interface Stop {
  at: number;
  place: string;
  kind: StopKind;
  town?: Entrance;
}

export function townKind(state: WorldState, town: Entrance): StopKind {
  if (peacefulVillage(state, town.cityId)) return 'peaceful';
  if (state.cities.get(town.cityId)?.completed) return 'restored';
  return savedProgress(state, town.cityId) > 0 ? 'recovering' : 'infected';
}

export function landmarks(w: Wilderness, state: WorldState, j: Journey): Stop[] {
  const p = j.trail.pts;
  const endpoint = (first: boolean): Stop => {
    const at = first ? 0 : j.lengths.at(-1)!;
    if (first && j.trail.id === 'spawn') return { at, place: 'spawn', kind: 'spawn' };
    if (!first && j.trail.id.startsWith('r')) return { at, place: 'ruin', kind: 'ruin' };
    const k = first ? 0 : p.length - 2;
    const town = w.townAt(p[k]!, p[k + 1]!, 8);
    return town
      ? { at, town, place: town.cityId, kind: townKind(state, town) }
      : { at, place: 'roadside', kind: 'roadside' };
  };
  const stops = [endpoint(true), endpoint(false)];
  for (const [index, b] of j.trail.bridges.entries()) {
    const i = p.findIndex((x, k) => k % 2 === 0 && (x === b.x0 || x === b.x1) && p[k + 1] === b.z);
    if (i >= 0) stops.push({ at: j.lengths[i / 2]!, place: 'bridge:' + index, kind: 'bridge' });
  }
  return stops;
}

// Between decisions a walk is periodic. Recover actual crossings analytically, including
// when nobody had this chunk loaded, without replaying every step or every elapsed lap.
export function rememberedSightings(
  w: Wilderness,
  state: WorldState,
  j: Journey,
  stops = landmarks(w, state, j),
): Sighting[] {
  const plan = state.travellerLegs.get(j.trail.id);
  const { first, last, leg, begin } = journeyTiming(j, state.clock, plan);
  const since = Math.max(state.travellerMemorySince, plan?.at ?? 0);
  const sightings = [...(plan?.memory ?? [])];
  if (state.clock < since) return sightings;
  const startAt = travellerPose(j, since, plan).distance;
  for (const stop of stops) {
    if (stop.kind === 'roadside' || stop.at < Math.min(first, last) || stop.at > Math.max(first, last))
      continue;
    const arrivals: number[] = [];
    if (stop.at !== first) arrivals.push(begin + Math.abs(stop.at - first) / j.speed);
    if (stop.at !== last) arrivals.push(begin + leg + Math.abs(stop.at - last) / j.speed);
    const saved = stop.town && state.cities.get(stop.town.cityId);
    const restored = saved?.completed ? saved.restoredAt : null;
    const record = (limit: number, before: boolean) => {
      let latest = startAt === stop.at && (before ? since < limit : since <= limit) ? since : -Infinity;
      for (const arrival of arrivals) {
        const period = 2 * leg;
        let t = arrival + Math.floor((limit - arrival) / period) * period;
        if (before && t >= limit) t -= period;
        if (t >= since) latest = Math.max(latest, t);
      }
      if (!Number.isFinite(latest)) return;
      // Only a restoration has a historical timestamp. An old, partially restored
      // village can truthfully be recalled as still affected by ink on that visit.
      const kind =
        stop.town && stop.kind !== 'peaceful'
          ? restored != null && latest >= restored
            ? 'restored'
            : 'infected'
          : stop.kind;
      sightings.push({ place: stop.place, kind, at: latest });
    };
    if (restored != null && restored >= since && restored <= state.clock) {
      record(restored, true);
      if (travellerPose(j, restored, plan).distance === stop.at)
        sightings.push({ place: stop.place, kind: 'restored', at: restored });
    }
    record(state.clock, false);
  }
  const unique = new Map<string, Sighting>();
  for (const s of sightings) {
    const key = s.place + '/' + s.kind;
    if (!unique.has(key) || unique.get(key)!.at < s.at) unique.set(key, s);
  }
  const newest = [...unique.values()].sort((a, b) => b.at - a.at);
  // Keep the two route-end villages and their historical states, even on a road with many bridges.
  const towns = newest.filter((s) => s.place.startsWith('c'));
  return [...towns, ...newest.filter((s) => !s.place.startsWith('c'))]
    .slice(0, MEMORY_LIMIT)
    .sort((a, b) => b.at - a.at);
}

export function recallTravels(w: Wilderness, state: WorldState, j: Journey, nameOf: (e: Entrance) => string) {
  const stops = landmarks(w, state, j);
  const sightings = rememberedSightings(w, state, j, stops);
  if (!sightings.length) return '这段路我才开始记，等碰上村子或桥，再和你讲。';
  const lines: string[] = [];
  for (const s of stops) {
    if (!s.town) continue;
    const visits = sightings.filter((v) => v.place === s.place);
    if (!visits.length) continue;
    const name = nameOf(s.town);
    if (visits[0]!.kind === 'restored' && visits.some((v) => v.kind === 'infected'))
      lines.push('头一回记下' + name + '时，那里还受墨染；后来再看，村口已经恢复了颜色。');
    else if (visits[0]!.kind === 'restored') lines.push('我到过' + name + '村口，那时那里已经恢复了颜色。');
    else if (visits[0]!.kind === 'peaceful') lines.push('我到过' + name + '，经过村口时一切太平。');
    else lines.push('我到过' + name + '，那次经过时村子还受墨染。');
  }
  const landmarksSeen = [...new Set(sightings.filter((s) => !s.place.startsWith('c')).map((s) => s.kind))];
  const details = landmarksSeen.map(
    (kind) =>
      ({ bridge: '河上的木桥', ruin: '路尽头的遗迹', spawn: '出发地的石台' })[
        kind as 'bridge' | 'ruin' | 'spawn'
      ],
  );
  if (details.length) lines.push('路上我亲眼见过' + details.join('和') + '。');
  return lines.join('');
}
