/* =================================================================
   ABQ Roleplay Lab — useStoryStream React Hook

   Wraps SseClient in React lifecycle:
   - Creates / tears down the SSE connection on mount / unmount
   - Accumulates events in state
   - Exposes sendAction() bound to the client
   - Tracks isConnected and currentBeat (last beat_ready event)
   - Auto-reconnects with back-off on unexpected disconnect
   ================================================================= */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SseAction, SseEvent } from '../lib/sseClient';
import { SseClient, MAX_RECONNECT_DELAY } from '../lib/sseClient';

const DEFAULT_SSE_URL = '/api/story/stream';

export interface UseStoryStreamReturn {
  /** Ordered list of all received events since mount */
  events: SseEvent[];

  /** Send a player action into the story stream */
  sendAction: (action: SseAction) => Promise<void>;

  /** True while the EventSource is open and healthy */
  isConnected: boolean;

  /** The most recent beat_ready event, or null */
  currentBeat: (SseEvent & { type: 'beat_ready' }) | null;

  /** Human-readable connection state for the UI */
  connectionState: 'connected' | 'connecting' | 'disconnected' | 'error';
}

export interface UseStoryStreamOptions {
  /** SSE endpoint URL (defaults to /api/story/stream) */
  url?: string;

  /** Maximum events to keep in state (unbounded if omitted) */
  maxEvents?: number;
}

/**
 * React hook that manages a live SSE story stream.
 *
 *   const { events, sendAction, isConnected, currentBeat } =
 *     useStoryStream({ url: '/api/story/stream' });
 *
 *   // Send a "continue" action when the user clicks:
 *   await sendAction({ kind: 'continue' });
 */
export function useStoryStream(options: UseStoryStreamOptions = {}): UseStoryStreamReturn {
  const { url = DEFAULT_SSE_URL, maxEvents } = options;

  const [events, setEvents] = useState<SseEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<UseStoryStreamReturn['connectionState']>('disconnected');
  const [currentBeat, setCurrentBeat] = useState<UseStoryStreamReturn['currentBeat']>(null);

  // Refs keep the client stable across renders without re-triggering
  // the useEffect that opens the connection.
  const clientRef    = useRef<SseClient | null>(null);
  const clientFrozen = useRef(false); // true while reconnect is in-flight

  // Stable callback — recreated only if url changes.
  const handleEvent = useCallback(
    (event: SseEvent) => {
      // Connection lifecycle events update state but must NOT enter the
      // narrative event stream (otherwise {"attempt": 0} etc. render
      // as fake story events in the StoryPanel).
      const narrativeTypes = new Set([
        'scene_change',
        'agent_act',
        'agent_speak',
        'agent_think',
        'world_state_delta',
        'beat_ready',
        'status',
        'outline',
        'complete',
        'error',
      ]);
      if (narrativeTypes.has(event.type)) {
        setEvents((prev) => {
          const next = [...prev, event];
          if (typeof maxEvents === 'number' && next.length > maxEvents) {
            return next.slice(-maxEvents);
          }
          return next;
        });
      }

      if (event.type === 'beat_ready') {
        setCurrentBeat(event as SseEvent & { type: 'beat_ready' });
      }

      if (event.type === 'connected')   setConnectionState('connected');
      if (event.type === 'disconnected') setConnectionState('disconnected');
      if (event.type === 'reconnecting') setConnectionState('connecting');
    },
    [maxEvents],
  );

  // Create the client once per url; destroy on url change.
  useEffect(() => {
    // Tear down the previous client if url changed.
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current.destroy();
      clientRef.current = null;
    }

    const client = new SseClient(url, url.replace(/\/stream$/, '/action'));
    clientRef.current = client;

    // Wire up the typed event listener.
    const unsubscribe = client.onEvent(handleEvent);

    // Open the connection.
    client.connect();

    return () => {
      unsubscribe();
      client.disconnect();
      client.destroy();
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Mirror connection state into isConnected for convenience.
  useEffect(() => {
    setIsConnected(connectionState === 'connected');
  }, [connectionState]);

  // Auto-reconnect: if the connection drops unexpectedly, open a new
  // SseClient fresh.  This avoids accumulating stale state inside a
  // client that has exhausted its own internal retries.
  useEffect(() => {
    if (connectionState === 'disconnected' || connectionState === 'error') {
      // Guard against re-entering while a reconnect is already in
      // progress (the SseClient itself schedules retries, but we
      // provide a hard re-init after MAX_RECONNECT_DELAY has elapsed
      // without recovery).
      if (!clientFrozen.current) {
        clientFrozen.current = true;
        const maxWait = MAX_RECONNECT_DELAY + 5_000;
        const timer = setTimeout(() => {
          clientFrozen.current = false;
          if (clientRef.current && connectionState !== 'connected' as string) {
            // Force a fresh client — discard the old one which has
            // saturated its back-off.
            clientRef.current.disconnect();
            clientRef.current.destroy();
            const fresh = new SseClient(url, url.replace(/\/stream$/, '/action'));
            clientRef.current = fresh;
            fresh.onEvent(handleEvent);
            fresh.connect();
          }
        }, maxWait);

        return () => clearTimeout(timer);
      }
    }

    if (connectionState === 'connected') {
      clientFrozen.current = false;
    }
  }, [connectionState, url, handleEvent]);

  const sendAction = useCallback(
    async (action: SseAction): Promise<void> => {
      const client = clientRef.current;
      if (!client || !isConnected) {
        throw new Error('Cannot send action — SSE connection is not open.');
      }
      await client.sendAction(action);
    },
    [isConnected],
  );

  return { events, sendAction, isConnected, currentBeat, connectionState };
}
