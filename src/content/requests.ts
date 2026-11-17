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
  '阿福',
  '小雨',
  '何师傅',
  '豆豆',
  '方婶',
  '老杨',
  '阿柚',
  '石头',
  '宋先生',
  '小枣',
];

export const REQUEST_LINES = {
  recolor: [
    '我一直想住一栋{color}的房子',
    '能把我家刷成{color}吗？看着就高兴',
    '{color}的墙，我小时候家里就是这样',
    '墨潮来之前，这房子是{color}的，你还记得吗？',
    '我老伴最喜欢{color}，刷上吧，让她回来认得路',
    '整条街就我家灰着，刷成{color}，邻居该羡慕了',
    '孩子画画总把我们家涂成{color}，就照他画的来',
    '傍晚太阳一照，{color}的墙最好看',
  ],
  fetch: [
    '我想自己画点东西，能给我带 {count} 份{color}颜料吗？',
    '帮我找 {count} 份{color}颜料吧，我要补补门框',
    '窗台上的花盆褪色了，{count} 份{color}颜料就够',
    '我想给孙女的风筝上色，带 {count} 份{color}颜料来好吗？',
    '店招被墨吃掉了，得用 {count} 份{color}颜料重写',
    '码头的船该上新漆了，{count} 份{color}颜料，拜托',
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
