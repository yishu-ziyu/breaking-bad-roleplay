/** Wire contract shared by the live hook and retry tests. */
export function boundedStoryDirection(
  instruction: string,
  context: string,
  maxLength = 1900,
): string {
  const head = instruction.trim().slice(0, maxLength)
  if (!context.trim() || head.length >= maxLength) return head
  const separator = '\n\n'
  const room = maxLength - head.length - separator.length
  if (room <= 0) return head
  // Recent consequences matter more than the oldest transcript fragment.
  const tail = context.trim().slice(-room)
  return `${head}${separator}${tail}`
}

export function buildStoryCommand(
  action: string,
  params: {
    player_input?: string
    player_kind?: 'say' | 'do' | 'observe' | 'free'
    redirect_prompt?: string
    target_character?: string
    from_beat_id?: string
    branch_goal?: string
    beat_id?: string
  },
  options: { runtimeVersion: number; revision: number; commandId: string },
): Record<string, unknown> {
  if (options.runtimeVersion === 0 && action === 'act') {
    return { action: 'redirect', redirect_prompt: params.player_input }
  }
  const body: Record<string, unknown> = { action }
  const fields: Record<string, (keyof typeof params)[]> = {
    act: ['player_input', 'player_kind'], redirect: ['redirect_prompt'],
    switch_perspective: ['target_character'], branch: ['from_beat_id', 'branch_goal'],
    continue_chapter: ['branch_goal'], replay: ['beat_id'],
  }
  for (const field of fields[action] ?? []) {
    if (params[field] !== undefined) body[field] = params[field]
  }
  if (options.runtimeVersion === 1) {
    body.command_id = options.commandId
    body.expected_revision = options.revision
  }
  return body
}
