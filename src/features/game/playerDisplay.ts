const RESOURCE_LABEL: Record<string, string> = {
  cash: '现金',
  saul_favor: '人情',
}

function band(value: number, high: string, mid: string, low: string, midAt = 3, highAt = 5): string {
  if (value >= highAt) return high
  if (value >= midAt) return mid
  return low
}

/** Observed pressure only. Numbers stay off the player surface. */
export function observedPressure(meters: Record<string, number>): string[] {
  const lines: string[] = []
  if ('police_risk' in meters) {
    lines.push(band(meters.police_risk, '风声紧了', '风声在起', '风声还小'))
  }
  if ('family_strain' in meters) {
    lines.push(band(meters.family_strain, '家里绷着', '家里在等说法', '家里还稳', 2, 5))
  }
  if ('jesse_trust' in meters) {
    if (meters.jesse_trust <= 1) lines.push('杰西在犹豫')
    else if (meters.jesse_trust <= 3) lines.push('杰西还能听')
    else lines.push('杰西还站在你这边')
  }
  return lines
}

export function resourceLines(resources: Record<string, number>): string[] {
  return Object.entries(resources).map(([key, value]) => `${RESOURCE_LABEL[key] ?? key} ${value}`)
}

export function atmosphereFor(locationLabel: string): string {
  if (locationLabel.includes('厨')) return '厨房的灯还亮着'
  if (locationLabel.includes('家')) return '家里还没睡'
  return '这一夜还没过完'
}
