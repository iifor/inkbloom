// Static transforms are grouped by chunk and palette. Only trees within a short walk
// carry individual leaf sprays; switching a tree moves its matrix between the two batches.
import * as THREE from 'three';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { makeInkMaterial } from '@/engine/render/ink-material';
import type { WildChunk } from '@/world/wilderness/chunk';
import { appendTree, treeMatrix, treePalette } from './tree-geometry';

const ENTER = 31,
  LEAVE = 39;

class TreeBatch {
  private readonly close: THREE.InstancedMesh;
  private readonly far: THREE.InstancedMesh;
  private readonly detailed: Uint8Array;
  private readonly bounds = new THREE.Box2();

  constructor(
    private readonly transforms: THREE.Matrix4[],
    templates: readonly THREE.BufferGeometry[],
    material: THREE.Material,
    root: THREE.Group,
    player: THREE.Vector3,
  ) {
    this.close = new THREE.InstancedMesh(templates[0]!, material, transforms.length);
    this.far = new THREE.InstancedMesh(templates[1]!, material, transforms.length);
    this.close.name = 'tree-sprays';
    this.far.name = 'distant-trees';
    this.detailed = new Uint8Array(transforms.length);
    for (const m of transforms) this.bounds.expandByPoint(new THREE.Vector2(m.elements[12], m.elements[14]));
    for (const mesh of [this.close, this.far]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      root.add(mesh);
    }
    this.update(player, true);
  }

  update(p: THREE.Vector3, initial = false): void {
    if (
      !initial &&
      this.close.count === 0 &&
      (p.x < this.bounds.min.x - ENTER ||
        p.x > this.bounds.max.x + ENTER ||
        p.z < this.bounds.min.y - ENTER ||
        p.z > this.bounds.max.y + ENTER)
    )
      return;
    let changed = initial;
    for (let i = 0; i < this.transforms.length; i++) {
      const m = this.transforms[i]!.elements;
      const range = this.detailed[i] ? LEAVE : ENTER;
      const close = Number((p.x - m[12]) ** 2 + (p.z - m[14]) ** 2 <= range * range);
      if (close !== this.detailed[i]) {
        this.detailed[i] = close;
        changed = true;
      }
    }
    if (!changed) return;
    this.close.count = this.far.count = 0;
    for (let i = 0; i < this.transforms.length; i++) {
      const mesh = this.detailed[i] ? this.close : this.far;
      mesh.setMatrixAt(mesh.count++, this.transforms[i]!);
    }
    for (const mesh of [this.close, this.far]) {
      mesh.visible = mesh.count > 0;
      if (!mesh.visible) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  dispose(): void {
    for (const mesh of [this.close, this.far]) {
      mesh.removeFromParent();
      mesh.dispose();
    }
  }
}

export class WildTrees {
  private readonly material = makeInkMaterial({ tree: true });
  private readonly batches = new Set<TreeBatch>();
  private readonly templates = new Map<number, THREE.BufferGeometry[]>();
  private lastX = Infinity;
  private lastZ = Infinity;

  constructor(private readonly root: THREE.Group) {}

  add(chunk: WildChunk, player: THREE.Vector3): () => void {
    const byPalette = new Map<number, THREE.Matrix4[]>();
    for (const tree of chunk.trees) {
      const palette = treePalette(tree);
      let group = byPalette.get(palette);
      if (!group) byPalette.set(palette, (group = []));
      group.push(treeMatrix(tree));
    }
    const batches: TreeBatch[] = [];
    for (const [palette, transforms] of byPalette) {
      let templates = this.templates.get(palette);
      if (!templates) {
        templates = [false, true].map((distant) => {
          const g = new GeometryBuilder();
          appendTree(g, palette, new THREE.Matrix4(), distant);
          return g.build();
        });
        this.templates.set(palette, templates);
      }
      const batch = new TreeBatch(transforms, templates, this.material, this.root, player);
      batches.push(batch);
      this.batches.add(batch);
    }
    return () => {
      for (const batch of batches) {
        this.batches.delete(batch);
        batch.dispose();
      }
    };
  }

  update(player: THREE.Vector3): void {
    if ((player.x - this.lastX) ** 2 + (player.z - this.lastZ) ** 2 < 4) return;
    this.lastX = player.x;
    this.lastZ = player.z;
    for (const batch of this.batches) batch.update(player);
  }

  dispose(): void {
    for (const batch of this.batches) batch.dispose();
    this.batches.clear();
    for (const templates of this.templates.values()) for (const g of templates) g.dispose();
    this.templates.clear();
    this.material.dispose();
  }
}
