import { color, type ColorKey } from '@/content/palette';
import { hashAt } from '@/world/math/hash';

// Lining stays distinct from the main garment, including on the two-tone hoods.
const outfits: readonly (readonly [ColorKey, ColorKey])[] = [
  ['teal', 'cream'],
  ['red', 'charcoal'],
  ['blue', 'sand'],
  ['green', 'bark'],
  ['purple', 'sand'],
  ['orange', 'charcoal'],
  ['sky', 'blue'],
  ['pink', 'purple'],
  ['cream', 'teal'],
  ['charcoal', 'red'],
  ['yellow', 'glass'],
  ['brown', 'green'],
];
const hairColors = ['charcoal', 'bark', 'brown', 'sand', 'stone', 'cream'] as const;

// Index 0 keeps the original pigment. The other indices match the exported _INKDYE.
export function residentDyes(seed: number): readonly number[] {
  const [cloth, trim] = outfits[hashAt(seed, 'resident-outfit') % outfits.length]!;
  const hair = hairColors[hashAt(seed, 'resident-hair') % hairColors.length]!;
  return [0, color(cloth), color(trim), color(hair)];
}

// KayKit ships separate head, body and equipment meshes plus the original atlas tile IDs.
export function kaykitDyeRole(mesh: string, tile: number): number {
  if (/_Head(?:_Hooded)?$/.test(mesh)) {
    if (tile === 1) return 3;
    return mesh.endsWith('_Hooded') && tile === 9 ? 2 : 0;
  }
  if (mesh.endsWith('_Cape')) return 2;
  if (mesh === 'Mage_Hat' && tile === 9) return 2;
  if (!/_(?:Body|ArmLeft|ArmRight)$/.test(mesh)) return 0;
  return tile === 8 ? 1 : tile === 9 ? 2 : 0;
}
