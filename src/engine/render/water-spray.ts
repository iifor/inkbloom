import * as THREE from 'three';
import { WATER_LEVEL } from '@/world/wilderness/water-level';
import { shared } from './ink-material';
import { OVERLAY_DEPTH } from './precipitation';

const BURSTS = 12;
const DROPS = 20;
const LIFE = 0.95;

const common = /* glsl */ `
uniform vec4 uBursts[${BURSTS}];
uniform vec2 uFlow[${BURSTS}];
uniform vec2 uBankNormal[${BURSTS}];
uniform float uTime;
varying float vDepth;
varying float vAlpha;
float packet(float age) {
  return smoothstep(0.0, 0.16, age) * (1.0 - smoothstep(0.42, ${LIFE}, age));
}
`;

/** Small crest strips and ballistic droplets, composited against the scene depth. */
export class WaterSpray {
  private readonly scene = new THREE.Scene();
  private readonly bursts = Array.from({ length: BURSTS }, () => new THREE.Vector4());
  private readonly flow = Array.from({ length: BURSTS }, () => new THREE.Vector2());
  private readonly bankNormals = Array.from({ length: BURSTS }, () => new THREE.Vector2());
  private readonly uniforms = {
    uDepth: { value: null as THREE.Texture | null },
    uReversedDepth: shared.uReversedDepth,
    uRes: { value: new THREE.Vector2(2, 2) },
    uNear: { value: 0.1 },
    uFar: { value: 500 },
    uTime: { value: 0 },
    uScale: { value: 600 },
    uLight: { value: 1 },
    uSun: { value: new THREE.Vector3() },
    uBursts: { value: this.bursts },
    uFlow: { value: this.flow },
    uBankNormal: { value: this.bankNormals },
  };
  private readonly drops = new THREE.BufferGeometry();
  private readonly crests = new THREE.InstancedBufferGeometry();
  private readonly dropIndices = new THREE.BufferAttribute(new Uint16Array(BURSTS * DROPS), 1).setUsage(THREE.DynamicDrawUsage);
  private readonly crestSlots = new THREE.InstancedBufferAttribute(new Float32Array(BURSTS).fill(-1), 1)
    .setUsage(THREE.DynamicDrawUsage);
  private readonly clipFromWorld = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private readonly bounds = new THREE.Sphere();
  private readonly dropMaterial: THREE.ShaderMaterial;
  private readonly crestMaterial: THREE.ShaderMaterial;
  private slot = 0;
  private latest = -Infinity;

  constructor(depth: THREE.Texture) {
    this.uniforms.uDepth.value = depth;
    const count = BURSTS * DROPS;
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++)
      seeds.set([(i * 0.618) % 1, (i * 0.754) % 1, (i * 0.414) % 1, Math.floor(i / DROPS)], i * 4);
    this.drops.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    this.drops.setAttribute('aDrop', new THREE.Float32BufferAttribute(seeds, 4));
    this.drops.setIndex(this.dropIndices);
    const grid = new THREE.PlaneGeometry(2, 2, 12, 8);
    this.crests.setIndex(grid.index!.clone());
    this.crests.setAttribute('position', grid.getAttribute('position').clone());
    this.crests.setAttribute('aBurst', this.crestSlots);
    grid.dispose();
    const opts = { uniforms: this.uniforms, transparent: true, depthTest: false, depthWrite: false };
    this.dropMaterial = new THREE.ShaderMaterial({
      ...opts,
      vertexShader: /* glsl */ `
        ${common}
        attribute vec4 aDrop;
        uniform float uScale;
        varying float vAge;
        varying float vMist;
        void main() {
          int i = int(aDrop.w);
          vec4 event = uBursts[i];
          float age = clamp(uTime - event.z - 0.14 * aDrop.z, 0.0, ${LIFE});
          float a = aDrop.x * 6.283185;
          vec2 dir = vec2(cos(a), sin(a));
          vec2 bankNormal = uBankNormal[i];
          float bank = step(0.5, length(bankNormal));
          vec2 bankTangent = vec2(-bankNormal.y, bankNormal.x);
          vec2 fan = bankNormal * mix(-0.35, 0.95, aDrop.y) + bankTangent * cos(a) * 0.9;
          dir = mix(dir, fan, bank);
          float speed = mix(0.65, 2.6, aDrop.y) * event.w;
          vec2 xz = event.xy + (dir * speed + uFlow[i] * mix(0.45, 0.28, bank)) * age;
          vMist = step(mix(0.73, 0.83, bank), aDrop.z);
          float launch = mix(1.6, 3.55, aDrop.z) * sqrt(event.w) * mix(1.0, 1.27, bank);
          float height = (launch - 4.9 * age) * age;
          vec4 view = modelViewMatrix * vec4(xz.x, ${WATER_LEVEL} + mix(0.05, 0.075, bank) + height, xz.y, 1.0);
          vDepth = -view.z;
          vAge = age / ${LIFE};
          vAlpha = event.w * mix(1.0, 1.45, bank) * packet(age) * smoothstep(-0.02, 0.08, height);
          gl_Position = projectionMatrix * view;
          float dropSize = mix(0.035, mix(0.036, 0.073, aDrop.y), bank);
          gl_PointSize = clamp(uScale * mix(dropSize, 0.19 + age * 0.36, vMist) / max(vDepth, 0.2), 1.0, 32.0);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${OVERLAY_DEPTH}
        uniform float uLight;
        varying float vAlpha;
        varying float vAge;
        varying float vMist;
        void main() {
          // A short procedural flipbook: the larger spray opens into lobes and thins out.
          float frame = floor(vAge * 7.0);
          vec2 p = gl_PointCoord - 0.5;
          float droplet = 1.0 - smoothstep(0.17, 0.50, length(p * vec2(1.5, 0.92)));
          float mist = exp(-dot(p, p) * 22.0);
          float torn = 0.55 + 0.45 * sin(p.x * (13.0 + frame) + frame) * cos(p.y * 15.0 - frame);
          float a = mix(droplet, mist * torn * 0.36, vMist) * vAlpha * visible();
          if (a < 0.008) discard;
          float glint = (1.0 - smoothstep(0.02, 0.23, length(p + vec2(0.12, 0.16)))) * (1.0 - vMist);
          gl_FragColor = vec4(mix(vec3(0.81, 0.93, 0.98), vec3(1.0), glint) * uLight, a);
        }`,
    });
    this.crestMaterial = new THREE.ShaderMaterial({
      ...opts,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        ${common}
        attribute float aBurst;
        varying vec2 vPatch;
        varying vec3 vNormal;
        varying float vBank;
        void main() {
          int i = int(aBurst);
          vec4 event = uBursts[i];
          float age = clamp(uTime - event.z, 0.0, ${LIFE});
          float shape = packet(age);
          vec2 v = uFlow[i];
          vBank = step(0.5, length(uBankNormal[i]));
          vec2 currentDir = length(v) > 0.01 ? normalize(v) : vec2(0.0, 1.0);
          vec2 along = mix(currentDir, uBankNormal[i], vBank);
          vec2 across = vec2(along.y, -along.x);
          float theta = position.y * 3.4 - age * 8.0 + position.x * position.x * 1.15;
          float envelope = max(0.0, 1.0 - position.x * position.x) * max(0.0, 1.0 - abs(position.y));
          float amplitude = mix(0.20, 0.37, vBank) * event.w * shape * envelope;
          // Gerstner displacement: the crest rises and folds forward with the same phase.
          vec2 xz = event.xy + mix(v * 0.65, v * 0.23 + along * 1.05, vBank) * age + across * position.x * 0.78 +
            along * (position.y * 0.32 + 0.52 * amplitude * cos(theta));
          vec4 view = modelViewMatrix * vec4(xz.x, ${WATER_LEVEL} + amplitude * (0.82 + sin(theta)), xz.y, 1.0);
          vDepth = -view.z;
          vPatch = position.xy;
          vNormal = normalize(vec3(-along.x * amplitude * 9.0 * cos(theta), 1.0, -along.y * amplitude * 9.0 * cos(theta)));
          vAlpha = event.w * shape * envelope * smoothstep(0.35, 0.9, sin(theta));
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${OVERLAY_DEPTH}
        uniform vec3 uSun;
        uniform float uLight;
        varying float vAlpha;
        varying vec2 vPatch;
        varying vec3 vNormal;
        varying float vBank;
        void main() {
          float specks = 0.66 + 0.34 * sin(vPatch.x * 39.0 + sin(vPatch.y * 22.0));
          float a = vAlpha * specks * visible();
          if (a < 0.008) discard;
          float sun = max(0.0, dot(normalize(vNormal), uSun));
          vec3 foam = mix(vec3(0.66, 0.83, 0.88), vec3(0.88, 0.96, 1.0), vBank);
          gl_FragColor = vec4(foam * uLight + vec3(0.38 * sun), a * mix(0.74, 1.0, vBank));
        }`,
    });
    const crests = new THREE.Mesh(this.crests, this.crestMaterial);
    const drops = new THREE.Points(this.drops, this.dropMaterial);
    crests.frustumCulled = drops.frustumCulled = false;
    drops.renderOrder = 1;
    this.scene.add(crests, drops);
  }

  add(x: number, z: number, time: number, strength: number, flowX: number, flowZ: number, bankNormal?: { x: number; z: number }): void {
    const i = this.slot++ % BURSTS;
    this.bursts[i]!.set(x, z, time, Math.min(1, Math.max(0, strength)));
    this.flow[i]!.set(flowX, flowZ);
    this.bankNormals[i]!.set(bankNormal?.x ?? 0, bankNormal?.z ?? 0);
    this.latest = time;
  }

  setSize(width: number, height: number): void {
    this.uniforms.uRes.value.set(width, height);
  }

  private selectVisible(camera: THREE.PerspectiveCamera, time: number): number {
    this.clipFromWorld.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(
      this.clipFromWorld,
      shared.uReversedDepth.value ? THREE.WebGPUCoordinateSystem : camera.coordinateSystem,
    );
    let count = 0;
    let changed = false;
    for (let slot = 0; slot < this.bursts.length; slot++) {
      const burst = this.bursts[slot]!;
      const age = time - burst.z;
      if (burst.w <= 0 || age < 0 || age >= LIFE) continue;
      this.bounds.center.set(burst.x, WATER_LEVEL + 0.35, burst.y);
      this.bounds.radius = 3.1 + this.flow[slot]!.length() * LIFE * 0.65;
      if (!this.frustum.intersectsSphere(this.bounds)) continue;
      // Keep each live burst's original particle seeds when other slots expire.
      if (this.crestSlots.array[count] !== slot) {
        this.crestSlots.array[count] = slot;
        for (let drop = 0; drop < DROPS; drop++) this.dropIndices.array[count * DROPS + drop] = slot * DROPS + drop;
        changed = true;
      }
      count++;
    }
    if (changed) {
      this.crestSlots.needsUpdate = true;
      this.dropIndices.needsUpdate = true;
    }
    this.crests.instanceCount = count;
    this.drops.setDrawRange(0, count * DROPS);
    return count;
  }

  render(r: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, time: number, night: number, sun: THREE.Vector3): void {
    if (time - this.latest >= LIFE || this.selectVisible(camera, time) === 0) return;
    const u = this.uniforms;
    u.uTime.value = time;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uScale.value = camera.projectionMatrix.elements[5]! * u.uRes.value.y * 0.5;
    u.uLight.value = 1 - 0.68 * night;
    u.uSun.value.copy(sun);
    r.render(this.scene, camera);
  }

  dispose(): void {
    this.drops.dispose();
    this.crests.dispose();
    this.dropMaterial.dispose();
    this.crestMaterial.dispose();
  }
}
