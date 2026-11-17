// Birds high over the land, drawn over the finished frame like the butterflies (and, like them,
// hidden behind hills): a few flocks of dark, ink-stroke birds wheeling in wide, slow circles,
// each bird a flapping curve that glides a while between beats, strung out behind its leader.
// When the player leaves a flock far behind, it flies in again from somewhere ahead. How many
// are out is set from outside (`update`'s level): by day, in fair weather, more where the land
// has its colour back.
import * as THREE from 'three';
import { shared } from './ink-material';
import { OVERLAY_DEPTH } from './precipitation';

const FLOCKS = 3;
const PER_FLOCK = 11;
const BIRDS = FLOCKS * PER_FLOCK;
/** A flock circles a centre this far (metres) from the player; beyond `LEAVE` it moves ahead. */
const NEAR = 70;
const FAR = 170;
const LEAVE = 280;

const vert = /* glsl */ `
attribute float aFlap;
attribute float aAlpha;
uniform float uScale;
varying float vDepth;
varying float vFlap;
varying float vAlpha;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vDepth = -view.z;
  vFlap = aFlap;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * view;
  gl_PointSize = clamp(uScale * 1.3 / max(vDepth, 0.1), 3.0, 46.0);
}`;

const frag = /* glsl */ `
precision highp float;
${OVERLAY_DEPTH}
uniform float uLight;
varying float vFlap;
varying float vAlpha;
void main() {
  if (vAlpha <= 0.01) discard;
  // two swept wings from a small body: up in a flat 'm' on the upstroke, down in an arch
  vec2 q = gl_PointCoord - 0.5;
  float x = abs(q.x);
  if (x > 0.46) discard;
  float wing = -q.y - (vFlap * 0.5 * x - 0.55 * x * x * (1.0 + vFlap));
  float thick = mix(0.045, 0.012, x / 0.46);
  float a = (1.0 - smoothstep(thick, thick + 0.03, abs(wing))) * vAlpha * visible();
  a = max(a, (1.0 - smoothstep(0.035, 0.06, length(q))) * vAlpha * visible());
  if (a <= 0.03) discard;
  gl_FragColor = vec4(mix(vec3(0.1, 0.1, 0.13), vec3(0.2, 0.22, 0.3), 1.0 - uLight), a * 0.85);
}`;

interface Flock {
  x: number;
  z: number;
  /** Height above the ground under its centre. */
  y: number;
  radius: number;
  /** Radians a second round the centre (sign: which way round). */
  turn: number;
  phase: number;
  /** Seconds since it last flew in (it fades in). */
  age: number;
}

export class Birds {
  private readonly scene = new THREE.Scene();
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly pos = new Float32Array(BIRDS * 3);
  private readonly flap = new Float32Array(BIRDS);
  private readonly alpha = new Float32Array(BIRDS);
  private readonly flocks: Flock[] = [];
  /** Each bird's place in its flock: lag behind the leader, out to the side, up, own beat. */
  private readonly places: { lag: number; side: number; up: number; beat: number }[] = [];
  private level = 0;
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
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('aFlap', new THREE.BufferAttribute(this.flap, 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const points = new THREE.Points(this.geometry, this.material);
    points.frustumCulled = false;
    this.scene.add(points);
    let s = 0x2545f491;
    const rand = (): number => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < BIRDS; i++) {
      const k = i % PER_FLOCK;
      // a loose skein: the leader first, the rest trailing off to either side
      this.places.push({
        lag: k * 0.035 + rand() * 0.02,
        side: (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (1.6 + rand()),
        up: (rand() - 0.5) * 3,
        beat: rand(),
      });
    }
    for (let f = 0; f < FLOCKS; f++)
      this.flocks.push({ x: 0, z: 0, y: 0, radius: 0, turn: 0, phase: 0, age: 0 });
  }

  /** Send a flock to circle somewhere ahead of a walker at (x, z) heading `ahead` (radians). */
  private rehome(
    f: Flock,
    x: number,
    z: number,
    ground: (x: number, z: number) => number,
    ahead: number,
  ): void {
    const a = ahead + (Math.random() - 0.5) * Math.PI * 1.4;
    const d = NEAR + Math.random() * (FAR - NEAR);
    f.x = x + Math.cos(a) * d;
    f.z = z + Math.sin(a) * d;
    f.y = ground(f.x, f.z) + 28 + Math.random() * 30;
    f.radius = 25 + Math.random() * 35;
    f.turn = (Math.random() < 0.5 ? -1 : 1) * (0.08 + Math.random() * 0.07);
    f.phase = Math.random() * Math.PI * 2;
    f.age = 0;
  }

  /** Move the flocks round a player at (x, z); `level` (0..1) is how many birds are out. */
  update(dt: number, x: number, z: number, ground: (x: number, z: number) => number, level: number): void {
    this.level = level;
    this.time += dt;
    if (!this.placed) {
      for (const f of this.flocks) this.rehome(f, x, z, ground, Math.random() * Math.PI * 2);
      for (const f of this.flocks) f.age = 10;
      this.placed = true;
    }
    if (level <= 0.01) return;
    const t = this.time;
    this.flocks.forEach((f, n) => {
      if (Math.hypot(f.x - x, f.z - z) > LEAVE) this.rehome(f, x, z, ground, Math.atan2(z - f.z, x - f.x));
      f.age += dt;
      // the circle itself drifts a little, so the flock wanders over the land
      f.x += Math.sin(t * 0.05 + n * 2.1) * 0.6 * dt;
      f.z += Math.cos(t * 0.04 + n * 1.3) * 0.6 * dt;
      // fading in after it flies in, and out as it is left behind
      const behind = Math.hypot(f.x - x, f.z - z);
      const fade = Math.min(1, f.age / 4) * (1 - Math.min(1, Math.max(0, (behind - LEAVE + 60) / 60)));
      // flocks come out one after another as the level rises, each fading in as it does
      const out = Math.min(1, Math.max(0, level * FLOCKS - n));
      for (let k = 0; k < PER_FLOCK; k++) {
        const i = n * PER_FLOCK + k;
        const p = this.places[i]!;
        const a = f.phase + f.turn * t - Math.sign(f.turn) * p.lag;
        // out from the circle a little either side, and bobbing as they fly
        const r = f.radius + p.side;
        this.pos[i * 3] = f.x + Math.cos(a) * r;
        this.pos[i * 3 + 1] = f.y + p.up + Math.sin(t * 0.7 + p.beat * 6) * 0.6;
        this.pos[i * 3 + 2] = f.z + Math.sin(a) * r;
        // a few quick beats, then a glide with the wings held level
        const cycle = (t * 0.45 + p.beat) % 1;
        this.flap[i] = cycle < 0.45 ? Math.sin(t * 11 + p.beat * 20) : 0.15;
        this.alpha[i] = fade * out;
      }
    });
    this.geometry.attributes.position!.needsUpdate = true;
    (this.geometry.attributes.aFlap as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  setSize(width: number, height: number): void {
    (this.uniforms.uRes!.value as THREE.Vector2).set(width, height);
  }

  render(r: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, night: number): void {
    if (this.level <= 0.01) return;
    const u = this.uniforms;
    u.uNear!.value = camera.near;
    u.uFar!.value = camera.far;
    u.uScale!.value = (camera.projectionMatrix.elements[5]! * (u.uRes!.value as THREE.Vector2).y) / 2;
    u.uLight!.value = 1 - night;
    r.render(this.scene, camera);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
