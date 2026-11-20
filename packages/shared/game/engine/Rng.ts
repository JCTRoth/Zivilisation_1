/**
 * ONE gameplay RNG per engine instance.
 *
 * Every roll that changes the simulation — combat, villages, AI choices,
 * nomads, disasters — draws from this stream, so a lobby seed plus a command
 * sequence reproduces the same game on a server, in a browser and in a test.
 *
 * Without an explicit seed the stream reads the global `Math.random` at call
 * time. That keeps the existing test harness (which pins `Math.random` via
 * `useSeededRandom`) and ordinary browser games working unchanged; the server
 * and `?seed=` lobbies always pin it.
 */
export interface Rng {
  (): number;
  /** Internal state, when the stream is a deterministic PRNG (not Math.random). */
  getState?(): number;
  setState?(state: number): void;
}

/** Mulberry32 — small, fast, deterministic, good enough for gameplay rolls. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const rng: Rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.getState = () => a;
  rng.setState = (state: number) => { a = state >>> 0; };
  return rng;
}

/** Gameplay rolls use a stream distinct from terrain generation and setup. */
const RNG_SALT = 0x51ee;

export function createGameplayRng(seed: number): Rng {
  return mulberry32(seed ^ RNG_SALT);
}

/** Uniform integer in [min, max], drawn from the given stream. */
export function rngInt(random: Rng, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** One random element of a non-empty array, drawn from the given stream. */
export function rngPick<T>(random: Rng, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}
