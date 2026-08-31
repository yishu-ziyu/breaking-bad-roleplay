/**
 * Silhouette Component (P0-C / desert-noir P2)
 *
 * 头像渲染链：优先 /avatars/desert-noir/<id>.jpg 油画风立绘（近黑背景+绿/琥珀轮廓光），
 * 加载失败回退旧 PNG/SVG 剪影，再失败回退首字母方块。
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
  const desertNoirSrc = `/avatars/desert-noir/${characterId}.jpg`
  const primarySrc = portraitAvatarIds.has(characterId)
    ? `/avatars/${characterId}.png`
    : `/avatars/${characterId}.svg`
  const fallbackSrc = `/avatars/${characterId}.svg`
  const src = !failedSrcs.includes(desertNoirSrc)
    ? desertNoirSrc
    : failedSrcs.includes(primarySrc)
      ? fallbackSrc
      : primarySrc

  if (
    failedSrcs.includes(desertNoirSrc) &&
    failedSrcs.includes(primarySrc) &&
    failedSrcs.includes(fallbackSrc)
  ) {
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
