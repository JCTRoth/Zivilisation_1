/**
 * Music — the game's background-music layer (the music bus).
 *
 * The soundtrack is driven by STATE, never by gameplay scripts: the game
 * announces which scene it is in (`menu`, `gameplay`, `gameOver`) and this
 * module decides what that scene sounds like. Nothing in the engine or the
 * combat loop ever names a recording — refactoring gameplay cannot break the
 * music, and a new track only ever edits the table below.
 *
 * How the state machine works, and why:
 *
 *  1. **One voice at a time, crossfaded.** A scene change fades the old
 *     recording out and the new one in over the same window — no hard cut,
 *     no beat lost. The retired element is released afterwards (see below).
 *  2. **Streaming, not decoding.** BGM is long, so it plays through an
 *     `HTMLAudioElement`, which the browser streams in chunks. The short
 *     effect recordings in `Sfx.ts` can afford to sit in memory; a 4 MB
 *     track cannot, and must never be pulled in through a full decode.
 *  3. **Preload what comes next, unload what is gone.** A state with no
 *     track yet (the setup screen, for now) warms the recording of the
 *     state the player is about to enter — that is what a loading screen
 *     does. When a voice is retired it is paused and its source released, so
 *     a menu that has been left does not hold the buffer forever.
 *  4. **One bus, ducks on demand.** The element volume is the music bus:
 *     `musicVolume` (settings) × the recording's own trim × the duck factor.
 *     `duckMusic()` briefly steps the bus back when a narratively loud cue
 *     (a Wonder, a declaration of war, a nuclear strike — see `Sfx.ts`)
 *     plays, then glides it back, so the news is never talked over.
 *  5. **Gated on the settings switch.** `enableBackgroundMusic` off means
 *     the track is not even fetched — turning the switch back on restores
 *     the current state's music.
 *
 * Autoplay note: browsers refuse media playback before a user gesture, so a
 * state entered before the first click parks and `unlockMusic()` retries it —
 * `Sfx.ts` calls that from the same click handling that warms the SFX
 * context. Tests drive this module with a stubbed `Audio` and fake timers;
 * `disposeMusic()` resets it between test files.
 */

import { useGameStore } from '../stores/GameStore';

/**
 * The scenes the soundtrack knows about.
 *
 * A scene, not a screen: pausing, the hotseat handoff or a dialog never
 * leaves `gameplay` — the music is the world, not the UI.
 */
export type MusicState = 'menu' | 'gameplay' | 'gameOver';

/** One recording a state can play. */
export interface MusicTrack {
  /** Path under `public/`, served at the root (e.g. `/assets/music/…`). */
  file: string;
  /** Trim of this recording inside the music bus (linear, 0–1). */
  trim: number;
}

/**
 * The recording table: state → track. Filling a row where there is none, or
 * exchanging a path, is the whole integration of a new track — no call site
 * changes, and a state with no row simply plays nothing (silence is a
 * legitimate soundtrack for an unfinished scene).
 *
 * All current recordings are full mixes, so one row per state is exact. A
 * game with stems (drums here, melody there) would extend `MusicTrack` with
 * a layer list, and this table is the only place that would change.
 */
export const MUSIC_TRACKS: Partial<Record<MusicState, MusicTrack>> = {
  // The one delivered track, trimmed to sit under the effect mix: a game
  // with a war in it must never bury the war under its own soundtrack.
  gameplay: { file: '/assets/music/Get_it_going.opus', trim: 0.5 },
};

/** Length of a crossfade between two states, in ms. */
export const MUSIC_CROSSFADE_MS = 1_500;
/** Length of the ramp that absorbs a plain volume change, in ms. */
export const MUSIC_VOLUME_RAMP_MS = 350;
/** How fast the bus steps back when a loud cue starts, in ms. */
export const MUSIC_DUCK_FADE_MS = 150;
/** How gently the bus comes back, in ms. */
export const MUSIC_DUCK_RESTORE_MS = 700;
/** How far the bus drops while a cue owns the room (factor of the bus). */
export const MUSIC_DUCK_LEVEL = 0.3;
/** How long a duck holds before the bus comes back, in ms. */
export const MUSIC_DUCK_HOLD_MS = 1_800;
/** Cooldown after a track finishes before it plays again, in ms. */
const MUSIC_COOLDOWN_MS = 25_000;
/** Step size of every volume ramp, in ms — small enough to sound linear. */
const RAMP_STEP_MS = 50;
/** Fallback music volume for a settings object without the field (old saves). */
const DEFAULT_MUSIC_VOLUME = 0.4;

/** One playing (or fading) state and the element that carries it. */
interface MusicVoice {
  state: MusicState;
  track: MusicTrack;
  el: HTMLAudioElement;
  /** Interval of the volume ramp currently running on `el`, if any. */
  ramp: ReturnType<typeof setInterval> | null;
}

/** The voice on the air — null while nothing is playing. */
let current: MusicVoice | null = null;
/** The state the game most recently announced. */
let wanted: MusicState = 'menu';
/** Bus factor: 1 normally, `MUSIC_DUCK_LEVEL` while a duck is active. */
let duckLevel = 1;
/** Pending end of the current duck. */
let duckTimer: ReturnType<typeof setTimeout> | null = null;
/** Pending replay after a track's cooldown. */
let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
/** True when a `play()` was rejected (no user gesture yet). */
let playbackBlocked = false;
/** Elements warmed for a state, by file path — taken over when entered. */
const preloaded = new Map<string, HTMLAudioElement>();

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/** The music switch — absence means ON, like `enableSoundEffects`. */
function musicEnabled(): boolean {
  return useGameStore.getState().settings.enableBackgroundMusic !== false;
}

/** The bus volume from settings, clamped into the mixing range. */
function musicVolume(): number {
  const raw = useGameStore.getState().settings.musicVolume;
  return clamp01(typeof raw === 'number' ? raw : DEFAULT_MUSIC_VOLUME);
}

/** The element volume a voice should head for right now. */
function targetVolume(voice: MusicVoice): number {
  if (!musicEnabled()) return 0;
  return clamp01(musicVolume() * voice.track.trim * duckLevel);
}

/** Build a streaming element for a path, or null where Audio is unavailable. */
function createElement(path: string): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  try {
    const el = new Audio(path);
    // `auto` starts buffering immediately, which is what makes an early
    // `preloadMusic` worth anything. The track plays once and then waits for
    // `MUSIC_COOLDOWN_MS` before replaying — a soundtrack with a hole in it is
    // worse than a repetition, but an immediate loop is a seam the ear catches.
    el.preload = 'auto';
    el.loop = false;
    el.volume = 0;
    return el;
  } catch {
    // Audio is unavailable in this context; the game runs silent.
    return null;
  }
}

/** Stop the element and release its source so the buffer can go. */
function unloadElement(el: HTMLAudioElement): void {
  try {
    if (typeof el.pause === 'function') el.pause();
    // `removeAttribute` (not `el.src = ''`) — the latter resolves to the page
    // URL and fetches the document as audio.
    if (typeof el.removeAttribute === 'function') el.removeAttribute('src');
    // With no source, `load()` resets the element and frees what was streamed.
    if (typeof el.load === 'function') el.load();
  } catch {
    // A partially stubbed or already-released element: nothing to do.
  }
}

/** The warmed element for a path, if any — removed from the shelf. */
function takePreloaded(path: string): HTMLAudioElement | null {
  const el = preloaded.get(path) ?? null;
  if (el) preloaded.delete(path);
  return el;
}

/**
 * Glide an element's volume from where it is to `to` over `ms`, in steps,
 * then run `onDone`. Existing ramps on the voice are superseded: a new
 * target always wins, from the audible current level — that is what keeps a
 * duck landing mid-crossfade from snapping the volume.
 */
function startRamp(
  voice: MusicVoice,
  to: number,
  ms: number,
  onDone?: () => void,
): void {
  if (voice.ramp) {
    clearInterval(voice.ramp);
    voice.ramp = null;
  }
  const el = voice.el;
  const from = clamp01(typeof el.volume === 'number' ? el.volume : 0);
  const goal = clamp01(to);
  const steps = Math.max(1, Math.round(ms / RAMP_STEP_MS));
  if (ms <= 0 || from === goal) {
    el.volume = goal;
    onDone?.();
    return;
  }
  let step = 0;
  voice.ramp = setInterval(() => {
    step += 1;
    if (step >= steps) {
      if (voice.ramp) clearInterval(voice.ramp);
      voice.ramp = null;
      el.volume = goal;
      onDone?.();
      return;
    }
    el.volume = clamp01(from + (goal - from) * (step / steps));
  }, RAMP_STEP_MS);
}

/**
 * Start playback, remembering a blocked autoplay so `unlockMusic` can retry
 * it once the player has interacted with the page.
 */
function playVoice(voice: MusicVoice): void {
  try {
    const result = voice.el.play();
    if (result && typeof result.catch === 'function') {
      result.catch(() => {
        playbackBlocked = true;
      });
    }
  } catch {
    playbackBlocked = true;
  }
}

/** Build a voice for a state, reusing a preloaded element when possible. */
function createVoice(state: MusicState, track: MusicTrack): MusicVoice | null {
  const el = takePreloaded(track.file) ?? createElement(track.file);
  if (!el) return null;
  el.loop = false;
  el.volume = 0;

  // After the track finishes, wait `MUSIC_COOLDOWN_MS` before replaying it.
  const onEnded = (): void => {
    if (current?.el !== el) return;
    if (!musicEnabled()) return;
    if (cooldownTimer) clearTimeout(cooldownTimer);
    cooldownTimer = setTimeout(() => {
      cooldownTimer = null;
      if (!current || current.el !== el) return;
      if (!musicEnabled()) return;
      try {
        (el as unknown as { currentTime?: number }).currentTime = 0;
      } catch {
        // Some stubs do not support seeking — ignore.
      }
      playVoice({ state, track, el, ramp: null } as MusicVoice);
    }, MUSIC_COOLDOWN_MS);
  };
  try {
    if (typeof el.addEventListener === 'function') el.addEventListener('ended', onEnded);
  } catch {
    // Ignore stubs without event support.
  }
  try {
    (el as unknown as { onended: ((...args: unknown[]) => void) | null }).onended = onEnded;
  } catch {
    // Ignore read-only stubs.
  }

  return { state, track, el, ramp: null };
}

/**
 * Tell the soundtrack which scene the game is in. Idempotent; a state with
 * no track fades the previous one out into silence.
 */
export function setMusicState(state: MusicState): void {
  const track = MUSIC_TRACKS[state];
  const sameState = state === wanted && current?.state === state;
  wanted = state;
  if (sameState) return;

  // The voice that was on the air: fade it out and release it once silent.
  if (current && (current.state !== state || current.track.file !== track?.file)) {
    if (cooldownTimer) {
      clearTimeout(cooldownTimer);
      cooldownTimer = null;
    }
    const retired = current;
    current = null;
    startRamp(retired, 0, MUSIC_CROSSFADE_MS, () => unloadElement(retired.el));
  }

  if (!track || !musicEnabled()) return;
  if (current?.state === state) return;

  const voice = createVoice(state, track);
  if (!voice) return;
  current = voice;
  startRamp(voice, targetVolume(voice), MUSIC_CROSSFADE_MS);
  playVoice(voice);
}

/**
 * Warm the recording a state will need, without playing it. Called while the
 * setup screen is open so `Start` begins in music rather than in a download.
 */
export function preloadMusic(state: MusicState = 'gameplay'): void {
  const track = MUSIC_TRACKS[state];
  if (!track || !musicEnabled()) return;
  if (current?.track.file === track.file || preloaded.has(track.file)) return;
  const el = createElement(track.file);
  if (el) preloaded.set(track.file, el);
}

/**
 * Step the bus back for `holdMs` while a loud cue plays, then glide it back.
 * Safe to call with no music on the air (the fact is simply remembered for
 * the next duck); safe to call again while one is holding (the timer moves).
 */
export function duckMusic(holdMs: number = MUSIC_DUCK_HOLD_MS): void {
  duckLevel = MUSIC_DUCK_LEVEL;
  if (duckTimer) clearTimeout(duckTimer);
  duckTimer = setTimeout(() => {
    duckTimer = null;
    duckLevel = 1;
    if (current) startRamp(current, targetVolume(current), MUSIC_DUCK_RESTORE_MS);
  }, Math.max(0, holdMs));
  if (current) startRamp(current, targetVolume(current), MUSIC_DUCK_FADE_MS);
}

/**
 * Retry playback that autoplay policy blocked, called from the game's first
 * user-gesture handling (see `Sfx.unlockAudio`).
 */
export function unlockMusic(): void {
  if (!playbackBlocked) return;
  playbackBlocked = false;
  if (current && musicEnabled()) playVoice(current);
}

/**
 * Absorb a settings change: the switch turning off fades the track out and
 * releases it; turning it on, or a volume change, is a plain glide.
 *
 * Kept as a subscription rather than a call in the settings screen so the
 * console, save-restore and future tooling all go through the same rule.
 */
function applySettings(): void {
  if (!musicEnabled()) {
    if (cooldownTimer) {
      clearTimeout(cooldownTimer);
      cooldownTimer = null;
    }
    const voice = current;
    if (voice) {
      current = null;
      startRamp(voice, 0, MUSIC_VOLUME_RAMP_MS, () => unloadElement(voice.el));
    }
    return;
  }
  if (!current) {
    setMusicState(wanted);
    return;
  }
  startRamp(current, targetVolume(current), MUSIC_VOLUME_RAMP_MS);
}

/** Settings slice this module reacts to — compared to ignore unrelated edits. */
function settingsFingerprint(): string {
  const settings = useGameStore.getState().settings;
  const enabled = settings.enableBackgroundMusic !== false;
  const volume = typeof settings.musicVolume === 'number' ? settings.musicVolume : DEFAULT_MUSIC_VOLUME;
  return `${enabled ? 1 : 0}:${volume}`;
}

let lastFingerprint = '';

// Subscribe on module load: every settings edit lands here, and only a change
// to the music switch or the music volume does any work.
useGameStore.subscribe(() => {
  const fingerprint = settingsFingerprint();
  if (fingerprint === lastFingerprint) return;
  lastFingerprint = fingerprint;
  applySettings();
});
lastFingerprint = settingsFingerprint();

/**
 * Reset every piece of module state — for tests only, mirroring
 * `disposeAudio` in `Sfx.ts`: the ramps and timers are module state, so one
 * test file's assertions would otherwise hear the previous file's crossfade.
 */
export function disposeMusic(): void {
  if (duckTimer) {
    clearTimeout(duckTimer);
    duckTimer = null;
  }
  if (cooldownTimer) {
    clearTimeout(cooldownTimer);
    cooldownTimer = null;
  }
  if (current) {
    if (current.ramp) clearInterval(current.ramp);
    current.ramp = null;
    unloadElement(current.el);
  }
  current = null;
  for (const el of preloaded.values()) unloadElement(el);
  preloaded.clear();
  duckLevel = 1;
  playbackBlocked = false;
  wanted = 'menu';
  lastFingerprint = settingsFingerprint();
}
