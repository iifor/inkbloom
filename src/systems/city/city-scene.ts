// A permanent city instance. Built from its deterministic layout; colour comes from the saved
// per-surface states via a GPU state texture kept in sync with accepted patches.
import * as THREE from 'three';
import { TUNING } from '@/content/tuning';
import { PhysicsWorld } from '@/engine/physics/world';
import { SurfaceStateTexture, makeInkMaterial, shared } from '@/engine/render/ink-material';
import { disposeTree } from '@/engine/resources';
import type { GameContext, GameScene } from '@/game/types';
import type { CityLayout } from '@/world/city/layout';
import { isColored } from '@/world/paint/surfaces';
import { blockState, type BlockState } from '@/world/city/blocks';
import { cityStates } from '@/world/state';
import type { Entrance } from '@/world/wilderness/generator';
import { buildCity } from './build-city';
import { Erosion } from './erosion';
import { InkStains } from './ink-stains';
import { InkTide } from './ink-tide';
import { CityMonsters } from './city-monsters';
import { Residents } from './residents';
import { Studios } from './studios';

export class CityScene implements GameScene {
  readonly ref: { readonly kind: 'city'; readonly id: string };
  readonly name: string;
  readonly root = new THREE.Group();
  readonly physics = new PhysicsWorld(8);
  readonly states: Uint8Array;
  private readonly texture: SurfaceStateTexture;
  private readonly material: THREE.ShaderMaterial;
  private readonly release: (() => void)[] = [];
  /** Coloured / total surfaces per city chunk, kept current from patches. */
  private readonly colored: number[];
  private readonly totals: number[];
  private coloredAll = 0;
  private exiting = false;
  /** True when the saved states belonged to an older layout and were discarded. */
  readonly wasReset: boolean;
  readonly stains: InkStains;
  readonly tide: InkTide;
  private readonly studios: Studios;
  private readonly erosion: Erosion;
  readonly monsters: CityMonsters;
  readonly residents: Residents;

  constructor(
    private readonly ctx: GameContext,
    readonly entrance: Entrance,
    readonly layout: CityLayout,
  ) {
    this.ref = { kind: 'city', id: layout.id };
    this.name = layout.name;
    this.root.name = `city:${layout.id}`;
    const { states, stains, defeated, requestsDone, reset } = cityStates(ctx.state, layout.id, layout);
    this.states = states;
    this.wasReset = reset;
    if (reset) ctx.events.emit('toast', { text: `${layout.name}的布局已更新，颜色进度已重置`, seconds: 6 });
    const chunks = layout.chunks * layout.chunks;
    this.colored = new Array<number>(chunks).fill(0);
    this.totals = new Array<number>(chunks).fill(0);
    layout.surfaces.forEach((info, i) => {
      this.totals[info.chunk]!++;
      if (isColored(states[i]!)) {
        this.colored[info.chunk]!++;
        this.coloredAll++;
      }
    });
    this.texture = new SurfaceStateTexture(this.states);
    this.material = makeInkMaterial({ state: this.texture });
    const g = buildCity(layout, this.physics);
    this.root.add(new THREE.Mesh(g.build(), this.material));
    this.stains = new InkStains(ctx, layout, stains, this.material, this.root);
    this.studios = new Studios(ctx, layout, states, (c) => this.progress(c), this.material, this.root);
    this.erosion = new Erosion(ctx, layout, states, this);
    this.monsters = new CityMonsters(ctx, layout, defeated, this.physics, this.root, this.material);
    this.residents = new Residents(ctx, layout, states, requestsDone, this.material, this.root);
    this.tide = new InkTide(ctx, layout, states, this, this.material, this.root);

    this.release.push(
      ctx.events.on('patch:applied', ({ patch }) => {
        if (patch.kind !== 'restore' && patch.kind !== 'paint' && patch.kind !== 'drain') return;
        if (patch.city !== layout.id) return;
        const before = isColored(this.texture.get(patch.surface));
        const after = isColored(this.states[patch.surface]!);
        if (before !== after) {
          const d = after ? 1 : -1;
          this.colored[layout.surfaces[patch.surface]!.chunk]! += d;
          this.coloredAll += d;
        }
        this.texture.set(patch.surface, this.states[patch.surface]!);
        this.updateSceneSat();
        if (after) this.checkComplete();
      }),
    );
    for (const gate of layout.gates) {
      const pos = new THREE.Vector3((gate.ix + 0.5) * layout.cell, 0, (gate.iz + 0.5) * layout.cell);
      this.release.push(
        ctx.interactions.add({
          scene: `city:${layout.id}`,
          pos,
          radius: 8,
          label: () => 'E 回到野外',
          activate: () => ctx.scenes.enterWild(),
          alt: ctx.scenes.travelAction(layout.id),
        }),
      );
    }
    this.updateSceneSat();
  }

  spawn(): { pos: THREE.Vector3; yaw: number } {
    return {
      pos: new THREE.Vector3(this.layout.spawn.x, 0.05, this.layout.spawn.z),
      yaw: this.layout.spawn.yaw,
    };
  }

  /** Overall coloured share; also tints roads and walls, which have no surface of their own. */
  progress(chunk?: number): number {
    if (chunk === undefined) return this.states.length ? this.coloredAll / this.states.length : 0;
    const total = this.totals[chunk] ?? 0;
    return total ? this.colored[chunk]! / total : 0;
  }

  get completed(): boolean {
    return this.ctx.state.cities.get(this.layout.id)?.completed ?? false;
  }

  /** Once every block has colour, the city is restored for good. */
  private checkComplete(): void {
    if (this.completed) return;
    if (!this.blocks().every((b) => b === 'colored' || b === 'thriving')) return;
    const hadGlider = this.ctx.state.inventory.glider;
    if (!this.ctx.apply({ kind: 'complete', city: this.layout.id }).ok) return;
    if (!hadGlider) this.ctx.events.emit('toast', { text: '得到纸飞机：在空中按住空格就能滑翔', seconds: 8 });
    const r = TUNING.city.completeReward;
    this.ctx.events.emit('toast', {
      text: `${this.layout.name}恢复了颜色！通用颜料 +${r.generic}，墨 +${r.ink}。周围的野外也会亮起来`,
      seconds: 8,
    });
    this.ctx.events.emit('city:completed', { city: this.layout.id, name: this.layout.name });
  }

  spawnTideMonsters(chunk: number, from: number): void {
    this.monsters.spawnTide(chunk, from);
  }

  clearTideMonsters(): void {
    this.monsters.clearTide();
  }

  surfaceCount(chunk: number): number {
    return this.totals[chunk] ?? 0;
  }

  /** Every block's state, read from its share of colour. */
  blocks(): BlockState[] {
    return this.totals.map((_, c) => blockState(this.progress(c), this.residents.open(c) === 0));
  }

  /** Which city chunk (0..chunks²-1) a position is in. */
  chunkAt(pos: THREE.Vector3): number {
    const side = this.layout.chunks;
    const per = this.layout.size / side;
    const cx = Math.min(side - 1, Math.max(0, Math.floor(pos.x / per)));
    const cz = Math.min(side - 1, Math.max(0, Math.floor(pos.z / per)));
    return cz * side + cx;
  }

  private updateSceneSat(): void {
    shared.uSceneSat.value = 0.25 + 0.75 * this.progress();
  }

  activate(): void {
    shared.uCityCount.value = 0;
    this.updateSceneSat();
  }

  /** Walking out through a gate leaves the city, same as pressing E there. */
  update(dt: number): void {
    if (this.exiting) return;
    this.stains.update();
    this.erosion.update(dt);
    this.monsters.update(dt);
    this.tide.update(dt);
    const p = this.ctx.player.position;
    const s = this.layout.size;
    if (p.x < 0 || p.z < 0 || p.x > s || p.z > s) {
      this.exiting = true;
      this.ctx.scenes.enterWild();
    }
  }

  dispose(): void {
    this.stains.dispose();
    this.studios.dispose();
    this.tide.dispose();
    this.monsters.dispose();
    this.residents.dispose();
    for (const r of this.release) r();
    this.texture.dispose();
    this.material.dispose();
    disposeTree(this.root);
  }
}
