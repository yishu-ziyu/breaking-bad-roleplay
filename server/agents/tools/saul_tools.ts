import type { SafeToolResult } from './walter_tools'

export type SaulLegalRiskInput = {
  pressure: number
  threat: number
  userText: string
}

export function saul_legal_risk_theater(input: SaulLegalRiskInput): SafeToolResult {
  const normalized = input.userText.toLowerCase()
  const mentionsMoney = /money|cash|pay|deal|lawyer|legal|现金|钱|律师|交易|合同/.test(normalized)
  const risk = input.pressure + input.threat + (mentionsMoney ? 2 : 0)
  const risk_level = risk >= 7 ? 'high' : risk >= 4 ? 'medium' : 'low'

  return {
    tool_name: 'saul_legal_risk_theater',
    summary:
      risk_level === 'high'
        ? 'Saul turns the scene into a liability triage, offering dramatic options without procedural advice.'
        : 'Saul sells reassurance while quietly measuring who becomes responsible if the room catches fire.',
    pressure_delta: mentionsMoney ? 1 : 0,
    suspicion_delta: risk_level === 'high' ? 1 : 0,
    risk_level,
  }
}
