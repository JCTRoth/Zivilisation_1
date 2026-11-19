import GameEngine, { headlessRuntime } from '@civ1/shared';
import type { CommandResult } from '@civ1/shared';
import { settingsFromLobby, type LobbyConfig } from './lobby';
import { InMemorySaveStore, type SaveStore } from './saveStore';
import { passAllFilter, type VisibilityFilter } from './fog';
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

  constructor(options: RoomOptions) {
    this.id = options.id;
    this.lobby = options.lobby;
    this.saveStore = options.saveStore ?? new InMemorySaveStore();
    this.visibility = options.visibility ?? passAllFilter;
    this.engine = new GameEngine(null, headlessRuntime, this.saveStore);
  }

  async start(): Promise<void> {
    // Tick-mode defers corpse removal (and other deadlines) onto the sim
    // clock instead of per-room setTimeout, so two rooms on the same seed
    // advance identically regardless of host load.
    this.engine.enableTickClock();
    await this.engine.initialize(settingsFromLobby(this.lobby));
    this.timer = setInterval(() => this.tick(), GameEngine.TICK_MS);
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
    // Flush classified events to connections here once the transport and fog
    // classifier land. The engine itself is advanced by commands + turn loop.
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
