// Axis-aligned box world: static colliders in a spatial hash, swept body movement with
// step-up, and raycasts. Ported from doodle-game's physics.js; adds collider groups so
// streamed chunks can be added and removed without rebuilding everything, and walks the
// hash grid for raycasts instead of testing every box.
import * as THREE from 'three';

const EPS = 1e-4;
const AXES = ['x', 'y', 'z'] as const;
type Axis = (typeof AXES)[number];

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** What a collider is, for raycast consumers (e.g. which surface a brush hit). */
export interface ColliderData {
  /** Surface ids per face, when the box is paintable. */
  readonly faces?: Partial<Record<'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz', number>>;
  /** Optional sub-rectangles on a face that map to another surface (doors). */
  readonly decals?: readonly Decal[];
  /** Not hit by brush or line-of-sight rays. */
  readonly seeThrough?: boolean;
  readonly tag?: string;
}

export interface Decal {
  readonly face: 'px' | 'nx' | 'pz' | 'nz';
  readonly min: Vec3Like;
  readonly max: Vec3Like;
  readonly surface: number;
}

export interface Box {
  readonly min: Vec3Like;
  readonly max: Vec3Like;
  readonly data: ColliderData;
  readonly group: string;
  /** Query stamp to de-duplicate boxes spanning several grid cells. */
  q: number;
}

export interface RayHit {
  readonly dist: number;
  readonly point: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly box: Box;
}

export interface Body {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  halfW: number;
  height: number;
  stepHeight: number;
  onGround: boolean;
  hitWall: boolean;
  hitCeiling: boolean;
  wallNormal: THREE.Vector3;
  landVel: number;
  noSnap: boolean;
  bx: number;
  bz: number;
}

export function makeBody(pos: THREE.Vector3, halfW: number, height: number, stepHeight = 0.55): Body {
  return {
    pos: pos.clone(),
    vel: new THREE.Vector3(),
    halfW,
    height,
    stepHeight,
    onGround: false,
    hitWall: false,
    hitCeiling: false,
    wallNormal: new THREE.Vector3(),
    landVel: 0,
    noSnap: false,
    bx: 0,
    bz: 0,
  };
}

const _min = new THREE.Vector3();
const _max = new THREE.Vector3();
const _out: Box[] = [];

export class PhysicsWorld {
  private readonly grid = new Map<number, Box[]>();
  private readonly groups = new Map<string, Box[]>();
  private qid = 0;

  constructor(readonly cell = 8) {
    if (!Number.isFinite(cell) || cell <= 0) throw new RangeError('Physics cell must be positive');
  }

  get boxCount(): number {
    let n = 0;
    for (const g of this.groups.values()) n += g.length;
    return n;
  }

  /** Add a box to a named group. Groups are removed together with removeGroup(). */
  addBox(group: string, min: Vec3Like, max: Vec3Like, data: ColliderData = {}): Box {
    const box: Box = { min: { ...min }, max: { ...max }, data, group, q: -1 };
    let list = this.groups.get(group);
    if (!list) this.groups.set(group, (list = []));
    list.push(box);
    this.forCells(box, (k) => {
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(box);
    });
    return box;
  }

  removeGroup(group: string): void {
    const list = this.groups.get(group);
    if (!list) return;
    const gone = new Set(list);
    const keys = new Set<number>();
    for (const box of list) this.forCells(box, (k) => keys.add(k));
    for (const k of keys) {
      const arr = this.grid.get(k);
      if (!arr) continue;
      const kept = arr.filter((b) => !gone.has(b));
      if (kept.length) this.grid.set(k, kept);
      else this.grid.delete(k);
    }
    this.groups.delete(group);
  }

  clear(): void {
    this.grid.clear();
    this.groups.clear();
  }

  private key(ix: number, iz: number): number {
    return (ix + 1_000_000) * 2_000_003 + (iz + 1_000_000);
  }

  private forCells(b: { min: Vec3Like; max: Vec3Like }, fn: (key: number) => void): void {
    const c = this.cell;
    const x0 = Math.floor(b.min.x / c);
    const x1 = Math.floor(b.max.x / c);
    const z0 = Math.floor(b.min.z / c);
    const z1 = Math.floor(b.max.z / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) fn(this.key(ix, iz));
  }

  /** Boxes overlapping the AABB [min, max]. */
  query(min: Vec3Like, max: Vec3Like, out: Box[] = []): Box[] {
    out.length = 0;
    const q = ++this.qid;
    this.forCells({ min, max }, (k) => {
      const arr = this.grid.get(k);
      if (!arr) return;
      for (const b of arr) {
        if (b.q === q) continue;
        b.q = q;
        if (
          b.min.x < max.x &&
          b.max.x > min.x &&
          b.min.y < max.y &&
          b.max.y > min.y &&
          b.min.z < max.z &&
          b.max.z > min.z
        )
          out.push(b);
      }
    });
    return out;
  }

  private bodyBox(body: Body, min: THREE.Vector3, max: THREE.Vector3): void {
    const p = body.pos;
    const hw = body.halfW;
    min.set(p.x - hw + EPS, p.y + EPS, p.z - hw + EPS);
    max.set(p.x + hw - EPS, p.y + body.height - EPS, p.z + hw - EPS);
  }

  overlapsBody(body: Body): boolean {
    this.bodyBox(body, _min, _max);
    return this.query(_min, _max, _out).length > 0;
  }

  /** Push the body out of overlapping boxes along one axis. Returns the push sign (0 = none). */
  private resolveAxis(body: Body, axis: number, move: number): number {
    const ax: Axis = AXES[axis]!;
    const p = body.pos;
    let pushed = 0;
    const dir = Math.sign(move);
    const lim = Math.abs(move) + 0.03;
    for (let iter = 0; iter < 4; iter++) {
      this.bodyBox(body, _min, _max);
      this.query(_min, _max, _out);
      if (_out.length === 0) break;
      let best = 0;
      for (const b of _out) {
        const cNeg = b.min[ax] - _max[ax] - EPS;
        const cPos = b.max[ax] - _min[ax] + EPS;
        let corr: number;
        if (dir > 0 && -cNeg <= lim) corr = cNeg;
        else if (dir < 0 && cPos <= lim) corr = cPos;
        else corr = Math.abs(cNeg) < Math.abs(cPos) ? cNeg : cPos;
        if (Math.abs(corr) > Math.abs(best)) best = corr;
      }
      if (best === 0) break;
      p[ax] += best;
      pushed = Math.sign(best);
    }
    return pushed;
  }

  private moveHoriz(body: Body, dx: number, dz: number, canStep: boolean): void {
    const p = body.pos;
    const ox = p.x;
    const oz = p.z;
    const oy = p.y;
    body.bx = 0;
    body.bz = 0;
    if (dx === 0 && dz === 0) return;
    p.x += dx;
    const rx = this.resolveAxis(body, 0, dx);
    p.z += dz;
    const rz = this.resolveAxis(body, 2, dz);
    if (rx === 0 && rz === 0) return;
    const nx = p.x;
    const nz = p.z;
    let stepped = false;
    if (canStep && body.stepHeight > 0) {
      p.x = ox;
      p.z = oz;
      p.y = oy + body.stepHeight;
      if (!this.overlapsBody(body)) {
        p.x += dx;
        const rx2 = this.resolveAxis(body, 0, dx);
        p.z += dz;
        const rz2 = this.resolveAxis(body, 2, dz);
        p.y -= body.stepHeight;
        this.resolveAxis(body, 1, -body.stepHeight);
        const d1 = (nx - ox) ** 2 + (nz - oz) ** 2;
        const d2 = (p.x - ox) ** 2 + (p.z - oz) ** 2;
        if (d2 > d1 + 1e-6 && p.y >= oy - 1e-3 && !this.overlapsBody(body)) {
          stepped = true;
          body.bx = rx2;
          body.bz = rz2;
          if (rx2 !== 0 || rz2 !== 0) {
            body.hitWall = true;
            body.wallNormal.set(rx2, 0, rz2).normalize();
          }
        }
      }
      if (!stepped) {
        p.x = nx;
        p.z = nz;
        p.y = oy;
      }
    }
    if (!stepped) {
      body.bx = rx;
      body.bz = rz;
      body.hitWall = true;
      body.wallNormal.set(rx, 0, rz).normalize();
    }
  }

  /** Integrate a body; sub-steps fast movement so it never tunnels. */
  moveBody(body: Body, dt: number): void {
    if (!Number.isFinite(dt) || dt < 0 || dt > 0.05) throw new RangeError(`Invalid physics timestep: ${dt}`);
    const sp = body.vel.length();
    const maxStep = Math.max(0.2, body.halfW * 0.8);
    const n = Math.max(1, Math.ceil((sp * dt) / maxStep));
    if (n > 512) throw new RangeError('Physics movement exceeds substep budget');
    let landVel = 0;
    let hitWall = false;
    let hitCeiling = false;
    let wx = 0;
    let wz = 0;
    for (let i = 0; i < n; i++) {
      this.step(body, dt / n);
      if (body.hitWall) {
        hitWall = true;
        wx = body.wallNormal.x;
        wz = body.wallNormal.z;
      }
      if (body.hitCeiling) hitCeiling = true;
      if (body.landVel) landVel = body.landVel;
    }
    body.hitWall = hitWall;
    body.wallNormal.set(wx, 0, wz);
    body.hitCeiling = hitCeiling;
    body.landVel = landVel;
  }

  private step(body: Body, dt: number): void {
    const p = body.pos;
    const v = body.vel;
    body.hitWall = false;
    body.hitCeiling = false;
    body.wallNormal.set(0, 0, 0);
    body.landVel = 0;
    const wasGround = body.onGround;
    this.moveHoriz(body, v.x * dt, v.z * dt, wasGround);
    if (body.bx !== 0) v.x = 0;
    if (body.bz !== 0) v.z = 0;
    const dy = v.y * dt;
    p.y += dy;
    const r = this.resolveAxis(body, 1, dy);
    body.onGround = false;
    if (r > 0) {
      body.onGround = true;
      body.landVel = v.y;
      if (v.y < 0) v.y = 0;
    } else if (r < 0) {
      body.hitCeiling = true;
      if (v.y > 0) v.y = 0;
    }
    if (!body.onGround && wasGround && v.y <= 0 && !body.noSnap) {
      const probe = body.stepHeight;
      p.y -= probe;
      if (this.resolveAxis(body, 1, -probe) > 0) {
        body.onGround = true;
        v.y = 0;
      } else p.y += probe;
    }
  }

  /** Ray against boxes, walking the hash grid cell by cell (2D DDA on xz). */
  raycast(o: Vec3Like, d: Vec3Like, maxDist = 1000, ignore?: (b: Box) => boolean): RayHit | null {
    const c = this.cell;
    let ix = Math.floor(o.x / c);
    let iz = Math.floor(o.z / c);
    const stepX = d.x > 0 ? 1 : -1;
    const stepZ = d.z > 0 ? 1 : -1;
    const tDeltaX = Math.abs(d.x) < 1e-12 ? Infinity : c / Math.abs(d.x);
    const tDeltaZ = Math.abs(d.z) < 1e-12 ? Infinity : c / Math.abs(d.z);
    let tMaxX = Math.abs(d.x) < 1e-12 ? Infinity : ((d.x > 0 ? ix + 1 : ix) * c - o.x) / d.x;
    let tMaxZ = Math.abs(d.z) < 1e-12 ? Infinity : ((d.z > 0 ? iz + 1 : iz) * c - o.z) / d.z;
    const q = ++this.qid;
    let best: Box | null = null;
    let bestT = maxDist;
    let bAxis = -1;
    let bSign = 0;

    for (let guard = 0; guard < 100000; guard++) {
      const arr = this.grid.get(this.key(ix, iz));
      if (arr)
        for (const b of arr) {
          if (b.q === q) continue;
          b.q = q;
          if (ignore?.(b)) continue;
          let tmin = 0;
          let tmax = bestT;
          let nAxis = -1;
          let nSign = 0;
          let ok = true;
          for (let a = 0; a < 3; a++) {
            const ax = AXES[a]!;
            const da = d[ax];
            const oa = o[ax];
            if (Math.abs(da) < 1e-12) {
              if (oa < b.min[ax] || oa > b.max[ax]) {
                ok = false;
                break;
              }
              continue;
            }
            const inv = 1 / da;
            let t1 = (b.min[ax] - oa) * inv;
            let t2 = (b.max[ax] - oa) * inv;
            let sign = -1;
            if (t1 > t2) {
              [t1, t2] = [t2, t1];
              sign = 1;
            }
            if (t1 > tmin) {
              tmin = t1;
              nAxis = a;
              nSign = sign;
            }
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) {
              ok = false;
              break;
            }
          }
          if (!ok || nAxis < 0) continue;
          if (tmin < bestT) {
            best = b;
            bestT = tmin;
            bAxis = nAxis;
            bSign = nSign;
          }
        }
      // a hit before this cell's exit cannot be beaten by boxes in later cells
      const exit = Math.min(tMaxX, tMaxZ);
      if (best && bestT <= exit) break;
      if (tMaxX < tMaxZ) {
        tMaxX += tDeltaX;
        ix += stepX;
      } else {
        tMaxZ += tDeltaZ;
        iz += stepZ;
      }
      if (exit > bestT || exit > maxDist) break;
    }
    if (!best) return null;
    const point = new THREE.Vector3(o.x + d.x * bestT, o.y + d.y * bestT, o.z + d.z * bestT);
    const normal = new THREE.Vector3();
    normal[AXES[bAxis]!] = bSign;
    return { dist: bestT, point, normal, box: best };
  }

  groundBelow(x: number, y: number, z: number, maxDrop = 200): number | null {
    const hit = this.raycast({ x, y, z }, { x: 0, y: -1, z: 0 }, maxDrop);
    return hit ? hit.point.y : null;
  }
}

/** Which surface a ray hit on a paintable box, or null. */
export function surfaceAt(hit: RayHit): number | null {
  const { box, normal, point } = hit;
  const face =
    normal.x > 0.5
      ? 'px'
      : normal.x < -0.5
        ? 'nx'
        : normal.y > 0.5
          ? 'py'
          : normal.y < -0.5
            ? 'ny'
            : normal.z > 0.5
              ? 'pz'
              : 'nz';
  for (const d of box.data.decals ?? []) {
    if (d.face !== face) continue;
    const e = 0.05;
    if (
      point.x >= d.min.x - e &&
      point.x <= d.max.x + e &&
      point.y >= d.min.y - e &&
      point.y <= d.max.y + e &&
      point.z >= d.min.z - e &&
      point.z <= d.max.z + e
    )
      return d.surface;
  }
  return box.data.faces?.[face] ?? null;
}
