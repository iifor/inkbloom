import type { PhysicsWorld } from '@/engine/physics/world';
import { type NpcFighter, inkFighter, populationSurvey } from '@/systems/combat/npc-combat';
import * as THREE from 'three';
import { TUNING } from '@/content/tuning';
import { sceneKey, type GameContext } from '@/game/types';
import { InkAnimal, animalTemplate, type InkAnimalKey } from '@/systems/combat/ink-animal';
import { KayKitVillager, loadVillager, type VillagerModel } from '@/systems/figures/kaykit-villager';
import { NpcVisitors } from '@/systems/figures/npc-visitors';
import { NpcAttention, attentionYaw } from '@/world/npc-attention';
import { hashInts, unit } from '@/world/math/hash';
import { lifeInChunk, lifeGround, type LifeSite } from '@/world/wilderness/ambient-life';
import { chunkSaturation } from '@/world/wilderness/wild-monsters';
import { WATER_LEVEL } from '@/world/wilderness/generator';
import type { Box } from '@/engine/physics/world';

const ANIMALS: Record<string, { key: InkAnimalKey; height: number; speed: number }> = {
  rabbit: { key: 'big/Bunny', height: 0.52, speed: 3.5 },
  bird: { key: 'blob/Pigeon', height: 0.38, speed: 2.8 },
  boar: { key: 'cute/Pig', height: 0.85, speed: 2.6 },
};
const PEOPLE: Record<string, { key: VillagerModel; title: string; words: string }> = {
  gatherer: {
    key: 'rogue',
    title: '采集人',
    words: '我在附近找些草药。林边常有小动物，走轻些就不会惊动它们。',
  },
  ranger: {
    key: 'knight',
    title: '巡路人',
    words: '沿着路走更安全。远离村子的荒地偶尔有墨怪，别独自追得太远。',
  },
  walker: {
    key: 'rogue-hooded',
    title: '歇脚的旅人',
    words: '赶了一段路，在这里歇歇脚。你也不必一直赶路，看看沿途的风景吧。',
  },
};
interface Resident {
  site: LifeSite;
  animal?: InkAnimal;
  person?: KayKitVillager;
  fighter?: NpcFighter;
  attention: NpcAttention;
  at: THREE.Vector3;
  target: THREE.Vector3;
  yaw: number;
  next: number;
  walk: number;
  elapsed: number;
  off?: () => void;
}

/** Bounded, cosmetic wildlife and roadside outings. Combat remains host-authoritative. */
export class WildAmbientLife {
  private readonly sites = new Map<string, LifeSite[]>();
  private readonly actors = new Map<string, Resident>();
  private wanted: { id: string; site: LifeSite; index: number }[] = [];
  private readonly sources = new Map<VillagerModel, Awaited<ReturnType<typeof loadVillager>>>();
  private readonly retry = new Map<VillagerModel, number>();
  private readonly visitors: NpcVisitors;
  private readonly ray = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly lower = new THREE.Vector3();
  private readonly upper = new THREE.Vector3();
  private readonly boxes: Box[] = [];
  private check = 0;
  private spawnCursor = 0;
  private disposed = false;
  private readonly stopSurvey: () => void;

  constructor(
    private readonly ctx: GameContext,
    private readonly root: THREE.Group,
    private readonly material: THREE.Material,
    private readonly physics: PhysicsWorld,
  ) {
    this.visitors = new NpcVisitors(ctx);
    this.stopSurvey = populationSurvey(ctx,physics,healthy => {
      for (const sites of this.sites.values()) for (const s of sites) if (s.person) {
        for(let i=0;i<s.count;i++){ const id=s.id+':'+i; if(healthy(id,this.actors.get(id)?.at ?? s)) return true; }
      }
      return false;
    });
  }

  update(dt: number, loaded: ReadonlyMap<string, unknown>): void {
    const { wilderness: w, player } = this.ctx;
    const clock = this.ctx.state.clock;
    this.visitors.update();
    // Amortize habitat queries as terrain streams in instead of doing a whole ring at once.
    for (const key of loaded.keys()) {
      if (this.sites.has(key)) continue;
      const [cx, cz] = key.split(',').map(Number);
      if (Number.isFinite(cx) && Number.isFinite(cz)) this.sites.set(key, lifeInChunk(w, cx!, cz!));
      break;
    }
    this.check -= dt;
    if (this.check <= 0) {
      this.check = 1;
      for (const key of this.sites.keys()) if (!loaded.has(key)) this.sites.delete(key);
      const nearby: LifeSite[] = [];
      for (const key of loaded.keys()) {
        const [cx, cz] = key.split(',').map(Number);
        if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;
        if (!this.sites.has(key)) continue;
        if (chunkSaturation(w, cx!, cz!, (id) => this.ctx.cities.progress(id)) < TUNING.combat.wild.greyBelow)
          continue;
        for (const site of this.sites.get(key)!) {
          if (Math.hypot(site.x - player.position.x, site.z - player.position.z) < 170) nearby.push(site);
        }
      }
      nearby.sort(
        (a, b) =>
          Math.hypot(a.x - player.position.x, a.z - player.position.z) -
          Math.hypot(b.x - player.position.x, b.z - player.position.z),
      );
      this.wanted = [];
      let animals = 0,
        people = 0;
      for (const site of nearby) {
        for (let i = 0; i < site.count; i++) {
          if (site.person ? people >= 4 : animals >= 20) break;
          if (site.person) people++;
          else animals++;
          this.wanted.push({ id: `${site.id}:${i}`, site, index: i });
        }
      }
      const keep = new Set(this.wanted.map((a) => a.id));
      for (const [id, a] of this.actors)
        if (!keep.has(id)) {
          this.release(a);
          this.actors.delete(id);
        }
    }
    // At most one skeleton clone per frame; retry missing assets without blocking generation.
    for (let attempt = 0; attempt < Math.min(2, this.wanted.length); attempt++) {
      const candidate = this.wanted[this.spawnCursor++ % this.wanted.length]!;
      if (this.actors.has(candidate.id)) continue;
      if (this.spawn(candidate.id, candidate.site, candidate.index)) break;
    }
    for (const [id,a] of this.actors) {
      a.elapsed += dt;
      const distance = Math.hypot(a.at.x - player.position.x, a.at.z - player.position.z);
      if (distance > 65 && a.elapsed < 0.1) continue;
      const step = Math.min(a.elapsed, 0.2);
      a.elapsed = 0;
      if (a.person) {
        a.person.root.visible = !this.ctx.state.infectedPeople.has(id);
        if(!a.person.root.visible) { a.fighter?.dispose(); a.fighter=undefined; continue; }
        a.fighter ??= inkFighter(this.ctx, this.physics, a.at,id);
        a.fighter.update(step, this.physics.ground, this.visitors.people);
        if (a.fighter.busy) {
          a.attention.hold(clock);
          a.next += step;
          if (a.fighter.target && !a.fighter.down)
            a.yaw = attentionYaw(
              a.yaw,
              a.fighter.approachHeading ?? Math.atan2(a.fighter.target.position.x - a.at.x, a.fighter.target.position.z - a.at.z),
              step,
            );
          a.person.root.position.copy(a.at);
          a.person.root.rotation.y = a.yaw;
          a.person.combatPose(step, a.fighter);
          continue;
        }
      }
      a.attention.update(
        clock,
        step,
        a.at,
        a.person ? this.visitors.people : [],
        (v) => this.visitors.canSee(a.at, v),
        a.yaw,
      );
      const visitor = a.attention.target;
      const def = ANIMALS[a.site.kind];
      const flee = !!a.animal && distance < (player.speed > 5 ? 13 : 7) && !player.flying && !player.gliding;
      let speed = 0;
      if (!visitor) {
        if (clock >= a.next) {
          const h = hashInts(a.site.seed, Math.floor(clock / 7), Math.round(a.walk));
          const angle = unit(h) * Math.PI * 2;
          const radius = a.site.person ? 3 : 9;
          const x = a.site.x + Math.sin(angle) * radius * unit(hashInts(h, 1));
          const z = a.site.z + Math.cos(angle) * radius * unit(hashInts(h, 1));
          if (lifeGround(w, x, z, 1)) a.target.set(x, w.heightAt(x, z), z);
          a.next = clock + 7 + unit(hashInts(h, 2)) * 7;
        }
        if (flee) {
          const angle = Math.atan2(a.at.x - player.position.x, a.at.z - player.position.z);
          // Keep the encounter local, so scared wildlife cannot run into unloaded terrain.
          const x = a.at.x + Math.sin(angle) * 3,
            z = a.at.z + Math.cos(angle) * 3;
          if (Math.hypot(x - a.site.x, z - a.site.z) < 14) a.target.set(x, w.heightAt(x, z), z);
        }
        const dx = a.target.x - a.at.x,
          dz = a.target.z - a.at.z;
        const remaining = Math.hypot(dx, dz);
        if (remaining > 0.2) {
          speed = flee ? def!.speed : a.site.person ? 0.85 : 0.55;
          const travel = Math.min(remaining, speed * step);
          const x = a.at.x + (dx / remaining) * travel,
            z = a.at.z + (dz / remaining) * travel;
          const y = w.heightAt(x, z);
          this.ray.copy(a.at).y += 0.35;
          this.direction.set(dx / remaining, 0, dz / remaining);
          if (
            Math.abs(y - a.at.y) < Math.max(0.12, travel * 0.6) &&
            y > WATER_LEVEL + 0.6 &&
            this.freeAt(x, y, z, a.site.person) &&
            !this.ctx.scenes.active.physics.raycast(this.ray, this.direction, travel + 0.35)
          ) {
            a.at.set(x, y, z);
            a.yaw = attentionYaw(a.yaw, Math.atan2(dx, dz), step);
            a.walk += travel * 7;
          } else {
            a.target.copy(a.at);
            speed = 0;
          }
        }
      } else a.yaw = attentionYaw(a.yaw, Math.atan2(visitor.x - a.at.x, visitor.z - a.at.z), step);
      if (a.person) {
        a.person.root.position.copy(a.at);
        a.person.root.rotation.y = a.yaw;
        a.person.update(
          step,
          !!visitor,
          speed ? 'walk' : a.site.kind === 'gatherer' ? 'interact' : 'idle',
          visitor && { x: visitor.x, y: visitor.eyeY, z: visitor.z },
        );
      } else
        a.animal!.pose(
          {
            x: a.at.x,
            y: a.at.y,
            z: a.at.z,
            yaw: a.yaw,
            walk: a.walk,
            stride: speed ? 1 : 0,
            attack: -1,
            hurt: 0,
            air: false,
            dying: -1,
            t: clock + unit(a.site.seed) * 10,
            colors: [],
          },
          def!.height,
        );
    }
  }

  private spawn(id: string, site: LifeSite, index: number): boolean {
    const person = PEOPLE[site.kind],
      animal = ANIMALS[site.kind];
    const angle = index * 2.4 + unit(site.seed) * 6.28;
    let at: THREE.Vector3 | undefined;
    for (let attempt = 0; attempt < 8; attempt++) {
      const theta = angle + attempt * 2.4;
      const radius = attempt ? 1 + attempt * 0.5 : index;
      const x = site.x + Math.sin(theta) * radius,
        z = site.z + Math.cos(theta) * radius;
      const y = this.ctx.wilderness.heightAt(x, z);
      if (lifeGround(this.ctx.wilderness, x, z, 1) && this.freeAt(x, y, z, site.person)) {
        at = new THREE.Vector3(x, y, z);
        break;
      }
    }
    if (!at) return false;
    let figure: KayKitVillager | InkAnimal;
    if (site.person) {
      const source = this.sources.get(person!.key);
      if (!source) {
        if (performance.now() >= (this.retry.get(person!.key) ?? 0)) {
          this.retry.set(person!.key, Infinity);
          void loadVillager(person!.key)
            .then((s) => {
              if (!this.disposed) this.sources.set(person!.key, s);
            })
            .catch(() => this.retry.set(person!.key, performance.now() + 15000));
        }
        return false;
      }
      figure = new KayKitVillager(source, unit(site.seed) * 5, undefined, site.seed);
    } else {
      const source = animalTemplate(animal!.key);
      if (!source) return false;
      figure = new InkAnimal(animal!.key, source, this.material);
    }
    const a: Resident = {
      site,
      at,
      target: at.clone(),
      attention: new NpcAttention(),
      yaw: angle,
      next: this.ctx.state.clock + index,
      walk: index,
      elapsed: 0,
    };
    if (figure instanceof KayKitVillager) a.person = figure;
    else a.animal = figure;
    figure.root.name = id;
    figure.root.position.copy(at);
    this.root.add(figure.root);
    this.actors.set(id, a);
    if (person)
      a.off = this.ctx.interactions.add({
        scene: sceneKey(this.ctx.scenes.active.ref),
        pos: figure.root.position,
        radius: 3,
        label: () => (this.ctx.arena?.inside || this.ctx.state.infectedPeople.has(id) ? null : `E 和${person.title}打招呼`),
        activate: () =>
          this.ctx.events.emit('toast', { text: `${person.title}：「${person.words}」`, seconds: 6 }),
      });
    return true;
  }

  private release(a: Resident): void {
    a.fighter?.dispose();
    a.off?.();
    a.person?.dispose();
    a.animal?.dispose();
  }
  private freeAt(x: number, y: number, z: number, person: boolean): boolean {
    this.lower.set(x - 0.35, y + 0.08, z - 0.35);
    this.upper.set(x + 0.35, y + (person ? 1.7 : 0.9), z + 0.35);
    return this.ctx.scenes.active.physics.query(this.lower, this.upper, this.boxes).length === 0;
  }
  dispose(): void {
    this.stopSurvey();
    this.disposed = true;
    for (const a of this.actors.values()) this.release(a);
    this.actors.clear();
    this.sites.clear();
    this.sources.clear();
    this.wanted = [];
  }
}
