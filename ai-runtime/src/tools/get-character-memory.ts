export function getCharacterMemory(memory: unknown): string {
  if (memory == null) return "No advisory character memory for this turn."
  return JSON.stringify(memory, null, 2)
}

export function characterMemoryTool(memory: unknown) {
  return {
    name: "get_character_memory" as const,
    description: "Read advisory character memory. Cannot change trust, risk, or debts.",
    parameters: { type: "object", properties: {} },
    execute: async () => ({
      content: [{ type: "text" as const, text: getCharacterMemory(memory) }],
      details: { readonly: true, advisory: true },
    }),
  }
}
