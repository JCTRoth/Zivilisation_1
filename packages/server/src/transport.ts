import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { GameRoom } from './room';
import type { OutboundEvent } from './fog';

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
  private readonly rooms = new Map<string, GameRoom>();
  private readonly streams = new Set<EventStream>();
  private nextStreamId = 0;

  constructor(options: TransportOptions = {}) {
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
    this.rooms.set(room.id, room);
  }

  async close(): Promise<void> {
    for (const stream of this.streams) {
      stream.unsubscribe();
      stream.res.end();
    }
    this.streams.clear();
    await new Promise<void>((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: [...this.rooms.keys()] }));
      return;
    }

    const commandMatch = url.pathname.match(/^\/rooms\/([^/]+)\/commands$/);
    if (commandMatch && req.method === 'POST') {
      await this.handleCommand(commandMatch[1], req, res);
      return;
    }

    const eventsMatch = url.pathname.match(/^\/rooms\/([^/]+)\/events$/);
    if (eventsMatch && req.method === 'GET') {
      this.handleEvents(eventsMatch[1], url, req, res);
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, reason: 'NOT_FOUND' }));
  }

  private async handleCommand(roomId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, reason: 'ROOM_NOT_FOUND' }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += String(chunk);
    let seat: number;
    let command: unknown;
    try {
      const parsed = JSON.parse(body) as { seat?: number; command?: unknown };
      seat = Number(parsed.seat);
      command = parsed.command;
      if (!Number.isFinite(seat) || !command || typeof command !== 'object') throw new Error('bad request');
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, reason: 'BAD_REQUEST' }));
      return;
    }
    const result = room.submit({
      command: command as never,
      context: { actorId: seat, turn: room.engine.currentTurn, seq: ++this.nextStreamId },
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  private handleEvents(roomId: string, url: URL, req: IncomingMessage, res: ServerResponse): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, reason: 'ROOM_NOT_FOUND' }));
      return;
    }
    const seat = Number(url.searchParams.get('seat'));
    if (!Number.isFinite(seat)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, reason: 'BAD_SEAT' }));
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const stream: EventStream = {
      res, roomId, seat, unsubscribe: () => undefined,
    };
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
}
