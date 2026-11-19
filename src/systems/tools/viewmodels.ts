// The weapons as held in first person, with the player's own hands and sleeves. They are the
// one model on screen every moment, so they are built like the rest of the painted world:
// rounded parts (no hard edges for the brush filter to break up), smooth normals, and drawn
// with the cloth material's painted strokes (the paint pass leaves anything this close plain).
// Weapon space: -z is forward along the barrel, metres; WeaponSlot places and swings it.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { characterDef, type Look, SKIN_TONES } from '@/content/characters';
import { color } from '@/content/palette';
import type { WeaponDef } from '@/content/weapons';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';

/** The colours of the hands holding it: skin and the character's coat. */
export interface Hands {
  readonly skin: number;
  readonly sleeve: number;
}

export function handsOf(look: Look): Hands {
  const def = characterDef(look.character);
  const coat = def.colors.coat ?? 'cream';
  return { skin: color(SKIN_TONES[look.skin] ?? 'skinLight'), sleeve: color(coat) };
}

type V = readonly [number, number, number];

class Parts {
  readonly g = new GeometryBuilder();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private static readonly cache = new Map<string, THREE.BufferGeometry>();

  /** A box with rounded edges, centred at `at`, turned by `rot` (x, y, z radians). */
  box(at: V, size: V, c: number, round = 0.012, rot: V = [0, 0, 0]): void {
    const r = Math.min(round, ...size.map((s) => s / 2 - 0.001));
    const key = `b${size.join()}:${r}`;
    let geo = Parts.cache.get(key);
    if (!geo) Parts.cache.set(key, (geo = new RoundedBoxGeometry(size[0], size[1], size[2], 2, r)));
    this.q.setFromEuler(this.e.set(rot[0], rot[1], rot[2]));
    this.g.meshSmooth(
      geo,
      this.m.compose(new THREE.Vector3(...at), this.q, new THREE.Vector3(1, 1, 1)),
      c,
      ALWAYS_COLOR,
    );
  }

  /** A rounded rod from a to b, radius ra at a and rb at b. */
  rod(a: V, b: V, ra: number, c: number, rb = ra): void {
    const from = new THREE.Vector3(...a);
    const to = new THREE.Vector3(...b);
    const dir = to.clone().sub(from);
    const len = dir.length();
    const key = `r${ra}:${rb}`;
    let geo = Parts.cache.get(key);
    // unit length along +y, from 0 to 1, with domed ends
    if (!geo) {
      const profile = [
        new THREE.Vector2(0, -0.02),
        new THREE.Vector2(ra * 0.7, -0.012),
        new THREE.Vector2(ra, 0.02),
        new THREE.Vector2(rb, 0.98),
        new THREE.Vector2(rb * 0.7, 1.012),
        new THREE.Vector2(0, 1.02),
      ];
      Parts.cache.set(key, (geo = new THREE.LatheGeometry(profile, 12)));
    }
    this.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.g.meshSmooth(geo, this.m.compose(from, this.q, new THREE.Vector3(1, len, 1)), c, ALWAYS_COLOR);
  }

  /** A smooth ellipsoid. */
  blob(at: V, radii: V, c: number, rot: V = [0, 0, 0]): void {
    let geo = Parts.cache.get('s');
    if (!geo) Parts.cache.set('s', (geo = new THREE.SphereGeometry(1, 14, 10)));
    this.q.setFromEuler(this.e.set(rot[0], rot[1], rot[2]));
    this.g.meshSmooth(
      geo,
      this.m.compose(new THREE.Vector3(...at), this.q, new THREE.Vector3(...radii)),
      c,
      ALWAYS_COLOR,
    );
  }

  /** A continuous rounded contour, built once and merged with the hand. */
  curve(points: readonly V[], radii: readonly number[], c: number): void {
    const path = new THREE.CatmullRomCurve3(points.map((v) => new THREE.Vector3(...v)));
    const segments = 40,
      sides = 12;
    const length = path.getLength();
    const geo = new THREE.TubeGeometry(path, segments, 1, sides, false);
    const pos = geo.getAttribute('position');
    const center = new THREE.Vector3(),
      vertex = new THREE.Vector3();
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      path.getPointAt(t, center);
      const f = t * (radii.length - 1);
      const k = Math.min(Math.floor(f), radii.length - 2);
      const radius = THREE.MathUtils.lerp(radii[k]!, radii[k + 1]!, THREE.MathUtils.smoothstep(f - k, 0, 1));
      // Domed ends, without separate caps at every bent finger joint.
      const endDistance = Math.min(t, 1 - t) * length;
      const cap = Math.sqrt(Math.max(0, 1 - Math.max(0, 1 - endDistance / radius) ** 2));
      for (let j = 0; j <= sides; j++) {
        const n = i * (sides + 1) + j;
        vertex
          .fromBufferAttribute(pos, n)
          .sub(center)
          .multiplyScalar(radius * cap)
          .add(center);
        pos.setXYZ(n, vertex.x, vertex.y, vertex.z);
      }
    }
    geo.computeVertexNormals();
    // TubeGeometry duplicates the longitudinal seam. Average its two normals so
    // it cannot draw a hard stripe down skin after the radius profile changes.
    const normals = geo.getAttribute('normal');
    for (let i = 0; i <= segments; i++) {
      const a = i * (sides + 1),
        b = a + sides;
      center.fromBufferAttribute(normals, a);
      vertex.fromBufferAttribute(normals, b).add(center).normalize();
      normals.setXYZ(a, vertex.x, vertex.y, vertex.z);
      normals.setXYZ(b, vertex.x, vertex.y, vertex.z);
    }
    this.g.meshSmooth(geo, this.m.identity(), c, ALWAYS_COLOR);
    geo.dispose();
  }

  /** Elliptical cross sections: a single skin surface from forearm to palm.
   * Rows are [centre x/y/z, half width, half thickness], from elbow to knuckles. */
  loft(rows: readonly (readonly [number, number, number, number, number])[], c: number): void {
    const path = new THREE.CatmullRomCurve3(rows.map((r) => new THREE.Vector3(r[0], r[1], r[2])));
    const profile = new THREE.CatmullRomCurve3(rows.map((r) => new THREE.Vector3(r[3], r[4], 0)));
    const segments = (rows.length - 1) * 5,
      sides = 24;
    const positions: number[] = [],
      indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments,
        at = path.getPoint(t),
        size = profile.getPoint(t);
      // Foreshorten only the forearm, keeping the palm's rounded cross-section.
      if (at.y < -0.05) {
        at.y = -0.05 + (at.y + 0.05) * 0.65;
        at.z = 0.03 + (at.z - 0.03) * 0.4;
      }
      for (let j = 0; j < sides; j++) {
        const angle = (j / sides) * Math.PI * 2;
        positions.push(
          at.x + Math.cos(angle) * Math.max(0, size.x),
          at.y,
          at.z + Math.sin(angle) * Math.max(0, size.y),
        );
      }
    }
    for (let i = 0; i < segments; i++)
      for (let j = 0; j < sides; j++) {
        const a = i * sides + j,
          b = i * sides + ((j + 1) % sides);
        indices.push(a, a + sides, b, b, a + sides, b + sides);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    this.g.meshSmooth(geo, this.m.identity(), c, ALWAYS_COLOR);
    geo.dispose();
  }

  /** A flush nail follows the finger's tangent and front surface, not a guessed
   * world-space offset that can leave a floating disc above a bent fingertip. */
  nail(points: readonly V[], radii: readonly number[], c: number): void {
    const path = new THREE.CatmullRomCurve3(points.map((v) => new THREE.Vector3(...v)));
    const t = 0.82,
      f = t * (radii.length - 1),
      k = Math.floor(f);
    const r = THREE.MathUtils.lerp(radii[k]!, radii[k + 1]!, THREE.MathUtils.smoothstep(f - k, 0, 1));
    const tangent = path.getTangentAt(t).normalize();
    const front = new THREE.Vector3(0, 0, 1).addScaledVector(tangent, -tangent.z).normalize();
    const across = new THREE.Vector3().crossVectors(tangent, front).normalize();
    const at = path.getPointAt(t).addScaledVector(front, r * 0.96);
    const geometry = new THREE.SphereGeometry(1, 16, 10);
    this.q.setFromRotationMatrix(this.m.makeBasis(across, tangent, front));
    this.g.meshSmooth(
      geometry,
      this.m.compose(at, this.q, new THREE.Vector3(r * 0.59, r * 0.95, 0.00065)),
      c,
      ALWAYS_COLOR,
    );
    geometry.dispose();
  }

  /** A hand closed round a grip at `at`, its sleeve running off towards `elbow` (out of view).
   * `side` is 1 for the right hand, -1 for the left. */
  hand(at: V, elbow: V, h: Hands | null, side: 1 | -1, rot: V = [0, 0, 0]): void {
    // carried by someone else, the weapon comes without these hands (their own hold it)
    if (!h) return;
    // fist and thumb, wrapped round the grip
    this.blob(at, [0.034, 0.042, 0.05], h.skin, rot);
    this.blob([at[0] - side * 0.026, at[1] + 0.022, at[2] - 0.016], [0.014, 0.016, 0.028], h.skin, rot);
    // wrist, then the sleeve with a turned-back cuff
    const wrist: V = [at[0] + side * 0.012, at[1] - 0.03, at[2] + 0.05];
    this.rod(at, wrist, 0.026, h.skin);
    const cuff: V = [
      wrist[0] + (elbow[0] - wrist[0]) * 0.12,
      wrist[1] + (elbow[1] - wrist[1]) * 0.12,
      wrist[2] + (elbow[2] - wrist[2]) * 0.12,
    ];
    this.rod(wrist, cuff, 0.034, h.sleeve, 0.036);
    this.rod(cuff, elbow, 0.036, h.sleeve, 0.045);
  }
}

/** Where the arms go: steeply down and back, so only the hand and a little of the forearm show. */
const RIGHT_ELBOW: V = [0.12, -0.46, 0.42];
const LEFT_ELBOW: V = [-0.42, -0.44, 0.12];

/** A relaxed walking hand and sleeve, merged once; the brush shares the right-hand mesh. */
export function walkingHand(h: Hands, side: 1 | -1, brush = false): THREE.BufferGeometry {
  const p = new Parts();
  if (brush && side === 1) heldBrush(p, h);
  else relaxedHand(p, h, side);
  return p.g.build();
}

/** A separate brush for the rigged first-person hand; the grip is at the origin. */
export function modelBrush(): THREE.BufferGeometry {
  const p = new Parts();
  p.rod([0, 0, 0.17], [0, 0, -0.3], 0.017, color('brown'), 0.014);
  p.box([0, 0, -0.3], [0.045, 0.025, 0.055], color('stone'), 0.004);
  p.box([0, 0, -0.366], [0.048, 0.026, 0.085], color('cream'), 0.006);
  for (let i = 0; i < 5; i++) {
    const x = -0.018 + i * 0.009;
    p.rod([x, 0.014, -0.335], [x, 0.014, -0.407], 0.001, color('sand'), 0.0005);
  }
  return p.g.build();
}

/** Fingers spread as the player reaches out to balance or catch a fall. */
export function bracingHand(h: Hands, side: 1 | -1): THREE.BufferGeometry {
  const p = new Parts();
  walkingForearm(p, h, side);
  const digits = [
    [-0.024, 0.024, -0.044, 0.098],
    [-0.009, 0.031, -0.018, 0.116],
    [0.008, 0.031, 0.014, 0.103],
    [0.025, 0.022, 0.041, 0.08],
  ] as const;
  for (const [i, [x, y, tipX, tipY]] of digits.entries()) {
    const r = 0.0093 - i * 0.00055;
    const points: V[] = [
      [side * x, y, 0],
      [(side * (x + tipX)) / 2, (y + tipY) / 2, -0.005],
      [side * tipX, tipY - 0.016, -0.011],
      [side * tipX, tipY, -0.006],
    ];
    p.curve(points, [r * 1.15, r, r * 0.9, r * 0.68], h.skin);
  }
  p.curve(
    [
      [-side * 0.015, -0.025, 0.012],
      [-side * 0.036, -0.01, 0.017],
      [-side * 0.051, 0.011, 0.011],
      [-side * 0.059, 0.033, 0.008],
    ],
    [0.016, 0.014, 0.011, 0.008],
    h.skin,
  );
  return p.g.build();
}

/** Palm and forearm share one surface: the wrist narrows, but never disconnects. */
function walkingForearm(p: Parts, h: Hands, side: 1 | -1, grip = false): void {
  const x = (v: number) => side * v;
  p.loft(
    [
      [x(0.1), -0.27, 0.225, 0, 0],
      [x(0.084), -0.23, 0.195, 0.035, 0.028],
      [x(0.061), -0.17, 0.132, 0.032, 0.025],
      [x(0.04), -0.108, 0.073, 0.025, 0.02],
      [x(0.022), -0.055, 0.03, 0.021, 0.017],
      [x(grip ? 0.018 : 0.006), -0.027, 0.01, 0.032, 0.021],
      [x(grip ? 0.019 : 0), 0.005, -0.002, 0.038, 0.023],
      [x(grip ? 0.021 : 0), 0.028, -0.006, 0.029, 0.016],
      [x(grip ? 0.022 : 0), 0.038, -0.007, 0.018, 0.01],
      [x(grip ? 0.022 : 0), 0.042, -0.007, 0, 0],
    ],
    h.skin,
  );
  // Elliptical opening and rolled cloth lip instead of a barrel cap.
  p.loft(
    [
      [x(0.13), -0.32, 0.28, 0.045, 0.037],
      [x(0.1), -0.25, 0.21, 0.046, 0.036],
      [x(0.079), -0.205, 0.168, 0.041, 0.033],
      [x(0.054), -0.13, 0.095, 0.038, 0.032],
      [x(0.046), -0.111, 0.078, 0.038, 0.031],
      [x(0.04), -0.1, 0.07, 0.034, 0.027],
      [x(0.041), -0.102, 0.071, 0.027, 0.022],
      [x(0.048), -0.119, 0.086, 0.029, 0.024],
    ],
    h.sleeve,
  );
}

function relaxedHand(p: Parts, h: Hands, side: 1 | -1): void {
  walkingForearm(p, h, side);
  const mirror = (v: V): V => [-side * v[0], v[1], v[2]];
  // Index nearly open; the other fingers curl progressively into the palm.
  const fingers: readonly (readonly V[])[] = [
    [
      [-0.024, 0.023, 0],
      [-0.017, 0.07, 0.003],
      [0.022, 0.085, 0.006],
      [0.064, 0.065, 0.008],
    ],
    [
      [0.003, 0.027, 0.005],
      [0.043, 0.05, 0.009],
      [0.073, 0.022, 0.018],
      [0.069, 0.01, 0.029],
    ],
    [
      [0.014, 0.006, 0.008],
      [0.057, 0.018, 0.02],
      [0.066, -0.006, 0.027],
      [0.065, -0.023, 0.033],
    ],
    [
      [0.022, -0.014, 0.003],
      [0.05, -0.01, 0.018],
      [0.056, -0.022, 0.03],
      [0.055, -0.039, 0.035],
    ],
  ];
  fingers.forEach((points, i) => {
    const r = [0.0085, 0.009, 0.0082, 0.007][i]!;
    const shape = points.map(mirror),
      radii = [r * 1.15, r, r * 0.95, r * 0.9];
    p.curve(shape, radii, h.skin);
    p.nail(shape, radii, h.skin);
  });
  const thumb: V[] = [
    [-0.007, -0.027, 0.006],
    [0.014, -0.014, 0.025],
    [0.036, 0.02, 0.046],
    [0.045, 0.056, 0.042],
  ];
  p.curve(thumb.map(mirror), [0.017, 0.014, 0.011, 0.008], h.skin);
  p.nail(thumb.map(mirror), [0.017, 0.014, 0.011, 0.008], h.skin);
}

/** Four fingers curl around the shaft; the thumb closes diagonally from the palm. */
function heldBrush(p: Parts, h: Hands): void {
  walkingForearm(p, h, 1, true);
  p.curve(
    [
      [0.006, -0.11, 0.006],
      [-0.007, -0.05, -0.002],
      [-0.025, 0.04, -0.016],
      [-0.047, 0.15, -0.031],
    ],
    [0.0085, 0.009, 0.008, 0.0065],
    color('brown'),
  );
  for (let i = 0; i < 4; i++) {
    const y = 0.026 - i * 0.021;
    const shaft = -0.017 - y * 0.2;
    const r = [0.0095, 0.01, 0.009, 0.0078][i]!;
    const points: V[] = [
      [0.03, y - 0.003, -0.008],
      [0.009, y + 0.004, -0.028],
      [shaft - 0.014, y + 0.003, -0.015],
      [shaft - 0.009, y - 0.002, 0.008],
      [shaft + 0.014, y - 0.005, 0.016],
    ];
    const radii = [r * 1.12, r, r * 0.98, r * 0.85, r * 0.7];
    p.curve(points, radii, h.skin);
    p.nail(points, radii, h.skin);
  }
  const thumb: V[] = [
    [0.023, -0.024, 0.009],
    [0.033, -0.002, 0.018],
    [0.014, 0.025, 0.032],
    [-0.012, 0.045, 0.009],
    [-0.026, 0.052, -0.007],
  ];
  const thumbRadii = [0.016, 0.014, 0.012, 0.01, 0.0085];
  p.curve(thumb, thumbRadii, h.skin);
  p.nail(thumb, thumbRadii, h.skin);
  const tilt: V = [-0.18, 0, 0.2];
  p.box([-0.047, 0.148, -0.031], [0.027, 0.028, 0.016], color('stone'), 0.004, tilt);
  p.box([-0.054, 0.179, -0.037], [0.031, 0.038, 0.013], color('cream'), 0.006, tilt);
  for (let i = 0; i < 5; i++) {
    const x = -0.066 + i * 0.006;
    p.rod([x, 0.166, -0.028], [x - 0.006, 0.196 + (i % 2) * 0.002, -0.034], 0.001, color('sand'), 0.0005);
  }
}

/** Points on each weapon, in weapon space: where the main hand grips it, where the other hand
 * holds it (none for one hand), and its far end (muzzle, blade tip, the staff's orb). */
// (the other hand sits as far along as a figure's arms reach in every stance: the front of the
// receiver, under the sniper's body, the launcher's front grip, up the staff's shaft)
const POINTS: Readonly<Record<string, { grip: V; off: V | null; tip: V }>> = {
  rifle: { grip: [0, -0.1, 0.08], off: [0, -0.03, -0.27], tip: [0, 0.01, -0.67] },
  sniper: { grip: [0, -0.1, 0.09], off: [0, -0.04, -0.26], tip: [0, 0.005, -1.02] },
  launcher: { grip: [0, -0.13, -0.01], off: [0, -0.08, -0.28], tip: [0, 0, -0.66] },
  katana: { grip: [0.005, 0.012, 0.08], off: null, tip: [0, 0.062, -0.88] },
  staff: { grip: [0, -0.285, 0.1], off: [0, -0.28, 0], tip: [0, -0.27, -0.34] },
};

/** A weapon as someone else carries it: no hands, the main grip at the origin, scaled so its
 * far end lies `length` from the grip (a figure's hold is laid out for that length). Also where
 * the other hand goes and where the far end is, in that same space. */
export function heldModel(
  def: WeaponDef,
  length: number,
): {
  readonly geometry: THREE.BufferGeometry;
  readonly off: THREE.Vector3 | null;
  readonly tip: THREE.Vector3;
} {
  const pts = POINTS[def.key]!;
  const grip = new THREE.Vector3(...pts.grip);
  const k = length / new THREE.Vector3(...pts.tip).distanceTo(grip);
  const place = (v: V): THREE.Vector3 => new THREE.Vector3(...v).sub(grip).multiplyScalar(k);
  const geometry = viewModel(def, null);
  geometry.applyMatrix4(
    new THREE.Matrix4()
      .makeScale(k, k, k)
      .multiply(new THREE.Matrix4().makeTranslation(-grip.x, -grip.y, -grip.z)),
  );
  return { geometry, off: pts.off ? place(pts.off) : null, tip: place(pts.tip) };
}

export function viewModel(def: WeaponDef, h: Hands | null): THREE.BufferGeometry {
  const p = new Parts();
  const [main, accent] = def.look;
  const wood = color('brown');
  const metal = color('charcoal');
  switch (def.key) {
    case 'katana': {
      // a gentle curve: the blade rises a little towards its tip. In someone else's hand it is
      // drawn bolder, or a few metres off it is a hairline lost against the grass
      const len = 0.88;
      const steps = 6;
      const bold = h ? 1 : 2.2;
      for (let i = 0; i < steps; i++) {
        const z0 = -(i / steps) * len;
        const z1 = -((i + 1) / steps) * len;
        const y = (z: number): number => 0.012 + 0.05 * (z / len) ** 2;
        p.box(
          [0, (y(z0) + y(z1)) / 2, (z0 + z1) / 2 - 0.01],
          [0.012 * bold, (0.042 - i * 0.003) * Math.sqrt(bold), len / steps + 0.02],
          main,
          0.005,
          [Math.atan2(y(z1) - y(z0), z0 - z1), 0, 0],
        );
      }
      p.rod([0, 0.012, 0.01], [0, 0.012, -0.01], 0.05, accent);
      p.box([0, 0.012, 0.15], [0.03, 0.036, 0.26], metal, 0.012);
      // the wrap's diamonds, as raised bands
      for (let i = 0; i < 5; i++) p.box([0, 0.012, 0.05 + i * 0.05], [0.034, 0.04, 0.012], accent, 0.005);
      p.blob([0, 0.012, 0.29], [0.02, 0.022, 0.016], accent);
      p.hand([0.005, 0.0, 0.08], RIGHT_ELBOW, h, 1);
      p.hand([-0.005, 0.0, 0.22], LEFT_ELBOW, h, -1);
      break;
    }
    case 'sniper':
      p.box([0, 0, -0.08], [0.066, 0.08, 0.46], main, 0.016);
      p.rod([0, 0.005, -0.3], [0, 0.005, -0.98], 0.014, metal, 0.012);
      p.rod([0, 0.005, -0.97], [0, 0.005, -1.02], 0.02, metal);
      // the scope, its rings and lenses
      p.rod([0, 0.085, 0.04], [0, 0.085, -0.3], 0.027, metal);
      p.rod([0, 0.085, -0.3], [0, 0.085, -0.33], 0.034, metal);
      p.blob([0, 0.085, -0.335], [0.026, 0.026, 0.006], color('glass'));
      for (const z of [-0.2, -0.04]) p.box([0, 0.06, z], [0.036, 0.03, 0.02], metal, 0.006);
      p.blob([0.05, 0.03, 0.03], [0.016, 0.016, 0.016], metal);
      p.box([0, -0.035, 0.27], [0.058, 0.11, 0.3], main, 0.025, [-0.1, 0, 0]);
      p.box([0, -0.09, 0.08], [0.034, 0.1, 0.045], wood, 0.012, [-0.35, 0, 0]);
      p.hand([0.0, -0.1, 0.09], RIGHT_ELBOW, h, 1, [-0.35, 0, 0]);
      p.hand([-0.03, -0.02, -0.3], LEFT_ELBOW, h, -1, [0, 0, 0.5]);
      break;
    case 'launcher':
      p.rod([0, 0, 0.26], [0, 0, -0.62], 0.075, main);
      p.rod([0, 0, -0.6], [0, 0, -0.66], 0.088, accent);
      p.rod([0, 0, 0.24], [0, 0, 0.28], 0.084, accent);
      p.rod([0, 0, -0.2], [0, 0, -0.26], 0.08, accent);
      p.box([0, 0.09, -0.15], [0.03, 0.04, 0.08], accent, 0.01);
      p.box([0, -0.11, -0.02], [0.036, 0.11, 0.05], accent, 0.012, [-0.25, 0, 0]);
      p.hand([0.0, -0.13, -0.01], RIGHT_ELBOW, h, 1, [-0.25, 0, 0]);
      p.hand([-0.06, -0.06, -0.34], LEFT_ELBOW, h, -1, [0, 0, 0.6]);
      break;
    case 'staff': {
      // held low and angled up by the pose; the head glows in the weapon's colour
      p.rod([0, -0.28, 0.45], [0, -0.28, -0.26], 0.018, wood, 0.015);
      p.blob([0, -0.27, -0.34], [0.065, 0.065, 0.065], main);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        p.rod(
          [0, -0.28, -0.25],
          [Math.cos(a) * 0.06, -0.27 + Math.sin(a) * 0.06, -0.33],
          0.008,
          accent,
          0.005,
        );
      }
      p.rod([0, -0.28, -0.22], [0, -0.28, -0.26], 0.024, accent);
      p.hand([0.0, -0.285, 0.1], RIGHT_ELBOW, h, 1);
      break;
    }
    default: {
      // Metal action and barrel, wooden stock and fore-end, and a curved magazine.
      p.box([0, 0, -0.08], [0.07, 0.085, 0.42], main, 0.016);
      p.rod([0, 0.01, -0.28], [0, 0.01, -0.64], 0.014, metal, 0.013);
      p.rod([0, 0.01, -0.63], [0, 0.01, -0.67], 0.02, metal);
      p.box([0, -0.005, -0.36], [0.064, 0.06, 0.2], accent, 0.02);
      p.box([0, 0.055, -0.02], [0.02, 0.025, 0.05], metal, 0.006);
      p.box([0, -0.1, -0.12], [0.04, 0.11, 0.06], metal, 0.012, [0.25, 0, 0]);
      p.box([0, -0.09, 0.07], [0.036, 0.1, 0.045], accent, 0.012, [-0.35, 0, 0]);
      p.box([0, -0.035, 0.24], [0.054, 0.1, 0.26], accent, 0.024, [-0.12, 0, 0]);
      p.hand([0, -0.1, 0.08], RIGHT_ELBOW, h, 1, [-0.35, 0, 0]);
      p.hand([-0.03, -0.03, -0.37], LEFT_ELBOW, h, -1, [0, 0, 0.5]);
    }
  }
  return p.g.build();
}
