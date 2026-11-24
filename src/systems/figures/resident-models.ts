import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  loadVillager,
  VILLAGER_MODELS,
  VILLAGER_MOTIONS,
  VILLAGER_ROLES,
  type VillagerModel,
  type ResidentMotions,
} from './kaykit-villager';

import {
  animatedCharacters as animated,
  rpgCharacters as rpg,
  PACK_CHARACTERS,
  type PackCharacterKey,
} from '@/content/quaternius-characters';

import { FRONTIER_CHARACTERS } from '@/content/crew-characters';
import { PLAYER_PACK_NAMES } from '@/content/characters';
import { hashAt } from '@/world/math/hash';

type FrontierModel = (typeof FRONTIER_CHARACTERS)[number]['key'];
const frontier = new Map<string, string>(FRONTIER_CHARACTERS.map((c) => [c.key, c.name]));
const kaykitNames: Record<VillagerModel, string> = {
  rogue: '轻装村民',
  'rogue-hooded': '兜帽村民',
  knight: '守卫',
  barbarian: '伐木工',
  mage: '法师',
};
export type ResidentModel = VillagerModel | PackCharacterKey | FrontierModel;
export const RESIDENT_MODELS: readonly ResidentModel[] = [
  ...VILLAGER_MODELS,
  ...PACK_CHARACTERS.map((c) => c.key),
  ...FRONTIER_CHARACTERS.map((c) => c.key),
];
export function residentInfo(key: ResidentModel) {
  if (isKayKit(key))
    return { name: kaykitNames[key], collection: 'KayKit 村民', profession: VILLAGER_ROLES[key].profession };
  const [pack, name] = key.split('/') as [string, string];
  const travellerName = frontier.get(key);
  if (travellerName)
    return {
      name: travellerName,
      collection: PLAYER_PACK_NAMES[pack as 'cube' | 'cyber' | 'platformer'],
      profession: null,
    };
  const profession = /Soldier|Knight|Warrior|Ranger/.test(name)
    ? 'guard'
    : /Witch|Wizard|Cleric/.test(name)
      ? 'mage'
      : /Worker|Viking/.test(name)
        ? 'woodcutter'
        : null;
  return pack === 'animated'
    ? ({
        name: animated[name as keyof typeof animated],
        collection: 'Quaternius · 动画角色',
        profession,
      } as const)
    : ({ name: rpg[name as keyof typeof rpg], collection: 'Quaternius · RPG 角色', profession } as const);
}
export function isKayKit(key: ResidentModel): key is VillagerModel {
  return !key.includes('/');
}

// Keep each established resident's occupation and routine for the same world seed.
const families = VILLAGER_MODELS.map((key) =>
  RESIDENT_MODELS.filter(
    (candidate) =>
      !frontier.has(candidate) && residentInfo(candidate).profession === VILLAGER_ROLES[key].profession,
  ),
);
export function modelForResident(seed: number): ResidentModel {
  const family = seed % families.length;
  // Add occasional travellers to civilian homes without reshuffling the established pool.
  if (
    VILLAGER_ROLES[VILLAGER_MODELS[family]!].profession === null &&
    hashAt(seed, 'frontier-resident') % 6 === 0
  ) {
    return FRONTIER_CHARACTERS[hashAt(seed, 'frontier-outfit-model') % FRONTIER_CHARACTERS.length]!.key;
  }
  const choices = families[family]!;
  return choices[Math.floor(seed / families.length) % choices.length]!;
}

const nativeLabels = {
  Death: '倒地',
  Defeat: '落败',
  Hit_React: '受击',
  Jump_Start: '起跳',
  Jump_End: '落地',
  Punch: '出拳',
  Roll: '翻滚',
  Run_Carry: '搬运奔跑',
  Walk_Carry: '搬运行走',
  Sit_Down: '坐下',
  Stand_Up: '起身',
  Idle_Weapon: '持械待机',
  Idle_Attacking: '戒备',
  Attacking_Idle: '戒备',
  RecieveHit: '受击',
  RecieveHit_2: '受击变化',
  RecieveHit_Attacking: '攻击中受击',
  Attack2: '连击',
  Bow_Draw: '拉弓',
  Run_Holding: '持弓奔跑',
  Dagger_Attack2: '匕首连击',
  Run_Weapon: '持械奔跑',
  Sword_Attack2: '挥剑连击',
  Spell2: '第二法术',
} as const;
function nativeMotions(names: readonly (keyof typeof nativeLabels)[]) {
  return Object.fromEntries(names.map((clip) => [`native-${clip}`, { clip, label: nativeLabels[clip] }]));
}
const sharedMotions = {
  idle: { clip: 'Idle', label: '待机' },
  walk: { clip: 'Walk', label: '行走' },
  run: { clip: 'Run', label: '奔跑' },
  jump: { clip: 'Jump_Loop', label: '腾空' },
  interact: { clip: 'Pickup', label: '拾取' },
  slash: { clip: 'Sword_Slash', label: '挥动' },
  shoot: { clip: 'Shoot_1_Hand', label: '瞄准动作' },
  cheer: { clip: 'Victory', label: '欢呼' },
  ...nativeMotions([
    'Death',
    'Defeat',
    'Hit_React',
    'Jump_Start',
    'Jump_End',
    'Punch',
    'Roll',
    'Run_Carry',
    'Sit_Down',
    'Stand_Up',
    'Walk_Carry',
  ]),
};
const rpgAttacks = {
  Cleric: 'Staff_Attack',
  Monk: 'Attack',
  Ranger: 'Punch',
  Rogue: 'Dagger_Attack',
  Warrior: 'Sword_Attack',
  Wizard: 'Staff_Attack',
};
const rpgExtraMotions = {
  Cleric: ['Death', 'Idle_Weapon', 'Punch', 'RecieveHit', 'RecieveHit_Attacking'],
  Monk: ['Attack2', 'Death', 'Idle_Attacking', 'RecieveHit', 'RecieveHit_2', 'Roll'],
  Ranger: [
    'Bow_Draw',
    'Death',
    'Idle_Attacking',
    'Idle_Weapon',
    'RecieveHit',
    'RecieveHit_2',
    'Roll',
    'Run_Holding',
  ],
  Rogue: ['Attacking_Idle', 'Dagger_Attack2', 'Death', 'Punch', 'RecieveHit', 'RecieveHit_2', 'Roll'],
  Warrior: [
    'Death',
    'Idle_Attacking',
    'Idle_Weapon',
    'Punch',
    'RecieveHit',
    'Roll',
    'Run_Weapon',
    'Sword_Attack2',
  ],
  Wizard: [
    'Death',
    'Idle_Attacking',
    'Idle_Weapon',
    'Punch',
    'RecieveHit',
    'RecieveHit_2',
    'Roll',
    'Run_Weapon',
    'Spell2',
  ],
} as const;
export function residentMotions(key: ResidentModel): ResidentMotions {
  if (isKayKit(key)) return VILLAGER_MOTIONS;
  if (frontier.has(key))
    return {
      idle: sharedMotions.idle,
      walk: sharedMotions.walk,
      interact: { clip: 'Wave', label: '招呼' },
      slash: { clip: 'Punch', label: '出拳' },
    };
  if (key.startsWith('animated/')) return sharedMotions;
  const name = key.slice(4) as keyof typeof rpg;
  const ranged =
    name === 'Ranger'
      ? { clip: 'Bow_Shoot', label: '射箭' }
      : name === 'Wizard' || name === 'Cleric'
        ? { clip: 'Spell1', label: '施法' }
        : null;
  return {
    idle: sharedMotions.idle,
    walk: sharedMotions.walk,
    run: sharedMotions.run,
    interact: { clip: 'PickUp', label: '拾取' },
    slash: { clip: rpgAttacks[name], label: '出招' },
    ...(ranged ? { shoot: ranged } : {}),
    ...nativeMotions(rpgExtraMotions[name]),
  };
}
const pending = new Map<ResidentModel, Promise<GLTF>>();
function packedFile(key: ResidentModel): Promise<GLTF> {
  let request = pending.get(key);
  if (!request) {
    request = new GLTFLoader()
      .loadAsync(`${import.meta.env.BASE_URL}models/quaternius/${key}.glb`)
      .catch((error) => {
        pending.delete(key);
        throw error;
      });
    pending.set(key, request);
  }
  return request;
}
export async function loadResident(key: ResidentModel): Promise<GLTF> {
  if (isKayKit(key)) return loadVillager(key);
  if (!key.startsWith('animated/') || key === 'animated/BaseCharacter') return packedFile(key);
  const [model, shared] = await Promise.all([packedFile(key), packedFile('animated/BaseCharacter')]);
  return { ...model, animations: shared.animations };
}
