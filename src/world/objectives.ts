// "What should I do now?" as a pure function of the situation. The objectives system gathers
// the facts each tick; this decides the text and what to point at. Edit the wording or the
// order of the rules here.

export interface Point {
  readonly x: number;
  readonly z: number;
}

export interface Situation {
  readonly scene: 'wild' | 'city';
  readonly generic: number;
  readonly ink: number;
  /** Ink needed for one generic pigment at a studio. */
  readonly inkPerGeneric: number;
  /** Any city entered before. */
  readonly visitedCity: boolean;
  readonly restoredCities: number;
  /** Ink dropped on death in this scene, if any. */
  readonly drop: (Point & { readonly ink: number }) | null;
  /** Nearest entrance of a city that is not restored yet, in the wilderness. */
  readonly nextCity: (Point & { readonly name: string }) | null;
  /** Inside a city: */
  readonly city?: {
    readonly name: string;
    readonly completed: boolean;
    readonly peaceful?: boolean;
    readonly coloredBlocks: number;
    readonly blocks: number;
    readonly gate: Point;
    readonly studio: Point | null;
    readonly stain: Point | null;
    /** Stronghold monsters still standing in the player's block, and the nearest one. */
    readonly guards: number;
    readonly nearestGuard: Point | null;
    readonly holdsWeapon: boolean;
  };
}

export interface Objective {
  /** What to do, in a few words. */
  readonly text: string;
  readonly target: Point | null;
  /** How to do it, for the first time or two only (the HUD keeps count; see shell/hints.ts). */
  readonly teach?: { readonly id: string; readonly text: string };
}

export function objective(s: Situation): Objective {
  if (s.drop && s.drop.ink > 0) return { text: `捡回掉落的 ${s.drop.ink} 墨`, target: s.drop };
  if (s.scene === 'city' && s.city) {
    const c = s.city;
    if (c.completed) return { text: `${c.name}恢复了 · 去找下一座城`, target: c.gate };
    if (c.guards > 0)
      return {
        text: `赶走这个街区的 ${c.guards} 只墨怪`,
        target: c.nearestGuard,
        teach: c.holdsWeapon
          ? { id: 'attack', text: '按住左键攻击' }
          : { id: 'draw-weapon', text: '按 2 拿武器' },
      };
    if (c.peaceful) return { text: `${c.name}安然无恙 · 出村探索`, target: c.gate };
    if (s.generic < 1) {
      if (s.ink >= s.inkPerGeneric && c.studio)
        return { text: '去画室提炼颜料', target: c.studio, teach: { id: 'studio', text: '橙色招牌，按 E' } };
      if (c.stain)
        return {
          text: '颜料用完了 · 去吸路上的墨渍',
          target: c.stain,
          teach: { id: 'stains', text: '走过墨渍就能吸墨，再去画室提炼' },
        };
      return { text: '颜料用完了 · 回野外采', target: c.gate };
    }
    return {
      text: `涂回颜色 · 有色街区 ${c.coloredBlocks}/${c.blocks}`,
      target: null,
      teach: { id: 'paint', text: '按住左键；每个街区要 70%' },
    };
  }
  if (!s.visitedCity && s.nextCity)
    return {
      text: `走进${s.nextCity.name}`,
      target: s.nextCity,
      teach: { id: 'enter-city', text: '跟着箭头走到城门，直接走进去' },
    };
  if (s.generic < 1 && s.ink < s.inkPerGeneric)
    return {
      text: '去野外采颜料',
      target: null,
      teach: { id: 'harvest', text: '花田、浆果丛、矿脉、芦苇丛，走近按 E' },
    };
  if (s.nextCity)
    return {
      text: s.restoredCities > 0 ? `下一座城：${s.nextCity.name}` : `回${s.nextCity.name}，把颜色还回去`,
      target: s.nextCity,
    };
  return { text: '沿路走走，找下一座城', target: null };
}

const ARROWS = ['↑', '↖', '←', '↙', '↓', '↘', '→', '↗'] as const;

/**
 * Arrow and distance from the player to a target, relative to where the player faces. Yaw
 * follows the camera: 0 looks towards -z, positive turns left.
 */
export function bearing(from: Point, yaw: number, to: Point): { arrow: string; metres: number } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const toward = Math.atan2(-dx, -dz);
  let rel = toward - yaw;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  const sector = ((Math.round(rel / (Math.PI / 4)) % 8) + 8) % 8;
  return { arrow: ARROWS[sector]!, metres: Math.round(Math.hypot(dx, dz)) };
}
