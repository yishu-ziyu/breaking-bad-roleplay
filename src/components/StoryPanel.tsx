import { type CSSProperties, useCallback } from 'react';
import type { SseAction } from '../lib/sseClient';
import type { UseStoryStreamReturn } from '../hooks/useStoryStream';
import StoryEvent from './StoryEvent';
import styles from './StoryPanel.module.css';

// ------------------------------------------------------------------
// Props
// ------------------------------------------------------------------

export interface StoryPanelProps {
  /** Current view mode — allows conditional rendering */
  view: 'story' | 'chat';

  /** SSE stream hook return value */
  stream: UseStoryStreamReturn;

  /** Called when user switches back to chat view */
  onSwitchToChat: () => void;

  /** UI strings — i18n keys, rendered by the parent */
  title?: string;
  subtitle?: string;
  beatPrompt?: string;
  chatBtnLabel?: string;
  language?: 'en' | 'zh';

  /** Perspective mode — 'global' shows all events, 'in-character' highlights player's role */
  perspective?: 'global' | 'in-character';

  /** The character id the player is currently embodying (used when perspective is 'in-character') */
  activeCharacterId?: string;
}

// ------------------------------------------------------------------
// Beat decision labels
// ------------------------------------------------------------------

const BEAT_ACTION_LABELS: Record<string, { en: string; zh: string }> = {
  continue:         { en: 'Continue',  zh: '继续推进' },
  stop:             { en: 'Stop',      zh: '暂停观察' },
  redirect:         { en: 'Redirect',  zh: '改写走向' },
  switch_perspective: { en: 'Switch View', zh: '切换视角' },
};

function getBeatLabel(actionType: string, lang: 'en' | 'zh'): string {
  return BEAT_ACTION_LABELS[actionType]?.[lang] ?? actionType.replace(/_/g, ' ');
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

/**
 * StoryPanel — event-driven narrative display
 *
 * Layout (top → bottom):
 *   Header  (title + stream status badge)
 *   Status  (connection state indicator)
 *   Stream  (scrollable list of StoryEvent rows)
 *   Footer  (beat_ready decision buttons OR "switch to chat" button)
 */
export default function StoryPanel({
  view,
  stream,
  onSwitchToChat,
  title = 'Narrative Stream',
  subtitle = 'Live story event feed',
  beatPrompt = 'Director decision required:',
  chatBtnLabel = 'Switch to Chat',
  language = 'en',
  perspective = 'global',
  activeCharacterId,
}: StoryPanelProps) {
  const { events, sendAction, isConnected, connectionState, currentBeat } = stream;

  // Extract player-facing options from the most recent beat_ready event.
  const beatOptions = currentBeat?.data && typeof currentBeat.data === 'object'
    ? ((currentBeat.data as { options?: unknown[] }).options ?? [])
    : [];

  const handleBeatAction = useCallback(
    async (actionType: string) => {
      try {
        await sendAction({ kind: actionType as SseAction['kind'] } as SseAction);
      } catch {
        // Connection errors are surfaced through the stream's
        // connectionState — silent here to avoid double-error noise.
      }
    },
    [sendAction],
  );

  // Hide completely when not in story view.
  if (view !== 'story') return null;

  // Connection status text for the status bar.
  const statusLabel: Record<string, string> = {
    connected: 'Stream live',
    connecting: 'Connecting…',
    disconnected: 'Disconnected',
    error: 'Connection error',
  };

  return (
    <div className={styles.panel} style={{ '--character-color': '#f7ce46' } as CSSProperties}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h2 className={styles.title}>{title}</h2>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
        <div className={styles.headerRight}>
          {perspective === 'in-character' && activeCharacterId && (
            <span className={styles.perspectiveBadge}>
              {language === 'zh' ? '扮演视角' : 'In-Character'}
            </span>
          )}
          <span className={styles.badge}>
            {events.length} event{events.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* ── Connection Status ─────────────────────────────── */}
      <div className={styles.status} role="status" aria-live="polite">
        <span
          className={`${styles.statusDot} ${
            styles[`statusDot--${connectionState}`] ?? ''
          }`.trim()}
        />
        <span>{statusLabel[connectionState] ?? connectionState}</span>
      </div>

      {/* ── Event Stream ──────────────────────────────────── */}
      <div className={styles.stream} role="log" aria-live="polite" aria-label="Story events">
        {events.length === 0 ? (
          <div className={styles.empty}>
            Waiting for the scene to unfold…<br />
            <span style={{ fontSize: '11px', opacity: 0.7, marginTop: '4px', display: 'inline-block' }}>
              {isConnected ? 'Connected — events will appear here.' : 'Connecting to story engine…'}
            </span>
          </div>
        ) : (
          events.map((event, index) => (
            <StoryEvent
              key={`${event.type}-${event.id ?? index}`}
              event={event}
              activeCharacterId={perspective === 'in-character' ? activeCharacterId : undefined}
            />
          ))
        )}
      </div>

      {/* ── Decision Panel (beat_ready) ───────────────────── */}
      {currentBeat && (
        <div className={styles.decision}>
          <p className={styles.decisionPrompt}>{beatPrompt}</p>
          {beatOptions.length > 0 ? (
            <div className={styles.decisionGrid}>
              {beatOptions.map((option) => {
                const optionObj = typeof option === 'object' && option !== null
                  ? (option as { type?: string; label?: string })
                  : {};
                const actionType = optionObj.type ?? String(option);
                return (
                  <button
                    key={actionType}
                    className={styles.decisionBtn}
                    type="button"
                    disabled={!isConnected}
                    onClick={() => handleBeatAction(actionType)}
                  >
                    {optionObj.label ?? getBeatLabel(actionType, 'en')}
                  </button>
                );
              })}
            </div>
          ) : (
            <DecisionFallback onAction={handleBeatAction} isConnected={isConnected} />
          )}
        </div>
      )}

      {/* ── Footer / Chat Toggle ─────────────────────────── */}
      <div className={styles.footer}>
        <button
          className={styles.chatBtn}
          type="button"
          disabled={!isConnected}
          onClick={onSwitchToChat}
        >
          {chatBtnLabel}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Internal: fallback decision buttons when options array is absent
// ------------------------------------------------------------------

interface DecisionFallbackProps {
  onAction: (actionType: string) => void;
  isConnected: boolean;
}

function DecisionFallback({ onAction, isConnected }: DecisionFallbackProps) {
  const defaults: SseAction['kind'][] = ['continue', 'stop', 'redirect', 'switch_perspective'];
  return (
    <div className={styles.decisionGrid}>
      {defaults.map((actionType) => (
        <button
          key={actionType}
          className={styles.decisionBtn}
          type="button"
          disabled={!isConnected}
          onClick={() => onAction(actionType)}
        >
          {getBeatLabel(actionType, 'en')}
        </button>
      ))}
    </div>
  );
}
