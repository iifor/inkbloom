// Small life in the air around the player, drawn over the finished frame like the rain (and,
// like it, hidden behind walls and hills): fireflies blinking over the grass on warm nights,
// butterflies fluttering by on fair days. Each one has a home near the player and wanders round
// it; when the player walks on, those left far behind find new homes ahead, so the air stays full
// without anything popping into view. How many are out is set from outside (`update`'s levels),
// by the hour, the season, the weather and the colour of the land.
import * as THREE from 'three';
import { OVERLAY_DEPTH } from './precipitation';
import { shared } from './ink-material';

const FIREFLIES = 220;
const BUTTERFLIES = 36;
/** Homes lie within this many metres of the player; beyond `LEAVE` they move ahead. */
const REACH = 26;
const LEAVE = 32;

/** Butterfly wing colours: lemon, cream, sky blue, apricot. */
const WINGS: readonly (readonly [number, number, number])[] = [
  [0.98, 0.88, 0.38],
  [0.98, 0.96, 0.88],
  [0.62, 0.8, 0.96],
  [0.98, 0.7, 0.42],
];

export interface CritterLevels {
  /** 0..1 of the fireflies out. */
  readonly fireflies: number;
  /** 0..1 of the butterflies out. */
  readonly butterflies: number;
  /** Wind, m/s: butterflies drift with it. */
  readonly windX: number;
  readonly windZ: number;
}

const fireflyVert = /* glsl */ `
attribute float aGlow;
uniform float uScale;
varying float vDepth;
varying float vGlow;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vDepth = -view.z;
  vGlow = aGlow;
  gl_Position = projectionMatrix * view;
  gl_PointSize = clamp(uScale * 0.32 / max(vDepth, 0.1), 2.5, 28.0);
}`;

const fireflyFrag = /* glsl */ `
precision highp float;
${OVERLAY_DEPTH}
varying float vGlow;
void main() {
  if (vGlow <= 0.01) discard;
  // a bright core in a soft halo
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = (exp(-r * r * 9.0) + 0.35 * exp(-r * r * 2.5)) * vGlow * visible();
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vec3(0.86, 1.0, 0.45) * a, 1.0);
}`;

const butterflyVert = /* glsl */ `
attribute vec3 aColor;
attribute float aFlap;
uniform float uScale;
varying float vDepth;
varying vec3 vColor;
varying float vFlap;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vDepth = -view.z;
  vColor = aColor;
  vFlap = aFlap;
  gl_Position = projectionMatrix * view;
  gl_PointSize = clamp(uScale * 0.38 / max(vDepth, 0.1), 2.5, 30.0);
}`;

const butterflyFrag = /* glsl */ `
precision highp float;
${OVERLAY_DEPTH}
uniform float uLight;
varying vec3 vColor;
varying float vFlap;
void main() {
  if (vFlap < 0.0) discard;
  // two wings either side of a thin body; they close (narrow) and open with the beat
  vec2 q = gl_PointCoord - 0.5;
  q.x /= max(0.15, vFlap);
  vec2 wing = vec2(abs(q.x) - 0.2, q.y + 0.05 * sign(q.y));
  float inWing = 1.0 - smoothstep(0.17, 0.22, length(wing * vec2(1.0, 1.25)));
  float body = (1.0 - smoothstep(0.03, 0.05, abs(gl_PointCoord.x - 0.5))) * step(abs(q.y), 0.22);
  float a = max(inWing, body) * visible();
  if (a <= 0.05) discard;
  vec3 c = mix(vColor, vec3(0.25, 0.2, 0.18), body);
  gl_FragColor = vec4(c * uLight, a);
}`;

/** A home and its own rhythm, for one critter. */
interface Home {
  x: number;
  z: number;
  y: number;
  /** 0..1, fixed: its phase, and the share of the swarm it belongs to (low ones come out first). */
  seed: number;
}

export class Critters {
  private readonly scene = new THREE.Scene();
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly flies: Home[] = [];
  private readonly butterflies: Home[] = [];
  private readonly flyPos: Float32Array;
  private readonly flyGlow: Float32Array;
  private readonly bflyPos: Float32Array;
  private readonly bflyFlap: Float32Array;
  private readonly flyGeom = new THREE.BufferGeometry();
  private readonly bflyGeom = new THREE.BufferGeometry();
  private readonly flyMat: THREE.ShaderMaterial;
  private readonly bflyMat: THREE.ShaderMaterial;
  private levels: CritterLevels = { fireflies: 0, butterflies: 0, windX: 0, windZ: 0 };
  private time = 0;
  private placed = false;

  constructor(depth: THREE.Texture) {
    this.uniforms = {
      uDepth: { value: depth },
      uRes: { value: new THREE.Vector2(2, 2) },
      uNear: { value: 0.1 },
      uFar: { value: 500 },
      uReversedDepth: shared.uReversedDepth,
      uScale: { value: 600 },
      uLight: { value: 1 },
    };
    this.flyPos = new Float32Array(FIREFLIES * 3);
    this.flyGlow = new Float32Array(FIREFLIES);
    this.flyGeom.setAttribute('position', new THREE.BufferAttribute(this.flyPos, 3));
    this.flyGeom.setAttribute('aGlow', new THREE.BufferAttribute(this.flyGlow, 1));
    this.bflyPos = new Float32Array(BUTTERFLIES * 3);
    this.bflyFlap = new Float32Array(BUTTERFLIES);
    const colors = new Float32Array(BUTTERFLIES * 3);
    for (let i = 0; i < BUTTERFLIES; i++) colors.set(WINGS[i % WINGS.length]!, i * 3);
    this.bflyGeom.setAttribute('position', new THREE.BufferAttribute(this.bflyPos, 3));
    this.bflyGeom.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.bflyGeom.setAttribute('aFlap', new THREE.BufferAttribute(this.bflyFlap, 1));
    const material = (vert: string, frag: string, additive: boolean): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
    this.flyMat = material(fireflyVert, fireflyFrag, true);
    this.bflyMat = material(butterflyVert, butterflyFrag, false);
    for (const [geom, mat] of [
      [this.flyGeom, this.flyMat],
      [this.bflyGeom, this.bflyMat],
    ] as const) {
      const pts = new THREE.Points(geom, mat);
      pts.frustumCulled = false;
      this.scene.add(pts);
    }
    for (let i = 0; i < FIREFLIES; i++) this.flies.push({ x: 0, z: 0, y: 0, seed: (i + 0.5) / FIREFLIES });
    for (let i = 0; i < BUTTERFLIES; i++)
      this.butterflies.push({ x: 0, z: 0, y: 0, seed: (i + 0.5) / BUTTERFLIES });
  }

  /** Re-home one critter at a random spot `near`..`REACH` metres from (x, z), ahead of the walker
   * when it is moving on. */
  private rehome(
    h: Home,
    x: number,
    z: number,
    ground: (x: number, z: number) => number,
    ahead: number,
  ): void {
    const a = ahead + (Math.random() - 0.5) * (Math.PI * 1.2);
    const d = 6 + Math.random() * (REACH - 6);
    h.x = x + Math.cos(a) * d;
    h.z = z + Math.sin(a) * d;
    h.y = ground(h.x, h.z);
  }

  /**
   * Move the critters round a player at (x, z) for `dt` seconds. `ground` gives the ground
   * height; `levels` how many of each are out. Cheap: a few hundred points on the CPU.
   */
  update(
    dt: number,
    x: number,
    z: number,
    ground: (x: number, z: number) => number,
    levels: CritterLevels,
  ): void {
    this.levels = levels;
    this.time += dt;
    const t = this.time;
    if (!this.placed) {
      for (const h of [...this.flies, ...this.butterflies])
        this.rehome(h, x, z, ground, Math.random() * Math.PI * 2);
      this.placed = true;
    }
    if (levels.fireflies > 0.01)
      for (let i = 0; i < FIREFLIES; i++) {
        const h = this.flies[i]!;
        if (Math.hypot(h.x - x, h.z - z) > LEAVE) this.rehome(h, x, z, ground, Math.atan2(z - h.z, x - h.x));
        const p = h.seed * 97;
        // a slow loop round its home, hovering knee to head high
        this.flyPos[i * 3] = h.x + Math.sin(t * 0.37 + p) * 1.6 + Math.sin(t * 0.9 + p * 2.1) * 0.4;
        this.flyPos[i * 3 + 1] = h.y + 0.5 + 1.4 * ((p * 0.37) % 1) + Math.sin(t * 0.6 + p) * 0.35;
        this.flyPos[i * 3 + 2] = h.z + Math.cos(t * 0.29 + p * 1.3) * 1.6;
        // each blinks on its own slow beat: a soft rise, a glow, a fade, then dark a while
        const beat = (t / (2.2 + 1.8 * ((p * 0.71) % 1)) + p) % 1;
        const blink = beat < 0.5 ? Math.sin((beat / 0.5) * Math.PI) : 0;
        this.flyGlow[i] = h.seed < levels.fireflies ? blink * blink : 0;
      }
    else this.flyGlow.fill(0);
    if (levels.butterflies > 0.01)
      for (let i = 0; i < BUTTERFLIES; i++) {
        const h = this.butterflies[i]!;
        if (Math.hypot(h.x - x, h.z - z) > LEAVE) this.rehome(h, x, z, ground, Math.atan2(z - h.z, x - h.x));
        // a wandering flutter, nudged downwind
        h.x += levels.windX * 0.04 * dt;
        h.z += levels.windZ * 0.04 * dt;
        const p = h.seed * 61;
        this.bflyPos[i * 3] = h.x + Math.sin(t * 0.5 + p) * 3 + Math.sin(t * 1.7 + p) * 0.5;
        this.bflyPos[i * 3 + 1] = h.y + 0.8 + Math.abs(Math.sin(t * 1.1 + p)) * 0.9;
        this.bflyPos[i * 3 + 2] = h.z + Math.cos(t * 0.43 + p * 1.7) * 3;
        this.bflyFlap[i] = h.seed < levels.butterflies ? 0.2 + 0.8 * Math.abs(Math.sin(t * 13 + p)) : -1;
      }
    else this.bflyFlap.fill(-1);
    this.flyGeom.attributes.position!.needsUpdate = true;
    (this.flyGeom.attributes.aGlow as THREE.BufferAttribute).needsUpdate = true;
    this.bflyGeom.attributes.position!.needsUpdate = true;
    (this.bflyGeom.attributes.aFlap as THREE.BufferAttribute).needsUpdate = true;
  }

  setSize(width: number, height: number): void {
    (this.uniforms.uRes!.value as THREE.Vector2).set(width, height);
  }

  /** Draw into whatever target is bound, over what is there. `night` dims the butterflies. */
  render(r: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, night: number): void {
    const { fireflies, butterflies } = this.levels;
    if (fireflies <= 0.01 && butterflies <= 0.01) return;
    this.uniforms.uNear!.value = camera.near;
    this.uniforms.uFar!.value = camera.far;
    this.uniforms.uScale!.value =
      (camera.projectionMatrix.elements[5]! * (this.uniforms.uRes!.value as THREE.Vector2).y) / 2;
    this.uniforms.uLight!.value = 1 - 0.6 * night;
    r.render(this.scene, camera);
  }

  dispose(): void {
    this.flyGeom.dispose();
    this.bflyGeom.dispose();
    this.flyMat.dispose();
    this.bflyMat.dispose();
  }
}
