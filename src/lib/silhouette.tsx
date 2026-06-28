/**
 * Silhouette Component (P0-C)
 *
 * 渲染 6 角色剪影 SVG 头像，零版权风险（全部自绘），单色 + 暗底圆。
 * 用法：<Silhouette characterId="walter" name="Walter" size={42} />
 */

import { useEffect, useState } from 'react'
import type { CharacterId } from '../roleProfiles'

interface SilhouetteProps {
  characterId: CharacterId
  name: string
  size?: number
}

export function Silhouette({ characterId, name, size = 42 }: SilhouetteProps) {
  const [showFallback, setShowFallback] = useState(false)

  useEffect(() => {
    setShowFallback(false)
  }, [characterId])

  if (showFallback) {
    return (
      <span className="silhouette-fallback" style={{ width: size, height: size }}>
        {name.slice(0, 1)}
      </span>
    )
  }

  return (
    <img
      src={`/avatars/${characterId}.svg`}
      alt={name}
      className="silhouette-avatar"
      width={size}
      height={size}
      onError={() => {
        setShowFallback(true)
      }}
    />
  )
}
