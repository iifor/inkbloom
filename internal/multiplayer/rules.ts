import { WorldHost } from '@/world/net/host';
import { createWorldState } from '@/world/state';
import { parseClientMessage } from '@/world/net/protocol';

// WorldHost copies acyclic save data before judging a patch. The embedded VM
// supplies ECMAScript builtins but lacks the browser structuredClone API.
function cloneState(value: any): any {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneState);
  if (ArrayBuffer.isView(value)) return (value as Uint8Array).slice();
  if (value instanceof Set) return new Set(Array.from(value, cloneState));
  if (value instanceof Map) return new Map(Array.from(value, ([k, v]) => [k, cloneState(v)]));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneState(v)]));
}
globalThis.structuredClone ??= cloneState;
let host: WorldHost;
export function init(id: string, seed: number, max: number, archive: string) {
  host = archive
    ? WorldHost.load(archive, max)
    : new WorldHost(createWorldState(id, seed, id), new Map(), max);
}
export const validate = (text: string) => JSON.stringify(parseClientMessage(text));
export const checkpoint = () => host.save();
export function join(key: string, raw: string, room: string, ai = false) {
  const m = JSON.parse(raw);
  const r = host.join(key, m.name, m.look);
  if (!r.ok) return JSON.stringify(r);
  return JSON.stringify({
    ...r,
    player: host.info(r.id),
    welcome: {
      t: 'welcome',
      v: 9,
      id: r.id,
      max: host.max,
      room: room || undefined,
      travellerAI: ai,
      world: host.world(),
      you: host.sliceOf(r.id),
      players: host.everyone().filter((p) => p.id !== r.id),
    },
    arena: host.arena.started ? host.arena.stateMessage() : undefined,
  });
}
export const leave = (id: number) => host.leave(id);
type Delivery = { ids: number[]; message: unknown };
function arena(out: ReturnType<WorldHost['tick']>): Delivery[] {
  return out.map(({ to, m }) => ({
    ids: to === 'all' ? host.everyone().map((p) => p.id) : to === 'arena' ? [...host.arena.members()] : [to],
    message: m,
  }));
}
export function command(id: number, raw: string) {
  const m = JSON.parse(raw);
  const out: Delivery[] = [];
  switch (m.t) {
    case 'move':
      host.move(id, m, m.scene, m.town);
      break;
    case 'visit':
      out.push({ ids: [id], message: host.visit(id, m.target, m.request) });
      break;
    case 'patch': {
      const r = host.patch(id, m.patch),
        you = host.sliceOf(id);
      out.push({
        ids: [id],
        message: r.ok
          ? { t: 'ok', seq: m.seq, fix: r.fix, you }
          : { t: 'rejected', seq: m.seq, kind: m.patch.kind, reason: r.reason, you, fix: r.fix },
      });
      if (r.ok && r.shared)
        out.push({
          ids: host
            .everyone()
            .filter((p) => p.id !== id)
            .map((p) => p.id),
          message: { t: 'applied', from: id, patch: m.patch, fix: r.fix },
        });
      break;
    }
    case 'arena':
      return JSON.stringify(
        arena(
          m.a === 'join'
            ? host.arena.join(id)
            : m.a === 'leave'
              ? host.arena.leave(id)
              : host.arena.vote(id, m.mode),
        ),
      );
    case 'act':
      return JSON.stringify(arena(host.arena.act(id, m)));
    case 'gesture':
      out.push({ ids: host.gesture(id), message: { t: 'gesture', from: id, g: m.g } });
      break;
  }
  return JSON.stringify(out);
}
export function tick(dt: number, directory: boolean) {
  const events = arena(host.tick(dt));
  const keepers = [...host.keepers()];
  const views = host.everyone().map(({ id }) => ({
    id,
    players: host.nearby(id),
    friends: directory ? host.locations(id) : undefined,
    keeps: keepers.filter(([, keeper]) => keeper === id).map(([town]) => town),
  }));
  return JSON.stringify({ clock: host.state.clock, events, views });
}

let pendingPlan: ReturnType<WorldHost['beginTravellerPlan']> = null;
export function beginPlan(id: number, trail: string) {
  if (pendingPlan) return 'null';
  pendingPlan = host.beginTravellerPlan(id, trail);
  if (!pendingPlan) return 'null';
  const options = pendingPlan.options.map(({ kind, place, metres, onward }) => ({
    kind,
    place,
    metres,
    onward,
  }));
  return JSON.stringify({ options, memory: pendingPlan.memory });
}
export function finishPlan(index: number) {
  const plan = pendingPlan;
  pendingPlan = null;
  return JSON.stringify(plan?.finish(index < 0 ? null : index) ?? null);
}
