import GameEngine from '@shared/game/engine/GameEngine';
import { headlessRuntime } from '@shared/ports/runtime';
import { createMemorySaveStore } from '@shared/ports/saveStore';
import type { OutboundEvent } from '@shared/types/events';
import { createRemoteSession, type RemoteSessionOptions } from './remoteSession';
import { setActiveSession } from './session';
import { subscribeToRoomEvents } from './remoteEvents';

/**
 * Remote-mode bootstrap. The server is authoritative; this tab runs a mirror
 * engine that never simulates anything — it only loads snapshots the server
 * publishes through the ordinary save/load path. All UI reads still work
 * because components talk to this engine exactly as before; all writes go to
 * the remote session, so the server remains the only authority.
 */
export async function createRemoteGame(options: RemoteSessionOptions): Promise<{
  engine: GameEngine;
  /** Fetch + apply the latest server snapshot immediately. */
  refresh(): Promise<void>;
  close(): void;
}> {
  const saveStore = createMemorySaveStore();
  const engine = new GameEngine(null, headlessRuntime, saveStore);

  const refresh = async () => {
    const response = await fetch(
      `${options.baseUrl.replace(/\/$/, '')}/rooms/${encodeURIComponent(options.roomId)}/state`
      + `?token=${encodeURIComponent(options.token ?? '')}`,
    );
    const payload = await response.json() as { ok: boolean; save?: string };
    if (!payload.ok || !payload.save) return;
    saveStore.set('civ1_savegame', payload.save);
    await engine.loadGame();
  };

  // Coalesce bursts of events/replies into one snapshot fetch, but expose an
  // awaited `refresh()` so callers that need a synchronised read can force it.
  let scheduled: Promise<void> | null = null;
  const scheduleRefresh = () => {
    if (scheduled) return;
    scheduled = Promise.resolve().then(async () => {
      scheduled = null;
      await refresh();
    });
  };

  setActiveSession(createRemoteSession({ ...options, onResult: scheduleRefresh }));

  const subscription = subscribeToRoomEvents({
    baseUrl: options.baseUrl,
    roomId: options.roomId,
    token: options.token ?? '',
    onConnected: () => void refresh(),
    onEvent: (_event: OutboundEvent) => scheduleRefresh(),
    onError: (error) => console.error('[remoteGame] event stream error', error),
  });

  try {
    await refresh();
  } catch (error) {
    subscription.close();
    setActiveSession(null);
    throw error;
  }

  return {
    engine,
    refresh,
    close: () => {
      subscription.close();
      setActiveSession(null);
    },
  };
}
