/**
 * StoryComingSoonNotice — visitor-facing message for the closed Story board
 * (T10, 2026-09-18). Plain language only: what is happening and what still
 * works. Copy lives in `src/lib/storyAvailability.ts` next to the switch.
 */

import { storyComingSoonCopy, type StoryGateLanguage } from '../lib/storyAvailability'

export type StoryComingSoonNoticeProps = {
  language: StoryGateLanguage
  /** Extra class for surface-specific placement (card / mode bar / settings). */
  className?: string
}

export function StoryComingSoonNotice({ language, className }: StoryComingSoonNoticeProps) {
  const copy = storyComingSoonCopy(language)
  return (
    <p className={className ? `story-coming-soon ${className}` : 'story-coming-soon'} role="alert">
      {copy.notice}
    </p>
  )
}

export default StoryComingSoonNotice
