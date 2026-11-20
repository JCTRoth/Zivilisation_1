/** Mirrors the server's LobbyConfig without depending on the server package. */
interface LobbyConfig {
  seed?: number;
  mapType?: string;
  mapWidth?: number;
  mapHeight?: number;
  numberOfCivilizations?: number;
  humanSeats?: number[];
  difficulty?: string;
  gameMode?: 'single' | 'hotseat';
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
