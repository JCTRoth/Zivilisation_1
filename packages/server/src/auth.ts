import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed lobby tokens. A client presents a token at join; the authority
 * derives the seat from it — never from a `seat=` field it could forge.
 * No extra dependency: HMAC-SHA256 over a compact payload, base64url encoded.
 */
export interface SeatTokenPayload {
  roomId: string;
  seat: number;
  /** Expiry as Unix seconds. */
  exp: number;
}

const DEFAULT_TTL_SECONDS = 60 * 60 * 8;

function encode(payload: SeatTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

/** Issue a token bound to one room and seat. */
export function createSeatToken(
  secret: string,
  roomId: string,
  seat: number,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  const payload: SeatTokenPayload = {
    roomId,
    seat,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = encode(payload);
  return `${body}.${sign(secret, body)}`;
}

/** Verify signature, room binding and expiry. Returns the seat or null. */
export function verifySeatToken(secret: string, token: string | null, roomId: string): number | null {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = sign(secret, body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: SeatTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SeatTokenPayload;
  } catch {
    return null;
  }
  if (payload.roomId !== roomId) return null;
  if (!Number.isFinite(payload.seat)) return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload.seat;
}

/** `seatForToken` resolver for the transports. */
export function tokenSeatResolver(secret: string) {
  return (token: string | null, roomId: string): number | null => verifySeatToken(secret, token, roomId);
}
