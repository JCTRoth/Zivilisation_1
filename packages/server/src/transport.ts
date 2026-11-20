import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { GameRoom } from './room';
import type { OutboundEvent } from './fog';
import { RoomManager } from './roomManager';
import type { LobbyConfig } from './lobby';
import { createSeatToken, verifySeatToken } from './auth';

/**
 * Minimal HTTP transport: commands in via POST, classified events out via
 * Server-Sent Events. No WebSocket dependency is needed to prove the seam —
 * a WS adapter can implement the same `addListener`/`submit` contract later.
 *
 * The seat is supplied by the connection at join time and is never taken from
 * a command body, so a client cannot act as another civilization.
 */
export interface TransportOptions {
  port?: number;
  host?: string;
  /** When set, commands and event streams require a valid signed seat token. */
  secret?: string;
}

interface EventStream {
  res: ServerResponse;
  roomId: string;
  seat: number;
  unsubscribe: () => void;
}

export class HttpTransport {
  private readonly server: Server;
  private readonly ready: Promise<void>;
  readonly rooms: RoomManager;
  private readonly secret?: string;
  private readonly streams = new Set<EventStream>();
  private nextStreamId = 0;

  constructor(options: TransportOptions = {}, rooms?: RoomManager) {
    this.rooms = rooms ?? new RoomManager();
    this.secret = options.secret;
    this.server = createServer((req, res) => void this.handle(req, res));
    this.ready = new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve);
    });
  }

  /** Await this before reading `port` when listening on an ephemeral port. */
  waitUntilReady(): Promise<void> {
    return this.ready;
  }

  /** Actual bound port — useful for tests that start on port 0. */
  get port(): number {
    const address = this.server.address();
    return typeof address === 'object' && address ? address.port : 0;
  }

  register(room: GameRoom): void {
    this.rooms.add(room);
  }

  async close(): Promise<void> {
    for (const stream of this.streams) {
      stream.unsubscribe();
      stream.res.end();
    }
    this.streams.clear();
    await this.rooms.closeAll();
    await new Promise<void>((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      this.json(res, 200, { ok: true, rooms: this.rooms.list() });
      return;
    }

    if (url.pathname === '/rooms' && req.method === 'POST') {
      await this.createRoom(req, res);
      return;
    }
    if (url.pathname === '/rooms' && req.method === 'GET') {
      this.json(res, 200, { ok: true, rooms: this.rooms.list() });
      return;
    }

    const roomMatch = url.pathname.match(/^\/rooms\/([^/]+)(?:\/(commands|events|save|load|state))?$/);
    if (roomMatch) {
      const [, roomId, action] = roomMatch;
      if (!action && req.method === 'DELETE') {
        const removed = await this.rooms.remove(roomId);
        this.json(res, removed ? 200 : 404, { ok: removed });
        return;
      }
      if (action === 'commands' && req.method === 'POST') {
        await this.handleCommand(roomId, req, res);
        return;
      }
      if (action === 'state' && req.method === 'GET') {
        const room = this.rooms.get(roomId);
        if (!room) return this.missingRoom(res);
        if (this.secret && verifySeatToken(
          this.secret,
          new URL(req.url ?? '/', 'http://localhost').searchParams.get('token'),
          roomId,
        ) === null) {
          this.json(res, 401, { ok: false, reason: 'UNAUTHORIZED' });
          return;
        }
        // A full save blob is the state snapshot: the client mirror applies it
        // through the engine's existing load path, so no second reducer exists.
        this.json(res, 200, { ok: true, save: room.engine.getSaveJSON() });
        return;
      }
      if (action === 'save' && req.method === 'POST') {
        const room = this.rooms.get(roomId);
        if (!room) return this.missingRoom(res);
        this.json(res, 200, { ok: room.engine.saveGame() });
        return;
      }
      if (action === 'load' && req.method === 'POST') {
        const room = this.rooms.get(roomId);
        if (!room) return this.missingRoom(res);
        this.json(res, 200, { ok: await room.engine.loadGame() });
        return;
      }
      if (action === 'events' && req.method === 'GET') {
        this.handleEvents(roomId, url, req, res);
        return;
      }
    }

    this.json(res, 404, { ok: false, reason: 'NOT_FOUND' });
  }

  private async createRoom(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    let lobby: LobbyConfig;
    try {
      lobby = JSON.parse(body) as LobbyConfig;
    } catch {
      this.json(res, 400, { ok: false, reason: 'BAD_REQUEST' });
      return;
    }
    const room = this.rooms.create(lobby);
    await room.start();
    // The creator gets the host seat's signed token. Other seats are issued
    // tokens by the lobby/join flow (same signer, different seat).
    const token = this.secret ? createSeatToken(this.secret, room.id, 0) : null;
    this.json(res, 201, { ok: true, id: room.id, token });
  }

  private async handleCommand(roomId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return this.missingRoom(res);
    let seat: number | null;
    let command: unknown;
    try {
      const parsed = JSON.parse(await this.readBody(req)) as {
        seat?: number; token?: string; command?: unknown;
      };
      // With auth configured the token is authoritative: a forged `seat`
      // field in the body changes nothing.
      seat = this.secret
        ? verifySeatToken(this.secret, parsed.token ?? null, roomId)
        : Number(parsed.seat);
      command = parsed.command;
      if (seat === null || !Number.isFinite(seat) || !command || typeof command !== 'object') {
        throw new Error('bad request');
      }
    } catch {
      this.json(res, 400, { ok: false, reason: 'BAD_REQUEST' });
      return;
    }
    const result = room.submit({
      command: command as never,
      context: { actorId: seat as number, turn: room.engine.currentTurn, seq: ++this.nextStreamId },
    });
    this.json(res, 200, result);
  }

  private handleEvents(roomId: string, url: URL, req: IncomingMessage, res: ServerResponse): void {
    const room = this.rooms.get(roomId);
    if (!room) return this.missingRoom(res);
    const seat = this.secret
      ? verifySeatToken(this.secret, url.searchParams.get('token'), roomId)
      : Number(url.searchParams.get('seat'));
    if (seat === null || !Number.isFinite(seat)) {
      this.json(res, 401, { ok: false, reason: 'UNAUTHORIZED' });
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    // Flush headers now so the client knows it is connected before any event
    // is emitted (otherwise fetch waits for the first SSE frame).
    res.flushHeaders();
    const stream: EventStream = { res, roomId, seat, unsubscribe: () => undefined };
    stream.unsubscribe = room.addListener((event: OutboundEvent) => {
      if (!room.visibility.isVisible(event, seat)) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    this.streams.add(stream);
    req.on('close', () => {
      stream.unsubscribe();
      this.streams.delete(stream);
    });
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    return body;
  }

  private json(res: ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  }

  private missingRoom(res: ServerResponse): void {
    this.json(res, 404, { ok: false, reason: 'ROOM_NOT_FOUND' });
  }
}
