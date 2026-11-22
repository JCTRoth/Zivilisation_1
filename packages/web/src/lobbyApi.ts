/** Mirrors the server's LobbyConfig without depending on the server package. */
interface LobbyConfig {
  seed?: number;
  mapType?: string;
  mapWidth?: number;
  mapHeight?: number;
  /** Civ1 world-shaping sliders — the room gets them too. */
  landMass?: number;
  temperature?: number;
  climate?: number;
  age?: number;
  numberOfCivilizations?: number;
  humanSeats?: number[];
  playerCivilizations?: (number | null)[];
  playerColors?: (string | null)[];
  playerSpawns?: (number | null)[];
  difficulty?: string;
  gameMode?: 'single' | 'hotseat';
  fixedAlliances?: boolean;
  teamAssignments?: number[];
}

/** One seat of a running game as the seats table knows it. */
interface RoomSeat {
  seat: number;
  color: string | null;
  status: string;
  /** When the invite was minted — not when the holder connected. */
  invitedAt: number | null;
}

/** One running game as `GET /rooms` describes it. */
export interface RoomSummary {
  id: string;
  turn: number;
  started: boolean;
  lobby: LobbyConfig;
  seats: RoomSeat[];
  /** Seats with a live event stream right now. */
  connectedSeats: number[];
}

/**
 * Thin client for the lobby endpoints. A lobby creates a room, then mints one
 * signed token per seat so players can join with a URL that cannot be forged.
 */
export interface LobbyResult {
  baseUrl: string;
  roomId: string;
  /** Host token (seat 0); null when the server runs without authentication. */
  hostToken: string | null;
  /** Seat -> signed token. Empty when the server is unauthenticated. */
  tokens: Record<string, string>;
}

export async function createRoomWithSeats(
  baseUrl: string,
  lobby: LobbyConfig,
  seats: number[],
): Promise<LobbyResult> {
  const root = baseUrl.replace(/\/$/, '');
  const created = await fetch(`${root}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(lobby),
  }).then((r) => r.json()) as { ok: boolean; id: string; token?: string | null };

  if (!created.ok) throw new Error('ROOM_CREATE_FAILED');
  const hostToken = created.token ?? null;
  if (!hostToken) {
    // Demo server without a secret: clients join with ?seat=N.
    return { baseUrl: root, roomId: created.id, hostToken, tokens: {} };
  }

  const minted = await fetch(`${root}/rooms/${encodeURIComponent(created.id)}/seats`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: hostToken, seats }),
  }).then((r) => r.json()) as { ok: boolean; tokens?: Record<string, string> };

  if (!minted.ok || !minted.tokens) throw new Error('SEAT_MINT_FAILED');
  return { baseUrl: root, roomId: created.id, hostToken, tokens: minted.tokens };
}

/** Build the join URL consumed by App's `?server=&room=&token=` handling. */
export function joinUrl(result: LobbyResult, seat: number): string {
  const params = new URLSearchParams({
    server: result.baseUrl,
    room: result.roomId,
  });
  if (result.tokens[String(seat)]) params.set('token', result.tokens[String(seat)]);
  else params.set('seat', String(seat));
  return `${window.location.pathname}?${params.toString()}`;
}

/**
 * The game server the client talks to: runtime config first (a deployment
 * ships it in `/config.js`), then the build-time env, then the dev default.
 * A player never has to know a URL or a port.
 */
export function defaultGameServer(): string {
  return globalThis.window?.__CIV1_CONFIG__?.gameServer
    ?? import.meta.env.VITE_GAME_SERVER
    ?? 'http://localhost:8787';
}

/**
 * Every game the server is running right now — the "Join a running game"
 * list. Settings, progress, seats and who is actually connected.
 */
export async function listRooms(baseUrl = defaultGameServer()): Promise<RoomSummary[]> {
  const root = baseUrl.replace(/\/$/, '');
  const res = await fetch(`${root}/rooms`)
    .then((r) => r.json()) as { ok: boolean; rooms?: RoomSummary[] };
  if (!res.ok || !Array.isArray(res.rooms)) throw new Error('ROOM_LIST_FAILED');
  return res.rooms;
}

/**
 * Claim a free seat in a running game. The server refuses with
 * `NO_FREE_SEAT` when every seat the lobby allows has an invite.
 */
export async function joinRoom(
  roomId: string,
  baseUrl = defaultGameServer(),
): Promise<{ seat: number; token: string | null }> {
  const root = baseUrl.replace(/\/$/, '');
  const res = await fetch(`${root}/rooms/${encodeURIComponent(roomId)}/join`, { method: 'POST' })
    .then((r) => r.json()) as { ok: boolean; seat?: number; token?: string | null; reason?: string };
  if (!res.ok || typeof res.seat !== 'number') {
    throw new Error(res.reason ?? 'JOIN_FAILED');
  }
  return { seat: res.seat, token: res.token ?? null };
}

/** The URL that boots the remote client for a claimed seat. */
export function remoteJoinUrl(roomId: string, seat: number, token: string | null,
                              baseUrl = defaultGameServer()): string {
  const params = new URLSearchParams({ server: baseUrl.replace(/\/$/, ''), room: roomId });
  if (token) params.set('token', token);
  else params.set('seat', String(seat));
  return `${window.location.pathname}?${params.toString()}`;
}
