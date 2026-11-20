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
}

export interface EventSubscription {
  close(): void;
}

export function subscribeToRoomEvents(options: RemoteEventOptions): EventSubscription {
  const controller = new AbortController();
  const url = `${options.baseUrl.replace(/\/$/, '')}/rooms/${encodeURIComponent(options.roomId)}`
    + `/events?token=${encodeURIComponent(options.token)}`;
  const maxRetries = options.maxRetries ?? 3;
  let delay = options.retryDelayMs ?? 500;

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

  const run = async () => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (controller.signal.aborted) return;
      try {
        await readStream();
        // A clean end of stream is treated like a drop so a reconnect occurs.
      } catch (error) {
        if (controller.signal.aborted) return;
        options.onError?.(error);
      }
      if (attempt === maxRetries || controller.signal.aborted) return;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  };
  void run();

  return { close: () => controller.abort() };
}
