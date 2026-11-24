import * as THREE from 'three';
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import { sceneKey, type GameContext } from '@/game/types';
import { KayKitVillager, loadVillager } from '@/systems/figures/kaykit-villager';
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
import { journeyOn, travellerPose, type Journey } from '@/world/wilderness/travellers';

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

  constructor(
    private readonly ctx: GameContext,
    private readonly root: THREE.Group,
    private readonly material: THREE.Material,
  ) {}

  update(dt: number, loaded: ReadonlyMap<string, { trails: readonly Trail[] }>): void {
    if (typeof window === 'undefined') return;
    const clock = this.ctx.state.clock;
    const player = this.ctx.player.position;
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
        const p = travellerPose(j, clock, this.ctx.state.travellerLegs.get(j.trail.id));
        const d = (p.x - player.x) ** 2 + (p.z - player.z) ** 2;
        const size = TUNING.world.chunkSize;
        if (d < 140 ** 2 && loaded.has(chunkKey(Math.floor(p.x / size), Math.floor(p.z / size))))
          nearby.push({ j, d });
      }
      this.visible = new Set(
        nearby
          .sort((a, b) => a.d - b.d)
          .slice(0, 6)
          .map((n) => n.j),
      );
      this.considerNextStop(clock);
      for (const [j, actor] of this.actors)
        if (!this.visible.has(j)) {
          this.removePrompt.get(j)?.();
          this.removePrompt.delete(j);
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
      let actor = this.actors.get(j);
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
          const words = askTraveller(ctx.wilderness, ctx.state, j, (e) => ctx.cities.layout(e).name, topic);
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
            label: () => (ctx.arena?.inside ? null : 'E 问旅行者从哪来、到哪去'),
            activate: () => reply('route'),
            alt: { label: () => 'F 打听附近村况', activate: () => reply('news') },
            talk: { label: () => 'T 聊聊去过的村子和路上的见闻', activate: () => reply('memory') },
          }),
        );
      }
      const p = travellerPose(j, clock, this.ctx.state.travellerLegs.get(j.trail.id));
      const w = this.ctx.wilderness;
      const y = pathsOf(w).bridgeAt(p.x, p.z)?.y ?? w.heightAt(p.x, p.z) + 0.04;
      actor.root.position.set(p.x, y, p.z);
      actor.root.rotation.y = p.angle;
      actor.update(dt, actor.root.position.distanceToSquared(player) < 3.5 ** 2, p.motion);
    }
  }

  private considerNextStop(clock: number): void {
    if (!this.plannerAvailable || this.pending || clock < this.nextThink) return;
    const state = this.ctx.state;
    for (const j of this.visible) {
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
    this.pending?.abort();
    for (const off of this.removePrompt.values()) off();
    this.removePrompt.clear();
    for (const actor of this.actors.values()) actor.dispose();
    this.actors.clear();
    this.visible.clear();
  }
}
