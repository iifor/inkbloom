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
      // the rifle: metal action and barrel, a wooden stock and fore-end, a curved magazine
      p.box([0, 0, -0.08], [0.07, 0.085, 0.42], main, 0.016);
      p.rod([0, 0.01, -0.28], [0, 0.01, -0.64], 0.014, metal, 0.013);
      p.rod([0, 0.01, -0.63], [0, 0.01, -0.67], 0.02, metal);
      p.box([0, -0.005, -0.36], [0.064, 0.06, 0.2], accent, 0.02);
      p.box([0, 0.055, -0.02], [0.02, 0.025, 0.05], metal, 0.006);
      p.box([0, -0.1, -0.12], [0.04, 0.11, 0.06], metal, 0.012, [0.25, 0, 0]);
      p.box([0, -0.09, 0.07], [0.036, 0.1, 0.045], accent, 0.012, [-0.35, 0, 0]);
      p.box([0, -0.035, 0.24], [0.054, 0.1, 0.26], accent, 0.024, [-0.12, 0, 0]);
      p.hand([0.0, -0.1, 0.08], RIGHT_ELBOW, h, 1, [-0.35, 0, 0]);
      p.hand([-0.03, -0.03, -0.37], LEFT_ELBOW, h, -1, [0, 0, 0.5]);
    }
  }
  return p.g.build();
}
