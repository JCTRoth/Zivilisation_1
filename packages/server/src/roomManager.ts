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
  loadBlob(roomId: string, slot: string): Promise<string | null>;
  upsertRoom(id: string, lobby: LobbyConfig): Promise<void>;
  saveBlob(roomId: string, slot: string, json: string): Promise<void>;
  appendEvent(
    roomId: string, seq: number, seat: number | null, type: string, payload: unknown,
  ): Promise<void>;
  lastEventSeq(roomId: string): Promise<number>;
  removeRoom(id: string): Promise<void>;
}

/**
 * Room lifecycle: create from a lobby payload, look up, and dispose. IDs are
 * sequential counters — transport-level, not gameplay state, but still free
 * of timestamps so a test can assert them.
 */
export class RoomManager {
  private readonly rooms = new Map<string, GameRoom>();
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
        ).catch((error) => console.error('[RoomManager] event persist failed', error));
        void this.bus.publish({ roomId: id, event, sourceId: this.sourceId });
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
        .catch((error) => console.error('[RoomManager] room persist failed', error));
    }
    return this.makeRoom(roomId, lobby, this.sqlite?.rooms.lastEventSeq(roomId) ?? 0);
  }

  /** Create and hydrate from an async store before the caller starts the room. */
  async createAsync(lobby: LobbyConfig, id?: string): Promise<GameRoom> {
    const roomId = id ?? `room_${++this.nextId}`;
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
      .catch((error) => console.error('[RoomManager] room persist failed', error));
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

  list(): Array<{ id: string; turn: number; started: boolean }> {
    return [...this.rooms.values()].map((room) => ({
      id: room.id,
      turn: room.engine.currentTurn,
      started: room.engine.isInitialized,
    }));
  }

  async remove(id: string): Promise<boolean> {
    const room = this.rooms.get(id);
    if (!room) return false;
    room.stop();
    this.rooms.delete(id);
    this.sqlite?.rooms.removeRoom(id);
    void this.asyncStore?.removeRoom(id)
      .catch((error) => console.error('[RoomManager] room delete failed', error));
    return true;
  }

  async closeAll(): Promise<void> {
    for (const room of this.rooms.values()) room.stop();
    this.rooms.clear();
    this.unsubscribeBus();
    await this.bus.close();
  }
}
