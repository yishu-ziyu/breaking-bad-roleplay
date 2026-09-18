import { storyFailureCopy, type StoryFailure } from '../lib/storyFailureCopy'

export type StoryFailureNoticeProps = {
  failure: StoryFailure
  language: 'en' | 'zh'
  /** Retry the run the same way it was started (same opening / same beat). */
  onRetry: () => void
  /** Optional escape hatch that wipes the local story state. */
  onReset?: () => void
  resetLabel?: string
}

/**
 * Player-facing notice for a story-level failure (session never created, or a
 * beat refused mid-stream). One plain line about what happened, one retry.
 * The raw server detail stays out of the copy by design.
 */
export function StoryFailureNotice({
  failure,
  language,
  onRetry,
  onReset,
  resetLabel,
}: StoryFailureNoticeProps) {
  const copy = storyFailureCopy(failure, language)
  return (
    <div className="story-failure" role="alert">
      <p className="story-failure__headline">{copy.headline}</p>
      <p className="story-failure__body">{copy.body}</p>
      <div className="story-failure__actions">
        <button
          type="button"
          className="story-failure__retry"
          onClick={onRetry}
          data-story-failure-kind={failure.kind}
        >
          {copy.retryLabel}
        </button>
        {onReset && resetLabel ? (
          <button type="button" className="story-failure__reset" onClick={onReset}>
            {resetLabel}
          </button>
        ) : null}
      </div>
    </div>
  )
}
