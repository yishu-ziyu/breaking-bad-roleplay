import type { SafeToolResult } from './walter_tools'

export type MikePerimeterInput = {
  pressure: number
  threat: number
  userText: string
}

export function mike_perimeter_read(input: MikePerimeterInput): SafeToolResult {
  const normalized = input.userText.toLowerCase()
  const mentionsDanger = /danger|threat|cartel|gun|follow|watch|危险|威胁|盯|跟踪|枪|卡特尔/.test(normalized)
  const risk = input.pressure + input.threat + (mentionsDanger ? 2 : 0)
  const risk_level = risk >= 7 ? 'high' : risk >= 4 ? 'medium' : 'low'

  return {
    tool_name: 'mike_perimeter_read',
    summary:
      risk_level === 'high'
        ? 'Mike reads the room as unstable and cuts the conversation down to consequences and exits.'
        : 'Mike gives a restrained situational read, keeping the focus on judgment rather than tactics.',
    pressure_delta: mentionsDanger ? 1 : 0,
    suspicion_delta: 0,
    risk_level,
  }
}
