// Growth: experience, levels, milestone attribute points and what each attribute does.
// design: docs/game-design.md section 9. Amounts are first guesses for playtesting.

/** Experience per action. */
export const XP = {
  surface: 1,
  blockColored: 60,
  tideHeld: 40,
  cityRestored: 150,
  ruinFound: 25,
  request: 40,
  monster: 4,
} as const;

/** Total experience needed to reach each level; index 0 is level 1. design: levels 1–10 */
export const LEVEL_XP = [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500] as const;
export const MAX_LEVEL = LEVEL_XP.length;

/** What every level above 1 adds on its own. */
export const PER_LEVEL = { health: 6, weapon: 3 } as const;

export type Attribute = 'health' | 'weapon' | 'skill' | 'armor';

export interface AttributeDef {
  readonly key: Attribute;
  readonly name: string;
  readonly per: number;
  readonly help: string;
}

/** What one attribute point buys. Strengths start at 100 (percent). */
export const ATTRIBUTES: readonly AttributeDef[] = [
  { key: 'health', name: '生命', per: 8, help: '生命上限' },
  { key: 'weapon', name: '武器强度', per: 5, help: '武器伤害（%）' },
  { key: 'skill', name: '技能强度', per: 5, help: '笔刷速度、推墨潮、武器技能（%）' },
  { key: 'armor', name: '防护', per: 6, help: '减伤：防护 /（生命 + 防护）' },
];

/** Attribute points for milestones. design: section 9 */
export const MILESTONES = {
  firstBlockColored: 1,
  /** Per city, at this many blocks coloured (the 5th, 10th, ...). */
  cityBlocks: [5, 10, 15, 20],
  cityBlocksPoint: 1,
  firstTideHeld: 1,
  allColors: 2,
  cityRestored: 3,
} as const;
