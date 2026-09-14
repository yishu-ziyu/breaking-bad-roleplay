type Props = { text: string }

export function ConsequenceStrip({ text }: Props) {
  if (!text) return null
  return (
    <p className="night-consequence" role="status" aria-live="polite">
      上一步后果：{text}
    </p>
  )
}
