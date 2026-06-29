/**
 * Scene Background Routing (P0-B)
 *
 * 根据最近 N 条对话消息的关键词，把当前聊天页切到对应的 SVG 场景。
 * 完全自绘 SVG = 零版权风险；用户自定义关系锚点 + 剧情节奏 → 场景感知。
 */

export type SceneId =
  | 'blue-desert-rv'
  | 'abq-sunset'
  | 'lab-rv'
  | 'saul-neon'
  | 'los-pollos'
  | 'dea-office'
  | 'rv-interior'
  | 'skyler-living'

export interface SceneRoute {
  id: SceneId
  url: string
  label: { en: string; zh: string }
  /** 中英文关键词统一小写匹配 */
  keywords: string[]
  /** 关键词权重，越高越优先匹配 */
  weight: number
}

export const SCENES: SceneRoute[] = [
  {
    id: 'blue-desert-rv',
    url: '/backgrounds/blue-desert-rv.jpg',
    label: { en: 'Blue Desert RV', zh: '蓝调荒漠房车' },
    keywords: [
      'walter', 'jesse', 'heisenberg', 'breaking bad', '房车', 'rv',
      '沙漠', 'desert', 'abq', 'albuquerque', '荒漠', '新墨西哥',
      'new mexico', 'blue', '蓝色', '蓝调',
    ],
    weight: 1,
  },
  {
    id: 'abq-sunset',
    url: '/backgrounds/abq-sunset.svg',
    label: { en: 'ABQ Desert', zh: 'ABQ 沙漠' },
    keywords: [
      '沙漠', 'desert', 'abq', 'albuquerque', '新墨西哥', 'new mexico',
      'border', 'border patrol', 'sunset', '落日', 'cactus', '仙人掌',
      'highway', '公路',
    ],
    weight: 1,
  },
  {
    id: 'lab-rv',
    url: '/backgrounds/lab-rv.svg',
    label: { en: 'RV Lab', zh: '房车实验室' },
    keywords: [
      '煎锅', 'cook', 'cooking', 'cook batch', '实验室', 'lab', 'meth',
      'chemistry', '化学', 'experiment', '实验', 'formula', '配方',
      'precursor', '前体', 'fume hood', '通风柜', '蒸馏', 'distill',
      'reaction', '反应', 'beaker', '烧瓶',
    ],
    weight: 2,
  },
  {
    id: 'rv-interior',
    url: '/backgrounds/rv-interior.svg',
    label: { en: 'RV at Night', zh: '夜行房车' },
    keywords: [
      '房车', 'rv', 'camper', 'travel', 'windshield', '挡风玻璃',
      'dashboard', '仪表盘', 'steering', '方向盘', 'bunk', '上铺',
    ],
    weight: 1,
  },
  {
    id: 'saul-neon',
    url: '/backgrounds/saul-neon.svg',
    label: { en: "Saul's Office", zh: 'Saul 律所' },
    keywords: [
      'saul', 'goodman', '律师', 'lawyer', 'legal', 'attorney', 'office',
      '办公室', 'better call', '合同', 'contract', 'lawyer office',
      'neon', '霓虹', '诉讼', 'lawsuit',
    ],
    weight: 2,
  },
  {
    id: 'los-pollos',
    url: '/backgrounds/los-pollos.svg',
    label: { en: 'Los Pollos', zh: '炸鸡店' },
    keywords: [
      'los pollos', 'hermanos', '炸鸡', 'chicken', 'restaurant', '餐厅',
      'fryer', '炸炉', 'kitchen', '厨房', '快餐', 'fast food',
    ],
    weight: 2,
  },
  {
    id: 'dea-office',
    url: '/backgrounds/dea-office.svg',
    label: { en: 'DEA Office', zh: 'DEA 办公室' },
    keywords: [
      'dea', '执法', 'enforcement', 'agent', 'hank', 'schrader',
      'police', '警', 'fbi', 'investigation', '调查', '嫌疑', 'suspect',
      'bust', '突击', 'raid', 'badge', '徽章', 'case', '案件',
      'monitor', '监控',
    ],
    weight: 2,
  },
  {
    id: 'skyler-living',
    url: '/backgrounds/skyler-living.svg',
    label: { en: 'White Home', zh: 'White 家' },
    keywords: [
      'skyler', 'white', '家', 'home', '客厅', 'living room', 'house',
      '房子', 'suburb', '郊区', 'couch', '沙发', 'kitchen', '厨房',
      'domestic', '家庭', 'family', '家人', 'wedding', '婚礼', 'toddler',
      'holly', '婴儿', 'baby',
    ],
    weight: 1,
  },
]

export const DEFAULT_SCENE: SceneRoute = SCENES[0] // blue-desert-rv

/**
 * 在最近 N 条消息中按权重打分选出最匹配的 scene。
 * 没有命中任何关键词时返回默认 ABQ 沙漠。
 */
export function pickScene(recentMessages: string[]): SceneRoute {
  if (!recentMessages.length) return DEFAULT_SCENE
  const combined = recentMessages.join(' ').toLowerCase()
  let best: { scene: SceneRoute; score: number } = { scene: DEFAULT_SCENE, score: 0 }
  for (const scene of SCENES) {
    let score = 0
    for (const keyword of scene.keywords) {
      if (combined.includes(keyword.toLowerCase())) {
        score += scene.weight
      }
    }
    if (score > best.score) {
      best = { scene, score }
    }
  }
  return best.scene
}

/**
 * 把对话消息中检测到的 scene 转换成切换 URL。
 * 给 React 用：返回字符串 URL 直接给 background-image 用。
 */
export function pickSceneUrl(recentMessages: string[]): string {
  return pickScene(recentMessages).url
}
