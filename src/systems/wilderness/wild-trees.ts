// Static transforms are grouped by chunk and palette. Only trees within a short walk
// carry individual leaf sprays, and trees a long way off are a few dozen triangles; switching a
// tree moves its matrix between the three batches.
import * as THREE from 'three';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { makeInkMaterial } from '@/engine/render/ink-material';
import type { WildChunk } from '@/world/wilderness/chunk';
import { appendRemoteTree, appendTree, treeMatrix, treePalette } from './tree-geometry';

const ENTER = 31,
  LEAVE = 39;
/** Beyond this (metres, give or take MARGIN) a tree is drawn in a few dozen triangles. */
const REMOTE = 120;
const MARGIN = 6;
/** Added to a palette to key great trees' and bamboo's batches apart from ordinary trees. */
const KIND_LOOK = { great: 1000, bamboo: 2000 } as const;
const LOOK_SPAN = 1000;

class TreeBatch {
  /** Near (leaf sprays), far, and remote (a few dozen triangles). */
  private readonly meshes: readonly [THREE.InstancedMesh, THREE.InstancedMesh, THREE.InstancedMesh];
  /** Each tree's tier: 0 near, 1 far, 2 remote. */
  private readonly tier: Uint8Array;
  private readonly bounds = new THREE.Box2();

  constructor(
    private readonly transforms: THREE.Matrix4[],
    templates: readonly THREE.BufferGeometry[],
    material: THREE.Material,
    root: THREE.Group,
    player: THREE.Vector3,
  ) {
    const mesh = (k: number, name: string): THREE.InstancedMesh => {
      const m = new THREE.InstancedMesh(templates[k]!, material, transforms.length);
      m.name = name;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // empty until the first update sorts the trees into tiers
      m.count = 0;
      m.visible = false;
      root.add(m);
      return m;
    };
    this.meshes = [mesh(0, 'tree-sprays'), mesh(1, 'distant-trees'), mesh(2, 'remote-trees')];
    this.tier = new Uint8Array(transforms.length).fill(255);
    for (const m of transforms) this.bounds.expandByPoint(new THREE.Vector2(m.elements[12], m.elements[14]));
    this.update(player);
  }

  update(p: THREE.Vector3): void {
    // the whole batch well inside one tier and already in it: nothing to do
    const b = this.bounds;
    const nearest = Math.hypot(
      Math.max(b.min.x - p.x, p.x - b.max.x, 0),
      Math.max(b.min.y - p.z, p.z - b.max.y, 0),
    );
    const farthest = Math.hypot(
      Math.max(Math.abs(p.x - b.min.x), Math.abs(p.x - b.max.x)),
      Math.max(Math.abs(p.z - b.min.y), Math.abs(p.z - b.max.y)),
    );
    const all = this.transforms.length;
    if (nearest > REMOTE + MARGIN && this.meshes[2].count === all) return;
    if (nearest > LEAVE && farthest < REMOTE - MARGIN && this.meshes[1].count === all) return;
    let changed = false;
    for (let i = 0; i < this.transforms.length; i++) {
      const m = this.transforms[i]!.elements;
      const d = Math.hypot(p.x - m[12], p.z - m[14]);
      const was = this.tier[i]!;
      // a margin either side of each boundary, so a tree does not flicker between two
      const near = was === 0 ? d <= LEAVE : d <= ENTER;
      const remote = was === 2 ? d >= REMOTE - MARGIN : d >= REMOTE + MARGIN;
      const tier = near ? 0 : remote ? 2 : 1;
      if (tier !== was) {
        this.tier[i] = tier;
        changed = true;
      }
    }
    if (!changed) return;
    for (const mesh of this.meshes) mesh.count = 0;
    for (let i = 0; i < this.transforms.length; i++) {
      const mesh = this.meshes[this.tier[i]!]!;
      mesh.setMatrixAt(mesh.count++, this.transforms[i]!);
    }
    for (const mesh of this.meshes) {
      mesh.visible = mesh.count > 0;
      if (!mesh.visible) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) {
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
    // batched by look: a palette, and whether a great tree
    const byLook = new Map<number, THREE.Matrix4[]>();
    for (const tree of chunk.trees) {
      const look = treePalette(tree) + (tree.kind ? KIND_LOOK[tree.kind] : 0);
      let group = byLook.get(look);
      if (!group) byLook.set(look, (group = []));
      group.push(treeMatrix(tree));
    }
    const batches: TreeBatch[] = [];
    for (const [look, transforms] of byLook) {
      let templates = this.templates.get(look);
      if (!templates) {
        const kind = (['great', 'bamboo'] as const).find((k) => KIND_LOOK[k] === look - (look % LOOK_SPAN));
        templates = (['near', 'far', 'remote'] as const).map((detail) => {
          const g = new GeometryBuilder();
          if (detail === 'remote') appendRemoteTree(g, look % LOOK_SPAN, new THREE.Matrix4(), kind);
          else appendTree(g, look % LOOK_SPAN, new THREE.Matrix4(), detail === 'far', kind);
          return g.build();
        });
        this.templates.set(look, templates);
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
