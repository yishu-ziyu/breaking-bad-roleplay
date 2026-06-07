/**
 * Silhouette Component (P0-C)
 *
 * 渲染 6 角色剪影 SVG 头像，零版权风险（全部自绘），单色 + 暗底圆。
 * 用法：<Silhouette characterId="walter" name="Walter" size={42} />
 */

import type { CharacterId } from '../roleProfiles'

interface SilhouetteProps {
  characterId: CharacterId
  name: string
  size?: number
}

export function Silhouette({ characterId, name, size = 42 }: SilhouetteProps) {
  return (
    <img
      src={`/avatars/${characterId}.svg`}
      alt={name}
      className="silhouette-avatar"
      width={size}
      height={size}
      onError={(event) => {
        // 兜底：剪影加载失败时显示首字母
        const img = event.currentTarget
        const parent = img.parentElement
        if (!parent) return
        img.style.display = 'none'
        const fallback = document.createElement('span')
        fallback.className = 'silhouette-fallback'
        fallback.textContent = name.slice(0, 1)
        parent.appendChild(fallback)
      }}
    />
  )
}
