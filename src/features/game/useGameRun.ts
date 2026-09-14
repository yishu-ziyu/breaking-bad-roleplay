import { useCallback, useEffect, useRef, useState } from 'react'
import { branchGame, getEvents, getGame, postAction, replayRevision, startGame } from './api.ts'
import { applyBeat, applyGameEvent, type DisplayView } from './eventReducer.ts'
import type { PlayerView } from './types.ts'

function openedBeat(opened: PlayerView, actionId: string | null) {
  return applyBeat(null, {
    run_id: opened.run_id,
    action_id: actionId,
    revision: opened.revision,
    view: opened,
    visibility: opened.visibility,
  })
}

export function useGameRun(seed = 1) {
  const [view, setView] = useState<DisplayView | null>(null)
  const [starting, setStarting] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skipMotion, setSkipMotion] = useState(false)
  const [muteVoice, setMuteVoice] = useState(true)
  const [mediaFailed, setMediaFailed] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const viewRef = useRef<DisplayView | null>(null)
  const seqRef = useRef(0)
  const runId = view?.run_id

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    let cancelled = false
    void startGame(seed)
      .then((opened) => {
        if (cancelled) return
        setView(openedBeat(opened, null))
        setStarting(false)
      })
      .catch(() => {
        if (cancelled) return
        setError('start_failed')
        setStarting(false)
      })
    return () => {
      cancelled = true
    }
  }, [seed])

  const restart = useCallback(() => {
    setStarting(true)
    setConfirming(false)
    setError(null)
    setView(null)
    setMediaFailed(false)
    setHistoryOpen(false)
    seqRef.current = 0
    void startGame(seed, { force: true })
      .then((opened) => {
        setView(openedBeat(opened, null))
        setStarting(false)
      })
      .catch(() => {
        setError('start_failed')
        setStarting(false)
      })
  }, [seed])

  const choose = useCallback(async (choiceId: string) => {
    const current = viewRef.current
    if (!current || current.ending || confirming) return
    const actionId = crypto.randomUUID()
    setConfirming(true)
    setError(null)
    try {
      const result = await postAction(current.run_id, {
        action_id: actionId,
        expected_revision: current.revision,
        choice_id: choiceId,
      })
      const incoming = result.view
      if (!incoming) {
        setError('act_failed')
        return
      }
      setView((prev) =>
        applyBeat(prev, {
          run_id: incoming.run_id,
          action_id: actionId,
          revision: incoming.revision,
          view: incoming,
          visibility: incoming.visibility,
        }),
      )
      if ('code' in result && result.code) setError(result.code)
    } catch {
      setError('act_failed')
    } finally {
      setConfirming(false)
    }
  }, [confirming])

  useEffect(() => {
    if (!runId) return
    let cancelled = false
    const tick = async () => {
      const current = viewRef.current
      if (!current) return
      try {
        const events = await getEvents(current.run_id, seqRef.current)
        if (cancelled || events.length === 0) return
        seqRef.current = Math.max(seqRef.current, ...events.map((item) => item.seq))
        const latest = events[events.length - 1]
        if (!latest || latest.revision < current.revision) return
        if (latest.revision === current.revision) return
        const fresh = await getGame(current.run_id)
        if (cancelled) return
        setView((prev) => applyGameEvent(prev, latest, fresh))
      } catch {
        /* network fail must not block the next action */
      }
    }
    const id = window.setInterval(() => {
      void tick()
    }, 3000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [runId])

  useEffect(() => {
    if (!historyOpen) return
    const current = viewRef.current
    if (!current) return
    let cancelled = false
    void getGame(current.run_id)
      .then((fresh) => {
        if (cancelled) return
        setView((prev) =>
          applyBeat(prev, {
            run_id: fresh.run_id,
            action_id: prev?.source_action_id ?? null,
            revision: fresh.revision,
            view: fresh,
            visibility: fresh.visibility,
          }),
        )
      })
      .catch(() => {
        /* 回看 is GET only */
      })
    return () => {
      cancelled = true
    }
  }, [historyOpen])

  const onReplay = useCallback(async () => {
    const current = viewRef.current
    if (!current) return
    setError(null)
    try {
      await replayRevision(current.run_id, current.revision)
      const fresh = await getGame(current.run_id)
      setView((prev) =>
        applyBeat(prev, {
          run_id: fresh.run_id,
          action_id: prev?.source_action_id ?? null,
          revision: fresh.revision,
          view: fresh,
          visibility: fresh.visibility,
        }),
      )
    } catch {
      setError('act_failed')
    }
  }, [])

  const onBranch = useCallback(async () => {
    const current = viewRef.current
    if (!current) return
    setError(null)
    const revision = current.ending && current.revision > 0 ? current.revision - 1 : current.revision
    try {
      const child = await branchGame(current.run_id, revision)
      seqRef.current = 0
      setHistoryOpen(false)
      setView(openedBeat(child, null))
    } catch {
      setError('act_failed')
    }
  }, [])

  return {
    view,
    starting,
    confirming,
    pending: confirming,
    error,
    skipMotion,
    muteVoice,
    mediaFailed,
    historyOpen,
    choose,
    restart,
    onSkipMotion: () => setSkipMotion((value) => !value),
    onMuteVoice: () => setMuteVoice((value) => !value),
    onMediaFail: () => setMediaFailed(true),
    onToggleHistory: () => setHistoryOpen((value) => !value),
    onReview: () => setHistoryOpen(true),
    onReplay,
    onBranch,
  }
}
