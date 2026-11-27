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
import { calendarAt, calendarClock } from '@/world/climate/calendar';
import { dayHours } from '@/engine/render/daylight';
import { color } from '@/content/palette';
import { ruinById } from '@/world/wilderness/ruins';
import { spiderWeb } from './spider-web';
import type { Box } from '@/engine/physics/world';

const ANIMALS: Record<string, { key: InkAnimalKey; height: number; speed: number }> = {
  fox: { key: 'Fox', height: 0.53, speed: 3.8 },
  cow: { key: 'Cow', height: 1.45, speed: 1.15 },
  donkey: { key: 'Donkey', height: 1.42, speed: 1.4 },
  horse: { key: 'Horse', height: 1.83, speed: 1.7 },
  rabbit: { key: 'big/Bunny', height: 0.52, speed: 3.5 },
  bird: { key: 'blob/Pigeon', height: 0.38, speed: 2.8 },
  boar: { key: 'cute/Pig', height: 0.85, speed: 2.6 },
  chick: { key: 'cute/Chicken', height: 0.32, speed: 1.6 },
  cat: { key: 'blob/Cat', height: 0.42, speed: 0 },
  bee: { key: 'cute/Bee', height: 0.14, speed: 0 },
  frog: { key: 'big/Frog', height: 0.25, speed: 2.1 },
  dog: { key: 'blob/Dog', height: 0.62, speed: 1.2 },
  crab: { key: 'cute/Crab', height: 0.24, speed: 1.25 },
  bat: { key: 'cute/Bat', height: 0.36, speed: 0 },
  panda: { key: 'cute/Panda', height: 0.82, speed: 0.45 },
  mushroom: { key: 'cute/Mushroom', height: 0.36, speed: 0 },
  penguin: { key: 'cute/Penguin', height: 0.52, speed: 1.15 },
  berrybird: { key: 'blob/Birb', height: 0.34, speed: 2.0 },
  springSpirit: { key: 'flying/Glub', height: 0.44, speed: 0 },
  ridgeDragon: { key: 'flying/Dragon', height: 1.05, speed: 0 },
  fieldMouse: { key: 'rat', height: 0.22, speed: 2.3 },
  grassSnake: { key: 'snake', height: 0.28, speed: 1.45 },
  oreSpirit: { key: 'flying/Goleling', height: 0.58, speed: 0 },
  elderSpirit: { key: 'cute/Tree', height: 0.91, speed: 0 },
  silkSpider: { key: 'spider', height: 0.14, speed: 0 },
  ruinGhost: { key: 'cute/Ghost', height: 0.78, speed: 0 },
};
const stockCoat = {
  Hair: color('bark'),
  Hooves: color('charcoal'),
  Muzzle: color('sand'),
  Main_Dark: color('bark'),
  Main_Light: color('cream'),
  Horns: color('sand'),
  Eye_Black: color('ink'),
  Eye_Dark: color('ink'),
  Eye_White: color('cream'),
};
const LOCAL_COATS: Record<string, Record<string, number>> = {
  fox: {
    Main: color('clayTile'),
    Main_Light: color('cream'),
    Grey: color('sand'),
    Black: color('bark'),
    Eyes: color('ink'),
  },
  cow: { ...stockCoat, Main: color('brown') },
  donkey: { ...stockCoat, Main: color('rock') },
  horse: { ...stockCoat, Main: color('clayTile') },
  fieldMouse: { Grey: color('brown'), Pink: color('skinWarm') },
  grassSnake: {
    DarkGreen: color('forest'),
    LightGreen: color('green'),
    Yellow: color('sand'),
    Purple: color('bark'),
    Teeth: color('cream'),
    Red: color('red'),
    DarkRed: color('clayTile'),
  },
  silkSpider: { Material: color('bark'), 'Material.001': color('sand') },
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
  crouch?: number;
  web?: ReturnType<typeof spiderWeb>;
  hop?: { from: THREE.Vector3; elapsed: number };
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
    this.stopSurvey = populationSurvey(ctx, physics, (healthy) => {
      for (const sites of this.sites.values())
        for (const s of sites)
          if (s.person) {
            for (let i = 0; i < s.count; i++) {
              const id = s.id + ':' + i;
              if (healthy(id, this.actors.get(id)?.at ?? s)) return true;
            }
          }
      return false;
    });
  }

  update(dt: number, loaded: ReadonlyMap<string, { fauna: readonly LifeSite[] }>): void {
    const { wilderness: w, player } = this.ctx;
    const clock = this.ctx.state.clock;
    this.visitors.update();
    // Amortize habitat queries as terrain streams in instead of doing a whole ring at once.
    for (const key of loaded.keys()) {
      if (this.sites.has(key)) continue;
      const [cx, cz] = key.split(',').map(Number);
      if (Number.isFinite(cx) && Number.isFinite(cz))
        this.sites.set(key, [...lifeInChunk(w, cx!, cz!), ...loaded.get(key)!.fauna]);
      break;
    }
    this.check -= dt;
    if (this.check <= 0) {
      this.check = 1;
      const cal = calendarAt(calendarClock(this.ctx.state, !!this.ctx.net));
      const afterSunset = Math.abs(cal.hour - 12) > dayHours(cal.declination) / 2;
      for (const key of this.sites.keys()) if (!loaded.has(key)) this.sites.delete(key);
      const nearby: LifeSite[] = [];
      for (const key of loaded.keys()) {
        const [cx, cz] = key.split(',').map(Number);
        if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;
        if (!this.sites.has(key)) continue;
        if (chunkSaturation(w, cx!, cz!, (id) => this.ctx.cities.progress(id)) < TUNING.combat.wild.greyBelow)
          continue;
        for (const site of this.sites.get(key)!) {
          if (
            site.kind === 'ruinGhost' &&
            (!afterSunset || !this.ctx.state.discovered.includes(site.landmarkId!))
          )
            continue;
          if (
            site.kind === 'fieldMouse' &&
            !afterSunset &&
            Math.abs(cal.hour - 12) < dayHours(cal.declination) / 2 - 1.5
          )
            continue;
          if (site.kind === 'bat' && !afterSunset) continue;
          if (site.kind === 'penguin' && cal.season !== 3) continue;
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
    for (const [id, a] of this.actors) {
      a.elapsed += dt;
      const distance = Math.hypot(a.at.x - player.position.x, a.at.z - player.position.z);
      if (distance > 65 && a.elapsed < 0.1) continue;
      const step = Math.min(a.elapsed, 0.2);
      a.elapsed = 0;
      if (a.animal && this.habitatPose(a, step, clock, distance)) continue;
      if (a.person) {
        a.person.root.visible = !this.ctx.state.infectedPeople.has(id);
        if (!a.person.root.visible) {
          a.fighter?.dispose();
          a.fighter = undefined;
          continue;
        }
        a.fighter ??= inkFighter(this.ctx, this.physics, a.at, id);
        a.fighter.update(step, this.physics.ground, this.visitors.people);
        if (a.fighter.busy) {
          a.attention.hold(clock);
          a.next += step;
          if (a.fighter.target && !a.fighter.down)
            a.yaw = attentionYaw(
              a.yaw,
              a.fighter.approachHeading ??
                Math.atan2(a.fighter.target.position.x - a.at.x, a.fighter.target.position.z - a.at.z),
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
      const dog = a.site.kind === 'dog',
        crab = a.site.kind === 'crab',
        panda = a.site.kind === 'panda',
        penguin = a.site.kind === 'penguin';
      const watching = dog && distance < 4 && Math.abs(player.position.y - a.at.y) < 2.5;
      const stock = a.site.kind === 'cow' || a.site.kind === 'horse' || a.site.kind === 'donkey';
      const forager = a.site.kind === 'chick' || a.site.kind === 'berrybird';
      const burrowing = a.site.kind === 'fieldMouse' || a.site.kind === 'grassSnake';
      const flee =
        !!a.animal &&
        !dog &&
        !stock &&
        !panda &&
        distance < (crab || penguin ? 3 : player.speed > 5 ? 13 : 7) &&
        !player.flying &&
        !player.gliding;
      let speed = 0;
      if (watching) {
        a.yaw = attentionYaw(a.yaw, Math.atan2(player.position.x - a.at.x, player.position.z - a.at.z), step);
      } else if (!visitor) {
        if (clock >= a.next) {
          const h = hashInts(a.site.seed, Math.floor(clock / 7), Math.round(a.walk));
          const angle = unit(h) * Math.PI * 2;
          const radius =
            forager || burrowing ? 2.5 : stock || dog || crab || panda || penguin || a.site.person ? 3 : 9;
          const x = a.site.x + Math.sin(angle) * radius * unit(hashInts(h, 1));
          const z =
            a.site.z + Math.cos(angle) * (a.site.kind === 'fieldMouse' ? 0.3 : radius) * unit(hashInts(h, 1));
          const y = w.heightAt(x, z);
          if (crab ? crabShore(y) : lifeGround(w, x, z, 1)) a.target.set(x, y, z);
          a.next = clock + 7 + unit(hashInts(h, 2)) * 7;
        }
        if (flee && burrowing && a.site.shelter) {
          const { x, z } = a.site.shelter;
          a.target.set(x, w.heightAt(x, z), z);
        } else if (a.site.kind === 'grassSnake') {
          // Return to the sunning spot when the reeds are quiet again.
          a.target.set(a.site.x, w.heightAt(a.site.x, a.site.z), a.site.z);
        } else if (flee) {
          const angle = Math.atan2(a.at.x - player.position.x, a.at.z - player.position.z);
          // Keep the encounter local, so scared wildlife cannot run into unloaded terrain.
          const x = a.at.x + Math.sin(angle) * 3,
            z = a.at.z + Math.cos(angle) * 3;
          if (Math.hypot(x - a.site.x, z - a.site.z) < (forager || crab || penguin ? 5 : 14))
            a.target.set(x, w.heightAt(x, z), z);
        }
        const dx = a.target.x - a.at.x,
          dz = a.target.z - a.at.z;
        const remaining = Math.hypot(dx, dz);
        if (remaining > 0.2) {
          speed = flee || panda ? def!.speed : a.site.person ? 0.85 : 0.55;
          const travel = Math.min(remaining, speed * step);
          const x = a.at.x + (dx / remaining) * travel,
            z = a.at.z + (dz / remaining) * travel;
          const y = w.heightAt(x, z);
          this.ray.copy(a.at).y += 0.35;
          this.direction.set(dx / remaining, 0, dz / remaining);
          if (
            Math.abs(y - a.at.y) < Math.max(0.12, travel * 0.6) &&
            (crab ? crabShore(y) : y > WATER_LEVEL + (a.site.kind === 'grassSnake' ? 0.12 : 0.6)) &&
            this.freeAt(x, y, z, a.site.person) &&
            !this.ctx.scenes.active.physics.raycast(this.ray, this.direction, travel + 0.35)
          ) {
            a.at.set(x, y, z);
            a.yaw = attentionYaw(a.yaw, Math.atan2(dx, dz) + (crab ? Math.PI / 2 : 0), step);
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
      } else {
        a.animal!.pose(
          {
            x: a.at.x,
            y: a.at.y,
            z: a.at.z,
            yaw: dog || panda || penguin || a.site.kind === 'berrybird' ? a.yaw + Math.PI : a.yaw,
            walk: a.walk,
            stride: stock || a.site.kind === 'fox' ? speed : speed ? 1 : 0,
            attack: -1,
            hurt: 0,
            air: false,
            dying: -1,
            t: clock + unit(a.site.seed) * 10,
            colors: [],
          },
          def!.height,
        );
        if (forager && speed === 0) {
          const peck = Math.max(0, Math.sin(clock * 3.8 + a.walk)) ** 6;
          a.animal!.root.rotateX((a.site.kind === 'berrybird' ? 0.42 : -0.34) * peck);
        }
        if (panda && speed === 0) a.animal!.root.rotateX(0.12 * (0.5 + 0.5 * Math.sin(clock * 1.9 + a.walk)));
        if (penguin && speed > 0) a.animal!.root.rotateZ(0.12 * Math.sin(a.walk * 2));
      }
    }
  }

  private habitatPose(a: Resident, dt: number, clock: number, distance: number): boolean {
    const { site, at } = a;
    if (
      site.kind !== 'cat' &&
      site.kind !== 'mushroom' &&
      site.kind !== 'bee' &&
      site.kind !== 'frog' &&
      site.kind !== 'oreSpirit' &&
      site.kind !== 'elderSpirit' &&
      site.kind !== 'silkSpider' &&
      site.kind !== 'ruinGhost' &&
      site.flightY === undefined &&
      site.kind !== 'bat'
    )
      return false;
    const w = this.ctx.wilderness,
      player = this.ctx.player;
    const phase = clock + a.walk + unit(site.seed) * 12;
    let lift = 0,
      airborne = false,
      cycle = 0;
    if (site.kind === 'oreSpirit') {
      const since = clock - (this.ctx.state.harvested.get(site.landmarkId!) ?? -Infinity);
      const progress = THREE.MathUtils.clamp(since / 2.8, 0, 1);
      const angle = unit(site.seed) * 6.28 + (since >= 0 && since < 2.8 ? Math.PI * 2 * progress : 0);
      const x = site.x + 2.55 * Math.sin(angle),
        z = site.z + 2.55 * Math.cos(angle);
      const y = w.heightAt(x, z) + 0.22 + 0.07 * Math.sin(phase * 2) + 1.3 * Math.sin(progress * Math.PI);
      if (this.freeAt(x, y, z, false)) at.set(x, y, z);
      a.yaw = angle + Math.PI / 2;
      airborne = true;
    } else if (site.kind === 'elderSpirit') {
      const staying = distance < 6 && player.speed < 0.5 && Math.abs(player.position.y - at.y) < 2.5;
      a.crouch = THREE.MathUtils.clamp((a.crouch ?? 0) + (staying ? dt : -dt * 2), 0, 3);
      if (a.crouch > 1.2)
        a.yaw = attentionYaw(a.yaw, Math.atan2(player.position.x - at.x, player.position.z - at.z), dt);
    } else if (site.kind === 'silkSpider') {
      if (a.web) a.web.material.opacity = 0.28 + 0.45 * this.ctx.renderer.atmosphere.weather.wet;
      lift = 0.06 + 0.035 * Math.sin(phase);
    } else if (site.kind === 'ruinGhost') {
      const angle = phase * 0.55;
      const x = site.x + 2.3 * Math.sin(angle),
        z = site.z + 0.45 * Math.cos(angle);
      const y = w.heightAt(x, z) + 0.5 + 0.14 * Math.sin(phase * 1.25);
      if (this.freeAt(x, y, z, false)) {
        at.set(x, y, z);
        a.yaw = Math.atan2(2.3 * Math.cos(angle), -0.45 * Math.sin(angle));
      }
    } else if (site.flightY !== undefined) {
      const point = this.direction;
      const yaw = landmarkFlight(site, site.flightY, phase, point);
      if (this.freeAt(point.x, point.y, point.z, false)) {
        at.copy(point);
        a.yaw = yaw;
      }
      airborne = true;
    } else if (site.kind === 'bat') {
      const angle = phase * 1.4,
        x = site.x + 3 * Math.sin(angle),
        z = site.z + 1.8 * Math.cos(angle);
      const y = w.heightAt(x, z) + 3.2 + 0.6 * Math.sin(angle * 2);
      if (this.freeAt(x, y, z, false)) {
        at.set(x, y, z);
        a.yaw = Math.atan2(3 * Math.cos(angle), -1.8 * Math.sin(angle));
      }
    } else if (site.kind === 'bee') {
      const x = site.x + 1.3 * Math.sin(phase * 1.3),
        z = site.z + 0.75 * Math.sin(phase * 2.6);
      const y = w.heightAt(x, z) + 0.75 + 0.22 * Math.cos(phase * 2.4);
      if (this.freeAt(x, y, z, false)) {
        a.yaw = Math.atan2(1.3 * 1.3 * Math.cos(phase * 1.3), 0.75 * 2.6 * Math.cos(phase * 2.6));
        at.set(x, y, z);
      }
    } else if (site.kind === 'mushroom') {
      const close = Math.abs(player.position.y - at.y) < 2.5 && distance < 3;
      a.crouch = THREE.MathUtils.damp(a.crouch ?? 0, close ? 1 : 0, close ? 5 : 2, dt);
    } else if (site.kind === 'cat') {
      if (distance < 6)
        a.yaw = attentionYaw(a.yaw, Math.atan2(player.position.x - at.x, player.position.z - at.z), dt);
    } else {
      const startled =
        distance < 5 && !player.flying && !player.gliding && Math.abs(player.position.y - at.y) < 2;
      if (!a.hop && clock >= a.next && startled) {
        a.next = clock + 1.2;
        const away = Math.atan2(at.x - player.position.x, at.z - player.position.z);
        for (const turn of [0, 0.9, -0.9, 1.6, -1.6]) {
          const yaw = away + turn,
            x = at.x + 1.05 * Math.sin(yaw),
            z = at.z + 1.05 * Math.cos(yaw);
          const y = w.heightAt(x, z);
          if (
            Math.hypot(x - site.x, z - site.z) > 4 ||
            y < WATER_LEVEL + 0.05 ||
            y > WATER_LEVEL + 2 ||
            Math.abs(y - at.y) > 0.45
          )
            continue;
          this.ray.copy(at).y += 0.22;
          this.direction.set(Math.sin(yaw), 0, Math.cos(yaw));
          if (!this.freeAt(x, y, z, false) || this.physics.raycast(this.ray, this.direction, 1.2)) continue;
          a.yaw = yaw;
          a.target.set(x, y, z);
          a.hop = { from: at.clone(), elapsed: 0 };
          break;
        }
      }
      if (a.hop) {
        a.hop.elapsed += dt;
        cycle = Math.min(1, a.hop.elapsed / 0.48);
        at.lerpVectors(a.hop.from, a.target, cycle);
        lift = 0.34 * Math.sin(cycle * Math.PI);
        airborne = cycle < 1;
        if (!airborne) a.hop = undefined;
      }
    }
    a.animal!.pose(
      {
        x: at.x,
        y: at.y + lift,
        z: at.z,
        yaw:
          site.kind === 'bat' ||
          site.kind === 'oreSpirit' ||
          site.kind === 'elderSpirit' ||
          site.kind === 'ruinGhost' ||
          site.flightY !== undefined
            ? a.yaw + Math.PI
            : a.yaw,
        walk: cycle * 2 * Math.PI,
        stride: 0,
        air: airborne,
        attack: -1,
        hurt: 0,
        dying: -1,
        t: site.kind === 'elderSpirit' ? Math.max(0, (a.crouch ?? 0) - 1.2) : phase,
        colors: [],
      },
      ANIMALS[site.kind]!.height,
    );
    if (site.kind === 'cat') a.animal!.root.scale.y *= 0.84;
    if (site.kind === 'elderSpirit') a.animal!.root.scale.y *= 0.8 + 0.2 * Math.min(1, (a.crouch ?? 0) / 2.4);
    if (site.kind === 'mushroom') {
      a.animal!.root.scale.y *= 1 - 0.62 * a.crouch!;
      a.animal!.root.rotateZ(0.09 * Math.sin(phase * 2) * (1 - a.crouch!));
    }
    return true;
  }

  private spawn(id: string, site: LifeSite, index: number): boolean {
    const person = PEOPLE[site.kind],
      animal = ANIMALS[site.kind];
    const angle = index * 2.4 + unit(site.seed) * 6.28;
    let at: THREE.Vector3 | undefined;
    if (site.flightY !== undefined) {
      const point = new THREE.Vector3();
      landmarkFlight(site, site.flightY, this.ctx.state.clock + index + unit(site.seed) * 12, point);
      if (!this.freeAt(point.x, point.y, point.z, false)) return false;
      at = point;
    }
    for (let attempt = 0; !at && attempt < 8; attempt++) {
      const theta = angle + attempt * 2.4;
      const radius = attempt ? 1 + attempt * 0.5 : index;
      const x = site.x + Math.sin(theta) * radius,
        z = site.z + Math.cos(theta) * radius;
      let y = this.ctx.wilderness.heightAt(x, z);
      if (site.kind === 'cat') {
        // The post is a modelled support. Only its exact position is a valid perch.
        if (attempt) break;
        y += 1.08;
      } else if (site.kind === 'bee') y += 0.75;
      else if (site.kind === 'bat') y += 3.2;
      else if (site.kind === 'oreSpirit') y += 1.8;
      else if (site.kind === 'ruinGhost') y += 0.6;
      if (site.kind === 'silkSpider' && attempt) return false;
      const valid =
        site.kind === 'frog'
          ? y >= WATER_LEVEL + 0.05 && y <= WATER_LEVEL + 2
          : site.kind === 'crab'
            ? crabShore(y)
            : site.kind === 'cat' ||
              (site.kind === 'grassSnake' && y > WATER_LEVEL + 0.12) ||
              site.kind === 'oreSpirit' ||
              site.kind === 'ruinGhost' ||
              site.kind === 'bee' ||
              site.kind === 'bat' ||
              lifeGround(this.ctx.wilderness, x, z, 1);
      if (valid && this.freeAt(x, y, z, site.person)) {
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
      const first = this.ctx.state.discovered[0];
      const crayon =
        site.kind === 'ruinGhost' && first ? ruinById(this.ctx.wilderness, first)?.color : undefined;
      figure = new InkAnimal(animal!.key, source, this.material, {
        slots: LOCAL_COATS[site.kind],
        tint: crayon === undefined ? undefined : { from: color('brown'), to: crayon },
      });
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
    if (site.kind === 'silkSpider' && site.shelter) {
      a.web = spiderWeb(site.shelter, at, (x, z) => this.ctx.wilderness.heightAt(x, z));
      this.root.add(a.web);
    }
    this.actors.set(id, a);
    if (person)
      a.off = this.ctx.interactions.add({
        scene: sceneKey(this.ctx.scenes.active.ref),
        pos: figure.root.position,
        radius: 3,
        label: () =>
          this.ctx.arena?.inside || this.ctx.state.infectedPeople.has(id)
            ? null
            : `E 和${person.title}打招呼`,
        activate: () =>
          this.ctx.events.emit('toast', { text: `${person.title}：「${person.words}」`, seconds: 6 }),
      });
    return true;
  }

  private release(a: Resident): void {
    if (a.web) {
      a.web.removeFromParent();
      a.web.geometry.dispose();
      a.web.material.dispose();
    }
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

function crabShore(y: number): boolean {
  return y >= WATER_LEVEL - 0.08 && y <= WATER_LEVEL + 1.1;
}

/** Sample the path and its tangent together so the model faces into each turn. */
function landmarkFlight(site: LifeSite, height: number, phase: number, out: THREE.Vector3): number {
  const dragon = site.kind === 'ridgeDragon';
  const angle = phase * (dragon ? 0.62 : 0.9);
  const rx = dragon ? 5.6 : 0.95,
    rz = dragon ? 4.2 : 0.7;
  out.set(
    site.x + rx * Math.sin(angle),
    height + (dragon ? 0.55 : 0.38) * Math.sin(2 * angle),
    site.z + rz * Math.cos(angle),
  );
  return Math.atan2(rx * Math.cos(angle), -rz * Math.sin(angle));
}
