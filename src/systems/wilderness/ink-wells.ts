// Ink wells (world/wilderness/ink-wells.ts) in loaded chunks. A seeping well is a pool of
// glossy black ink in a ring of dark stones, its stain creeping out over the grass; its guards
// are among the chunk's monsters (WildMonsterCamps). With them down, "E 净化墨泉" cleanses it: it
// runs clear, flowers come up round the rim, and the colour comes back round it (the drain
// shader's uWells, set here for the cleansed wells near the player). A well whose town has its
// colour back is dry: a ring of stones round cracked ground.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import { MAX_WELLS, shared } from '@/engine/render/ink-material';
import type { GameContext } from '@/game/types';
import { wildMonsterBack } from '@/world/state';
import type { WildChunk } from '@/world/wilderness/chunk';
import {
  type InkWell,
  inkWellInChunk,
  inkWellsNear,
  wellGuards,
  wellSeeping,
} from '@/world/wilderness/ink-wells';
import { chunkSaturation } from '@/world/wilderness/wild-monsters';
import { BOULDER } from './stone-shape';

type Look = 'seeping' | 'clear' | 'dry';

const ROCK = BOULDER;
const DISC = new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2);
const BALL = new THREE.SphereGeometry(1, 6, 4);
/** The pool's radius, metres. */
const POOL = 1.7;
const BLOOMS = [color('pink'), color('yellow'), color('sky'), color('cream'), color('red')];

const roll = (seed: number, k: number): number => {
  const v = Math.sin(seed * 0.0001 + k * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

function buildWell(
  well: InkWell,
  look: Look,
  heightAt: (x: number, z: number) => number,
): THREE.BufferGeometry {
  const g = new GeometryBuilder();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const level =
    Math.max(
      ...[0, 1, 2, 3, 4, 5].map((k) => heightAt(well.x + Math.cos(k) * POOL, well.z + Math.sin(k) * POOL)),
    ) + 0.06;
  // the pool: ink, clear water, or bare cracked earth
  const surface = look === 'seeping' ? color('ink') : look === 'clear' ? color('water') : color('rock');
  g.meshSmooth(
    DISC,
    m.compose(new THREE.Vector3(well.x, level, well.z), q.identity(), new THREE.Vector3(POOL, 1, POOL)),
    surface,
    look === 'seeping' ? ALWAYS_COLOR : undefined,
  );
  // a ring of stones, black with ink while it seeps
  const stones = 11;
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2 + roll(well.seed, i) * 0.3;
    const size = 0.22 + roll(well.seed, i + 20) * 0.28;
    const x = well.x + Math.cos(a) * (POOL + size * 0.3);
    const z = well.z + Math.sin(a) * (POOL + size * 0.3);
    q.setFromEuler(new THREE.Euler(roll(well.seed, i + 40), roll(well.seed, i + 60) * 6, 0));
    m.compose(
      new THREE.Vector3(x, heightAt(x, z) + size * 0.2, z),
      q,
      new THREE.Vector3(size * 1.2, size * 0.8, size),
    );
    g.meshSmooth(ROCK, m, look === 'seeping' ? color('charcoal') : color('rock'));
  }
  if (look === 'seeping') {
    // the stain creeping out from the pool in long tongues
    for (let i = 0; i < 7; i++) {
      const a = roll(well.seed, i + 80) * Math.PI * 2;
      const reach = 2.5 + roll(well.seed, i + 90) * 4;
      for (let k = 0; k < 3; k++) {
        const d = POOL + (reach * (k + 0.5)) / 3;
        const x = well.x + Math.cos(a) * d;
        const z = well.z + Math.sin(a) * d;
        const w = (1 - k / 3) * 0.9 + 0.3;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
        m.compose(
          new THREE.Vector3(x, heightAt(x, z) + 0.04, z),
          q,
          new THREE.Vector3(reach / 3 + 0.4, 1, w),
        );
        g.meshSmooth(DISC, m, color('ink'), ALWAYS_COLOR);
      }
    }
  } else if (look === 'clear') {
    // flowers come up round the rim
    for (let i = 0; i < 26; i++) {
      const a = roll(well.seed, i + 120) * Math.PI * 2;
      const d = POOL + 0.6 + roll(well.seed, i + 140) * 3.5;
      const x = well.x + Math.cos(a) * d;
      const z = well.z + Math.sin(a) * d;
      const y = heightAt(x, z);
      m.compose(new THREE.Vector3(x, y + 0.2, z), q.identity(), new THREE.Vector3(0.012, 0.2, 0.012));
      g.meshSmooth(BALL, m, color('green'));
      m.compose(new THREE.Vector3(x, y + 0.42, z), q.identity(), new THREE.Vector3(0.1, 0.06, 0.1));
      g.meshSmooth(BALL, m, BLOOMS[i % BLOOMS.length]!);
    }
  }
  return g.build();
}

interface Shown {
  readonly well: InkWell;
  readonly mesh: THREE.Mesh;
  look: Look;
}

export class WildInkWells {
  private readonly shown = new Map<string, Shown>();
  private readonly release: () => void;
  private checkT = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly material: THREE.Material,
    private readonly root: THREE.Object3D,
  ) {
    // a well someone (here or elsewhere) cleansed runs clear at once
    this.release = ctx.events.on('patch:applied', ({ patch }) => {
      if (patch.kind === 'cleanse') this.refresh();
    });
  }

  /** How the land around a well is now. */
  private saturation(well: InkWell): number {
    return chunkSaturation(this.ctx.wilderness, well.cx, well.cz, (c) => this.ctx.cities.progress(c));
  }

  private lookOf(well: InkWell): Look {
    if (this.ctx.state.cleansed.has(well.id)) return 'clear';
    return wellSeeping(this.saturation(well)) ? 'seeping' : 'dry';
  }

  /** Guards still standing over a well. */
  private standing(well: InkWell): number {
    return wellGuards(this.ctx.wilderness, well, this.saturation(well)).filter((g) =>
      wildMonsterBack(this.ctx.state, g.id),
    ).length;
  }

  /** Show a loaded chunk's well, if it has one. Returns a function that removes it again. */
  add(chunk: WildChunk): () => void {
    const well = inkWellInChunk(this.ctx.wilderness, chunk.cx, chunk.cz);
    if (!well) return () => {};
    // none in or right by the arena: its guards are never put out there (wild-monster-camps.ts),
    // so it could never be cleansed
    const arena = this.ctx.arena?.site;
    if (arena && Math.hypot(well.x - arena.x, well.z - arena.z) < arena.radius + 35) return () => {};
    const look = this.lookOf(well);
    const mesh = new THREE.Mesh(buildWell(well, look, this.ctx.wilderness.heightAt), this.material);
    mesh.name = `ink-well:${well.id}`;
    this.root.add(mesh);
    this.shown.set(well.id, { well, mesh, look });
    const off = this.ctx.interactions.add({
      scene: 'wild',
      pos: new THREE.Vector3(well.x, well.y + 0.5, well.z),
      radius: TUNING.combat.wells.reach,
      label: () => this.label(well),
      activate: () => this.cleanse(well),
    });
    this.updateShader();
    return () => {
      off();
      mesh.geometry.dispose();
      mesh.removeFromParent();
      this.shown.delete(well.id);
      this.updateShader();
    };
  }

  private label(well: InkWell): string {
    const look = this.lookOf(well);
    if (look === 'clear') return '清泉：颜色回来了';
    if (look === 'dry') return '干涸的墨泉';
    const n = this.standing(well);
    const W = TUNING.combat.wells;
    return n ? `墨泉：还有 ${n} 只墨怪守着` : `E 净化墨泉（墨 +${W.ink}，颜料 +${W.pigment}）`;
  }

  private cleanse(well: InkWell): void {
    if (this.lookOf(well) !== 'seeping') return;
    const r = this.ctx.apply({ kind: 'cleanse', well: well.id });
    if (!r.ok) {
      this.ctx.events.emit('toast', { text: r.reason });
      return;
    }
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      this.ctx.events.emit('paint:bloom', {
        at: { x: well.x + Math.cos(a) * 2.5, y: well.y + 0.6, z: well.z + Math.sin(a) * 2.5 },
        color: BLOOMS[k % BLOOMS.length]!,
      });
    }
    this.ctx.events.emit('toast', { text: '墨泉净化了，颜色回到了这片土地', seconds: 5 });
  }

  /** Rebuild any well whose look has changed (cleansed, or dried up as its town got colour). */
  private refresh(): void {
    for (const s of this.shown.values()) {
      const look = this.lookOf(s.well);
      if (look === s.look) continue;
      s.look = look;
      s.mesh.geometry.dispose();
      s.mesh.geometry = buildWell(s.well, look, this.ctx.wilderness.heightAt);
    }
    this.updateShader();
  }

  /** Tell the drain shader where the cleansed wells near the player are. */
  private updateShader(): void {
    const p = this.ctx.player.position;
    const clear = inkWellsNear(this.ctx.wilderness, p.x, p.z, 500)
      .filter((w) => this.ctx.state.cleansed.has(w.id))
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))
      .slice(0, MAX_WELLS);
    clear.forEach((w, i) => shared.uWells.value[i]!.set(w.x, w.z, TUNING.combat.wells.bloom, 0));
    shared.uWellCount.value = clear.length;
  }

  update(dt: number): void {
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = 1;
    this.refresh();
    // the first time one comes into view, say what it is
    const p = this.ctx.player.position;
    for (const s of this.shown.values())
      if (s.look === 'seeping' && Math.hypot(s.well.x - p.x, s.well.z - p.z) < 30)
        this.ctx.events.emit('toast', {
          text: '墨泉：墨从这里渗出来。打倒守着它的墨怪，按 E 净化，周围的颜色就会回来',
          seconds: 7,
          once: 'ink-well',
        });
  }

  dispose(): void {
    this.release();
    for (const s of this.shown.values()) {
      s.mesh.geometry.dispose();
      s.mesh.removeFromParent();
    }
    this.shown.clear();
    shared.uWellCount.value = 0;
  }
}
