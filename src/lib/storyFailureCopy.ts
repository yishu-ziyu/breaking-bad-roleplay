/* Plain-language copy for a story-level failure.
 *
 * Three ways a run can stop before the player gets an in-scene explanation:
 *  - session_create: POST /api/session/create failed, so no world exists yet.
 *  - beat_rejected: the stream delivered an `error` event, so the beat the
 *    player asked for was refused after the scene had already started.
 *  - resume_failed: loading the saved session failed, so the run that was
 *    already on the server could not be opened again.
 *
 * The UI must never print the raw server string as the only line: it is
 * internal wording ("Internal Server Error", validation codes). Keep the raw
 * text in `detail` for debugging, and render the copy below.
 */

export type StoryFailureKind = 'session_create' | 'beat_rejected' | 'resume_failed'

export interface StoryFailure {
  kind: StoryFailureKind
  /** HTTP status when the failure came from a response; null for streams/network. */
  status: number | null
  /** Raw server / transport detail. Never rendered as the player-facing line. */
  detail: string | null
}

export interface StoryFailureCopy {
  headline: string
  body: string
  retryLabel: string
}

const COPY: Record<StoryFailureKind, Record<'zh' | 'en', StoryFailureCopy>> = {
  session_create: {
    zh: {
      headline: '剧情没能开始',
      body: '创建这次故事时出错了，一个字都还没演出。你的开场设定还在——重试会用同一段开场重新开始。',
      retryLabel: '重试用同一段开场',
    },
    en: {
      headline: 'The story did not start',
      body: 'Something failed while creating this story, and nothing has been performed yet. Your opening is still here — retry starts again with the same opening.',
      retryLabel: 'Retry the same opening',
    },
  },
  beat_rejected: {
    zh: {
      headline: '这一拍没能继续',
      body: '后面的内容生成失败了。已经演过的部分已保存，重试会接着往下一拍走。',
      retryLabel: '重试这一拍',
    },
    en: {
      headline: 'This beat could not go on',
      body: 'Generating the next part failed. Everything already performed is saved — retry continues from this beat.',
      retryLabel: 'Retry this beat',
    },
  },
  resume_failed: {
    zh: {
      headline: '上次的剧情没能打开',
      body: '读取已保存的进度时出错了，已经演过的部分还在。重试会重新打开同一场剧情。',
      retryLabel: '重试打开上次的剧情',
    },
    en: {
      headline: 'Could not open your last story',
      body: 'Something failed while loading the saved progress. Everything already performed is still there — retry opens the same story again.',
      retryLabel: 'Retry loading the story',
    },
  },
}

/* Resume toasts are one-line notices over the story panel, not error pages.
 * They used to be hard-coded English even in the Chinese interface. */
export type StoryResumeNoticeKind = 'expired' | 'unverified'

const RESUME_NOTICE_COPY: Record<StoryResumeNoticeKind, Record<'zh' | 'en', string>> = {
  expired: {
    zh: '上次的剧情已经不在了（被删除，或服务器重置过）。重新开始一段新的吧。',
    en: 'Your last session expired (deleted or server reset). Start a new one.',
  },
  unverified: {
    zh: '暂时连不上服务器，没法确认上次的剧情还在不在。等网络恢复后再试一次。',
    en: 'Could not verify your last session. Try again when the server is reachable.',
  },
}

export function storyResumeNoticeCopy(
  kind: StoryResumeNoticeKind,
  language: string | null | undefined,
): string {
  const lang = language === 'en' ? 'en' : 'zh'
  return RESUME_NOTICE_COPY[kind][lang]
}

export function storyFailureCopy(
  failure: Pick<StoryFailure, 'kind'>,
  language: string | null | undefined,
): StoryFailureCopy {
  const lang = language === 'en' ? 'en' : 'zh'
  return COPY[failure.kind][lang]
}
