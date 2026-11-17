// Box world: static colliders in a spatial hash, swept body movement with step-up, and
// raycasts. Ported from doodle-game's physics.js; adds collider groups so streamed chunks can
// be added and removed without rebuilding everything, and walks the hash grid for raycasts
// instead of testing every box.
//
// A world may also have smooth `ground`: a height function (rolling hills). Bodies stand on it
// and follow it downhill, slopes steeper than MAX_SLOPE stop them like a wall, and rays stop at
// it. Boxes (trees, towers, ruins) sit on top of it as usual.
//
// Boxes are axis-aligned unless added with a yaw: a turned box keeps its AABB in min/max for
// the hash and as a cheap first test, then gets an exact test in its own frame (separating
// axes against the body's footprint, slabs for rays). Bodies slide off turned walls along
// their normal instead of stopping axis by axis.
import * as THREE from 'three';

const EPS = 1e-4;
/** Steepest ground a body can walk up (rise over run). */
export const MAX_SLOPE = 1;
/** Stand-in box for ray hits on the ground; it has no faces, so no surface either. */
const GROUND_BOX: Box = {
  min: { x: 0, y: 0, z: 0 },
  max: { x: 0, y: 0, z: 0 },
  data: {},
  group: 'ground',
  q: -1,
};
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
  /** This box is one of several standing in for a box turned about +y (see turnedBox): faces
   * and decals belong to that box, and a hit is placed on them in its own frame. */
  readonly turned?: TurnedFrame;
}

/** A box turned about +y, as the boxes standing in for it remember it. */
export interface TurnedFrame {
  /** Centre; y is where its own heights start (decals are measured from it). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Its own +z faces (sin angle, cos angle). */
  readonly angle: number;
  /** Half its size along its own x and z. */
  readonly hx: number;
  readonly hz: number;
  /** Surface ids per face, in its own frame. */
  readonly faces?: Partial<Record<'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz', number>>;
  /** Sub-rectangles of its faces with another surface, in its own frame. */
  readonly decals?: readonly Decal[];
}

/**
 * Axis-aligned boxes standing in for a box turned about +y, from y0 to y1: slices across it no
 * wider than `slice`, each only as long as the turned box is all along the slice, so none
 * pokes out of it. A box turned by a whole quarter is one box.
 */
export function turnedBox(
  t: TurnedFrame,
  y0: number,
  y1: number,
  add: (min: Vec3Like, max: Vec3Like, data: ColliderData) => void,
  slice = 0.8,
): void {
  const c = Math.cos(t.angle);
  const s = Math.sin(t.angle);
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => ({ x: t.x + c * u! * t.hx + s * v! * t.hz, z: t.z - s * u! * t.hx + c * v! * t.hz }));
  const data: ColliderData = { turned: t };
  const xs = corners.map((p) => p.x);
  const zs = corners.map((p) => p.z);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  if (Math.abs(s) < 0.03 || Math.abs(c) < 0.03) {
    add({ x: x0, y: y0, z: Math.min(...zs) }, { x: x1, y: y1, z: Math.max(...zs) }, data);
    return;
  }
  /** Where the outline crosses x: its lowest and highest z there. */
  const across = (x: number): [number, number] => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 4; i++) {
      const a = corners[i]!;
      const b = corners[(i + 1) % 4]!;
      if ((x < a.x && x < b.x) || (x > a.x && x > b.x) || a.x === b.x) continue;
      const z = a.z + ((x - a.x) / (b.x - a.x)) * (b.z - a.z);
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    }
    return [lo, hi];
  };
  const count = Math.ceil((x1 - x0) / slice);
  for (let k = 0; k < count; k++) {
    const xa = x0 + ((x1 - x0) * k) / count;
    const xb = x0 + ((x1 - x0) * (k + 1)) / count;
    const [loA, hiA] = across(xa);
    const [loB, hiB] = across(xb);
    const lo = Math.max(loA, loB);
    const hi = Math.min(hiA, hiB);
    if (hi - lo > 0.05) add({ x: xa, y: y0, z: lo }, { x: xb, y: y1, z: hi }, data);
  }
}

export interface Decal {
  readonly face: 'px' | 'nx' | 'pz' | 'nz';
  readonly min: Vec3Like;
  readonly max: Vec3Like;
  readonly surface: number;
}

/** A box turned about its vertical centre line, in the three.js `rotation.y` sense. */
export interface BoxTurn {
  readonly yaw: number;
  readonly cx: number;
  readonly cz: number;
  /** Half extents along the box's own x and z. */
  readonly hx: number;
  readonly hz: number;
  readonly c: number;
  readonly s: number;
}

export interface Box {
  /** The AABB; for a turned box, of the box after turning. */
  readonly min: Vec3Like;
  readonly max: Vec3Like;
  readonly data: ColliderData;
  readonly group: string;
  readonly turn?: BoxTurn;
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
const _push = { x: 0, z: 0 };
const _tn = new THREE.Vector3();

/**
 * How deep the xz rectangle [min, max] sits in a turned box, on the shallowest of the four
 * separating axes (world x and z, the box's own x and z); 0 or less when they are apart. With
 * `out`, also writes the xz move that pushes the rectangle out along that axis.
 */
function turnedDepth(b: Box, min: Vec3Like, max: Vec3Like, out?: { x: number; z: number }): number {
  const t = b.turn!;
  const ax = (max.x - min.x) / 2;
  const az = (max.z - min.z) / 2;
  const dx = t.cx - (min.x + max.x) / 2;
  const dz = t.cz - (min.z + max.z) / 2;
  const ac = Math.abs(t.c);
  const as = Math.abs(t.s);
  // the box's own axes are (c, -s) and (s, c)
  const du = dx * t.c - dz * t.s;
  const dv = dx * t.s + dz * t.c;
  const d0 = ax + (b.max.x - b.min.x) / 2 - Math.abs(dx);
  const d1 = az + (b.max.z - b.min.z) / 2 - Math.abs(dz);
  const d2 = ax * ac + az * as + t.hx - Math.abs(du);
  const d3 = ax * as + az * ac + t.hz - Math.abs(dv);
  const depth = Math.min(d0, d1, d2, d3);
  if (out && depth > 0) {
    // away from the box centre, a hair past touching
    const m = depth + EPS;
    if (depth === d0) [out.x, out.z] = [-Math.sign(dx) * m, 0];
    else if (depth === d1) [out.x, out.z] = [0, -Math.sign(dz) * m];
    else if (depth === d2) [out.x, out.z] = [-Math.sign(du) * m * t.c, Math.sign(du) * m * t.s];
    else [out.x, out.z] = [-Math.sign(dv) * m * t.s, -Math.sign(dv) * m * t.c];
  }
  return depth;
}

/** Where a ray enters a turned box (Infinity if it does not); writes that face's world normal. */
function turnedRay(b: Box, o: Vec3Like, d: Vec3Like, maxT: number, n: THREE.Vector3): number {
  const t = b.turn!;
  const rx = o.x - t.cx;
  const rz = o.z - t.cz;
  const lo = [rx * t.c - rz * t.s, o.y, rx * t.s + rz * t.c];
  const ld = [d.x * t.c - d.z * t.s, d.y, d.x * t.s + d.z * t.c];
  const lmin = [-t.hx, b.min.y, -t.hz];
  const lmax = [t.hx, b.max.y, t.hz];
  let tmin = 0;
  let tmax = maxT;
  let nAxis = -1;
  let nSign = 0;
  for (let a = 0; a < 3; a++) {
    const da = ld[a]!;
    const oa = lo[a]!;
    if (Math.abs(da) < 1e-12) {
      if (oa < lmin[a]! || oa > lmax[a]!) return Infinity;
      continue;
    }
    const inv = 1 / da;
    let t1 = (lmin[a]! - oa) * inv;
    let t2 = (lmax[a]! - oa) * inv;
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
    if (tmin > tmax) return Infinity;
  }
  if (nAxis < 0) return Infinity;
  // the box's own x is (c, 0, -s) in the world, its own z (s, 0, c)
  if (nAxis === 0) n.set(nSign * t.c, 0, -nSign * t.s);
  else if (nAxis === 1) n.set(0, nSign, 0);
  else n.set(nSign * t.s, 0, nSign * t.c);
  return tmin;
}

export class PhysicsWorld {
  private readonly grid = new Map<number, Box[]>();
  private readonly groups = new Map<string, Box[]>();
  private qid = 0;
  /** Set when an axis resolve met a turned box, so moveHoriz knows to push out of it. */
  private turnedNear = false;
  /** Push out of turned walls in the last horizontal move; a unit normal once it ends. */
  private readonly slide = new THREE.Vector3();
  /** Smooth ground height at (x, z), or null for a world of boxes only. */
  ground: ((x: number, z: number) => number) | null = null;

  constructor(readonly cell = 8) {
    if (!Number.isFinite(cell) || cell <= 0) throw new RangeError('Physics cell must be positive');
  }

  get boxCount(): number {
    let n = 0;
    for (const g of this.groups.values()) n += g.length;
    return n;
  }

  /**
   * Add a box to a named group. Groups are removed together with removeGroup(). With a yaw,
   * [min, max] is the box before turning; it turns about its vertical centre line.
   */
  addBox(group: string, min: Vec3Like, max: Vec3Like, data: ColliderData = {}, yaw = 0): Box {
    let box: Box;
    if (!yaw) box = { min: { ...min }, max: { ...max }, data, group, q: -1 };
    else {
      const cx = (min.x + max.x) / 2;
      const cz = (min.z + max.z) / 2;
      const hx = (max.x - min.x) / 2;
      const hz = (max.z - min.z) / 2;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const ex = hx * Math.abs(c) + hz * Math.abs(s);
      const ez = hx * Math.abs(s) + hz * Math.abs(c);
      box = {
        min: { x: cx - ex, y: min.y, z: cz - ez },
        max: { x: cx + ex, y: max.y, z: cz + ez },
        data,
        group,
        turn: { yaw, cx, cz, hx, hz, c, s },
        q: -1,
      };
    }
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
          b.max.z > min.z &&
          (!b.turn || turnedDepth(b, min, max) > 0)
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
        if (b.turn) {
          // turned boxes push out along their own normals (resolveTurned); up and down they are
          // like any box
          this.turnedNear = true;
          if (axis !== 1) continue;
        }
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

  /** Push the body out of turned boxes it overlaps, adding the push to `slide`. */
  private resolveTurned(body: Body): boolean {
    if (!this.turnedNear) return false;
    this.turnedNear = false;
    const p = body.pos;
    let pushed = false;
    for (let iter = 0; iter < 4; iter++) {
      this.bodyBox(body, _min, _max);
      this.query(_min, _max, _out);
      let best = 0;
      let px = 0;
      let pz = 0;
      for (const b of _out) {
        if (!b.turn) continue;
        const depth = turnedDepth(b, _min, _max, _push);
        if (depth > best) {
          best = depth;
          px = _push.x;
          pz = _push.z;
        }
      }
      if (best === 0) break;
      p.x += px;
      p.z += pz;
      this.slide.x += px;
      this.slide.z += pz;
      pushed = true;
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
    this.slide.set(0, 0, 0);
    if (dx === 0 && dz === 0) return;
    this.turnedNear = false;
    p.x += dx;
    const rx = this.resolveAxis(body, 0, dx);
    p.z += dz;
    const rz = this.resolveAxis(body, 2, dz);
    const turned = this.resolveTurned(body);
    if (rx === 0 && rz === 0 && !turned) return;
    const nx = p.x;
    const nz = p.z;
    const sx = this.slide.x;
    const sz = this.slide.z;
    let stepped = false;
    if (canStep && body.stepHeight > 0) {
      p.x = ox;
      p.z = oz;
      p.y = oy + body.stepHeight;
      if (!this.overlapsBody(body)) {
        this.slide.set(0, 0, 0);
        this.turnedNear = false;
        p.x += dx;
        const rx2 = this.resolveAxis(body, 0, dx);
        p.z += dz;
        const rz2 = this.resolveAxis(body, 2, dz);
        const turned2 = this.resolveTurned(body);
        p.y -= body.stepHeight;
        this.resolveAxis(body, 1, -body.stepHeight);
        const d1 = (nx - ox) ** 2 + (nz - oz) ** 2;
        const d2 = (p.x - ox) ** 2 + (p.z - oz) ** 2;
        if (d2 > d1 + 1e-6 && p.y >= oy - 1e-3 && !this.overlapsBody(body)) {
          stepped = true;
          body.bx = rx2;
          body.bz = rz2;
          if (rx2 !== 0 || rz2 !== 0 || turned2) this.wallHit(body, rx2, rz2);
        }
      }
      if (!stepped) {
        p.x = nx;
        p.z = nz;
        p.y = oy;
        this.slide.set(sx, 0, sz);
      }
    }
    if (!stepped) {
      body.bx = rx;
      body.bz = rz;
      this.wallHit(body, rx, rz);
    }
    this.slide.normalize();
  }

  /** Mark a wall hit from axis pushes plus any turned-wall push in `slide`. */
  private wallHit(body: Body, rx: number, rz: number): void {
    const n = Math.hypot(this.slide.x, this.slide.z);
    body.hitWall = true;
    body.wallNormal
      .set(rx + (n > 0 ? this.slide.x / n : 0), 0, rz + (n > 0 ? this.slide.z / n : 0))
      .normalize();
  }

  /** Undo a horizontal move that would climb ground steeper than MAX_SLOPE. */
  private slopeLimit(body: Body, ox: number, oz: number): void {
    const g = this.ground;
    if (!g) return;
    const p = body.pos;
    const run = Math.hypot(p.x - ox, p.z - oz);
    if (run < 1e-6) return;
    const to = g(p.x, p.z);
    // only climbing counts, and only when the body is down at the ground
    if (to - p.y <= 0.05 || to - g(ox, oz) <= MAX_SLOPE * run) return;
    const nx = (ox - p.x) / run;
    const nz = (oz - p.z) / run;
    p.x = ox;
    p.z = oz;
    body.hitWall = true;
    body.wallNormal.set(nx, 0, nz);
    if (Math.abs(nx) > 0.3) body.bx = Math.sign(nx);
    if (Math.abs(nz) > 0.3) body.bz = Math.sign(nz);
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
    const ox = p.x;
    const oz = p.z;
    this.moveHoriz(body, v.x * dt, v.z * dt, wasGround);
    this.slopeLimit(body, ox, oz);
    if (body.bx !== 0) v.x = 0;
    if (body.bz !== 0) v.z = 0;
    // along a turned wall keep only the velocity that does not go into it
    const sn = this.slide;
    const into = v.x * sn.x + v.z * sn.z;
    if (into < 0) {
      v.x -= into * sn.x;
      v.z -= into * sn.z;
    }
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
    const g = this.ground;
    if (g) {
      const gy = g(p.x, p.z);
      if (p.y <= gy) {
        // landed on (or walked into rising) ground
        if (!body.onGround && v.y < 0) body.landVel = v.y;
        p.y = gy;
        body.onGround = true;
        if (v.y < 0) v.y = 0;
      } else if (!body.onGround && wasGround && v.y <= 0 && !body.noSnap && p.y - gy <= body.stepHeight) {
        // walking downhill: keep the feet on the ground instead of skipping off it
        p.y = gy;
        body.onGround = true;
        v.y = 0;
      }
    }
  }

  /** Where a ray first meets the ground, by marching then bisecting; Infinity if it does not. */
  private groundHit(o: Vec3Like, d: Vec3Like, maxDist: number): number {
    const g = this.ground;
    if (!g) return Infinity;
    const above = (t: number): number => o.y + d.y * t - g(o.x + d.x * t, o.z + d.z * t);
    let t0 = 0;
    let a0 = above(0);
    if (a0 <= 0) return 0;
    for (let guard = 0; guard < 4000 && t0 < maxDist; guard++) {
      // step by a share of the clearance: big strides high up, small ones skimming the ground
      const t1 = Math.min(maxDist, t0 + Math.min(4, Math.max(0.25, a0 * 0.5)));
      const a1 = above(t1);
      if (a1 <= 0) {
        let lo = t0;
        let hi = t1;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          if (above(mid) > 0) lo = mid;
          else hi = mid;
        }
        return hi;
      }
      if (t1 >= maxDist) break;
      t0 = t1;
      a0 = a1;
    }
    return Infinity;
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
    let bTurned: THREE.Vector3 | null = null;

    for (let guard = 0; guard < 100000; guard++) {
      const arr = this.grid.get(this.key(ix, iz));
      if (arr)
        for (const b of arr) {
          if (b.q === q) continue;
          b.q = q;
          if (ignore?.(b)) continue;
          if (b.turn) {
            const t = turnedRay(b, o, d, bestT, _tn);
            if (t < bestT) {
              best = b;
              bestT = t;
              bTurned = _tn.clone();
            }
            continue;
          }
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
            bTurned = null;
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
    const gt = this.groundHit(o, d, best ? bestT : maxDist);
    if (gt < (best ? bestT : Infinity) || (!best && gt <= maxDist)) {
      const point = new THREE.Vector3(o.x + d.x * gt, o.y + d.y * gt, o.z + d.z * gt);
      const g = this.ground!;
      const e = 0.3;
      const normal = new THREE.Vector3(
        g(point.x - e, point.z) - g(point.x + e, point.z),
        2 * e,
        g(point.x, point.z - e) - g(point.x, point.z + e),
      ).normalize();
      return { dist: gt, point, normal, box: GROUND_BOX };
    }
    if (!best) return null;
    const point = new THREE.Vector3(o.x + d.x * bestT, o.y + d.y * bestT, o.z + d.z * bestT);
    const normal = bTurned ?? new THREE.Vector3();
    if (!bTurned) normal[AXES[bAxis]!] = bSign;
    return { dist: bestT, point, normal, box: best };
  }

  groundBelow(x: number, y: number, z: number, maxDrop = 200): number | null {
    const hit = this.raycast({ x, y, z }, { x: 0, y: -1, z: 0 }, maxDrop);
    return hit ? hit.point.y : null;
  }
}

/**
 * Which surface a ray hit on a paintable box, or null. A turned box's faces and decals are
 * named and placed as before it turned.
 */
export function surfaceAt(hit: RayHit): number | null {
  const { box } = hit;
  let { normal, point } = hit;
  if (box.data.turned) return turnedSurfaceAt(box.data.turned, normal, point);
  const t = box.turn;
  if (t) {
    const rx = point.x - t.cx;
    const rz = point.z - t.cz;
    point = new THREE.Vector3(t.cx + rx * t.c - rz * t.s, point.y, t.cz + rx * t.s + rz * t.c);
    normal = new THREE.Vector3(normal.x * t.c - normal.z * t.s, normal.y, normal.x * t.s + normal.z * t.c);
  }
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

/** Which face of a turned box a hit is on, and its surface, worked out in the box's own frame. */
function turnedSurfaceAt(t: TurnedFrame, normal: Vec3Like, point: Vec3Like): number | null {
  const c = Math.cos(t.angle);
  const s = Math.sin(t.angle);
  const dx = point.x - t.x;
  const dz = point.z - t.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const ly = point.y - t.y;
  const face =
    normal.y > 0.5
      ? 'py'
      : normal.y < -0.5
        ? 'ny'
        : Math.abs(lx) - t.hx > Math.abs(lz) - t.hz
          ? lx > 0
            ? 'px'
            : 'nx'
          : lz > 0
            ? 'pz'
            : 'nz';
  for (const d of t.decals ?? []) {
    if (d.face !== face) continue;
    // the stand-in boxes sit a little inside the turned one: only check along the face
    const u = face === 'pz' || face === 'nz' ? lx : lz;
    const [u0, u1] = face === 'pz' || face === 'nz' ? [d.min.x, d.max.x] : [d.min.z, d.max.z];
    if (u >= u0 - 0.05 && u <= u1 + 0.05 && ly >= d.min.y - 0.05 && ly <= d.max.y + 0.05) return d.surface;
  }
  return t.faces?.[face] ?? null;
}
