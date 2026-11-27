import * as THREE from 'three';

export const WAKE_COUNT = 18;
const RANGE = 48;
const RESOLUTION = 384;

/** A top-down water disturbance field. Each stamp is a finite wave packet. */
export class WakeField {
  private readonly target = new THREE.WebGLRenderTarget(RESOLUTION, RESOLUTION, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  readonly texture = this.target.texture;
  readonly bounds = new THREE.Vector3(0, 0, RANGE);
  private readonly wakes = Array.from({ length: WAKE_COUNT }, () => new THREE.Vector4());
  private readonly drift = Array.from({ length: WAKE_COUNT }, () => new THREE.Vector2());
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uWakes: { value: this.wakes },
      uDrift: { value: this.drift },
      uTime: { value: 0 },
      uBounds: { value: this.bounds },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform vec4 uWakes[${WAKE_COUNT}];
      uniform vec2 uDrift[${WAKE_COUNT}];
      uniform float uTime;
      uniform vec3 uBounds;
      void main() {
        vec2 p = uBounds.xy + vUv * uBounds.z;
        vec2 bands = vec2(0.0);
        for (int i=0; i<${WAKE_COUNT}; i++) {
          vec4 wake = uWakes[i];
          float age = uTime - wake.z;
          if (wake.w <= 0.0 || age < 0.0 || age > 2.4) continue;
          vec2 delta = p - wake.xy - uDrift[i] * age * 0.55;
          delta.x *= 1.08;
          float radius = age * mix(1.15, 1.95, wake.w);
          if (dot(delta, delta) > (radius + 0.65) * (radius + 0.65)) continue;
          float distort = sin(3.4*delta.x + 1.5*delta.y) * cos(2.6*delta.y + float(i));
          float edge = length(delta) - radius + 0.067 * distort;
          float width = 0.13 + 0.044 * age;
          vec3 wave = vec3(edge, edge + 0.32, edge - 0.13) / width;
          vec3 band = exp(-wave * wave);
          float fade = wake.w * smoothstep(0.0, 0.14, age) * (1.0 - smoothstep(0.22, 2.4, age));
          fade *= mix(0.32, 1.0, smoothstep(-0.65, 0.55, distort));
          bands += vec2(band.x + band.y * 0.45, band.z) * fade;
        }
        gl_FragColor = vec4(min(vec2(1.0), bands), 0.0, 1.0);
      }
    `,
  });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private player = 0;
  private fish = 0;
  private latest = -Infinity;

  constructor() {
    const quad = new THREE.Mesh(this.geometry, this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  add(x: number, z: number, time: number, fromPlayer: boolean, strength: number, dx = 0, dz = 0): void {
    const i = fromPlayer ? this.player++ % 6 : 6 + (this.fish++ % (WAKE_COUNT - 6));
    this.wakes[i]!.set(x, z, time, strength);
    this.drift[i]!.set(dx, dz);
    this.latest = time;
  }

  /** Allocate the water target and compile the stamp shader before the first ripple. */
  async prepare(renderer: THREE.WebGLRenderer): Promise<void> {
    const target = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(this.target);
      await renderer.compileAsync(this.scene, this.camera);
    } finally {
      renderer.setRenderTarget(target);
    }
  }

  warmUp(renderer: THREE.WebGLRenderer): void {
    const target = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(this.target);
      renderer.render(this.scene, this.camera);
    } finally {
      renderer.setRenderTarget(target);
    }
  }

  render(renderer: THREE.WebGLRenderer, eye: THREE.Vector3, time: number): boolean {
    if (time - this.latest > 2.4) return false;
    const cell = RANGE / RESOLUTION;
    this.bounds.set(
      Math.floor((eye.x - RANGE / 2) / cell) * cell,
      Math.floor((eye.z - RANGE / 2) / cell) * cell,
      RANGE,
    );
    this.material.uniforms.uTime!.value = time;
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    return true;
  }

  dispose(): void {
    this.target.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
