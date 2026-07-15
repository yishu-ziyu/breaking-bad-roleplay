/**
 * Silhouette Component (P0-C)
 *
 * 渲染 6 角色剪影 SVG 头像，零版权风险（全部自绘），单色 + 暗底圆。
 * 用法：<Silhouette characterId="walter" name="Walter" size={42} />
 */

import { useState } from 'react'
import type { CharacterId } from '../roleProfiles'

// PNG portraits when present; others (e.g. hank) load /avatars/<id>.svg directly.
const portraitAvatarIds = new Set<CharacterId>([
  'walter',
  'jesse',
  'skyler',
  'saul',
  'gus',
  'mike',
  'hank',
])

interface SilhouetteProps {
  characterId: CharacterId
  name: string
  size?: number
}

export function Silhouette({ characterId, name, size = 42 }: SilhouetteProps) {
  const [failedSrcs, setFailedSrcs] = useState<string[]>([])
  const primarySrc = portraitAvatarIds.has(characterId)
    ? `/avatars/${characterId}.png`
    : `/avatars/${characterId}.svg`
  const fallbackSrc = `/avatars/${characterId}.svg`
  const src = failedSrcs.includes(primarySrc) ? fallbackSrc : primarySrc

  if (failedSrcs.includes(primarySrc) && failedSrcs.includes(fallbackSrc)) {
    return (
      <span className="silhouette-fallback" style={{ width: size, height: size }}>
        {name.slice(0, 1)}
      </span>
    )
  }

  return (
    <img
      src={src}
      alt={name}
      className="silhouette-avatar"
      width={size}
      height={size}
      onError={() => {
        setFailedSrcs(prev => prev.includes(src) ? prev : [...prev, src])
      }}
    />
  )
}
