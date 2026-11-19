import * as THREE from 'three';
import { makeInkMaterial } from '@/engine/render/ink-material';
import { hashAt, unit } from '@/world/math/hash';
import type { WildChunk } from '@/world/wilderness/chunk';
import { type Wilderness, WATER_LEVEL } from '@/world/wilderness/generator';
import { makeFishAtlas } from './fish-paint';
import { fishShape } from './fish-shape';
import { FISH_SPECIES, type FishSpecies } from '@/content/fish';
import { fishSpeciesAt } from '@/world/wilderness/fish';

interface Shoal {
  x: number;
  z: number;
  phase: number;
  species: FishSpecies;
}

/** Reserve a submerged patch for each school, including room for tails at the edge of its orbit. */
export function shoalsInChunk(chunk: WildChunk, w: Wilderness): Shoal[] {
  if (!chunk.hasWater) return [];
  const shoals: Shoal[] = [];
  const { n, cell, x0, z0 } = chunk;
  for (let iz = 2; iz < n - 1; iz += 4)
    for (let ix = 2; ix < n - 1; ix += 4) {
      const x = x0 + ix * cell,
        z = z0 + iz * cell;
      if (w.heightAt(x, z) > WATER_LEVEL - 1) continue;
      let highest = -Infinity;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++)
          highest = Math.max(highest, w.heightAt(x + dx * cell, z + dz * cell));
      if (highest > WATER_LEVEL - 1) continue;
      if (shoals.some((s) => Math.hypot(s.x - x, s.z - z) < 30)) continue;
      shoals.push({
        x,
        z,
        phase: unit(hashAt(w.seed, 'fish', x, z)) * Math.PI * 2,
        species: fishSpeciesAt(w, x, z),
      });
    }
  return shoals;
}

function schoolMotion(s: Shoal, cell: number, w: Wilderness) {
  // Grow a rectangle of submerged terrain cells. Any path between two points inside it stays in water.
  let left = -cell,
    right = cell,
    back = -cell,
    front = cell;
  const wetLine = (horizontal: boolean, edge: number, lo: number, hi: number) => {
    for (let p = lo; p <= hi; p += cell)
      if (w.heightAt(s.x + (horizontal ? p : edge), s.z + (horizontal ? edge : p)) > WATER_LEVEL - 1)
        return false;
    return true;
  };
  for (let i = 0; i < 2; i++) {
    if (wetLine(false, left - cell, back, front)) left -= cell;
    if (wetLine(false, right + cell, back, front)) right += cell;
    if (wetLine(true, back - cell, left, right)) back -= cell;
    if (wetLine(true, front + cell, left, right)) front += cell;
  }
  // Conservative bed clearance for the whole orbit, sampled once when streaming in.
  let bed = -Infinity;
  for (let x = left; x <= right; x += cell)
    for (let z = back; z <= front; z += cell) bed = Math.max(bed, w.heightAt(s.x + x, s.z + z));
  return {
    ...s,
    left,
    right,
    back,
    front,
    floor: bed + 0.28,
    alarm: false,
    nextBurst: 0,
    members: Array.from({ length: 4 }, (_, i) => ({
      x: 0,
      z: 0,
      retreatX: 0,
      retreatZ: 0,
      offsetX: 0,
      offsetZ: 0,
      yaw: 0,
      beat: s.phase + i * 1.8,
      nextRipple: 0,
    })),
  };
}

export class WildFish {
  private readonly shapes = FISH_SPECIES.map((s, i) => fishShape(s, i, FISH_SPECIES.length));
  private readonly paint = makeFishAtlas();
  private readonly material = makeInkMaterial({ fishPaint: this.paint, side: THREE.DoubleSide });
  private readonly batches = new Map<THREE.InstancedMesh, ReturnType<typeof schoolMotion>[]>();
  private readonly pose = new THREE.Object3D();
  private readonly stroke = new THREE.Color();

  constructor(
    private readonly root: THREE.Group,
    private readonly ripple: (x: number, z: number, t: number) => void,
  ) {}

  add(chunk: WildChunk, w: Wilderness): () => void {
    const shoals = shoalsInChunk(chunk, w);
    if (!shoals.length) return () => {};
    const meshes: THREE.InstancedMesh[] = [];
    const kinds = [...new Set(shoals.map((s) => s.species))];
    for (const species of kinds) {
      const selected = shoals.filter((s) => s.species === species);
      const shape = this.shapes[FISH_SPECIES.indexOf(species)]!;
      const mesh = new THREE.InstancedMesh(shape, this.material, selected.length * 4);
      mesh.name = `野外鱼群·${species.name}`;
      mesh.userData.species = species.key;
      mesh.visible = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.count * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      );
      const schools = selected.map((s) => schoolMotion(s, chunk.cell, w));
      // Instance matrices move every frame. Bound the full swimming area once,
      // including the tail stroke, so turning the camera never clips a fleeing fish.
      const bounds = new THREE.Box3();
      for (const s of schools) {
        bounds.expandByPoint(new THREE.Vector3(s.x + s.left - 1.4, WATER_LEVEL - 1.4, s.z + s.back - 1.4));
        bounds.expandByPoint(new THREE.Vector3(s.x + s.right + 1.4, WATER_LEVEL, s.z + s.front + 1.4));
      }
      mesh.boundingBox = bounds;
      mesh.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
      this.root.add(mesh);
      this.batches.set(mesh, schools);
      meshes.push(mesh);
    }
    return () => {
      for (const mesh of meshes) {
        if (!this.batches.delete(mesh)) continue;
        mesh.removeFromParent();
        mesh.dispose();
      }
    };
  }

  update(t: number, player: THREE.Vector3, dt: number): void {
    for (const [mesh, shoals] of this.batches) {
      mesh.visible = shoals.some((s) => Math.hypot(s.x - player.x, s.z - player.z) < 110);
      if (!mesh.visible) continue;
      let i = 0;
      for (const s of shoals) {
        const species = s.species;
        const px = player.x - s.x,
          pz = player.z - s.z,
          py = player.y - (WATER_LEVEL - species.depth);
        const nearest = Math.min(...s.members.map((f) => Math.hypot(px - f.x, py, pz - f.z)));
        if (nearest > 9 && Math.hypot(px, py, pz) > 11) s.alarm = false;
        const burst = (!s.alarm && nearest < 5.5) || (s.alarm && nearest < 2.8 && t >= s.nextBurst);
        if (burst) {
          s.alarm = true;
          s.nextBurst = t + 1.4;
        }
        for (let k = 0; k < 4; k++) {
          const f = s.members[k]!;
          const a = t * 0.58 * species.pace + s.phase + k * 0.64;
          const rx = 2.5 - k * 0.2;
          const rz = 1.6 + k * 0.14;
          if (burst) {
            const away = Math.hypot(f.x - px, f.z - pz) < 0.1 ? a : Math.atan2(f.z - pz, f.x - px);
            const heading = away + (k - 1.5) * 0.56;
            f.retreatX = THREE.MathUtils.clamp(f.x + 8 * Math.cos(heading), s.left + 1.2, s.right - 1.2);
            f.retreatZ = THREE.MathUtils.clamp(f.z + 8 * Math.sin(heading), s.back + 1.2, s.front - 1.2);
          }
          const rate = (s.alarm ? 1.7 : 0.72) * Math.sqrt(species.pace);
          f.offsetX = THREE.MathUtils.damp(f.offsetX, s.alarm ? f.retreatX : 0, rate, dt);
          f.offsetZ = THREE.MathUtils.damp(f.offsetZ, s.alarm ? f.retreatZ : 0, rate, dt);
          const orbit = 1 - 0.8 * Math.min(1, Math.hypot(f.offsetX, f.offsetZ) / 2.5);
          const x = THREE.MathUtils.clamp(f.offsetX + orbit * rx * Math.cos(a), s.left + 0.7, s.right - 0.7);
          const z = THREE.MathUtils.clamp(f.offsetZ + orbit * rz * Math.sin(a), s.back + 0.7, s.front - 0.7);
          const yaw = Math.atan2(f.z - z, x - f.x);
          const speed = Math.min(4, Math.hypot(x - f.x, z - f.z) / Math.max(dt, 0.001));
          f.beat = (f.beat + dt * (5.4 * species.pace + 2.1 * speed)) % (2 * Math.PI);
          const swing = 0.105 + 0.014 * speed;
          this.stroke.setRGB(swing * Math.sin(f.beat), swing * Math.cos(f.beat), 0);
          f.yaw += Math.atan2(Math.sin(yaw - f.yaw), Math.cos(yaw - f.yaw)) * (1 - Math.exp(-14 * dt));
          f.x = x;
          f.z = z;
          this.pose.position.set(
            s.x + x,
            Math.max(s.floor, WATER_LEVEL - species.depth + 0.07 * Math.sin(a * 2 + k) - 0.1 * (1 - orbit)),
            s.z + z,
          );
          this.pose.rotation.y = f.yaw;
          if (
            t >= f.nextRipple &&
            Math.hypot(px - x, py, pz - z) < 22 &&
            this.pose.position.y > WATER_LEVEL - 0.67
          ) {
            this.ripple(
              s.x + x - 0.4 * species.length * Math.cos(f.yaw),
              s.z + z + 0.4 * species.length * Math.sin(f.yaw),
              t,
            );
            f.nextRipple = t + (s.alarm ? 0.67 : 1.25) / species.pace + 0.13 * k;
          }
          const size = 0.8 + k * 0.09;
          this.pose.scale.set(size * species.length, size, size);
          this.pose.updateMatrix();
          mesh.setColorAt(i, this.stroke);
          mesh.setMatrixAt(i++, this.pose.matrix);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const mesh of this.batches.keys()) {
      mesh.removeFromParent();
      mesh.dispose();
    }
    this.batches.clear();
    for (const shape of this.shapes) shape.dispose();
    this.material.dispose();
    this.paint.dispose();
  }
}
