import type { OutboundEvent } from '@shared/types/events';

/**
 * Client side of the event stream. The UI used to receive engine events via
 * `GameEngine.onStateChange`; over a socket the authority classifies and
 * fog-filters them first, and this function delivers the same wire events.
 */
export interface RemoteEventOptions {
  baseUrl: string;
  roomId: string;
  token: string;
  onEvent: (event: OutboundEvent) => void;
  /** Called once per successful connection — useful to synchronise tests. */
  onConnected?: () => void;
  onError?: (error: unknown) => void;
  /** Reconnect attempts after a dropped stream (default 3). */
  maxRetries?: number;
  /** Initial backoff between attempts, doubled each time (default 500 ms). */
  retryDelayMs?: number;
  /** Upper bound for the backoff (default 4000 ms). */
  maxRetryDelayMs?: number;
}

export interface EventSubscription {
  close(): void;
}

/** A connection that lasted this long counts as healthy. */
const STABLE_CONNECTION_MS = 5000;

export function subscribeToRoomEvents(options: RemoteEventOptions): EventSubscription {
  const controller = new AbortController();
  const url = `${options.baseUrl.replace(/\/$/, '')}/rooms/${encodeURIComponent(options.roomId)}`
    + `/events?token=${encodeURIComponent(options.token)}`;
  const maxRetries = options.maxRetries ?? 3;
  let delay = options.retryDelayMs ?? 500;
  const maxDelay = options.maxRetryDelayMs ?? 4000;

  const readStream = async (): Promise<void> => {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`EVENT_STREAM_${response.status}`);
    options.onConnected?.();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) { finished = true; break; }
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          options.onEvent(JSON.parse(line.slice(6)) as OutboundEvent);
        } catch (error) {
          options.onError?.(error);
        }
      }
    }
  };

  /**
   * Wait until the browser reports a network again.
   *
   * While the device is offline the reconnect attempts are not consumed: the
   * player gets their connection back and the room picks up where it left
   * off, instead of the stream giving up after a few seconds in a tunnel.
   *
   * The wait also ends when the subscription is closed, so a closing client
   * never leaves a promise pending.
   */
  const waitUntilOnline = async (): Promise<void> => {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return;
    if (navigator.onLine !== false) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        window.removeEventListener('online', done);
        controller.signal.removeEventListener('abort', done);
        resolve();
      };
      window.addEventListener('online', done, { once: true });
      controller.signal.addEventListener('abort', done, { once: true });
      // The event may have fired between the check and the listener.
      if (navigator.onLine !== false) done();
    });
  };

  const run = async () => {
    let attempt = 0;
    while (!controller.signal.aborted) {
      const startedAt = Date.now();
      try {
        await waitUntilOnline();
        if (controller.signal.aborted) return;
        await readStream();
      } catch (error) {
        if (controller.signal.aborted) return;
        options.onError?.(error);
      }
      if (controller.signal.aborted) return;
      // A connection that stayed up for a while resets the budget: a long,
      // healthy session followed by a drop deserves a full set of retries.
      if (Date.now() - startedAt > STABLE_CONNECTION_MS) {
        attempt = 0;
        delay = options.retryDelayMs ?? 500;
      }
      if (attempt >= maxRetries) return;
      attempt += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, maxDelay);
    }
  };
  void run();

  return { close: () => controller.abort() };
}
