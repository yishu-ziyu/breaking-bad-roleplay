import { useState } from 'react'
import type { ReactNode } from 'react'

export interface GifCardProps {
  src: string | null | undefined
  alt?: string
  caption?: ReactNode
}

export function GifCard({ src, alt, caption }: GifCardProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (!src || src === failedSrc) return null
  return (
    <figure className="gif-card">
      <img
        src={src}
        alt={alt || ''}
        onError={() => {
          setFailedSrc(src)
        }}
      />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}
