import * as THREE from 'three';
import { makeInkMaterial, shared } from './ink-material';
import { makeWindMap, sampleWindMap } from './wind-map';

export interface FlagSpec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly color: number;
  readonly phase: number;
  readonly surface?: number;
}

/** A light cloth grid: its entire hoist is pinned, its free edge lifts with the wind. */
export class FlagCloth {
  readonly mesh: THREE.Mesh;
  private readonly position: THREE.BufferAttribute;
  private readonly air = new THREE.Vector2();
  private readonly location = new THREE.Vector3();
  private strength = 0;
  private angle = 0;
  private settled = false;
  private readonly columns = 16;
  private readonly rows = 8;

  constructor(
    readonly spec: FlagSpec,
    material: THREE.Material,
  ) {
    const geometry = new THREE.PlaneGeometry(1, 1, this.columns, this.rows);
    this.position = geometry.getAttribute('position') as THREE.BufferAttribute;
    this.position.setUsage(THREE.DynamicDrawUsage);
    (geometry.getAttribute('normal') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(
      'aColor',
      new THREE.Float32BufferAttribute(new Float32Array(this.position.count).fill(spec.color), 1),
    );
    geometry.setAttribute(
      'aSurface',
      new THREE.Float32BufferAttribute(new Float32Array(this.position.count).fill(spec.surface ?? -1), 1),
    );
    geometry.setAttribute(
      'aPane',
      new THREE.Float32BufferAttribute(new Float32Array(this.position.count * 2), 2),
    );
    // Conservative for every wind direction and for the fully hanging cloth.
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, -spec.height / 2, 0),
      spec.width * 1.4 + spec.height,
    );
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'wind-flag';
    this.mesh.position.set(spec.x, spec.y, spec.z);
    this.pose(0);
  }

  update(dt: number, windMap: THREE.DataTexture): void {
    this.mesh.getWorldPosition(this.location);
    sampleWindMap(
      windMap,
      this.location.x - shared.uWindDrift.value.x,
      this.location.z - shared.uWindDrift.value.y,
      this.air,
    );
    const wind = shared.uWind.value;
    const speed = wind.length();
    const gust = THREE.MathUtils.smoothstep(this.air.x, 0.22, 0.8);
    const target = speed * (0.65 + 0.5 * gust);
    // Keep the last direction in still air; blend direction across +/- PI by the shortest arc.
    const angle = speed > 0.02 ? Math.atan2(wind.y, wind.x) + (this.air.y - 0.5) * 0.28 : this.angle;
    const follow = this.settled ? 1 - Math.exp(-dt * 3) : 1;
    this.strength += (target - this.strength) * follow;
    this.angle += Math.atan2(Math.sin(angle - this.angle), Math.cos(angle - this.angle)) * follow;
    this.settled = true;
    this.pose(shared.uTime.value);
  }

  private pose(time: number): void {
    const { width, height, phase } = this.spec;
    const lift = 1 - Math.exp(-this.strength * 0.5);
    const dx = Math.cos(this.angle),
      dz = Math.sin(this.angle);
    for (let row = 0; row <= this.rows; row++) {
      const v = row / this.rows;
      for (let col = 0; col <= this.columns; col++) {
        const u = col / this.columns;
        const wave =
          Math.sin(u * 10 - time * 4.2 + phase + v * 1.8) +
          0.3 * Math.sin(u * 19 - time * 6.3 + phase - v * 2.5);
        const fold = Math.sin(v * Math.PI * 4 + u * 2 + phase) * width * 0.045 * u;
        const along = width * u * (0.24 + 0.76 * lift);
        const cross = fold * (1 - lift) + width * 0.095 * u ** 1.4 * wave * lift;
        this.position.setXYZ(
          row * (this.columns + 1) + col,
          dx * along - dz * cross,
          -height * v - width * u * (0.88 * (1 - lift) + 0.06 * lift) + width * 0.025 * u * wave * lift,
          dz * along + dx * cross,
        );
      }
    }
    this.position.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}

/** One shared cloth material and wind map per collection, released with the owning scene. */
export class WindFlags {
  private readonly material = makeInkMaterial({ cloth: true, side: THREE.DoubleSide });
  private readonly flags = new Set<FlagCloth>();
  private readonly windMap: THREE.DataTexture;
  private readonly ownsMap: boolean;

  constructor(
    private readonly root: THREE.Object3D,
    seed: number,
    map?: THREE.DataTexture,
  ) {
    this.windMap = map ?? makeWindMap(seed ^ 0x714d);
    this.ownsMap = !map;
  }

  add(spec: FlagSpec): () => void {
    const flag = new FlagCloth(spec, this.material);
    this.root.add(flag.mesh);
    this.flags.add(flag);
    flag.update(0, this.windMap);
    return () => {
      flag.dispose();
      this.flags.delete(flag);
    };
  }

  update(dt: number): void {
    for (const flag of this.flags) flag.update(dt, this.windMap);
  }

  dispose(): void {
    for (const flag of this.flags) flag.dispose();
    this.flags.clear();
    this.material.dispose();
    if (this.ownsMap) this.windMap.dispose();
  }
}
