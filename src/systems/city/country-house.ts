// Country houses in both the wilderness chunk mesh and the paintable village mesh.
// All details share the surface of the roof, door or wall they grow from.
import * as THREE from 'three';
import { color } from '@/content/palette';
import type { HouseStyle } from '@/content/templates';
import { NO_SURFACE, type GeometryBuilder } from '@/engine/render/geometry-builder';
import type { Vec3Like, ColliderData } from '@/engine/physics/world';
import type { Face } from '@/world/city/layout';
import { appendIvy, appendWindowBox } from './house-plants';

export interface House {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  base: number;
  /** Ground level at the foot of the plinth, when the caller builds one. */
  foot?: number;
  enterable?: boolean;
  height: number;
  front: Face;
  doorAt: number;
  style: HouseStyle;
  plaster: number;
  tile: number;
  doorColor: number;
  surfaces?: { walls: Readonly<Record<Face, number>>; roof: number; door: number };
}

export const DOOR_WIDTH = 1.6;
export const DOOR_HEIGHT = 2.4;
const wood = color('bark'),
  stone = color('rock'),
  glass = color('glass');
const faces: readonly Face[] = ['px', 'nx', 'pz', 'nz'];
const up = { x: 0, y: 1, z: 0 };
const v = (x: number, y: number, z: number): Vec3Like => ({ x, y, z });
const allFaces = (c: number) => ({ px: c, nx: c, py: c, ny: c, pz: c, nz: c });
/** 0..1 for a house and a salt: each house its own sag, ivy and so on, the same every build. */
const roll = (h: House, k: number): number => {
  const r = Math.sin(h.x0 * 12.9898 + h.z0 * 78.233 + k * 37.719) * 43758.5453;
  return r - Math.floor(r);
};

/** Orient a polygon towards its outside irrespective of the house's compass bearing. */
function panel(
  g: GeometryBuilder,
  points: Vec3Like[],
  out: Vec3Like,
  tint: number,
  surface: number,
  /** For window glass: which room shows behind it (see GeometryBuilder.pane). */
  pane?: number,
): void {
  const [a, b, c] = points as [Vec3Like, Vec3Like, Vec3Like];
  const ux = b.x - a.x,
    uy = b.y - a.y,
    uz = b.z - a.z,
    vx = c.x - a.x,
    vy = c.y - a.y,
    vz = c.z - a.z;
  let nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = ux * vy - uy * vx;
  if (nx * out.x + ny * out.y + nz * out.z < 0) {
    points.reverse();
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const len = Math.hypot(nx, ny, nz);
  if (!len) return;
  if (pane !== undefined) {
    g.pane(
      points[0]!,
      points[1]!,
      points[2]!,
      points[3]!,
      v(nx / len, ny / len, nz / len),
      tint,
      surface,
      pane,
    );
    return;
  }
  g.quad(
    points[0]!,
    points[1]!,
    points[2]!,
    points[3] ?? points[2]!,
    v(nx / len, ny / len, nz / len),
    tint,
    surface,
  );
}

type BoxSink = (min: Vec3Like, max: Vec3Like, data: ColliderData) => void;

const xFace = (f: Face) => f === 'px' || f === 'nx';
const normal = (f: Face) => v(f === 'px' ? 1 : f === 'nx' ? -1 : 0, 0, f === 'pz' ? 1 : f === 'nz' ? -1 : 0);
function wallPoint({ x0, x1, z0, z1, base }: House) {
  return (f: Face, u: number, y: number, offset: number) =>
    xFace(f)
      ? v(f === 'px' ? x1 + offset : x0 - offset, base + y, u)
      : v(u, base + y, f === 'pz' ? z1 + offset : z0 - offset);
}

/**
 * A country house: walls, facade, roof. `detail` false builds only its shell (walls and the
 * roof's slopes and gables), for seeing it from far off where the rest is under a pixel.
 */
export function buildCountryHouse(g: GeometryBuilder, h: House, box: BoxSink, detail = true): void {
  const { x0, x1, z0, z1, front, base, height, surfaces } = h;
  const walls = surfaces?.walls,
    roof = surfaces?.roof ?? NO_SURFACE,
    door = surfaces?.door ?? NO_SURFACE;
  const onFace = wallPoint(h),
    eave = base + height;
  const doorMin = onFace(front, h.doorAt - DOOR_WIDTH / 2, 0, 0),
    doorMax = onFace(front, h.doorAt + DOOR_WIDTH / 2, DOOR_HEIGHT, 0);
  if (h.enterable) buildOpenShell(g, h, box);
  else {
    g.box(
      v(x0, base, z0),
      v(x1, eave, z1),
      { px: h.plaster, nx: h.plaster, pz: h.plaster, nz: h.plaster },
      walls,
    );
    box(
      v(x0, base, z0),
      v(x1, eave, z1),
      surfaces
        ? {
            faces: { ...walls, py: roof },
            decals: [{ face: front, min: doorMin, max: doorMax, surface: door }],
          }
        : {},
    );
  }
  if (detail) addFacade(g, h, box);
  if (detail) addIvy(g, h);
  addRoof(g, h, box, detail);
}

function buildOpenShell(g: GeometryBuilder, h: House, collide: BoxSink): void {
  const { x0, x1, z0, z1, base, height, front, doorAt } = h;
  const onFace = wallPoint(h);
  const thickness = 0.19;
  const piece = (f: Face, lo: number, hi: number, bottom: number) => {
    const a = onFace(f, lo, bottom, 0);
    const b = onFace(f, hi, height, -thickness);
    const min = v(Math.min(a.x, b.x), a.y, Math.min(a.z, b.z));
    const max = v(Math.max(a.x, b.x), b.y, Math.max(a.z, b.z));
    g.box(min, max, allFaces(h.plaster));
    collide(min, max, {});
  };
  for (const f of faces) {
    const [lo, hi] = xFace(f) ? [z0, z1] : [x0 + thickness, x1 - thickness];
    if (f !== front) piece(f, lo, hi, 0);
    else {
      const left = doorAt - DOOR_WIDTH / 2;
      const right = doorAt + DOOR_WIDTH / 2;
      piece(f, lo, left, 0);
      piece(f, right, hi, 0);
      piece(f, left, right, DOOR_HEIGHT);
    }
  }
  const eave = base + height;
  g.box(
    v(x0 + thickness, eave - 0.12, z0 + thickness),
    v(x1 - thickness, eave, z1 - thickness),
    allFaces(wood),
  );
}

/** Ivy climbs one front corner of some cottages and takes the wall's paint state. */
function addIvy(g: GeometryBuilder, h: House): void {
  if (h.style !== 'cottage' || roll(h, 1) > 0.45) return;
  const { front, height } = h;
  const onFace = wallPoint(h);
  const [lo, hi] = xFace(front) ? [h.z0, h.z1] : [h.x0, h.x1];
  const corner = roll(h, 2) < 0.5 ? lo : hi;
  const reach = height * (0.55 + 0.35 * roll(h, 3));
  const surface = h.surfaces?.walls[front] ?? NO_SURFACE;
  appendIvy(
    g,
    (u, y, depth) => onFace(front, u, y, depth),
    corner,
    corner === lo ? 1 : -1,
    reach,
    h.foot === undefined ? undefined : h.foot - h.base,
    surface,
    (salt) => roll(h, salt),
  );
}

function addFacade(g: GeometryBuilder, h: House, box: BoxSink): void {
  const { x0, x1, z0, z1, height, front, surfaces } = h;
  const walls = surfaces?.walls,
    door = surfaces?.door ?? NO_SURFACE;
  const onFace = wallPoint(h);
  for (const f of faces) {
    const sid = walls?.[f] ?? NO_SURFACE,
      n = normal(f);
    const [lo, hi] = xFace(f) ? [z0, z1] : [x0, x1];
    const rect = (
      u0: number,
      u1: number,
      y0: number,
      y1: number,
      o: number,
      tint: number,
      s = sid,
      pane?: number,
    ) =>
      panel(
        g,
        [onFace(f, u0, y0, o), onFace(f, u1, y0, o), onFace(f, u1, y1, o), onFace(f, u0, y1, o)],
        n,
        tint,
        s,
        pane,
      );
    const room = (k: number) => Math.floor(roll(h, 200 + faces.indexOf(f) * 10 + k) * 16);
    // A piece that stands proud of the wall by `o`: its face and its four edges back to the
    // wall, so it throws a shadow and shows its thickness from the side.
    const slab = (u0: number, u1: number, y0: number, y1: number, o: number, tint: number, s = sid) => {
      rect(u0, u1, y0, y1, o, tint, s);
      const [a, b] = [onFace(f, u0, y0, 0), onFace(f, u1, y0, 0)];
      const side = v(a.x - b.x, 0, a.z - b.z);
      const edge = (p: Vec3Like, q: Vec3Like, r: Vec3Like, t: Vec3Like, out: Vec3Like) =>
        panel(g, [p, q, r, t], out, tint, s);
      edge(onFace(f, u0, y1, 0), onFace(f, u1, y1, 0), onFace(f, u1, y1, o), onFace(f, u0, y1, o), up);
      edge(
        onFace(f, u0, y0, 0),
        onFace(f, u1, y0, 0),
        onFace(f, u1, y0, o),
        onFace(f, u0, y0, o),
        v(0, -1, 0),
      );
      edge(onFace(f, u0, y0, 0), onFace(f, u0, y1, 0), onFace(f, u0, y1, o), onFace(f, u0, y0, o), side);
      edge(
        onFace(f, u1, y0, 0),
        onFace(f, u1, y1, 0),
        onFace(f, u1, y1, o),
        onFace(f, u1, y0, o),
        v(-side.x, 0, -side.z),
      );
    };
    // the stone footing stands out under the sill beam; posts and beams are proud of the plaster
    const baseTrim = (y0: number, y1: number, depth: number, tint: number) => {
      if (h.enterable && f === front) {
        slab(lo, h.doorAt - DOOR_WIDTH / 2, y0, y1, depth, tint);
        slab(h.doorAt + DOOR_WIDTH / 2, hi, y0, y1, depth, tint);
      } else slab(lo, hi, y0, y1, depth, tint);
    };
    baseTrim(0, 0.48, 0.09, stone);
    baseTrim(0.48, 0.63, 0.06, wood);
    slab(lo, hi, height - 0.24, height, 0.06, wood);
    for (const u of [lo + 0.15, hi - 0.15]) slab(u - 0.09, u + 0.09, 0.63, height - 0.24, 0.075, wood);
    if (h.style === 'barn') {
      baseTrim(0.57, 1.0, 0.023, wood);
      // Exposed diagonal braces in the two outer bays of the timber frame.
      for (const side of [-1, 1]) {
        const foot = side > 0 ? lo + 0.18 : hi - 0.18;
        const shoulder = foot + side * Math.min(1.65, (hi - lo) * 0.21);
        panel(
          g,
          [
            onFace(f, foot, 1.0, 0.026),
            onFace(f, foot + side * 0.16, 1.0, 0.026),
            onFace(f, shoulder + side * 0.16, height - 0.2, 0.026),
            onFace(f, shoulder, height - 0.2, 0.026),
          ],
          n,
          wood,
          sid,
        );
      }
    }
    // Shutters, inset blue-grey panes, a single crossbar and a deep sill.
    const bays = Math.max(f === front ? 2 : 1, Math.min(3, Math.floor((hi - lo) / 3.6)));
    const winHalf = Math.min(0.88, (hi - lo) * 0.096);
    for (let i = 0; i < bays; i++) {
      const u = lo + ((hi - lo) * (i + 0.5)) / bays;
      if (f === front && Math.abs(u - h.doorAt) < winHalf + 0.92) continue;
      const y = Math.min(2.6, height - 0.38);
      // a frame standing out round the glass, which lies back in it; glazing bars over the
      // glass, and a sill deep enough to throw its shadow down the wall
      slab(u - winHalf - 0.12, u - winHalf, 1.08, y, 0.11, wood);
      slab(u + winHalf, u + winHalf + 0.12, 1.08, y, 0.11, wood);
      slab(u - winHalf, u + winHalf, y - 0.13, y, 0.11, wood);
      slab(u - winHalf, u + winHalf, 1.08, 1.22, 0.11, wood);
      rect(u - winHalf, u + winHalf, 1.22, y - 0.13, 0.025, glass, sid, room(i));
      rect(u - 0.045, u + 0.045, 1.22, y - 0.13, 0.05, wood);
      rect(u - winHalf, u + winHalf, y - 0.55, y - 0.48, 0.05, wood);
      slab(u - winHalf - 0.18, u + winHalf + 0.18, 1.03, 1.16, 0.19, wood);
      if (h.style === 'cottage') {
        const side = f === front && u > h.doorAt ? 1 : -1;
        const shutter = u + side * (winHalf + 0.34);
        slab(shutter - 0.2, shutter + 0.2, 1.22, y - 0.1, 0.06, h.doorColor);
        if (f === front) {
          appendWindowBox(
            g,
            (x, y, depth) => onFace(f, x, y, depth),
            u,
            winHalf,
            sid,
            (salt) => roll(h, 300 + i * 97 + salt),
            box,
          );
        }
      }
    }
    if (f !== front) continue;
    const u = h.doorAt;
    // the door hangs back in a frame that stands out round it
    slab(u - 0.95, u - 0.8, 0, DOOR_HEIGHT + 0.17, 0.13, wood);
    slab(u + 0.8, u + 0.95, 0, DOOR_HEIGHT + 0.17, 0.13, wood);
    slab(u - 0.8, u + 0.8, DOOR_HEIGHT, DOOR_HEIGHT + 0.17, 0.13, wood);
    if (!h.enterable) {
      rect(u - 0.8, u + 0.8, 0, DOOR_HEIGHT, 0.035, h.doorColor, door);
      rect(u - 0.52, u + 0.52, 1.47, 2.11, 0.05, glass, door, room(9));
      rect(u - 0.035, u + 0.035, 1.47, 2.11, 0.065, wood, door);
      rect(u + 0.54, u + 0.65, 0.97, 1.16, 0.07, wood, door);
    }
    // A separate little shed roof casts a shadow over the entrance. Shop curtains
    // hang in three panels with actual gaps along the hem.
    const aw = Math.min(h.style === 'shop' ? 2.8 : 1.7, (hi - lo) / 2 - 0.18);
    const mid = Math.max(lo + aw, Math.min(hi - aw, u));
    const nearY = 2.97,
      farY = 2.69,
      depth = h.style === 'barn' ? 0.78 : 1.22;
    const canopy = [
      onFace(f, mid - aw, nearY, 0),
      onFace(f, mid + aw, nearY, 0),
      onFace(f, mid + aw, farY, depth),
      onFace(f, mid - aw, farY, depth),
    ];
    panel(g, [...canopy], up, h.tile, sid);
    panel(g, canopy, v(0, -1, 0), wood, sid);
    rect(mid - aw, mid + aw, farY - 0.12, farY, depth, wood);
    for (const u of [mid - aw + 0.15, mid + aw - 0.15]) {
      const a = onFace(f, u - 0.06, farY - 0.52, 0.02),
        b = onFace(f, u - 0.06, farY - 0.09, depth - 0.1);
      const outward = xFace(f) ? v(0, 0, 1) : v(1, 0, 0);
      panel(g, [a, b, v(b.x, b.y - 0.11, b.z), v(a.x, a.y - 0.11, a.z)], outward, wood, sid);
      panel(
        g,
        [v(a.x, a.y - 0.11, a.z), v(b.x, b.y - 0.11, b.z), b, a],
        v(-outward.x, 0, -outward.z),
        wood,
        sid,
      );
    }
    if (h.style === 'shop')
      for (let k = 0; k < 3; k++) {
        const left = mid - aw + (2 * aw * k) / 3;
        rect(
          left + 0.05,
          left + (2 * aw) / 3 - 0.05,
          farY - 0.51 + (k % 2) * 0.05,
          farY - 0.09,
          depth - 0.04,
          h.doorColor,
        );
      }
  }
}

function addRoof(g: GeometryBuilder, h: House, box: BoxSink, detail: boolean): void {
  const { x0, x1, z0, z1, front, base, height, surfaces } = h;
  const walls = surfaces?.walls,
    roof = surfaces?.roof ?? NO_SURFACE;
  const onFace = wallPoint(h),
    cx = (x0 + x1) / 2,
    cz = (z0 + z1) / 2,
    eave = base + height;
  // Long, overhanging ridge. The barn has clipped (half-hipped) ends, the shop a full hip.
  const ridgeX = h.style === 'barn' ? xFace(front) : !xFace(front);
  const axis = (u: number, y: number, t: number) => (ridgeX ? v(cx + u, y, cz + t) : v(cx + t, y, cz + u));
  const along = (ridgeX ? x1 - x0 : z1 - z0) / 2,
    across = (ridgeX ? z1 - z0 : x1 - x0) / 2;
  const lip = 0.66,
    run = across + lip,
    end = along + lip;
  const cut =
    Math.min(along * 0.48, across * 0.74) * (h.style === 'shop' ? 1 : h.style === 'barn' ? 0.62 : 0);
  const ridge = end - cut,
    rise = Math.min(4.5, across * (h.style === 'barn' ? 0.88 : 0.65));
  const top = eave + rise,
    edge = eave - (lip * rise) / across + 0.14;
  // no roof is ruled straight: the ridge sags a little toward its middle (an old barn's most),
  // and the eaves waver; the ends, where hips and gables meet it, stay true
  const sag = (h.style === 'barn' ? 0.1 : 0.05) + 0.07 * roll(h, 4);
  const settle = (p: Vec3Like, t: number, s: number): Vec3Like => ({
    x: p.x,
    y:
      p.y -
      sag * Math.sin(Math.PI * t) * (0.25 + 0.75 * s) +
      (1 - s) * 0.025 * Math.sin(t * 9 + roll(h, 5) * 6) * Math.sin(Math.PI * t),
    z: p.z,
  });
  const lerp3 = (a: Vec3Like, b: Vec3Like, t: number): Vec3Like => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  });
  const SAG_ALONG = 6,
    SAG_UP = 2;
  for (const side of [-1, 1]) {
    const edgeA = axis(-end, edge, side * run),
      edgeB = axis(end, edge, side * run);
    const peakA = axis(-ridge, top, 0),
      peakB = axis(ridge, top, 0);
    const at = (t: number, s: number): Vec3Like =>
      settle(lerp3(lerp3(edgeA, edgeB, t), lerp3(peakA, peakB, t), s), t, s);
    for (let i = 0; i < SAG_ALONG; i++)
      for (let j = 0; j < SAG_UP; j++) {
        const [t0, t1, s0, s1] = [i / SAG_ALONG, (i + 1) / SAG_ALONG, j / SAG_UP, (j + 1) / SAG_UP];
        panel(g, [at(t0, s0), at(t1, s0), at(t1, s1), at(t0, s1)], up, h.tile, roof);
      }
    const innerA = axis(-along, eave, side * across),
      innerB = axis(along, eave, side * across);
    if (detail) {
      const bottomA = axis(-end, edge - 0.18, side * run),
        bottomB = axis(end, edge - 0.18, side * run);
      panel(g, [bottomA, bottomB, innerB, innerA], v(0, -1, 0), wood, roof);
      const outside = ridgeX ? v(0, 0, side) : v(side, 0, 0);
      panel(g, [bottomA, bottomB, edgeB, edgeA], outside, wood, roof);
    }
    const endFace: Face = ridgeX ? (side > 0 ? 'px' : 'nx') : side > 0 ? 'pz' : 'nz';
    const sid = walls?.[endFace] ?? NO_SURFACE,
      endNormal = normal(endFace);
    const peak = axis(side * ridge, top, 0);
    const l = axis(side * end, edge, -run),
      r = axis(side * end, edge, run);
    if (cut > 0) panel(g, [l, r, peak], endNormal, h.tile, roof);
    else {
      const gablePeak = axis(side * along, top - 0.1, 0);
      panel(
        g,
        [axis(side * along, eave - 0.14, -across), axis(side * along, eave - 0.14, across), gablePeak],
        endNormal,
        h.plaster,
        sid,
      );
      if (!detail) continue;
      const mid = ridgeX ? cz : cx;
      panel(
        g,
        [
          onFace(endFace, mid - 0.14, height, 0.025),
          onFace(endFace, mid + 0.14, height, 0.025),
          onFace(endFace, mid + 0.14, height + rise - 0.28, 0.025),
          onFace(endFace, mid - 0.14, height + rise - 0.28, 0.025),
        ],
        endNormal,
        wood,
        sid,
      );
      for (const t of [-1, 1]) {
        const tip = axis(side * end, edge, t * run),
          below = axis(side * end, edge - 0.18, t * run);
        panel(g, [tip, peak, axis(side * end, top - 0.18, 0), below], endNormal, wood, roof);
        panel(
          g,
          [
            below,
            axis(side * end, top - 0.18, 0),
            axis(side * along, top - 0.18, 0),
            axis(side * along, edge - 0.18, t * run),
          ],
          v(0, -1, 0),
          wood,
          roof,
        );
      }
    }
  }
  const block = (u0: number, u1: number, y0: number, y1: number, t0: number, t1: number, c: number) =>
    g.box(axis(u0, y0, t0), axis(u1, y1, t1), allFaces(c), allFaces(roof));
  // the ridge capping follows the sag, a short length at a time
  for (let i = 0; i < SAG_ALONG; i++) {
    const u0 = -ridge + (2 * ridge * i) / SAG_ALONG,
      u1 = -ridge + (2 * ridge * (i + 1)) / SAG_ALONG;
    const drop = sag * Math.sin(Math.PI * ((i + 0.5) / SAG_ALONG));
    block(
      i === 0 ? u0 - 0.08 : u0 - 0.02,
      i === SAG_ALONG - 1 ? u1 + 0.08 : u1 + 0.02,
      top - 0.1 - drop,
      top + 0.13 - drop,
      -0.14,
      0.14,
      h.tile,
    );
  }
  // the chimney stays in the shell: its shadow on the roof shows from far off
  if (h.style !== 'barn') {
    const u = -ridge * 0.48,
      t = across * 0.36,
      chimney = top - rise * 0.36 + 1.33;
    block(u - 0.35, u + 0.35, chimney - 2, chimney, t - 0.31, t + 0.31, stone);
    block(u - 0.44, u + 0.44, chimney - 0.16, chimney + 0.07, t - 0.4, t + 0.4, wood);
    // its sooty mouth, where the smoke comes from
    const y = chimney + 0.075;
    g.chimney(
      axis(u - 0.2, y, t + 0.2),
      axis(u + 0.2, y, t + 0.2),
      axis(u + 0.2, y, t - 0.2),
      axis(u - 0.2, y, t - 0.2),
      color('charcoal'),
      roof,
    );
  }
  if (detail && h.style === 'cottage') {
    // A little loft window pushed out of the front pitch. Its cheeks disappear
    // into the roof and its own eaves cast a shadow over the glazing.
    const side = front === 'px' || front === 'pz' ? 1 : -1;
    const t = side * across * 0.72,
      u = along * 0.24,
      back = side * across * 0.19;
    const bottom = top + ((edge - top) * Math.abs(t)) / run - 0.1;
    const sill = bottom + 0.1,
      ledge = sill + 0.94,
      peak = ledge + 0.56;
    const n = normal(front),
      p = (du: number, y: number, dt = 0) => axis(u + du, y, t + dt * side);
    panel(g, [p(-0.87, bottom), p(0.87, bottom), p(0.87, ledge), p(-0.87, ledge)], n, h.plaster, roof);
    panel(g, [p(-0.87, ledge), p(0.87, ledge), p(0, peak)], n, h.plaster, roof);
    panel(
      g,
      [p(-0.57, sill, 0.02), p(0.57, sill, 0.02), p(0.57, ledge - 0.09, 0.02), p(-0.57, ledge - 0.09, 0.02)],
      n,
      wood,
      roof,
    );
    for (const k of [-1, 1]) {
      const a = k * 0.065,
        b = k * 0.47;
      panel(
        g,
        [
          p(a, sill + 0.11, 0.04),
          p(b, sill + 0.11, 0.04),
          p(b, ledge - 0.19, 0.04),
          p(a, ledge - 0.19, 0.04),
        ],
        n,
        glass,
        roof,
        Math.floor(roll(h, 260) * 16),
      );
      panel(
        g,
        [
          p(k * 0.87, bottom),
          p(k * 0.87, ledge),
          axis(u + k * 0.87, ledge, back),
          axis(u + k * 0.87, bottom, back),
        ],
        ridgeX ? v(k, 0, 0) : v(0, 0, k),
        wood,
        roof,
      );
      panel(
        g,
        [
          p(k * 1.05, ledge - 0.07, 0.2),
          p(0, peak + 0.08, 0.2),
          axis(u, peak + 0.08, back),
          axis(u + k * 1.05, ledge - 0.07, back),
        ],
        up,
        h.tile,
        roof,
      );
    }
  }
  // The physics world uses boxes. Four nested steps approximate the pitched top
  // for landing and picking; none stretches to the ridge height at the eaves.
  for (let i = 0; i < 4; i++) {
    const f = (i + 0.5) / 4;
    const half = across * (1 - i / 4),
      length = Math.min(along, end - cut * f);
    const surfaceFaces = allFaces(roof);
    if (cut === 0 && walls) {
      if (ridgeX) {
        surfaceFaces.px = walls.px;
        surfaceFaces.nx = walls.nx;
      } else {
        surfaceFaces.pz = walls.pz;
        surfaceFaces.nz = walls.nz;
      }
    }
    box(
      axis(-length, eave + (rise * i) / 4, -half),
      axis(length, eave + (rise * (i + 1)) / 4, half),
      surfaces ? { faces: surfaceFaces } : {},
    );
  }
}
