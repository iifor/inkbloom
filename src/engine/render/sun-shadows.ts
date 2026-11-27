// Sun shadows: a depth map from the sun's side, covering a square of ground a little ahead of
// the camera, which ink-material.ts reads to darken what the sun cannot see. A tree's crown
// lets the sun through the gaps between its leaf clusters, so its shade is dappled.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { shared } from './ink-material';

/** Everything as the sun sees it: depth only. Posed like the ink material's meshes (instanced,
 * skinned), without what never throws a shadow (grass sways on its own layer). */
const shadowVert = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
attribute float aColor;
varying float vPigment;
varying vec3 vWorld;
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 world = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    world = instanceMatrix * world;
  #endif
  world = modelMatrix * world;
  vWorld = world.xyz;
  vPigment = aColor;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;
const shadowFrag = /* glsl */ `
precision highp float;
uniform sampler2D uCanopyBrush;
uniform vec3 uSunDir;
varying float vPigment;
varying vec3 vWorld;
void main() {
  float pigment = floor(vPigment + 0.5);
  bool cedar = pigment == ${color('cedar')}.0;
  if (cedar || pigment == ${color('leaf')}.0 || pigment == ${color('canopy')}.0) {
    // The gaps between the leaf clusters (the dark of the brush sheet: the gaps and the
    // clusters' shaded undersides), laid out on the
    // ground along the sun's rays: every leaf on one ray agrees whether it is a gap, so the
    // light comes all the way down through the crown and lies in spots under the tree.
    vec2 ground = vWorld.xz - uSunDir.xz * (vWorld.y / max(uSunDir.y, 0.2));
    vec2 sheet = texture2D(uCanopyBrush, ground * 0.29).rg;
    if ((cedar ? sheet.g : sheet.r) < 0.54) discard;
  }
  gl_FragColor = vec4(1.0);
}`;

/** Half the side of the square of ground that gets sun shadows, metres. */
const SHADOW_REACH = 70;
const SHADOW_SIZE = 2048;
/** Metres the shadow square may move before a skipped frame draws it anyway. */
const SHADOW_JUMP = 4;
const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _centre = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export class SunShadows {
  private readonly rt: THREE.WebGLRenderTarget;
  /** Frames counted for drawing shadows every other one, and where the last map was centred. */
  private frame = 0;
  private readonly at = new THREE.Vector3(Infinity, Infinity, Infinity);
  private readonly cam = new THREE.OrthographicCamera(
    -SHADOW_REACH,
    SHADOW_REACH,
    SHADOW_REACH,
    -SHADOW_REACH,
    1,
    500,
  );
  private readonly material = new THREE.ShaderMaterial({
    uniforms: { uCanopyBrush: shared.uCanopyBrush, uSunDir: { value: new THREE.Vector3(0, 1, 0) } },
    vertexShader: shadowVert,
    fragmentShader: shadowFrag,
    colorWrite: false,
    side: THREE.DoubleSide,
  });

  constructor() {
    const depth = new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE);
    depth.format = THREE.DepthFormat;
    depth.type = THREE.FloatType;
    this.rt = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: depth,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    shared.uShadowMap.value = depth;
    shared.uShadowTexel.value = 1 / SHADOW_SIZE;
  }

  /**
   * Draw the scene's depth as the sun (from `dir`) sees it, over a square centred a little
   * ahead of the camera. The square moves in whole texels so shadow edges do not crawl as the
   * player walks. Every other frame is enough: in this pass nothing sways, only monsters move,
   * and a frame old is unseen. The map and its matrix always change together, so a skipped
   * frame reads the last map exactly where it was drawn; a jump (a teleport, a fast turn)
   * redraws at once.
   */
  update(gl: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera, dir: THREE.Vector3): void {
    cam.getWorldDirection(_fwd).setY(0);
    if (_fwd.lengthSq() > 1e-6) _fwd.normalize();
    _centre.setFromMatrixPosition(cam.matrixWorld).addScaledVector(_fwd, SHADOW_REACH * 0.45);
    // light-space axes, then snap the centre to the texel grid along them
    _right.set(0, 1, 0).cross(dir).normalize();
    _up.crossVectors(dir, _right).normalize();
    const texel = (SHADOW_REACH * 2) / SHADOW_SIZE;
    const r = Math.round(_centre.dot(_right) / texel) * texel - _centre.dot(_right);
    const u = Math.round(_centre.dot(_up) / texel) * texel - _centre.dot(_up);
    _centre.addScaledVector(_right, r).addScaledVector(_up, u);
    if (++this.frame % 2 === 1 && _centre.distanceToSquared(this.at) < SHADOW_JUMP ** 2) return;
    this.at.copy(_centre);
    const sc = this.cam;
    sc.position.copy(_centre).addScaledVector(dir, 250);
    sc.up.copy(_up);
    sc.lookAt(_centre);
    sc.updateMatrixWorld();
    shared.uShadowMatrix.value.multiplyMatrices(BIAS, sc.projectionMatrix).multiply(sc.matrixWorldInverse);
    shared.uShadowOn.value = 1;
    this.material.uniforms.uSunDir!.value.copy(dir);
    this.draw(gl, scene, cam);
  }

  /** compileAsync does not use scene.overrideMaterial, so substitute it only during preparation. */
  async prepare(gl: THREE.WebGLRenderer, scene: THREE.Scene): Promise<void> {
    const target = gl.getRenderTarget();
    const materials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        materials.set(object, object.material);
        object.material = this.material;
      }
    });
    try {
      gl.setRenderTarget(this.rt);
      await gl.compileAsync(scene, this.cam);
    } finally {
      for (const [mesh, material] of materials) mesh.material = material;
      gl.setRenderTarget(target);
    }
  }

  /** Draw the map from where the sun's camera stands now. */
  draw(gl: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera): void {
    // the held tool hangs off the camera; it should not throw a shadow
    const camVisible = cam.visible;
    cam.visible = false;
    scene.overrideMaterial = this.material;
    gl.setRenderTarget(this.rt);
    gl.clear(false, true, false);
    gl.render(scene, this.cam);
    scene.overrideMaterial = null;
    cam.visible = camVisible;
  }

  dispose(): void {
    this.rt.dispose();
    this.material.dispose();
  }
}
