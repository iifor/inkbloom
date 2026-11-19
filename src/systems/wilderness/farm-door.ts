import * as THREE from 'three';
import { color } from '@/content/palette';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import type { PhysicsWorld } from '@/engine/physics/world';
import type { GameContext } from '@/game/types';
import { DOOR_HEIGHT, DOOR_WIDTH } from '@/systems/city/country-house';

export interface FarmDoor {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly front: 1 | -1;
  readonly tint: number;
}

const WIDTH = DOOR_WIDTH - 0.022;
const HEIGHT = DOOR_HEIGHT - 0.035;
const HALF_DEPTH = 0.045;

function doorLeaf(g: GeometryBuilder, tint: number): void {
  const piece = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) =>
    g.box({ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 }, { px: c, nx: c, py: c, ny: c, pz: c, nz: c });
  piece(0, 0.012, -HALF_DEPTH, WIDTH, HEIGHT, HALF_DEPTH, tint);
  const wood = color('bark');
  const iron = color('charcoal');
  for (const sign of [-1, 1]) {
    const z0 = Math.min(sign * 0.042, sign * 0.07);
    const z1 = Math.max(sign * 0.042, sign * 0.07);
    for (const y of [0.27, 1.29, 2.09]) piece(0.06, y, z0, WIDTH - 0.06, y + 0.11, z1, wood);
    const handle0 = Math.min(sign * 0.043, sign * 0.122);
    const handle1 = Math.max(sign * 0.043, sign * 0.122);
    piece(WIDTH - 0.28, 1.035, handle0, WIDTH - 0.11, 1.1, handle1, iron);
  }
}

function hinge(door: FarmDoor): THREE.Vector3 {
  return new THREE.Vector3(door.x - (door.front * WIDTH) / 2, door.y, door.z);
}

export function appendClosedFarmDoor(g: GeometryBuilder, door: FarmDoor): void {
  const leaf = new GeometryBuilder();
  doorLeaf(leaf, door.tint);
  g.append(leaf, new THREE.Matrix4().makeRotationY(door.front === 1 ? 0 : Math.PI).setPosition(hinge(door)));
}

export function mountFarmDoor(
  ctx: GameContext,
  root: THREE.Object3D,
  material: THREE.Material,
  physics: PhysicsWorld,
  group: string,
  door: FarmDoor,
): () => void {
  const geometry = new GeometryBuilder();
  doorLeaf(geometry, door.tint);
  const mesh = new THREE.Mesh(geometry.build(), material);
  const pivot = hinge(door);
  mesh.position.copy(pivot);
  root.add(mesh);
  const closedYaw = door.front === 1 ? 0 : Math.PI;
  let swing: -1 | 0 | 1 = 0;
  const set = (next: typeof swing) => {
    swing = next;
    const yaw = closedYaw + swing * (Math.PI / 2);
    mesh.rotation.y = yaw;
    const x = pivot.x + (Math.cos(yaw) * WIDTH) / 2;
    const z = pivot.z - (Math.sin(yaw) * WIDTH) / 2;
    physics.removeGroup(group);
    physics.addBox(
      group,
      { x: x - WIDTH / 2, y: pivot.y, z: z - HALF_DEPTH },
      { x: x + WIDTH / 2, y: pivot.y + HEIGHT, z: z + HALF_DEPTH },
      { noAutoStep: true },
      yaw,
    );
  };
  set(0);
  const off = ctx.interactions.add({
    scene: 'wild',
    pos: new THREE.Vector3(door.x, door.y + 0.45, door.z),
    radius: 2.2,
    label: () => {
      const p = ctx.player.position;
      return Math.hypot(p.x - door.x, p.z - door.z) <= 2.2 && Math.abs(p.y - door.y) < 1.25
        ? swing
          ? '关门'
          : '开门'
        : null;
    },
    activate: () => {
      const p = ctx.player.position;
      // Open away from the player. Close only when the threshold and swing are clear.
      const along = (p.x - pivot.x) * door.front;
      const into = (door.z - p.z) * door.front;
      const half = 0.35;
      const travel = swing ? swing * into : Math.abs(into);
      if (
        along > -half &&
        along < WIDTH + half &&
        (swing ? travel > -half && travel < WIDTH + half : travel < half)
      )
        return;
      set(swing ? 0 : into > 0 ? -1 : 1);
    },
  });
  return () => {
    off();
    physics.removeGroup(group);
    mesh.removeFromParent();
    mesh.geometry.dispose();
  };
}
