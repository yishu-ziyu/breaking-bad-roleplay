export type WalterLabPressureInput = {
  pressure: number
  suspicion: number
  userText: string
}

export type SafeToolResult = {
  tool_name: string
  summary: string
  pressure_delta: number
  suspicion_delta: number
  risk_level: 'low' | 'medium' | 'high'
}

export function walter_lab_pressure_simulation(input: WalterLabPressureInput): SafeToolResult {
  const normalized = input.userText.toLowerCase()
  const mentionsProcess = /lab|chem|cook|formula|process|blue|实验|化学|配方|流程/.test(normalized)
  const risk = input.pressure + input.suspicion + (mentionsProcess ? 2 : 0)
  const risk_level = risk >= 7 ? 'high' : risk >= 4 ? 'medium' : 'low'

  return {
    tool_name: 'walter_lab_pressure_simulation',
    summary:
      risk_level === 'high'
        ? 'Walter reframes technical curiosity as a control problem and shuts down operational detail.'
        : 'Walter converts the moment into a sterile lesson about discipline, precision, and consequences.',
    pressure_delta: mentionsProcess ? 1 : 0,
    suspicion_delta: mentionsProcess ? 1 : 0,
    risk_level,
  }
}
