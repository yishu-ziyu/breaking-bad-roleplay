/** Visible opener must follow UI language, even after the first insert. */

export type OpenerLang = 'zh' | 'en'

export type OpenerMessage = {
  id: string
  sender: string
  text: string
  emotion?: string | null
  gifQuery?: string | null
  gifUrl?: string | null
}

export function isOpenerOnlyThread(messages: OpenerMessage[] | undefined, characterId: string): boolean {
  if (!messages || messages.length !== 1) return false
  return messages[0].id === `opener-${characterId}`
}

export function openerTextForLanguage(
  opener: Record<OpenerLang, string>,
  language: OpenerLang,
): string {
  return opener[language] ?? opener.en
}

/** If the thread is still the first-visit opener, rewrite it to the UI language. */
export function syncOpenerLanguage<T extends OpenerMessage>(
  messages: T[] | undefined,
  characterId: string,
  opener: Record<OpenerLang, string>,
  language: OpenerLang,
  openingEmotion: string,
): T[] | undefined {
  if (!isOpenerOnlyThread(messages, characterId) || !messages) return messages
  const nextText = openerTextForLanguage(opener, language)
  const current = messages[0]
  if (current.text === nextText && current.emotion === openingEmotion) return messages
  return [
    {
      ...current,
      text: nextText,
      emotion: openingEmotion,
    },
  ]
}
