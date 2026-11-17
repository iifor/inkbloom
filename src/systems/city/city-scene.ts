// A town standing in the wilderness. Built from its deterministic layout where the wilderness
// put it; colour comes from the saved per-surface states via a GPU state texture kept in sync
// with accepted patches. It shares the wilderness's physics world: the player walks in through
// a gate and the scene manager makes it the active scene while they are inside.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { PhysicsWorld } from '@/engine/physics/world';
import { GeometryBuilder, fromGeometryData } from '@/engine/render/geometry-builder';
import { SurfaceStateTexture, makeInkMaterial, shared } from '@/engine/render/ink-material';
import { disposeTree } from '@/engine/resources';
import type { GameContext, GameScene } from '@/game/types';
import { type CityLayout, groundAt } from '@/world/city/layout';
import { isColored } from '@/world/paint/surfaces';
import { blockState, type BlockState } from '@/world/city/blocks';
import { type TideSave, cityStates } from '@/world/state';
import type { Entrance } from '@/world/wilderness/generator';
import { buildCity, cityGroup } from './build-city';
import { Erosion } from './erosion';
import { InkStains } from './ink-stains';
import { InkTide } from './ink-tide';
import { CityMonsters } from './city-monsters';
import { Residents } from './residents';
import { Studios } from './studios';

/** Metres from a district's middle beyond which its houses are drawn as shells. A district is
 * 128 m across, so its nearest houses are then some 70 m off, where a window frame is about a
 * pixel; a district in full is some 200 thousand triangles, as a shell a tenth of that. */
const FAR_DETAIL = 130;
/** Radians a second the waterwheel turns. */
const WHEEL_TURN = 0.45;

/** A wooden undershot waterwheel turning about its own x axis: two rims, spokes, paddles. */
function waterwheel(r: number): THREE.BufferGeometry {
  const g = new GeometryBuilder();
  const wood = color('bark');
  const m = new THREE.Matrix4();
  const turn = new THREE.Matrix4();
  const rim = new THREE.TorusGeometry(r, 0.09, 5, 28).rotateY(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(0.08, 2 * r, 0.08);
  const paddle = new THREE.BoxGeometry(1.3, 0.55, 0.06);
  const axle = new THREE.CylinderGeometry(0.16, 0.16, 2.2, 8).rotateZ(Math.PI / 2);
  for (const x of [-0.55, 0.55]) {
    g.mesh(rim, m.makeTranslation(x, 0, 0), wood);
    for (let k = 0; k < 4; k++)
      g.mesh(spoke, m.makeTranslation(x, 0, 0).multiply(turn.makeRotationX((k * Math.PI) / 4)), wood);
  }
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI * 2) / 16;
    g.mesh(paddle, turn.makeRotationX(a).multiply(m.makeTranslation(0, r - 0.2, 0)), wood);
  }
  g.mesh(axle, m.identity(), wood);
  for (const geometry of [rim, spoke, paddle, axle]) geometry.dispose();
  return g.build();
}

export class CityScene implements GameScene {
  readonly ref: { readonly kind: 'city'; readonly id: string };
  readonly name: string;
  readonly root = new THREE.Group();
  readonly states: Uint8Array;
  private readonly texture: SurfaceStateTexture;
  private readonly material: THREE.ShaderMaterial;
  private readonly release: (() => void)[] = [];
  /** One per district: its geometry in full, and with the houses as shells. */
  private readonly detail: THREE.LOD[] = [];
  /** The mill's waterwheel, when a river runs through. */
  private wheel: THREE.Mesh | null = null;
  /** Coloured / total surfaces per city chunk, kept current from patches. */
  private readonly colored: number[];
  private readonly totals: number[];
  private coloredAll = 0;
  /** True when the saved states belonged to an older layout and were discarded. */
  readonly wasReset: boolean;
  // set while the town is put together over a few frames (see build); used once it is ready
  stains!: InkStains;
  tide!: InkTide;
  private studios!: Studios;
  private erosion!: Erosion;
  monsters!: CityMonsters;
  residents!: Residents;
  /** The rest of putting the town together, a step at a time; null once it stands. */
  private building: Generator<void, void, void> | null;

  constructor(
    private readonly ctx: GameContext,
    readonly entrance: Entrance,
    readonly layout: CityLayout,
    /** The wilderness's physics: the town's walls and houses go in it while it stands. */
    readonly physics: PhysicsWorld,
  ) {
    this.ref = { kind: 'city', id: layout.id };
    this.name = layout.name;
    this.root.name = `city:${layout.id}`;
    const { states, stains, defeated, requestsDone, tide, reset } = cityStates(ctx.state, layout.id, layout);
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
    // the town's ground lies on the land's own triangles: draw it in front of them (towards
    // the eye is up the depth range when depth runs the other way)
    const towards = shared.uReversedDepth.value ? 1 : -1;
    this.material.polygonOffset = true;
    this.material.polygonOffsetFactor = towards;
    this.material.polygonOffsetUnits = 2 * towards;
    this.building = this.steps(stains, defeated, requestsDone, tide);
  }

  /** Whether the town is all there: enterable, its systems running. */
  get ready(): boolean {
    return this.building === null;
  }

  /** Put more of the town together, for about `ms` milliseconds. Returns whether it is done. */
  build(ms: number): boolean {
    const until = performance.now() + ms;
    while (this.building && performance.now() < until) if (this.building.next().done) this.building = null;
    return this.ready;
  }

  /** Put the rest of the town together now (the player is about to stand in it). */
  finish(): void {
    while (this.building) if (this.building.next().done) this.building = null;
  }

  /** Everything after the town's own state: its districts' geometry one at a time, then each
   * of its systems, so standing a town up never stalls a frame for long. */
  private *steps(
    stains: Uint8Array,
    defeated: Uint8Array,
    requestsDone: Uint8Array,
    tide: TideSave,
  ): Generator<void, void, void> {
    const { ctx, layout, states } = this;
    // geometry and colliders worked out ahead of time in the city worker, when they are ready
    const built = ctx.cities.takeBuilt(layout.id);
    if (built) for (const b of built.boxes) this.physics.addBox(b.group, b.min, b.max, b.data);
    const local = built ? null : buildCity(layout, this.physics);
    yield;
    // a district at a time, so what is out of view (or out of the sun's shadow square) is not
    // drawn; its houses as shells once the district is far off
    const per = layout.size / layout.chunks;
    for (let i = 0; i < layout.chunks * layout.chunks; i++) {
      const full = built ? fromGeometryData(built.tiles[i]!.full) : local![i]!.full.build();
      const far = built ? fromGeometryData(built.tiles[i]!.far) : local![i]!.far.build();
      const lod = new THREE.LOD();
      const x = layout.ox + ((i % layout.chunks) + 0.5) * per;
      const z = layout.oz + (Math.floor(i / layout.chunks) + 0.5) * per;
      lod.position.set(x, groundAt(layout, x, z), z);
      for (const [geometry, from] of [
        [full, 0],
        [far, FAR_DETAIL],
      ] as const) {
        const mesh = new THREE.Mesh(geometry, this.material);
        // the geometry is in world space: undo the tile's own position
        mesh.position.copy(lod.position).negate();
        lod.addLevel(mesh, from, 0.08);
      }
      // levels follow the player's camera only (see updateDetail): the sun's camera stands far
      // off and would otherwise always see shells, losing the near houses' smaller shadows
      lod.autoUpdate = false;
      this.detail.push(lod);
      this.root.add(lod);
      // a district a frame at most: its first draw also uploads it to the GPU
      yield;
    }
    if (layout.wheel) {
      this.wheel = new THREE.Mesh(waterwheel(layout.wheel.r), this.material);
      this.wheel.position.set(layout.wheel.x, layout.wheel.y, layout.wheel.z);
      this.root.add(this.wheel);
    }
    yield;
    this.stains = new InkStains(ctx, layout, stains, this.material, this.root);
    yield;
    this.studios = new Studios(ctx, layout, states, (c) => this.progress(c), this.material, this.root);
    this.erosion = new Erosion(ctx, layout, states, this);
    yield;
    this.monsters = new CityMonsters(ctx, layout, defeated, this.physics, this.root, this.material);
    yield;
    this.residents = new Residents(ctx, layout, states, requestsDone, this.material, this.root);
    yield;
    this.tide = new InkTide(ctx, layout, states, this, tide, this.root);

    this.release.push(
      ctx.events.on('patch:applied', ({ patch }) => {
        if (!('city' in patch) || patch.city !== layout.id) return;
        let gained = false;
        if (patch.kind === 'restore' || patch.kind === 'paint' || patch.kind === 'drain')
          gained = this.sync(patch.surface, false);
        else if (patch.kind === 'defeat' || patch.kind === 'request')
          // a fallen monster or a granted wish frees the colour around it; bloom each surface
          for (let i = 0; i < this.states.length; i++) gained = this.sync(i, true) || gained;
        else return;
        if (gained) this.checkComplete();
      }),
    );
    // a restored town's gates are stops on the travel ring
    for (const gate of layout.gates) {
      const pos = new THREE.Vector3(
        layout.ox + (gate.ix + 0.5) * layout.cell,
        groundAt(
          layout,
          layout.ox + (gate.ix + 0.5) * layout.cell,
          layout.oz + (gate.iz + 0.5) * layout.cell,
        ),
        layout.oz + (gate.iz + 0.5) * layout.cell,
      );
      const travel = ctx.scenes.travelAction(layout.id, 'E');
      this.release.push(ctx.interactions.add({ scene: `city:${layout.id}`, pos, radius: 8, ...travel }));
    }
  }

  spawn(): { pos: THREE.Vector3; yaw: number } {
    return {
      pos: new THREE.Vector3(
        this.layout.spawn.x,
        groundAt(this.layout, this.layout.spawn.x, this.layout.spawn.z) + 0.05,
        this.layout.spawn.z,
      ),
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
  /** Bring one surface's counts and texture up to its saved state. Returns whether it gained
   * colour; `bloom` bursts its colour where it stands (for colour freed without the brush). */
  private sync(i: number, bloom: boolean): boolean {
    const before = isColored(this.texture.get(i));
    const after = isColored(this.states[i]!);
    const s = this.layout.surfaces[i]!;
    if (before !== after) {
      const d = after ? 1 : -1;
      this.colored[s.chunk]! += d;
      this.coloredAll += d;
    }
    const y = groundAt(this.layout, s.x, s.z) + 2;
    if (before && !after) this.ctx.events.emit('paint:drained', { at: { x: s.x, y, z: s.z } });
    if (bloom && !before && after)
      this.ctx.events.emit('paint:bloom', { at: { x: s.x, y, z: s.z }, color: s.color });
    if (this.texture.get(i) !== this.states[i]) this.texture.set(i, this.states[i]!);
    return !before && after;
  }

  private checkComplete(): void {
    // this player's own restore: in a server world someone else may have finished the town
    if (this.ctx.state.growth.milestones.includes(`city:${this.layout.id}:restored`)) return;
    if (!this.blocks().every((b) => b === 'colored' || b === 'thriving')) return;
    const hadGlider = this.ctx.state.inventory.glider;
    if (!this.ctx.apply({ kind: 'complete', city: this.layout.id }).ok) return;
    this.ctx.events.emit('title', { text: `${this.layout.name}恢复了颜色`, sub: '周围的野外也亮了起来' });
    if (!hadGlider) this.ctx.events.emit('toast', { text: '得到纸飞机：在空中按住空格滑翔', seconds: 6 });
    this.ctx.events.emit('city:completed', { city: this.layout.id, name: this.layout.name });
  }

  spawnTideMonsters(chunk: number, from: number, onDefeat: () => void): void {
    this.monsters.spawnTide(chunk, from, onDefeat);
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
    const cx = Math.min(side - 1, Math.max(0, Math.floor((pos.x - this.layout.ox) / per)));
    const cz = Math.min(side - 1, Math.max(0, Math.floor((pos.z - this.layout.oz) / per)));
    return cz * side + cx;
  }

  brushStop(eye: THREE.Vector3, forward: THREE.Vector3): number | null {
    return this.tide.curtainDistance(eye, forward);
  }

  /** Pick each district's level of detail by its distance from the camera. */
  updateDetail(camera: THREE.Camera): void {
    for (const lod of this.detail) lod.update(camera);
    // the river turns the mill's wheel, downstream (the rivers run along z)
    if (this.wheel) this.wheel.rotation.x = this.ctx.state.clock * WHEEL_TURN;
  }

  /** While the player is inside. In a server world only the town's keeper runs its erosion and
   * tide (everyone else sees their drains arrive as patches), so more players inside do not
   * drain it faster. */
  update(dt: number): void {
    this.stains.update();
    const keeper = !this.ctx.net || this.ctx.net.keeps(this.layout.id);
    if (keeper) this.erosion.update(dt);
    this.monsters.update(dt);
    if (keeper) this.tide.update(dt);
  }

  /** While the player is just outside the wall: the guards stay awake; everything else (the
   * tide's timers, erosion) waits for them to come in. */
  updateOutside(dt: number): void {
    if (this.ready) this.monsters.update(dt);
  }

  dispose(): void {
    // half put together: finish, so everything it registered is released below
    this.finish();
    this.stains.dispose();
    this.studios.dispose();
    this.tide.dispose();
    this.monsters.dispose();
    this.residents.dispose();
    for (const r of this.release) r();
    this.physics.removeGroup(cityGroup(this.layout.id));
    this.texture.dispose();
    this.material.dispose();
    disposeTree(this.root);
  }
}
