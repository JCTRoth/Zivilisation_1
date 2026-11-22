import GameEngine, { headlessRuntime } from '@civ1/shared';
import type { CommandResult } from '@civ1/shared';
import { settingsFromLobby, type LobbyConfig } from './lobby';
import { InMemorySaveStore, type SaveStore } from './saveStore';
import { engineFogFilter, type OutboundEvent, type VisibilityFilter } from './fog';
import { classifyEvent } from './classify';
import type { CommandEnvelope } from './commands';
import { metrics } from './metrics';
import { logger } from './logger';

export interface RoomOptions {
  id: string;
  lobby: LobbyConfig;
  saveStore?: SaveStore;
  visibility?: VisibilityFilter;
  /** Persist periodically after commands (default true, room durability). */
  autoSave?: boolean;
  /** Append every classified event to the outbox (replay/audit). */
  onEvent?: (event: OutboundEvent, seq: number) => void;
  /** Sequence to continue from when restoring a room with an outbox. */
  startEventSeq?: number;
  /** Mirror a successful save to an async store (multi-process mode). */
  onSave?: (slot: string, json: string) => void;
  /** Periodic outbox retention callback. */
  onTrimOutbox?: (keepSeq: number) => void;
}

/**
 * One GameRoom owns exactly one GameEngine instance and one tick loop.
 * The engine runs with the headless runtime, so no React store, canvas or
 * wall-clock animation can leak into the authoritative simulation.
 */
/** Save at most once every 50 ticks (5 s at TICK_MS=100). */
const AUTOSAVE_EVERY_TICKS = 50;

export class GameRoom {
  readonly id: string;
  readonly lobby: LobbyConfig;
  readonly engine: GameEngine;
  readonly saveStore: SaveStore;
  readonly visibility: VisibilityFilter;

  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly autoSave: boolean;
  private dirty = false;
  private eventSeq: number;
  private readonly commandResults = new Map<string, CommandResult>();
  private readonly onEvent?: (event: OutboundEvent, seq: number) => void;
  private readonly onSave?: (slot: string, json: string) => void;
  private readonly onTrimOutbox?: (keepSeq: number) => void;
  private readonly listeners = new Set<(event: OutboundEvent) => void>();

  constructor(options: RoomOptions) {
    this.id = options.id;
    this.lobby = options.lobby;
    this.saveStore = options.saveStore ?? new InMemorySaveStore();
    this.autoSave = options.autoSave ?? true;
    this.eventSeq = options.startEventSeq ?? 0;
    this.onEvent = options.onEvent;
    this.onSave = options.onSave;
    this.onTrimOutbox = options.onTrimOutbox;
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
    // A restored room carries its save in the injected store; load it instead
    // of generating a new world so the game continues exactly where it was.
    if (this.saveStore.get('civ1_savegame') === null) {
      await this.engine.initialize(settingsFromLobby(this.lobby));
    } else if (!await this.engine.loadGame()) {
      logger.warn('invalid save, starting fresh', { roomId: this.id });
      await this.engine.initialize(settingsFromLobby(this.lobby));
    }
    this.timer = setInterval(() => this.tick(), GameEngine.TICK_MS);
  }

  /** Subscribe to classified events. Returns an unsubscribe function. */
  addListener(listener: (event: OutboundEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Seats with a live event stream right now — the honest "who is here"
   * signal for the join screen. An invite being minted does not mean anyone
   * is connected, so this is tracked per transport connection, not from the
   * seats table.
   */
  private readonly connections = new Set<number>();

  seatConnected(seat: number): void {
    this.connections.add(seat);
  }

  seatDisconnected(seat: number): void {
    this.connections.delete(seat);
  }

  get connectedSeats(): number[] {
    return [...this.connections].sort((a, b) => a - b);
  }

  /**
   * Seats an invite was minted for, in this process. The seats table is the
   * durable copy; this exists so a server without persistence (and a test)
   * still refuses to hand the same seat to two joiners.
   */
  private readonly claimed = new Set<number>();

  claimSeat(seat: number): void {
    this.claimed.add(seat);
  }

  get claimedSeats(): number[] {
    return [...this.claimed].sort((a, b) => a - b);
  }

  /** Forward an event published by another server process to local clients. */
  receiveRemote(event: OutboundEvent): void {
    if (typeof event.seq === 'number') this.eventSeq = Math.max(this.eventSeq, event.seq);
    for (const listener of this.listeners) listener(event);
  }

  private emit(event: OutboundEvent): void {
    const sequenced: OutboundEvent = { ...event, seq: ++this.eventSeq };
    metrics.event(event.type);
    logger.info('event', { roomId: this.id, eventSeq: this.eventSeq, type: event.type });
    this.onEvent?.(sequenced, this.eventSeq);
    for (const listener of this.listeners) listener(sequenced);
  }

  /** Server-side identity gate: the context comes from the connection, never the payload. */
  submit(envelope: CommandEnvelope): CommandResult {
    const { actorId, seq } = envelope.context;
    const key = `${actorId}:${seq}`;
    const cached = this.commandResults.get(key);
    if (cached) return cached;
    // A seq at or below the persisted high-water mark was already applied,
    // possibly on another worker or before a restart.
    if (seq > 0 && seq <= this.engine.getLastCommandSeq(actorId)) {
      return { ok: false, reason: 'STALE_COMMAND' };
    }

    const result = this.engine.submit(envelope.command, { ...envelope.context, seq });
    metrics.command(envelope.command.type, result.ok ? 'ok' : 'rejected');
    logger.info('command', {
      roomId: this.id, commandSeq: seq, type: envelope.command.type, ok: result.ok,
    });
    if (seq > 0) this.engine.noteCommand(actorId, seq);
    this.commandResults.set(key, result);
    if (this.commandResults.size > 256) {
      this.commandResults.delete(this.commandResults.keys().next().value as string);
    }
    if (result.ok && this.autoSave) this.dirty = true;
    return result;
  }

  private tick(): void {
    this.engine.advanceTick();
    // Keep at most 10k events; a client older than that needs a snapshot.
    if (this.onTrimOutbox && this.eventSeq > 10_000 && this.engine.currentTick % 600 === 0) {
      this.onTrimOutbox(this.eventSeq - 10_000);
    }
    if (this.dirty && this.autoSave && this.engine.currentTick % AUTOSAVE_EVERY_TICKS === 0) {
      this.flushSave();
    }
  }

  /** Persist immediately — used by `/save`, graceful shutdown and tests. */
  flushSave(): boolean {
    if (!this.engine.isInitialized) return false;
    const ok = this.engine.saveGame();
    if (ok) metrics.save();
    if (ok) {
      const slot = 'civ1_savegame';
      const json = this.saveStore.get(slot);
      if (json && this.onSave) this.onSave(slot, json);
      this.dirty = false;
    }
    return ok;
  }

  stop(): void {
    if (this.dirty && this.autoSave) this.flushSave();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}
