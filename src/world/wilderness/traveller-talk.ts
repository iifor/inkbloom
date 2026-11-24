import type { WorldState } from '../state';
import { townDistance, type Entrance, type Wilderness } from './generator';
import { travellerPose, type Journey, type TravelLeg } from './travellers';

import { landmarks, townKind, recallTravels, rememberedSightings } from './traveller-memory';
export function travelOptions(w: Wilderness, state: WorldState, j: Journey) {
  const p = travellerPose(j, state.clock, state.travellerLegs.get(j.trail.id));
  const length = j.lengths.at(-1)!;
  const stops = landmarks(w, state, j);
  // Both short walks and a full trip are possible, even on a road without a bridge.
  for (const at of [p.distance - 120, p.distance + 120]) {
    if (at > 0 && at < length && stops.every((s) => Math.abs(s.at - at) >= 20))
      stops.push({ at, place: 'roadside', kind: 'roadside' });
  }
  return stops
    .filter((s) => Math.abs(s.at - p.distance) >= 10)
    .sort((a, b) => Math.abs(a.at - p.distance) - Math.abs(b.at - p.distance))
    .slice(0, 10)
    .map((s) => ({
      ...s,
      metres: Math.round(Math.abs(s.at - p.distance)),
      onward: (s.at - p.distance) * (p.to - p.from) > 0,
    }));
}

export function acceptStop(
  j: Journey,
  clock: number,
  previous: TravelLeg | undefined,
  to: number,
): TravelLeg | null {
  const pose = travellerPose(j, clock, previous);
  const from = pose.distance;
  const origin = from === 0 || from === j.lengths.at(-1) ? from : pose.origin;
  return Number.isFinite(to) && to >= 0 && to <= j.lengths.at(-1)! && Math.abs(from - to) >= 5
    ? { at: clock, from, to, origin }
    : null;
}

/** Checkpoint the old journey before replacing it; travel while the model was thinking counts too. */
export function commitTravellerStop(w: Wilderness, state: WorldState, j: Journey, target: number) {
  const leg = acceptStop(j, state.clock, state.travellerLegs.get(j.trail.id), target);
  if (leg) {
    leg.memory = rememberedSightings(w, state, j);
    state.travellerLegs.set(j.trail.id, leg);
  }
  return leg;
}

export function decisionDue(j: Journey, clock: number, plan?: TravelLeg) {
  return !plan || clock >= plan.at + Math.abs(plan.to - plan.from) / j.speed + j.rest / 2;
}

export function askTraveller(
  w: Wilderness,
  state: WorldState,
  j: Journey,
  nameOf: (e: Entrance) => string,
  topic: 'route' | 'news' | 'memory',
) {
  const pose = travellerPose(j, state.clock, state.travellerLegs.get(j.trail.id));
  if (topic === 'memory') return recallTravels(w, state, j, nameOf);
  if (topic === 'news') {
    const towns = w
      .entrancesNear(pose.x, pose.z, 1)
      .filter((e) => townDistance(e, pose.x, pose.z) <= 1200)
      .sort((a, b) => townDistance(a, pose.x, pose.z) - townDistance(b, pose.x, pose.z))
      .slice(0, 2);
    const news = towns.map((e) => {
      const name = nameOf(e);
      switch (townKind(state, e)) {
        case 'peaceful':
          return name + '一直太平，村里人照常过日子。';
        case 'restored':
          return name + '已经恢复了颜色，外头的人可以返乡了。';
        case 'recovering':
          return name + '已经有些地方恢复了颜色，进村还是得留神。';
        default:
          return name + '还受墨染，去那边要当心。';
      }
    });
    return news.join('') || '这一带离村落远，附近的消息我也说不准。';
  }
  const stops = landmarks(w, state, j);
  const place = (at: number): string => {
    const s = stops.find((s) => Math.abs(s.at - at) < 2);
    if (s?.town) return nameOf(s.town);
    if (s?.kind === 'spawn') return '出发地的石台';
    if (s?.kind === 'ruin') return '遗迹边';
    if (s?.kind === 'bridge') return '路上的桥头';
    const end = stops[Number(at > j.lengths.at(-1)! / 2)]!;
    const towards = end.town
      ? nameOf(end.town)
      : end.kind === 'spawn'
        ? '石台'
        : end.kind === 'ruin'
          ? '遗迹'
          : '路口';
    return '离' + towards + '约' + Math.round(Math.abs(at - end.at)) + '米的路边';
  };
  if (pose.origin === pose.to)
    return (
      '我是从' +
      place(pose.origin) +
      '出发的，' +
      (pose.motion === 'idle' ? '刚走了一圈回来。' : '这会儿正在回去的路上。')
    );
  return pose.motion === 'idle'
    ? '我从' + place(pose.origin) + '来，刚到' + place(pose.to) + '，在这儿歇会儿。'
    : '我从' + place(pose.origin) + '来，这趟要去' + place(pose.to) + '。';
}
