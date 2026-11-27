// Soft glow over the finished frame: the bright parts of the painted frame at a quarter of the
// resolution, blurred across then down, added on top.
import * as THREE from 'three';
import { postVert } from './paint-shader';

/** How strongly bright light blooms over its surroundings. */
const GLOW_STRENGTH = 0.32;

/** Bright parts of the painted frame, blurred along one axis (9 taps). With `uPick` set it
 * first keeps only what is brighter than the threshold. */
const glowFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uStep;
uniform float uPick;
vec3 pick(vec3 c) {
  float l = dot(c, vec3(0.3, 0.59, 0.11));
  return uPick > 0.5 ? c * smoothstep(0.72, 1.0, l) : c;
}
void main() {
  vec3 sum = pick(texture2D(tSrc, vUv).rgb) * 0.227;
  for (int i = 1; i <= 4; i++) {
    float w = i == 1 ? 0.195 : i == 2 ? 0.122 : i == 3 ? 0.054 : 0.016;
    sum += pick(texture2D(tSrc, vUv + uStep * float(i) * 1.5).rgb) * w;
    sum += pick(texture2D(tSrc, vUv - uStep * float(i) * 1.5).rgb) * w;
  }
  gl_FragColor = vec4(sum, 1.0);
}`;
/** Adds the glow on top of the finished frame. */
const glowAddFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tGlow;
uniform float uStrength;
void main() { gl_FragColor = vec4(texture2D(tGlow, vUv).rgb * uStrength, 1.0); }`;

export class GlowPass {
  private readonly glowA: THREE.WebGLRenderTarget;
  private readonly glowB: THREE.WebGLRenderTarget;
  private readonly glowBlur: THREE.ShaderMaterial;
  private readonly glowAdd: THREE.ShaderMaterial;
  private readonly glowScene = new THREE.Scene();
  private readonly glowQuad: THREE.Mesh;

  constructor() {
    const glowTarget = (): THREE.WebGLRenderTarget =>
      new THREE.WebGLRenderTarget(2, 2, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });
    this.glowA = glowTarget();
    this.glowB = glowTarget();
    this.glowBlur = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uStep: { value: new THREE.Vector2() }, uPick: { value: 0 } },
      vertexShader: postVert,
      fragmentShader: glowFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.glowAdd = new THREE.ShaderMaterial({
      uniforms: { tGlow: { value: this.glowA.texture }, uStrength: { value: GLOW_STRENGTH } },
      vertexShader: postVert,
      fragmentShader: glowAddFrag,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
    });
    this.glowQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.glowBlur);
    this.glowScene.add(this.glowQuad);
  }

  /** Quarter of the frame's own size. */
  setSize(rw: number, rh: number): void {
    this.glowA.setSize(Math.max(2, rw >> 2), Math.max(2, rh >> 2));
    this.glowB.setSize(Math.max(2, rw >> 2), Math.max(2, rh >> 2));
  }

  async prepare(r: THREE.WebGLRenderer, camera: THREE.Camera): Promise<void> {
    const target = r.getRenderTarget();
    const material = this.glowQuad.material;
    try {
      this.glowQuad.material = this.glowBlur;
      r.setRenderTarget(this.glowB);
      await r.compileAsync(this.glowScene, camera);
      this.glowQuad.material = this.glowAdd;
      r.setRenderTarget(null);
      await r.compileAsync(this.glowScene, camera);
    } finally {
      this.glowQuad.material = material;
      r.setRenderTarget(target);
    }
  }

  /** Pick the bright parts of `src`, blur them across then down at quarter size, add them to
   * the screen. */
  render(r: THREE.WebGLRenderer, src: THREE.Texture, cam: THREE.Camera): void {
    const b = this.glowBlur.uniforms;
    const w = this.glowA.width;
    const h = this.glowA.height;
    this.glowQuad.material = this.glowBlur;
    b.tSrc!.value = src;
    b.uPick!.value = 1;
    b.uStep!.value.set(1 / w, 0);
    r.setRenderTarget(this.glowB);
    r.render(this.glowScene, cam);
    b.tSrc!.value = this.glowB.texture;
    b.uPick!.value = 0;
    b.uStep!.value.set(0, 1 / h);
    r.setRenderTarget(this.glowA);
    r.render(this.glowScene, cam);
    this.glowQuad.material = this.glowAdd;
    r.setRenderTarget(null);
    r.render(this.glowScene, cam);
  }

  dispose(): void {
    this.glowA.dispose();
    this.glowB.dispose();
    this.glowBlur.dispose();
    this.glowAdd.dispose();
    this.glowQuad.geometry.dispose();
  }
}
