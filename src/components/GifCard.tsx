import type { ReactNode } from 'react'

export interface GifCardProps {
  src: string | null | undefined
  alt?: string
  caption?: ReactNode
}

export function GifCard({ src, alt, caption }: GifCardProps) {
  if (!src) return null
  return (
    <figure className="gif-card">
      <img
        src={src}
        alt={alt || ''}
        onError={e => {
          const figure = e.currentTarget.closest('figure')
          if (figure) {
            figure.setAttribute('hidden', 'true')
          }
        }}
      />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}
