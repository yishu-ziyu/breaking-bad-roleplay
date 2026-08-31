/**
 * ElementSquare — desert-noir 唯一装饰母题：元素周期表方块。
 * 左上角小号原子序数（mono 8px muted），中间大号 Bebas Neue 符号。
 * green 变体：border / 符号用 --dn-accent（Heisenberg 绿）。
 *
 * 用法：<ElementSquare symbol="Br" num="35" size={54} green />
 */

import type { CSSProperties } from 'react'

interface ElementSquareProps {
  symbol: string
  num: string | number
  size?: number
  green?: boolean
  className?: string
}

export function ElementSquare({ symbol, num, size = 48, green = false, className }: ElementSquareProps) {
  const cls = ['elem-square', green ? 'elem-square--green' : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  const style = { '--elem-size': `${size}px` } as CSSProperties
  return (
    <span className={cls} style={style}>
      <span className="elem-square__num">{num}</span>
      <span className="elem-square__symbol">{symbol}</span>
    </span>
  )
}

export default ElementSquare
