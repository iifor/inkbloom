import * as THREE from 'three';
import { WATER_LEVEL } from '@/world/wilderness/water-level';
import { shared } from './ink-material';
import { OVERLAY_DEPTH } from './precipitation';

const BURSTS = 12;
const DROPS = 12;
const LIFE = 0.95;

const common = /* glsl */ `
uniform vec4 uBursts[${BURSTS}];
uniform vec2 uFlow[${BURSTS}];
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
  };
  private readonly drops = new THREE.BufferGeometry();
  private readonly crests = new THREE.InstancedBufferGeometry();
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
    const grid = new THREE.PlaneGeometry(2, 2, 12, 8);
    this.crests.setIndex(grid.index!.clone());
    this.crests.setAttribute('position', grid.getAttribute('position').clone());
    this.crests.setAttribute('aBurst', new THREE.InstancedBufferAttribute(Float32Array.from(this.bursts, (_, i) => i), 1));
    this.crests.instanceCount = BURSTS;
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
          float speed = mix(0.65, 2.6, aDrop.y) * event.w;
          vec2 xz = event.xy + (dir * speed + uFlow[i] * 0.45) * age;
          vMist = step(0.73, aDrop.z);
          float height = (mix(1.6, 3.55, aDrop.z) * sqrt(event.w) - 4.9 * age) * age;
          vec4 view = modelViewMatrix * vec4(xz.x, ${WATER_LEVEL} + 0.05 + height, xz.y, 1.0);
          vDepth = -view.z;
          vAge = age / ${LIFE};
          vAlpha = event.w * packet(age) * smoothstep(-0.02, 0.08, height);
          gl_Position = projectionMatrix * view;
          gl_PointSize = clamp(uScale * mix(0.035, 0.19 + age * 0.36, vMist) / max(vDepth, 0.2), 1.0, 32.0);
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
          gl_FragColor = vec4(vec3(0.81, 0.93, 0.98) * uLight, a);
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
        void main() {
          int i = int(aBurst);
          vec4 event = uBursts[i];
          float age = clamp(uTime - event.z, 0.0, ${LIFE});
          float shape = packet(age);
          vec2 v = uFlow[i];
          vec2 along = length(v) > 0.01 ? normalize(v) : vec2(0.0, 1.0);
          vec2 across = vec2(along.y, -along.x);
          float theta = position.y * 3.4 - age * 8.0 + position.x * position.x * 1.15;
          float envelope = max(0.0, 1.0 - position.x * position.x) * max(0.0, 1.0 - abs(position.y));
          float amplitude = 0.20 * event.w * shape * envelope;
          // Gerstner displacement: the crest rises and folds forward with the same phase.
          vec2 xz = event.xy + v * age * 0.65 + across * position.x * 0.78 +
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
        void main() {
          float specks = 0.66 + 0.34 * sin(vPatch.x * 39.0 + sin(vPatch.y * 22.0));
          float a = vAlpha * specks * visible();
          if (a < 0.008) discard;
          float sun = max(0.0, dot(normalize(vNormal), uSun));
          gl_FragColor = vec4(vec3(0.66, 0.83, 0.88) * uLight + vec3(0.38 * sun), a * 0.74);
        }`,
    });
    const crests = new THREE.Mesh(this.crests, this.crestMaterial);
    const drops = new THREE.Points(this.drops, this.dropMaterial);
    crests.frustumCulled = drops.frustumCulled = false;
    drops.renderOrder = 1;
    this.scene.add(crests, drops);
  }

  add(x: number, z: number, time: number, strength: number, flowX: number, flowZ: number): void {
    const i = this.slot++ % BURSTS;
    this.bursts[i]!.set(x, z, time, Math.min(1, Math.max(0, strength)));
    this.flow[i]!.set(flowX, flowZ);
    this.latest = time;
  }

  setSize(width: number, height: number): void {
    this.uniforms.uRes.value.set(width, height);
  }

  render(r: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, time: number, night: number, sun: THREE.Vector3): void {
    if (time - this.latest > LIFE + 0.15) return;
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
