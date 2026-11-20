import GameEngine, { headlessRuntime } from '@civ1/shared';
import type { CommandResult } from '@civ1/shared';
import { settingsFromLobby, type LobbyConfig } from './lobby';
import { InMemorySaveStore, type SaveStore } from './saveStore';
import { engineFogFilter, type OutboundEvent, type VisibilityFilter } from './fog';
import { classifyEvent } from './classify';
import type { CommandEnvelope } from './commands';

export interface RoomOptions {
  id: string;
  lobby: LobbyConfig;
  saveStore?: SaveStore;
  visibility?: VisibilityFilter;
}

/**
 * One GameRoom owns exactly one GameEngine instance and one tick loop.
 * The engine runs with the headless runtime, so no React store, canvas or
 * wall-clock animation can leak into the authoritative simulation.
 */
export class GameRoom {
  readonly id: string;
  readonly lobby: LobbyConfig;
  readonly engine: GameEngine;
  readonly saveStore: SaveStore;
  readonly visibility: VisibilityFilter;

  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private readonly listeners = new Set<(event: OutboundEvent) => void>();

  constructor(options: RoomOptions) {
    this.id = options.id;
    this.lobby = options.lobby;
    this.saveStore = options.saveStore ?? new InMemorySaveStore();
    this.engine = new GameEngine(null, headlessRuntime, this.saveStore);
    this.visibility = options.visibility ?? engineFogFilter(this.engine);
    // Every engine event is classified once here, then filtered per seat by
    // the transport. Nothing is sent straight from the engine to a socket.
    this.engine.onStateChange = (type, data) => {
      this.emit(classifyEvent(type, data));
    };
  }

  async start(): Promise<void> {
    // Tick-mode defers corpse removal (and other deadlines) onto the sim
    // clock instead of per-room setTimeout, so two rooms on the same seed
    // advance identically regardless of host load.
    this.engine.enableTickClock();
    await this.engine.initialize(settingsFromLobby(this.lobby));
    this.timer = setInterval(() => this.tick(), GameEngine.TICK_MS);
  }

  /** Subscribe to classified events. Returns an unsubscribe function. */
  addListener(listener: (event: OutboundEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: OutboundEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** Server-side identity gate: the context comes from the connection, never the payload. */
  submit(envelope: CommandEnvelope): CommandResult {
    return this.engine.submit(envelope.command, {
      ...envelope.context,
      seq: ++this.seq,
    });
  }

  private tick(): void {
    this.engine.advanceTick();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}
