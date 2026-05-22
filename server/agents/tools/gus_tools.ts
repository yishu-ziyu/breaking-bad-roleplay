import type { SafeToolResult } from './walter_tools'

export type GusComplianceInput = {
  trust: number
  pressure: number
  threat: number
  userText: string
}

export function gus_compliance_evaluation(input: GusComplianceInput): SafeToolResult {
  const normalized = input.userText.toLowerCase()
  const challengesOrder = /why|no|can't|refuse|trust|loyal|为什么|不行|拒绝|信任|忠诚/.test(normalized)
  const risk = input.pressure + input.threat - input.trust + (challengesOrder ? 2 : 0)
  const risk_level = risk >= 7 ? 'high' : risk >= 4 ? 'medium' : 'low'

  return {
    tool_name: 'gus_compliance_evaluation',
    summary:
      risk_level === 'high'
        ? 'Gus treats the answer as a compliance failure and narrows the room with formal courtesy.'
        : 'Gus evaluates discipline and usefulness through calm hospitality rather than open confrontation.',
    pressure_delta: challengesOrder ? 1 : 0,
    suspicion_delta: challengesOrder ? 1 : 0,
    risk_level,
  }
}
