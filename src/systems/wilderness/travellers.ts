import type { PhysicsWorld } from '@/engine/physics/world';
import { type NpcFighter, inkFighter, populationSurvey } from '@/systems/combat/npc-combat';
import * as THREE from 'three';
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import { sceneKey, type GameContext } from '@/game/types';
import { KayKitVillager, loadVillager } from '@/systems/figures/kaykit-villager';
import { NpcVisitors } from '@/systems/figures/npc-visitors';
import { footHeight, walkNpc } from '@/systems/figures/npc-walking';
import { attentionYaw } from '@/world/npc-attention';
import { hashAt, hashString } from '@/world/math/hash';
import { rememberedSightings } from '@/world/wilderness/traveller-memory';
import { chunkKey } from '@/world/wilderness/chunk';
import { pathsOf, type Trail } from '@/world/wilderness/paths';
import {
  askTraveller,
  travelOptions,
  commitTravellerStop,
  decisionDue,
} from '@/world/wilderness/traveller-talk';
import { journeyOn, TravellerRoutine, type Journey } from '@/world/wilderness/travellers';

/** A rolled blanket with two leather straps, tied across the traveller's back. */
function bedroll(material: THREE.Material) {
  const g = new GeometryBuilder();
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 10);
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const roll = (x: number, width: number, radius: number, pigment: number) => {
    const at = new THREE.Matrix4().compose(
      new THREE.Vector3(x, 0, -0.21),
      rotation,
      new THREE.Vector3(radius, width, radius),
    );
    g.mesh(cylinder, at, pigment, ALWAYS_COLOR);
  };
  roll(0, 0.56, 0.13, color('sand'));
  for (const x of [-0.17, 0.17]) roll(x, 0.045, 0.14, color('bark'));
  cylinder.dispose();
  return new THREE.Mesh(g.build(), material);
}

export class WildTravellers {
  private readonly stopSurvey: () => void;
  private nearby: Journey[] = [];
  private readonly fighters = new Map<Journey, NpcFighter>();
  private readonly journeys = new WeakMap<Trail, Journey | null>();
  private readonly actors = new Map<Journey, KayKitVillager>();
  private visible = new Set<Journey>();
  private readonly removePrompt = new Map<Journey, () => void>();
  private readonly attempted = new WeakMap<Journey, number>();
  private plannerAvailable = true;
  private nextThink = 0;
  private pending?: AbortController;
  private refreshIn = 0;
  private source?: Awaited<ReturnType<typeof loadVillager>>;
  private loading = false;
  private retryAt = 0;
  private readonly routines = new WeakMap<Journey, TravellerRoutine>();
  private readonly visitors: NpcVisitors;

  constructor(
    private readonly ctx: GameContext,
    private readonly root: THREE.Group,
    private readonly material: THREE.Material,
    private readonly physics: PhysicsWorld,
  ) {
    this.visitors = new NpcVisitors(ctx);
    this.stopSurvey = populationSurvey(ctx,physics,healthy => this.nearby.some(j => healthy('traveller:'+hashString(j.trail.id),
      this.fighters.get(j)?.position ?? this.routine(j).pose(ctx.state.clock,ctx.state.travellerLegs.get(j.trail.id)))));
  }

  private routine(j: Journey): TravellerRoutine {
    let routine = this.routines.get(j);
    if (!routine) this.routines.set(j, (routine = new TravellerRoutine(j)));
    return routine;
  }

  update(dt: number, loaded: ReadonlyMap<string, { trails: readonly Trail[] }>): void {
    if (typeof window === 'undefined') return;
    const clock = this.ctx.state.clock;
    const player = this.ctx.player.position;
    this.visitors.update();
    this.refreshIn -= dt;
    if (this.refreshIn <= 0) {
      this.refreshIn = 0.4;
      const trails = new Set<Trail>();
      for (const chunk of loaded.values()) for (const t of chunk.trails) trails.add(t);
      const nearby: { j: Journey; d: number }[] = [];
      for (const t of trails) {
        if (!this.journeys.has(t)) this.journeys.set(t, journeyOn(this.ctx.wilderness.seed, t));
        const j = this.journeys.get(t);
        if (!j) continue;
        const p = this.routine(j).pose(clock, this.ctx.state.travellerLegs.get(j.trail.id));
        const d = (p.x - player.x) ** 2 + (p.z - player.z) ** 2;
        const size = TUNING.world.chunkSize;
        if (d < 140 ** 2 && loaded.has(chunkKey(Math.floor(p.x / size), Math.floor(p.z / size))))
          nearby.push({ j, d });
      }
      this.nearby = nearby.map(n => n.j);
      this.visible = new Set(
        nearby
          .sort((a, b) => a.d - b.d)
          .slice(0, 6)
          .map((n) => n.j),
      );
      this.considerNextStop(clock);
      for (const [j, actor] of this.actors)
        if (!this.visible.has(j)) {
          this.routine(j).attention.release(clock);
          this.removePrompt.get(j)?.();
          this.removePrompt.delete(j);
          this.fighters.get(j)?.dispose();
          this.fighters.delete(j);
          actor.dispose();
          this.actors.delete(j);
        }
    }
    if (!this.visible.size) return;
    if (!this.source) {
      if (!this.loading && clock >= this.retryAt) {
        this.loading = true;
        void loadVillager('rogue-hooded')
          .then((s) => {
            this.source = s;
          })
          .catch((error) => {
            this.retryAt = this.ctx.state.clock + 30;
            console.warn('旅行者模型加载失败', error);
          })
          .finally(() => {
            this.loading = false;
          });
      }
      return;
    }
    for (const j of this.visible) {
      const id = 'traveller:'+hashString(j.trail.id);
      let actor = this.actors.get(j);
      if (this.ctx.state.infectedPeople.has(id)) {
        if (actor) actor.root.visible = false;
        this.fighters.get(j)?.dispose(); this.fighters.delete(j);
        continue;
      }
      if (actor) actor.root.visible = true;
      if (!actor) {
        actor = new KayKitVillager(
          this.source,
          j.offset,
          undefined,
          hashAt(this.ctx.wilderness.seed, 'traveller', hashString(j.trail.id)),
        );
        actor.model.getObjectByName('chest')?.add(bedroll(this.material));
        actor.root.name = '野外旅行者';
        actor.root.userData.trail = j.trail.id;
        this.root.add(actor.root);
        this.actors.set(j, actor);
        const ctx = this.ctx;
        const reply = (topic: 'route' | 'news' | 'memory') => {
          const words = askTraveller(
            ctx.wilderness,
            ctx.state,
            j,
            (e) => ctx.cities.layout(e).name,
            topic,
            this.routine(j).pose(ctx.state.clock, ctx.state.travellerLegs.get(j.trail.id)),
          );
          ctx.events.emit('toast', {
            text: '旅行者：「' + words + '」',
            seconds: topic === 'route' ? 7 : 10,
          });
        };
        this.removePrompt.set(
          j,
          ctx.interactions.add({
            get scene() {
              return sceneKey(ctx.scenes.active.ref);
            },
            pos: actor.root.position,
            radius: 4,
            label: () => (ctx.arena?.inside || ctx.state.infectedPeople.has(id) ? null : 'E 问旅行者从哪来、到哪去'),
            activate: () => reply('route'),
            alt: { label: () => 'F 打听附近村况', activate: () => reply('news') },
            talk: { label: () => 'T 聊聊去过的村子和路上的见闻', activate: () => reply('memory') },
          }),
        );
      }
      const routine = this.routine(j);
      const p = routine.pose(clock, this.ctx.state.travellerLegs.get(j.trail.id));
      const w = this.ctx.wilderness;
      const ground = (x: number, z: number) => pathsOf(w).bridgeAt(x, z)?.y ?? w.heightAt(x, z) + 0.04;
      let fighter = this.fighters.get(j);
      if (!fighter) {
        actor.root.position.set(p.x, footHeight(this.physics, p.x, ground(p.x, p.z), p.z), p.z);
        fighter = inkFighter(this.ctx, this.physics, actor.root.position, id);
        this.fighters.set(j, fighter);
      }
      fighter.update(dt, ground, this.visitors.people);
      if (fighter.busy) {
        routine.attention.hold(clock);
        if (fighter.target && !fighter.down)
          actor.root.rotation.y = attentionYaw(
            actor.root.rotation.y,
            fighter.approachHeading ?? Math.atan2(
              fighter.target.position.x - fighter.position.x,
              fighter.target.position.z - fighter.position.z,
            ),
            dt,
          );
        actor.combatPose(dt, fighter);
        continue;
      }
      const heading = routine.attention.target
        ? undefined
        : walkNpc(fighter, p, ground, this.visitors.people, dt);
      routine.attention.update(
        clock,
        dt,
        actor.root.position,
        this.visitors.people,
        (visitor) => this.visitors.canSee(actor!.root.position, visitor),
        actor.root.rotation.y,
      );
      const target = routine.attention.target;
      const desired = target
        ? Math.atan2(target.x - fighter.position.x, target.z - fighter.position.z)
        : (heading ?? p.angle);
      actor.root.rotation.y = attentionYaw(actor.root.rotation.y, desired, dt);
      actor.update(
        dt,
        !!target,
        heading !== undefined ? 'walk' : p.motion === 'walk' ? 'idle' : p.motion,
        target ? { x: target.x, y: target.eyeY, z: target.z } : undefined,
      );
    }
  }

  private considerNextStop(clock: number): void {
    if (!this.plannerAvailable || this.pending || clock < this.nextThink) return;
    const state = this.ctx.state;
    for (const j of this.visible) {
      if (this.ctx.state.infectedPeople.has('traveller:'+hashString(j.trail.id)) || this.routine(j).attention.target || this.fighters.get(j)?.busy) continue;
      const previous = state.travellerLegs.get(j.trail.id);
      if (clock < (this.attempted.get(j) ?? 0) || !decisionDue(j, clock, previous)) continue;
      this.attempted.set(j, clock + 22);
      this.nextThink = clock + 6;
      if (this.ctx.net) this.ctx.net.requestTravellerPlan(j.trail.id);
      else void this.planLocally(j);
      break;
    }
  }

  private async planLocally(j: Journey): Promise<void> {
    const state = this.ctx.state;
    const previous = state.travellerLegs.get(j.trail.id);
    const options = travelOptions(this.ctx.wilderness, state, j);
    if (!options.length) return;
    const controller = (this.pending = new AbortController());
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('/api/traveller-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          world: state.id,
          trail: j.trail.id,
          options: options.map(({ kind, place, metres, onward }) => ({ kind, place, metres, onward })),
          memory: rememberedSightings(this.ctx.wilderness, state, j),
        }),
        signal: controller.signal,
      });
      if (
        [204, 404, 405].includes(response.status) ||
        (response.ok && !response.headers.get('content-type')?.includes('application/json'))
      ) {
        this.plannerAvailable = false;
        return;
      }
      if (!response.ok) return;
      const { stop } = await response.json();
      if (
        controller.signal.aborted ||
        state.travellerLegs.get(j.trail.id) !== previous ||
        !Number.isInteger(stop) ||
        !options[stop]
      )
        return;
      commitTravellerStop(this.ctx.wilderness, state, j, options[stop]!.at);
    } catch {
      // Keep walking the last accepted route while the service is unavailable.
    } finally {
      clearTimeout(timer);
      this.pending = undefined;
    }
  }

  dispose(): void {
    this.stopSurvey();
    for (const fighter of this.fighters.values()) fighter.dispose();
    this.fighters.clear();
    this.pending?.abort();
    for (const off of this.removePrompt.values()) off();
    this.removePrompt.clear();
    for (const actor of this.actors.values()) actor.dispose();
    this.actors.clear();
    this.visible.clear();
  }
}
