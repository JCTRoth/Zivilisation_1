import { WebSocketServer, WebSocket } from 'ws';
import type { RoomManager } from './roomManager';
import type { OutboundEvent } from './fog';
import { tokenSeatResolver } from './auth';

export interface WsTransportOptions {
  port?: number;
  host?: string;
  /**
   * Authenticate the join: map a handshake token to a seat. Returning null
   * rejects the socket. The default is a demo mapping of `?seat=` (which a
   * real deployment must replace with a signed lobby token).
   */
  seatForToken?: (token: string | null, roomId: string) => number | null;
  /** When set, signed lobby tokens are required (overrides seatForToken). */
  secret?: string;
}

/**
 * WebSocket transport — the same contract as HttpTransport's SSE stream, but
 * bidirectional: commands arrive as messages, classified + fog-filtered
 * events are pushed back to the seat that owns the socket.
 */
export class WsTransport {
  private readonly wss: WebSocketServer;
  private readonly ready: Promise<void>;
  private readonly unsubscribes = new Map<WebSocket, () => void>();

  constructor(
    private readonly options: WsTransportOptions = {},
    readonly rooms: RoomManager,
  ) {
    this.wss = new WebSocketServer({ port: options.port ?? 0, host: options.host ?? '127.0.0.1' });
    this.ready = new Promise((resolve, reject) => {
      this.wss.once('listening', resolve);
      this.wss.once('error', reject);
      this.wss.on('connection', (socket, request) => this.onConnection(socket, request.url ?? ''));
    });
  }

  waitUntilReady(): Promise<void> {
    return this.ready;
  }

  get port(): number {
    const address = this.wss.address();
    return typeof address === 'object' && address ? address.port : 0;
  }

  async close(): Promise<void> {
    for (const [socket, unsubscribe] of this.unsubscribes) {
      unsubscribe();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'closed', reason: 'shutdown' }));
      }
    }
    this.unsubscribes.clear();
    await new Promise<void>((resolve, reject) => {
      this.wss.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private async onConnection(socket: WebSocket, url: string): Promise<void> {
    const params = new URL(url, 'http://localhost').searchParams;
    const roomId = params.get('room');
    const room = roomId ? await this.rooms.getOrLoad(roomId) : undefined;
    if (!room) {
      socket.close(4404, 'ROOM_NOT_FOUND');
      return;
    }
    const seatForToken = this.options.secret
      ? tokenSeatResolver(this.options.secret)
      : this.options.seatForToken
        ?? ((token: string | null) => (token === null ? null : Number(token)));
    const seat = seatForToken(params.get('token'), room.id);
    if (seat === null || !Number.isFinite(seat)) {
      socket.close(4401, 'UNAUTHORIZED');
      return;
    }

    const unsubscribe = room.addListener((event: OutboundEvent) => {
      if (!room.visibility.isVisible(event, seat)) return;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'event', event }));
      }
    });
    this.unsubscribes.set(socket, unsubscribe);
    socket.on('close', () => {
      unsubscribe();
      this.unsubscribes.delete(socket);
    });

    socket.on('message', (raw) => {
      let message: { type?: string; command?: unknown; requestId?: string; seq?: number };
      try {
        message = JSON.parse(String(raw)) as typeof message;
      } catch {
        socket.send(JSON.stringify({ type: 'result', ok: false, reason: 'BAD_REQUEST' }));
        return;
      }
      if (message.type !== 'command' || !message.command || typeof message.command !== 'object') {
        socket.send(JSON.stringify({ type: 'result', requestId: message.requestId, ok: false, reason: 'BAD_REQUEST' }));
        return;
      }
      const result = room.submit({
        command: message.command as never,
        context: { actorId: seat, turn: room.engine.currentTurn, seq: Number(message.seq) || 0 },
      });
      socket.send(JSON.stringify({ type: 'result', requestId: message.requestId, result }));
    });
  }
}
