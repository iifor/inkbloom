// Resident requests: who asks, and how they say it. The program picks kinds, colours and
// amounts; these lines are fallback text until the AI style pass writes its own.
export const RESIDENT_NAMES = [
  '老陈',
  '阿梅',
  '小林',
  '周奶奶',
  '大刘',
  '阿青',
  '吴老师',
  '小满',
  '老许',
  '秦姐',
];

export const REQUEST_LINES = {
  recolor: [
    '我一直想住一栋{color}的房子',
    '能把我家刷成{color}吗？看着就高兴',
    '{color}的墙，我小时候家里就是这样',
  ],
  fetch: [
    '我想自己画点东西，能给我带 {count} 份{color}颜料吗？',
    '帮我找 {count} 份{color}颜料吧，我要补补门框',
  ],
} as const;

export const REQUEST_RULES = {
  /** Requests per block: [min, max]. */
  perBlock: [1, 2],
  /** Chance a request is a recolor rather than a fetch. */
  recolorChance: 0.6,
  fetchCount: [3, 5],
  reward: { generic: 10, ink: 10 },
} as const;
