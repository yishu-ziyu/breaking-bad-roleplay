import { useMemo } from 'react';
import type { SseEvent } from '../lib/sseClient';
import styles from './StoryEvent.module.css';

// ------------------------------------------------------------------
// Props
// ------------------------------------------------------------------

export interface StoryEventProps {
  /** One SSE event emitted by the story stream */
  event: SseEvent;

  /** When set (in-character mode), events from this character are highlighted; others are dimmed */
  activeCharacterId?: string;
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

/**
 * StoryEvent — renders a single SSE story event.
 *
 * Each event type maps to a distinct visual treatment:
 *
 *  scene_change         Colored scene header + description
 *  agent_act            Actor name + italicized action description
 *  agent_speak          Dialogue bubble with speaker name + emotion tag
 *  agent_think          Subtle dashed-card inner monologue (italic)
 *  world_state_delta    Minimal mono status indicator
 *  beat_ready           Decision button group
 *  * (unknown)          Neutral render of the raw data
 */
export default function StoryEvent({ event, activeCharacterId }: StoryEventProps) {
  // Map event type to CSS modifier class.
  const typeClass = useMemo(() => {
    const map: Record<string, string> = {
      status:                styles.state,
      outline:               styles.scene,
      scene_change:          styles.scene,
      agent_act:             styles.action,
      agent_speak:           styles.speech,
      agent_think:           styles.thought,
      world_state_delta:     styles.state,
      beat_ready:            styles.beat,
    };
    return map[event.type] ?? '';
  }, [event.type, styles]);

  // Perspective modifier: highlight events from the active character,
  // dim events from other characters (only in in-character mode).
  const perspectiveClass = useMemo(() => {
    if (!activeCharacterId) return '';
    const eventCharId = extractCharacterId(event);
    if (!eventCharId) return '';
    return eventCharId === activeCharacterId
      ? styles.perspectiveHighlight
      : styles.perspectiveDim;
  }, [event, activeCharacterId, styles]);

  // Combined class list.
  const combinedClass = useMemo(() => {
    const parts = [styles.event];
    if (typeClass) parts.push(typeClass);
    if (perspectiveClass) parts.push(perspectiveClass);
    return parts.join(' ');
  }, [typeClass, perspectiveClass, styles]);

  // Accent bar color class.
  const accentClass = useMemo(() => {
    const map: Record<string, string> = {
      scene_change:          styles.accentScene,
      agent_act:             styles.accentAction,
      agent_speak:           styles.accentSpeech,
      agent_think:           styles.accentThought,
      world_state_delta:     styles.accentState,
      beat_ready:            styles.accentBeat,
    };
    return map[event.type] ?? styles.accentState;
  }, [event.type, styles]);

  // Render the event body. Switch on event.type for type-safe rendering.
  const renderBody = () => {
    switch (event.type) {
      case 'status':
        return <StatusBody data={event.data} />;
      case 'outline':
        return <OutlineBody data={event.data} />;
      case 'scene_change':
        return <SceneChangeBody data={event.data} />;
      case 'agent_act':
        return <AgentActBody data={event.data} />;
      case 'agent_speak':
        return <AgentSpeakBody data={event.data} />;
      case 'agent_think':
        return <AgentThinkBody data={event.data} />;
      case 'world_state_delta':
        return <WorldStateBody data={event.data} />;
      case 'beat_ready':
        return <BeatReadyBody data={event.data} />;
      default:
        return <RawBody data={event.data} />;
    }
  };

  return (
    <div className={combinedClass}>
      <div className={accentClass} aria-hidden="true" />
      <div className={styles.content}>{renderBody()}</div>
    </div>
  );
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/**
 * Extract the character id from an event's data payload, if present.
 * Handles both `character_id` (snake_case, from backend schemas) and
 * `character` (display name, from some director outputs).
 */
function extractCharacterId(event: SseEvent): string | null {
  const d = event.data as Record<string, unknown> | null | undefined;
  if (!d) return null;
  return (d.character_id ?? d.character ?? null) as string | null;
}

// ------------------------------------------------------------------
// Event body renderers (one per event type)
// ------------------------------------------------------------------

// ----- status -----
function StatusBody({ data }: { data: unknown }) {
  const inner = (data as Record<string, unknown>).data as Record<string, unknown>;
  const msg = (inner.message as string | undefined) ?? '';
  return (
    <>
      <span className={styles.sceneTag}>STATUS</span>
      <p className={styles.sceneDesc}>{msg}</p>
    </>
  );
}

// ----- outline -----
function OutlineBody({ data }: { data: unknown }) {
  const inner = (data as Record<string, unknown>).data as Record<string, unknown>;
  const content = (inner.content as string | undefined) ?? '';
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);

  return (
    <>
      <span className={styles.sceneTag}>OUTLINE</span>
      {lines.map((line, i) => (
        <p key={i} className={styles.sceneDesc}>{line}</p>
      ))}
    </>
  );
}

// ----- scene_change -----
interface SceneChangeData {
  to_scene?: string;
  from_scene?: string;
  description?: string;
}

function SceneChangeBody({ data }: { data: unknown }) {
  const inner = (data as Record<string, unknown>).data as SceneChangeData;
  const title = inner.to_scene ?? inner.from_scene ?? 'Scene Change';
  const desc  = inner.description ?? '';

  return (
    <>
      <span className={styles.sceneTag}>SCENE</span>
      <h3 className={styles.sceneTitle}>{title}</h3>
      {desc && <p className={styles.sceneDesc}>{desc}</p>}
    </>
  );
}

// ----- agent_act -----
interface AgentActData {
  character_id?: string;
  action?: string;
  target?: string;
}

function AgentActBody({ data }: { data: unknown }) {
  const inner = (data as Record<string, unknown>).data as AgentActData;
  const actor = inner.character_id ?? '';
  const action = inner.action ?? '';

  return (
    <>
      {actor && <strong className={styles.actorName}>{actor}</strong>}
      <p className={styles.actionText}>{action}</p>
    </>
  );
}

// ----- agent_speak -----
interface AgentSpeakData {
  character?: string;
  character_id?: string;
  dialogue?: string;
  text?: string;
  emotion?: string;
  mood?: string;
}

function AgentSpeakBody({ data }: { data: unknown }) {
  const d = data as AgentSpeakData;
  const speaker = d.character ?? d.character_id ?? '';
  const dialogue = d.dialogue ?? d.text ?? '';
  const emotion = d.emotion ?? d.mood ?? '';

  return (
    <>
      <div className={styles.speaker}>
        <strong className={styles.speakerName}>{speaker}</strong>
        {emotion && <span className={styles.emotionTag}>{emotion}</span>}
      </div>
      <p className={styles.dialogue}>{dialogue}</p>
    </>
  );
}

// ----- agent_think -----
interface AgentThinkData {
  character?: string;
  character_id?: string;
  thought?: string;
  inner_monologue?: string;
  reasoning?: string;
}

function AgentThinkBody({ data }: { data: unknown }) {
  const d = data as AgentThinkData;
  const thinker = d.character ?? d.character_id ?? '';
  const thought = d.thought ?? d.inner_monologue ?? d.reasoning ?? '';

  return (
    <>
      {thinker && <p className={styles.thinkLabel}>{thinker} — inner thought</p>}
      <p className={styles.monologue}>{thought}</p>
    </>
  );
}

// ----- world_state_delta -----
interface WorldStateData {
  delta?: unknown;
  changes?: unknown;
  description?: string;
}

function WorldStateBody({ data }: { data: unknown }) {
  const d = data as WorldStateData;
  const text = d.description
    ?? (d.delta !== undefined ? JSON.stringify(d.delta) : null)
    ?? (d.changes !== undefined ? JSON.stringify(d.changes) : '')
    ?? '';

  return <p className={styles.deltaText}>{text}</p>;
}

// ----- beat_ready -----
interface BeatReadyData {
  beat_number?: number;
  description?: string;
  scene_hint?: string;
  options?: unknown[];
  available_actions?: unknown[];
}

function BeatReadyBody({ data }: { data: unknown }) {
  const d = data as BeatReadyData;
  const desc = d.description ?? d.scene_hint ?? '';
  const options = d.options ?? d.available_actions ?? [];

  // Buttons are rendered by StoryPanel (which has sendAction).
  // We show a preview here; the action dispatch lives at the panel level.
  const optionStrings = options.map((opt) =>
    typeof opt === 'object' && opt !== null
      ? ((opt as { type?: string; label?: string }).label
        ?? (opt as { type?: string }).type
        ?? JSON.stringify(opt))
      : String(opt),
  );

  return (
    <>
      <p className={styles.beatHeader}>
        {d.beat_number !== undefined ? `BEAT ${d.beat_number}` : 'BEAT READY'}
      </p>
      {desc && <p className={styles.beatDesc}>{desc}</p>}
      <div className={styles.beatGrid}>
        {optionStrings.map((label) => (
          <span
            key={label}
            className={styles.beatBtn}
            style={{ cursor: 'default', opacity: 0.7 }}
          >
            {label}
          </span>
        ))}
      </div>
    </>
  );
}

// ----- fallback / unknown event type -----
function RawBody({ data }: { data: unknown }) {
  const text = data !== undefined && data !== null
    ? JSON.stringify(data, null, 2)
    : '(empty event payload)';

  return (
    <pre
      style={{
        margin: 0,
        fontSize: '11px',
        lineHeight: 1.45,
        color: 'rgba(255,255,255,0.55)',
        fontFamily: 'var(--font-mono)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {text}
    </pre>
  );
}
