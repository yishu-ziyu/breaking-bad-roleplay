/* =================================================================
   Provider brand catalog (BYOK) — single source for UI labels
   Mirrors backend /api/connections/catalog + agents/byok_presets.py
   ================================================================= */

export type ProviderId =
  | 'minimax'
  | 'stepfun'
  | 'deepseek'
  | 'openai'
  | 'gemini'
  | 'moonshot'
  | 'qwen'
  | 'zhipu'
  | 'openrouter'
  | 'siliconflow'
  | 'custom'

export type ConnectionMode = 'platform' | 'byok'
export type ConnectionStatus =
  | 'empty'
  | 'saved'
  | 'valid'
  | 'invalid'
  | 'quota'
  | 'unreachable'

/** Vault slot key: `${providerId}.llm` or `${providerId}.tts` or custom base. */
export type CredentialSlot = string

export type MiniMaxRegion = 'cn' | 'global'

export type ProviderGroup = 'platform' | 'official' | 'china' | 'aggregator' | 'custom'
export type ProviderKind = 'openai' | 'anthropic'

export interface ProviderBrand {
  id: ProviderId
  displayName: string
  productLine: string
  group: ProviderGroup
  groupLabel: string
  kind: ProviderKind
  defaultModel: string
  models: string[]
  needsLlmKey: boolean
  needsTtsKey: boolean
  needsBaseUrl: boolean
  regions: MiniMaxRegion[]
  defaultRegion: MiniMaxRegion | null
  defaultBaseUrl?: string
  keyHintLlm: string
  keyHintTts: string | null
  docsUrl: string
  consoleUrl: string | null
  platformDemo?: boolean
}

export const PROVIDER_BRANDS: ProviderBrand[] = [
  {
    id: 'minimax',
    displayName: 'MiniMax',
    productLine: 'M3',
    group: 'platform',
    groupLabel: '平台同款',
    kind: 'anthropic',
    defaultModel: 'MiniMax-M3',
    models: ['MiniMax-M3', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.5'],
    needsLlmKey: true,
    needsTtsKey: true,
    needsBaseUrl: false,
    regions: ['cn', 'global'],
    defaultRegion: 'cn',
    defaultBaseUrl: 'https://api.minimaxi.com/anthropic/v1',
    keyHintLlm: 'sk- / sk-cp-',
    keyHintTts: 'Speech API secret',
    docsUrl: 'https://platform.minimaxi.com/',
    consoleUrl: 'https://platform.minimaxi.com/',
    platformDemo: true,
  },
  {
    id: 'stepfun',
    displayName: 'StepFun',
    productLine: '3.7 Flash',
    group: 'platform',
    groupLabel: '平台同款',
    kind: 'openai',
    defaultModel: 'step-3.7-flash',
    models: ['step-3.7-flash', 'step-3.5-flash', 'step-3.5-flash-2603'],
    needsLlmKey: true,
    needsTtsKey: false,
    needsBaseUrl: false,
    regions: [],
    defaultRegion: null,
    defaultBaseUrl: 'https://api.stepfun.com/v1',
    keyHintLlm: 'Bearer key',
    keyHintTts: null,
    docsUrl: 'https://platform.stepfun.com/',
    consoleUrl: 'https://platform.stepfun.com/',
    platformDemo: true,
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    productLine: 'V4 Flash',
    group: 'official',
    groupLabel: '官方直连',
    kind: 'openai',
    defaultModel: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat'],
    needsLlmKey: true,
    needsTtsKey: false,
    needsBaseUrl: false,
    regions: [],
    defaultRegion: null,
    defaultBaseUrl: 'https://api.deepseek.com',
    keyHintLlm: 'sk-...',
    keyHintTts: null,
    docsUrl: 'https://api-docs.deepseek.com',
    consoleUrl: 'https://platform.deepseek.com',
  },
  {
    id: 'openai',
    displayName: 'OpenAI',
    productLine: 'GPT',
    group: 'official',
    groupLabel: '官方直连',
    kind: 'openai',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4.1'],
    needsLlmKey: true,
    needsTtsKey: false,
    needsBaseUrl: false,
    regions: [],
    defaultRegion: null,
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyHintLlm: 'sk-...',
    keyHintTts: null,
    docsUrl: 'https://platform.openai.com/api-keys',
    consoleUrl: 'https://platform.openai.com',
  },
  {
    id: 'gemini',
    displayName: 'Google Gemini',
    productLine: 'Flash',
    group: 'official',
    groupLabel: '官方直连',
    kind: 'openai',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
    needsLlmKey: true,
    needsTtsKey: false,
    needsBaseUrl: false,
    regions: [],
    defaultRegion: null,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyHintLlm: 'AIza...',
    keyHintTts: null,
    docsUrl: 'https://ai.google.dev/gemini-api/docs/openai',
    consoleUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'moonshot',
    displayName: 'Kimi',
    productLine: 'K2',
    group: 'china',
    groupLabel: '国内官方',
    kind: 'openai',
    defaultModel: 'kimi-k2.5',
    models: ['kimi-k2.5', 'kimi-k2-turbo-preview', 'kimi-k2-thinking'],
    needsLlmKey: true,
    needsTtsKey: false,
    needsBaseUrl: false,
    regions: [],
    defaultRegion: null,
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    keyHintLlm: 'sk-...',
    keyHintTts: null,
    docsUrl: 'https://platform.moonshot.cn',
    consoleUrl: 'https://platform.moonshot.cn',
  },
  {
    id: 'qwen',
    displayName: '通义千问',
    productLine: 'Qwen',
    group: 'china',
    groupLabel: '国内官方',
    kind: 'openai',
    defaultModel: 'qwen-plus',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-long'],
    needsLlmKey: true,
    needsTtsKey: false,
    needsBaseUrl: false,
    regions: [],
    defaultRegion: null,
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keyHintLlm: 'sk-...',
    keyHintTts: null,
    docsUrl: 'https://help.aliyun.com/zh/model-studio',
    consoleUrl: 'https://dashscope.console.aliyun.com',
  },
  {
    id: 'zhipu',
    displayName: '智谱 GLM',
    productLine: 'GLM-4',
    group: 'china',
    groupLabel: '国内官方',
    kind: 'openai',
    defaultModel: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus', 'glm-4'],
    needsLlmKey: true,
    needsTtsKey: false,
    needsBaseUrl: false,
    regions: [],
    defaultRegion: null,
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    keyHintLlm: '...',
    keyHintTts: null,
    docsUrl: 'https://open.bigmodel.cn',
    consoleUrl: 'https://open.bigmodel.cn',
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    productLine: 'Multi',
    group: 'aggregator',
    groupLabel: '聚合',
    kind: 'openai',
    defaultModel: 'openai/gpt-4o-mini',
    models: [
      'openai/gpt-4o-mini',
      'google/gemini-2.0-flash-001',
      'deepseek/deepseek-chat',
      'anthropic/claude-3.5-haiku',
      'moonshotai/kimi-k2-0905',
    ],
    needsLlmKey: true,
    needsTtsKey: false,
    needsBaseUrl: false,
    regions: [],
    defaultRegion: null,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyHintLlm: 'sk-or-...',
    keyHintTts: null,
    docsUrl: 'https://openrouter.ai/docs/quickstart',
    consoleUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'siliconflow',
    displayName: '硅基流动',
    productLine: 'SiliconFlow',
    group: 'aggregator',
    groupLabel: '聚合',
    kind: 'openai',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    models: [
      'deepseek-ai/DeepSeek-V3',
      'Qwen/Qwen2.5-72B-Instruct',
      'moonshotai/Kimi-K2-Instruct',
    ],
    needsLlmKey: true,
    needsTtsKey: false,
    needsBaseUrl: false,
    regions: [],
    defaultRegion: null,
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    keyHintLlm: 'sk-...',
    keyHintTts: null,
    docsUrl: 'https://docs.siliconflow.cn',
    consoleUrl: 'https://cloud.siliconflow.cn',
  },
  {
    id: 'custom',
    displayName: '自定义',
    productLine: 'OpenAI 兼容',
    group: 'custom',
    groupLabel: '自定义',
    kind: 'openai',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'deepseek-chat', 'step-3.7-flash'],
    needsLlmKey: true,
    needsTtsKey: false,
    needsBaseUrl: true,
    regions: [],
    defaultRegion: null,
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyHintLlm: 'Bearer key',
    keyHintTts: null,
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    consoleUrl: null,
  },
]

export const PLATFORM_PROVIDER_IDS: ProviderId[] = ['minimax', 'stepfun']

export function getProviderBrand(id: string): ProviderBrand {
  return PROVIDER_BRANDS.find(p => p.id === id) ?? PROVIDER_BRANDS[0]
}

export function isProviderId(id: string): id is ProviderId {
  return PROVIDER_BRANDS.some(p => p.id === id)
}

export function formatProviderChip(
  brand: ProviderBrand,
  modelId?: string,
): string {
  const model = modelId || brand.defaultModel
  if (brand.id === 'minimax') return `${brand.displayName} · ${brand.productLine}`
  return `${brand.displayName} · ${model}`
}

export function llmSlotFor(providerId: string): CredentialSlot {
  return `${providerId}.llm`
}

export function ttsSlotFor(providerId: string): CredentialSlot | null {
  return providerId === 'minimax' ? 'minimax.tts' : null
}

export function baseUrlSlotFor(providerId: string): CredentialSlot | null {
  return providerId === 'custom' ? 'custom.baseUrl' : null
}

export function brandsForMode(mode: ConnectionMode): ProviderBrand[] {
  if (mode === 'platform') {
    return PROVIDER_BRANDS.filter(b => b.platformDemo)
  }
  return PROVIDER_BRANDS
}

export function groupBrands(brands: ProviderBrand[]): Array<{
  group: ProviderGroup
  groupLabel: string
  brands: ProviderBrand[]
}> {
  const order: ProviderGroup[] = ['platform', 'official', 'china', 'aggregator', 'custom']
  return order
    .map(group => {
      const items = brands.filter(b => b.group === group)
      return {
        group,
        groupLabel: items[0]?.groupLabel || group,
        brands: items,
      }
    })
    .filter(g => g.brands.length > 0)
}
