import { GameRoom } from './room';
import type { LobbyConfig } from './lobby';

/**
 * Room lifecycle: create from a lobby payload, look up, and dispose. IDs are
 * sequential counters — transport-level, not gameplay state, but still free
 * of timestamps so a test can assert them.
 */
export class RoomManager {
  private readonly rooms = new Map<string, GameRoom>();
  private nextId = 0;

  create(lobby: LobbyConfig, id?: string): GameRoom {
    const roomId = id ?? `room_${++this.nextId}`;
    if (this.rooms.has(roomId)) throw new Error(`ROOM_EXISTS: ${roomId}`);
    const room = new GameRoom({ id: roomId, lobby });
    this.rooms.set(roomId, room);
    return room;
  }

  /** Add an already-constructed room (tests, custom storage/fog). */
  add(room: GameRoom): void {
    if (this.rooms.has(room.id)) throw new Error(`ROOM_EXISTS: ${room.id}`);
    this.rooms.set(room.id, room);
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
    return true;
  }

  async closeAll(): Promise<void> {
    for (const room of this.rooms.values()) room.stop();
    this.rooms.clear();
  }
}
