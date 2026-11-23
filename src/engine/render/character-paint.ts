import * as THREE from 'three';
import { color } from '@/content/palette';

// One generated atlas shared by all imported characters, including camera hands.
// Top: linen / leather. Bottom: skin / hair. No change to saved palette indices.
const neutral = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
neutral.needsUpdate = true;
export const characterPaintUniforms = {
  uCharacterPaint: { value: neutral as THREE.Texture },
  uCharacterPaintReady: { value: 0 },
};
let requested = false;
export function enableCharacterPaint(material: THREE.ShaderMaterial): void {
  material.defines.CHARACTER_PAINT = '';
  Object.assign(material.uniforms, characterPaintUniforms);
  material.needsUpdate = true;
  if (requested || typeof document === 'undefined') return;
  requested = true;
  new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}textures/characters/painted-materials-v1.png`,
    (texture) => {
      texture.colorSpace = THREE.NoColorSpace; // Atlas channels encode pigment variation, not lighting.
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = 4;
      characterPaintUniforms.uCharacterPaint.value = texture;
      characterPaintUniforms.uCharacterPaintReady.value = 1;
    },
    undefined,
    (error) => {
      requested = false;
      console.warn('人物材质贴图未加载，暂用基础绘画材质。', error);
    },
  );
}

export function characterMaterial(slot: string, pigment: number): number {
  if (slot === 'eye' || slot === 'ink' || pigment === color('ink')) return 4;
  if (slot === 'skin' || [color('skinLight'), color('skinWarm'), color('skinDeep')].includes(pigment))
    return 2;
  if (slot === 'hair') return 3;
  if (['bag', 'boots', 'bootTrim', 'belt', 'pouch', 'brown', 'bark'].includes(slot)) return 1;
  return 0;
}
