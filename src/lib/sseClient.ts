/* =================================================================
   ABQ Roleplay Lab — SSE Client
   Connects to backend SSE endpoint, parses events, handles
   reconnection with exponential back-off, and emits typed events
   via a callback or EventEmitter-style onEvent listener.
   ================================================================= */

export type SseEventType =
  | 'scene_change'
  | 'agent_act'
  | 'agent_speak'
  | 'agent_think'
  | 'world_state_delta'
  | 'beat_ready'
  | 'error'
  | 'connected'
  | 'disconnected'
  | 'reconnecting';

export interface SseEvent {
  /** SSE "event" field — the event type */
  type: SseEventType;

  /** Raw parsed JSON payload */
  data: unknown;

  /** Raw event string (for debugging) */
  raw?: string;

  /** Server-assigned id, if the event carries one */
  id?: string;

  /** Retry hint from the server, in ms */
  retry?: number;
}

type SseListener = (event: SseEvent) => void;

const DEFAULT_RECONNECT_DELAY = 2_000;  // initial delay, ms
const MAX_RECONNECT_DELAY   = 30_000; // cap, ms
const RECONNECT_BACKOFF     = 1.5;   // multiplier per failed attempt
// B3 fix: increased from 15s to 45s — Director beat processing can take 20s+
// for complex scenes (character sub-agent calls + LLM inference).
// Heartbeat interval = same as timeout; client considers connection dead
// if no data arrives for HEARTBEAT_TIMEOUT + HEARTBEAT_TOLERANCE.
const HEARTBEAT_TIMEOUT     = 45_000; // consider connection dead after no data for 45 s
const HEARTBEAT_TOLERANCE   = 1_000;  // tolerate 1 s jitter on top

// Export constants for use by hooks
export { DEFAULT_RECONNECT_DELAY, MAX_RECONNECT_DELAY, RECONNECT_BACKOFF, HEARTBEAT_TIMEOUT, HEARTBEAT_TOLERANCE };

/**
 * Lightweight SSE client with typed event emission and reconnection.
 *
 * Usage
 * -----
 *   const client = new SseClient('/api/story/stream');
 *
 *   client.onEvent((evt) => {
 *     if (evt.type === 'scene_change') { ... }
 *   });
 *
 *   client.connect();
 *
 *   // Send a player action into the stream:
 *   await client.sendAction({ type: 'continue' });
 *
 *   client.disconnect();
 */
export class SseClient {
  private url: string;
  private actionUrl: string;
  private es: EventSource | null = null;
  private listeners: Set<SseListener> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = DEFAULT_RECONNECT_DELAY;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastDataAt = 0;
  private manualClose = false;
  private destroyed = false;

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  constructor(url: string, actionUrl?: string) {
    this.url = url;
    this.actionUrl = actionUrl ?? url.replace(/\/stream$/, '/action');
  }

  /**
   * Open the SSE connection. Re-attempts on failure with
   * exponential back-off (resets on success). Does nothing if a
   * connection is already open.
   */
  connect(): void {
    if (this.destroyed) {
      throw new Error('SseClient has been destroyed — create a new instance.');
    }
    if (this.es && this.es.readyState !== EventSource.CLOSED) return;

    this.manualClose = false;
    this.emit({ type: 'reconnecting', data: { attempt: this.reconnectAttempts } });

    this.es = new EventSource(this.url);

    this.es.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.reconnectDelay = DEFAULT_RECONNECT_DELAY;
      this.startHeartbeat();
      this.emit({ type: 'connected', data: { url: this.url } });
    });

    // Catch-all for any event not handled by a named listener.
    this.es.addEventListener('message', (raw: MessageEvent) => {
      this.onData(raw);
    });

    this.es.addEventListener('error', (_raw: Event) => {
      this.stopHeartbeat();
      const wasOpen = this.es?.readyState !== EventSource.CLOSED;
      // EventSource fires "error" once on failure and again when it gives up
      // reconnecting (readyState === CLOSED). We handle both here.
      if (wasOpen) {
        this.emit({ type: 'disconnected', data: { willReconnect: !this.manualClose } });
      }
      if (!this.manualClose && !this.destroyed) {
        this.scheduleReconnect();
      }
    });
  }

  /**
   * Close the SSE connection. Does not clear listeners so you can
   * reconnect later with connect().
   */
  disconnect(): void {
    this.manualClose = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    if (this.es) {
      this.es.close();
      this.es = null;
    }
  }

  /**
   * Permanently tear down this client — clears all listeners and
   * cancels any pending reconnection. Instance is unusable after.
   */
  destroy(): void {
    this.disconnect();
    this.listeners.clear();
    this.destroyed = true;
  }

  // ------------------------------------------------------------------
  // Event emission
  // ------------------------------------------------------------------

  /**
   * Register a callback that fires for every parsed event.
   * Multiple listeners are supported.
   */
  onEvent(listener: SseListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ------------------------------------------------------------------
  // Outbound actions
  // ------------------------------------------------------------------

  /**
   * Send a player action to the backend over the SSE stream.
   * The SSE protocol uses POST for data transmission; here we use
   * a plain POST which the backend forwards into the stream.
   *
   * @param action - Structured player action (see SseAction below)
   */
  async sendAction(action: SseAction): Promise<void> {
    // Transform frontend action shape to backend SessionAction schema
    const payload: Record<string, unknown> = { action: action.kind }
    if (action.kind === 'redirect') {
      payload.redirect_prompt = action.targetScene
    }
    if (action.kind === 'switch_perspective') {
      payload.target_character = action.characterId
    }

    const response = await fetch(this.actionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown error');
      throw new Error(`sendAction failed (${response.status}): ${text}`);
    }
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  private onData(raw: MessageEvent): void {
    this.lastDataAt = Date.now();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.data);
    } catch {
      // Non-JSON comment or stray line — ignore silently.
      return;
    }

    // Resolve event type from the SSE "event" field (sent by server
    // as `event: <type>` lines). If absent, the MessageEvent typeName
    // is used as a fallback.
    const eventType: SseEventType =
      (raw as MessageEvent & { type?: string }).type === 'message'
        ? 'beat_ready'  // unknown type — let caller inspect `data`
        : ((raw as MessageEvent & { type?: string }).type as SseEventType) ?? 'beat_ready';

    const evt: SseEvent = {
      type: eventType,
      data: parsed,
      raw: raw.data,
      id: raw.lastEventId || undefined,
    };

    this.emit(evt);
  }

  private emit(event: SseEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Isolate listener failures so one bad listener
        // does not break the others.
      }
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    if (this.destroyed) return;

    this.reconnectAttempts += 1;
    this.reconnectDelay = Math.min(
      this.reconnectDelay * RECONNECT_BACKOFF,
      MAX_RECONNECT_DELAY,
    );

    this.emit({
      type: 'reconnecting',
      data: { attempt: this.reconnectAttempts, delayMs: this.reconnectDelay },
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.destroyed) this.connect();
    }, this.reconnectDelay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastDataAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      const silentFor = Date.now() - this.lastDataAt;
      if (silentFor > HEARTBEAT_TIMEOUT + HEARTBEAT_TOLERANCE) {
        // No data for too long — force reconnect.
        this.stopHeartbeat();
        if (this.es) {
          this.es.close();
          this.es = null;
        }
        if (!this.manualClose && !this.destroyed) {
          this.emit({ type: 'disconnected', data: { reason: 'heartbeat_timeout' } });
          this.scheduleReconnect();
        }
      }
    }, HEARTBEAT_TIMEOUT);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

// ------------------------------------------------------------------
// Structured action payloads the client can send
// ------------------------------------------------------------------

export type SseAction =
  | { kind: 'continue' }
  | { kind: 'stop' }
  | { kind: 'redirect'; targetScene?: string }
  | { kind: 'switch_perspective'; characterId: string }
  | { kind: 'chat'; text: string };
