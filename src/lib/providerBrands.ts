/* =================================================================
   Provider brand catalog (BYOK) — single source for UI labels
   Mirrors backend /api/connections/catalog fields.
   ================================================================= */

export type ProviderId = 'minimax' | 'stepfun' | 'cliproxy'
export type ConnectionMode = 'platform' | 'byok'
export type ConnectionStatus =
  | 'empty'
  | 'saved'
  | 'valid'
  | 'invalid'
  | 'quota'
  | 'unreachable'

export type CredentialSlot =
  | 'minimax.llm'
  | 'minimax.tts'
  | 'stepfun.llm'
  | 'cliproxy.llm'
  | 'cliproxy.baseUrl'

export type MiniMaxRegion = 'cn' | 'global'

export interface ProviderBrand {
  id: ProviderId
  displayName: string
  productLine: string
  defaultModel: string
  models: string[]
  needsLlmKey: boolean
  needsTtsKey: boolean
  needsBaseUrl: boolean
  regions: MiniMaxRegion[]
  defaultRegion: MiniMaxRegion | null
  keyHintLlm: string
  keyHintTts: string | null
  docsUrl: string
  consoleUrl: string | null
  defaultBaseUrl?: string
}

export const PROVIDER_BRANDS: ProviderBrand[] = [
  {
    id: 'minimax',
    displayName: 'MiniMax',
    productLine: 'M3',
    defaultModel: 'MiniMax-M3',
    models: ['MiniMax-M3'],
    needsLlmKey: true,
    needsTtsKey: true,
    needsBaseUrl: false,
    regions: ['cn', 'global'],
    defaultRegion: 'cn',
    keyHintLlm: 'sk- / sk-cp-',
    keyHintTts: 'Speech API secret',
    docsUrl: 'https://platform.minimaxi.com/',
    consoleUrl: 'https://platform.minimaxi.com/',
  },
  {
    id: 'stepfun',
    displayName: 'StepFun',
    productLine: 'step-2',
    defaultModel: 'step-2-16k',
    models: ['step-2-16k'],
    needsLlmKey: true,
    needsTtsKey: false,
    needsBaseUrl: false,
    regions: [],
    defaultRegion: null,
    keyHintLlm: 'Bearer key',
    keyHintTts: null,
    docsUrl: 'https://platform.stepfun.com/',
    consoleUrl: 'https://platform.stepfun.com/',
  },
  {
    id: 'cliproxy',
    displayName: 'CLIProxy',
    productLine: 'local',
    defaultModel: 'gemini-pro-agent',
    models: ['gemini-pro-agent'],
    needsLlmKey: false,
    needsTtsKey: false,
    needsBaseUrl: true,
    regions: [],
    defaultRegion: null,
    keyHintLlm: 'optional local key',
    keyHintTts: null,
    docsUrl: 'https://github.com',
    consoleUrl: null,
    defaultBaseUrl: 'http://127.0.0.1:8317',
  },
]

export function getProviderBrand(id: ProviderId): ProviderBrand {
  return PROVIDER_BRANDS.find(p => p.id === id) ?? PROVIDER_BRANDS[0]
}

export function formatProviderChip(
  brand: ProviderBrand,
  modelId?: string,
): string {
  const model = modelId || brand.defaultModel
  if (brand.id === 'minimax') return `${brand.displayName} · ${brand.productLine}`
  if (brand.id === 'cliproxy') return `${brand.displayName} · local`
  return `${brand.displayName} · ${model}`
}

export function llmSlotFor(providerId: ProviderId): CredentialSlot {
  if (providerId === 'minimax') return 'minimax.llm'
  if (providerId === 'stepfun') return 'stepfun.llm'
  return 'cliproxy.llm'
}

export function ttsSlotFor(providerId: ProviderId): CredentialSlot | null {
  return providerId === 'minimax' ? 'minimax.tts' : null
}
