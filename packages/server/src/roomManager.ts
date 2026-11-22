import { logger } from "./logger";
import { GameRoom } from './room';
import type { LobbyConfig } from './lobby';
import type { SaveStore } from './saveStore';
import { createMemorySaveStore } from '@civ1/shared';
import type { SqlitePersistence } from './persistence/sqliteStore';
import { LocalEventBus, type RoomEventBus } from './pubsub';

/**
 * Async persistence contract for multi-process deployments. SQLite satisfies
 * the synchronous path directly; Postgres implements this interface and is
 * wrapped by `createAsync`/`restoreAll`.
 */
/** Identifies one server process on the shared event bus. */
export type RoomEventBusSource = string;

export interface AsyncRoomStore {
  loadRooms(): Promise<Array<{ id: string; lobby: LobbyConfig }>>;
  loadRoom(id: string): Promise<{ id: string; lobby: LobbyConfig } | null>;
  loadBlob(roomId: string, slot: string): Promise<string | null>;
  upsertRoom(id: string, lobby: LobbyConfig): Promise<void>;
  saveBlob(roomId: string, slot: string, json: string): Promise<void>;
  appendEvent(
    roomId: string, seq: number, seat: number | null, type: string, payload: unknown,
  ): Promise<void>;
  lastEventSeq(roomId: string): Promise<number>;
  oldestEventSeq(roomId: string): Promise<number>;
  trimOutbox(roomId: string, keepSeq: number): Promise<void>;
  readEvents(
    roomId: string, after: number, limit?: number,
  ): Promise<Array<{ seq: number; seat: number | null; type: string; payload: unknown }>>;
  removeRoom(id: string): Promise<void>;
}

/** One running game as the join screen sees it. */
export interface RoomSummary {
  id: string;
  turn: number;
  started: boolean;
  lobby: LobbyConfig;
  /** Seats an invite was minted for (from the seats table). */
  seats: Array<{ seat: number; color: string | null; status: string; invitedAt: number | null }>;
  /** Subset of those seats with a live event stream right now. */
  connectedSeats: number[];
}

/**
 * Room lifecycle: create from a lobby payload, look up, and dispose. IDs are
 * sequential counters — transport-level, not gameplay state, but still free
 * of timestamps so a test can assert them.
 */
export class RoomManager {
  private readonly rooms = new Map<string, GameRoom>();
  private readonly pendingRooms = new Map<string, Promise<GameRoom | undefined>>();
  private readonly sqlite?: SqlitePersistence;
  private readonly asyncStore?: AsyncRoomStore;
  private readonly bus: RoomEventBus;
  private readonly unsubscribeBus: () => void;
  private readonly sourceId: string;
  private static nextSourceId = 0;
  private nextId = 0;

  constructor(
    persistence?: SqlitePersistence | AsyncRoomStore,
    bus: RoomEventBus = new LocalEventBus(),
    sourceId?: string,
  ) {
    this.sourceId = sourceId ?? `mgr_${++RoomManager.nextSourceId}`;
    if (persistence && 'db' in persistence) this.sqlite = persistence;
    else if (persistence && 'loadRooms' in persistence) this.asyncStore = persistence;
    this.bus = bus;
    // Events from another process are forwarded to the matching local room.
    this.unsubscribeBus = bus.subscribe((message) => {
      if (message.sourceId === this.sourceId) return; // never echo our own events
      this.rooms.get(message.roomId)?.receiveRemote(message.event);
    });
  }

  private makeRoom(
    id: string,
    lobby: LobbyConfig,
    startEventSeq: number,
    saveStore?: SaveStore,
  ): GameRoom {
    const store = saveStore
      ?? this.sqlite?.saveStoreFor(id)
      ?? createMemorySaveStore();
    const room = new GameRoom({
      id,
      lobby,
      saveStore: store,
      startEventSeq,
      onEvent: (event, seq) => {
        this.sqlite?.rooms.appendEvent(id, seq, event.civId ?? null, event.type, event.payload);
        void this.asyncStore?.appendEvent(
          id, seq, event.civId ?? null, event.type, event.payload,
        ).catch((error) => logger.error('event persist failed', { detail: String(error) }));
        void this.bus.publish({ roomId: id, event, sourceId: this.sourceId });
      },
      onSave: (slot, json) => {
        void this.asyncStore?.saveBlob(id, slot, json)
          .catch((error) => logger.error('save failed', { detail: String(error) }));
      },
      onTrimOutbox: (keepSeq) => {
        this.sqlite?.rooms.trimOutbox(id, keepSeq);
        void this.asyncStore?.trimOutbox(id, keepSeq)
          .catch((error) => logger.error('outbox trim failed', { detail: String(error) }));
      },
    });
    this.rooms.set(id, room);
    return room;
  }

  create(lobby: LobbyConfig, id?: string): GameRoom {
    const roomId = id ?? `room_${++this.nextId}`;
    if (this.rooms.has(roomId)) throw new Error(`ROOM_EXISTS: ${roomId}`);
    this.sqlite?.rooms.upsertRoom(roomId, lobby);
    if (this.asyncStore) {
      void this.asyncStore.upsertRoom(roomId, lobby)
        .catch((error) => logger.error('room persist failed', { detail: String(error) }));
    }
    return this.makeRoom(roomId, lobby, this.sqlite?.rooms.lastEventSeq(roomId) ?? 0);
  }

  /** Create and hydrate from an async store before the caller starts the room. */
  async createAsync(lobby: LobbyConfig, id?: string): Promise<GameRoom> {
    let roomId = id;
    if (!roomId && this.asyncStore) {
      // A fresh worker's counter starts at zero while the shared DB already
      // holds rooms from previous processes: derive an unused id from it.
      const existing = new Set((await this.asyncStore.loadRooms()).map((r) => r.id));
      do { roomId = `room_${++this.nextId}`; } while (existing.has(roomId));
    } else {
      roomId = roomId ?? `room_${++this.nextId}`;
    }
    if (this.rooms.has(roomId)) throw new Error(`ROOM_EXISTS: ${roomId}`);
    let startSeq = 0;
    if (this.asyncStore) {
      await this.asyncStore.upsertRoom(roomId, lobby);
      startSeq = await this.asyncStore.lastEventSeq(roomId);
    } else {
      this.sqlite?.rooms.upsertRoom(roomId, lobby);
      startSeq = this.sqlite?.rooms.lastEventSeq(roomId) ?? 0;
    }
    const room = this.makeRoom(roomId, lobby, startSeq);
    await this.hydrate(room, roomId);
    return room;
  }

  private async hydrate(room: GameRoom, roomId: string): Promise<void> {
    if (!this.asyncStore) return;
    const blob = await this.asyncStore.loadBlob(roomId, 'civ1_savegame');
    if (blob) room.saveStore.set('civ1_savegame', blob);
  }

  /** Add an already-constructed room (tests, custom storage/fog). */
  add(room: GameRoom): void {
    if (this.rooms.has(room.id)) throw new Error(`ROOM_EXISTS: ${room.id}`);
    this.sqlite?.rooms.upsertRoom(room.id, room.lobby);
    void this.asyncStore?.upsertRoom(room.id, room.lobby)
      .catch((error) => logger.error('room persist failed', { detail: String(error) }));
    this.rooms.set(room.id, room);
  }

  /** Rebuild and start all rooms persisted from a previous server process. */
  async restoreAll(): Promise<GameRoom[]> {
    const restored: GameRoom[] = [];
    if (this.asyncStore) {
      for (const { id, lobby } of await this.asyncStore.loadRooms()) {
        if (this.rooms.has(id)) continue;
        const startSeq = await this.asyncStore.lastEventSeq(id);
        const room = this.makeRoom(id, lobby, startSeq);
        await this.hydrate(room, id);
        await room.start();
        restored.push(room);
      }
      return restored;
    }
    if (!this.sqlite) return [];
    for (const { id, lobby } of this.sqlite.rooms.listRooms()) {
      if (this.rooms.has(id)) continue;
      const numeric = Number(id.match(/^room_(\d+)$/)?.[1]);
      if (Number.isFinite(numeric)) this.nextId = Math.max(this.nextId, numeric);
      const room = this.makeRoom(id, lobby, this.sqlite.rooms.lastEventSeq(id));
      await room.start();
      restored.push(room);
    }
    return restored;
  }

  get(id: string): GameRoom | undefined {
    return this.rooms.get(id);
  }

  /**
   * Look up a room, loading it from the shared store if another process created
   * it. Concurrent callers share one load promise so a worker never starts two
   * engines for the same room.
   */
  async getOrLoad(id: string): Promise<GameRoom | undefined> {
    const local = this.rooms.get(id);
    if (local) return local;
    if (!this.asyncStore) return undefined;
    const pending = this.pendingRooms.get(id);
    if (pending) return pending;
    const loading = (async () => {
      const record = await this.asyncStore!.loadRoom(id);
      if (!record) return undefined;
      const existing = this.rooms.get(id);
      if (existing) return existing;
      const startSeq = await this.asyncStore!.lastEventSeq(id);
      const room = this.makeRoom(id, record.lobby, startSeq);
      await this.hydrate(room, id);
      await room.start();
      return room;
    })().finally(() => this.pendingRooms.delete(id));
    this.pendingRooms.set(id, loading);
    return loading;
  }

  list(): Array<{ id: string; turn: number; started: boolean }> {
    return [...this.rooms.values()].map((room) => ({
      id: room.id,
      turn: room.engine.currentTurn,
      started: room.engine.isInitialized,
    }));
  }

  /**
   * The join screen's data: settings, progress and seats for every room that
   * is actually running (loaded in this process). Seats come from the seats
   * table — an invite was minted for them — and `connectedSeats` says which
   * of those are here right now.
   */
  summaries(): RoomSummary[] {
    return [...this.rooms.values()].map((room) => {
      // In-memory claims first (a server without persistence still knows its
      // own invites), the seats table then fills in colour and mint time.
      const seats = new Map<number, RoomSummary['seats'][number]>();
      for (const seat of room.claimedSeats) {
        seats.set(seat, {
          seat,
          color: room.lobby.playerColors?.[seat] ?? null,
          status: 'joined',
          invitedAt: null,
        });
      }
      for (const row of this.sqlite?.rooms.listSeats(room.id) ?? []) {
        seats.set(row.seat, row);
      }
      return {
        id: room.id,
        turn: room.engine.currentTurn,
        started: room.engine.isInitialized,
        lobby: room.lobby,
        seats: [...seats.values()].sort((a, b) => a.seat - b.seat),
        connectedSeats: room.connectedSeats,
      };
    });
  }

  async remove(id: string): Promise<boolean> {
    const room = this.rooms.get(id);
    if (!room) return false;
    room.stop();
    this.rooms.delete(id);
    this.sqlite?.rooms.removeRoom(id);
    void this.asyncStore?.removeRoom(id)
      .catch((error) => logger.error('room delete failed', { detail: String(error) }));
    return true;
  }

  async closeAll(): Promise<void> {
    for (const room of this.rooms.values()) room.stop();
    this.rooms.clear();
    this.unsubscribeBus();
    await this.bus.close();
  }
}
