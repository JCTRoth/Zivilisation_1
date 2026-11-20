import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import type { GameRoom } from './room';
import type { OutboundEvent } from './fog';
import { RoomManager } from './roomManager';
import type { LobbyConfig } from './lobby';
import { createSeatToken, verifySeatToken } from './auth';
import type { SqlitePersistence } from './persistence/sqliteStore';
import type { AsyncRoomStore, RoomEventBusSource } from './roomManager';
import type { RoomEventBus } from './pubsub';

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
  /** Durable store for rooms, saves and seats. */
  persistence?: SqlitePersistence;
  /** Async store for multi-process deployments. */
  asyncPersistence?: AsyncRoomStore;
  /** Cross-process event distribution; defaults to an in-process bus. */
  bus?: RoomEventBus;
  /** Unique id for this process on the shared bus. */
  sourceId?: RoomEventBusSource;
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
  private readonly persistence?: SqlitePersistence;
  private readonly streams = new Set<EventStream>();
  private nextStreamId = 0;

  constructor(options: TransportOptions = {}, rooms?: RoomManager) {
    this.rooms = rooms ?? new RoomManager(
      options.persistence ?? options.asyncPersistence,
      options.bus,
      options.sourceId,
    );
    this.secret = options.secret;
    this.persistence = options.persistence;
    this.server = createServer((req, res) => void this.handle(req, res));
    this.ready = new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve);
    });
  }

  /** Await this before reading `port` when listening on an ephemeral port. */
  async waitUntilReady(): Promise<void> {
    await this.ready;
    // Restore persisted rooms before accepting traffic.
    await this.rooms.restoreAll();
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
    // The dev client runs on a different origin; allow it to call the API.
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
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

    const roomMatch = url.pathname.match(/^\/rooms\/([^/]+)(?:\/(commands|events|save|load|state|seats))?$/);
    if (roomMatch) {
      const [, roomId, action] = roomMatch;
      if (!action && req.method === 'DELETE') {
        const removed = await this.rooms.remove(roomId);
        this.json(res, removed ? 200 : 404, { ok: removed });
        return;
      }
      if (action === 'seats' && req.method === 'POST') {
        await this.handleMintSeats(roomId, req, res);
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
        this.json(res, 200, { ok: room.flushSave() });
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
    const room = await this.rooms.createAsync(lobby);
    await room.start();
    // The creator gets the host seat's signed token. Other seats are issued
    // tokens by the lobby/join flow (same signer, different seat).
    const token = this.secret ? createSeatToken(this.secret, room.id, 0) : null;
    this.json(res, 201, { ok: true, id: room.id, token });
  }

  /** Host-only (seat 0): mint one signed token per requested seat. */
  private async handleMintSeats(roomId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.secret) {
      this.json(res, 400, { ok: false, reason: 'AUTH_NOT_CONFIGURED' });
      return;
    }
    let hostToken: string | null = null;
    let seats: number[] = [];
    let colors: string[] = [];
    try {
      const parsed = JSON.parse(await this.readBody(req)) as {
        token?: string; seats?: number[]; colors?: string[];
      };
      hostToken = parsed.token ?? null;
      const authHeader = req.headers.authorization;
      if (!hostToken && authHeader?.startsWith('Bearer ')) hostToken = authHeader.slice(7);
      if (Array.isArray(parsed.seats)) seats = parsed.seats.map(Number);
      if (Array.isArray(parsed.colors)) colors = parsed.colors.map(String);
    } catch {
      this.json(res, 400, { ok: false, reason: 'BAD_REQUEST' });
      return;
    }
    if (verifySeatToken(this.secret, hostToken, roomId) !== 0) {
      this.json(res, 403, { ok: false, reason: 'HOST_ONLY' });
      return;
    }
    if (!seats.length || seats.some((s) => !Number.isInteger(s) || s < 0 || s > 6)) {
      this.json(res, 400, { ok: false, reason: 'BAD_SEATS' });
      return;
    }
    const room = this.rooms.get(roomId);
    if (!room) return this.missingRoom(res);

    const tokens: Record<string, string> = {};
    for (const seat of seats) {
      const token = createSeatToken(this.secret, roomId, seat);
      tokens[String(seat)] = token;
      // Store only a hash — a database leak must not hand out live tokens.
      const hash = createHmac('sha256', this.secret).update(token).digest('hex');
      room.saveStore.set(`seat_token_hash_${seat}`, hash);
      this.persistence?.rooms.saveSeat(roomId, seat, hash, colors[seat]);
    }
    this.json(res, 200, { ok: true, tokens });
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
    // `?after=seq` is a JSON catch-up request (reconnect without a snapshot).
    const afterParam = url.searchParams.get('after');
    if (afterParam !== null) {
      if (!this.persistence) {
        this.json(res, 400, { ok: false, reason: 'NO_OUTBOX' });
        return;
      }
      const after = Number(afterParam);
      const events = this.persistence.rooms.readEvents(
        roomId, Number.isFinite(after) ? after : 0,
      ).filter((event) => room.visibility.isVisible({
        type: event.type,
        payload: event.payload,
        civId: event.seat ?? undefined,
      }, seat));
      this.json(res, 200, { ok: true, events });
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
