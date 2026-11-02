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
    readonly coloredBlocks: number;
    readonly blocks: number;
    readonly gate: Point;
    readonly studio: Point | null;
    readonly stain: Point | null;
    /** Stronghold monsters still standing in the player's block, and the nearest one. */
    readonly guards: number;
    readonly nearestGuard: Point | null;
    readonly holdsWeapon: boolean;
    /** The player's block is 有色 but residents still have wishes. */
    readonly wishes: number;
    readonly nearestWish: Point | null;
  };
}

export interface Objective {
  readonly text: string;
  readonly target: Point | null;
}

export function objective(s: Situation): Objective {
  if (s.drop && s.drop.ink > 0) return { text: `去捡回掉落的 ${s.drop.ink} 墨（红旗处）`, target: s.drop };
  if (s.scene === 'city' && s.city) {
    const c = s.city;
    if (c.completed) return { text: `${c.name}恢复了！走出城门，去找下一座城`, target: c.gate };
    if (c.guards > 0)
      return {
        text: c.holdsWeapon
          ? `这个街区有 ${c.guards} 只墨怪守着：按住左键攻击赶走它们`
          : `这个街区有 ${c.guards} 只墨怪守着：按 2 换武器`,
        target: c.nearestGuard,
      };
    if (c.wishes > 0)
      return {
        text: `这个街区有了颜色，还有 ${c.wishes} 位居民有心愿（门口的彩色牌子）：完成后街区繁荣，画室会产出颜料`,
        target: c.nearestWish,
      };
    if (s.generic < 1) {
      if (s.ink >= s.inkPerGeneric && c.studio)
        return { text: '去画室把墨提炼成通用颜料（找橙色招牌，按 E）', target: c.studio };
      if (c.stain) return { text: '颜料用完了：走过路上的墨渍吸墨，再去画室提炼', target: c.stain };
      return { text: '颜料用完了：回野外采颜料', target: c.gate };
    }
    return {
      text: `把街区涂回颜色（按住左键）：有色街区 ${c.coloredBlocks} / ${c.blocks}，每个街区要 70%`,
      target: null,
    };
  }
  if (!s.visitedCity && s.nextCity)
    return { text: `去远处的塔楼：那是${s.nextCity.name}的入口，按 E 进城`, target: s.nextCity };
  if (s.generic < 1 && s.ink < s.inkPerGeneric)
    return { text: '采颜料：花田、浆果丛、矿脉、芦苇丛，走近按 E', target: null };
  if (s.nextCity)
    return {
      text: s.restoredCities > 0 ? `下一座城：${s.nextCity.name}` : `回${s.nextCity.name}，把颜色还回去`,
      target: s.nextCity,
    };
  return { text: '四处走走，找下一座塔楼', target: null };
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
