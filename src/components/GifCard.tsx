import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export interface GifCardProps {
  src: string | null | undefined
  alt?: string
  caption?: ReactNode
}

export function GifCard({ src, alt, caption }: GifCardProps) {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    setHidden(false)
  }, [src])

  if (!src) return null
  return (
    <figure className="gif-card" hidden={hidden}>
      <img
        src={src}
        alt={alt || ''}
        onError={() => {
          setHidden(true)
        }}
      />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}
