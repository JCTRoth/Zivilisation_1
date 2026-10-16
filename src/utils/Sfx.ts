/**
 * Sfx - the game's sound layer.
 *
 * Every cue has a synthesized fallback built from oscillator beeps, so the
 * game makes a noise even with no assets on disk. Recordings then take a cue
 * over one at a time via `CUE_FILES` (see that table); a cue with a file plays
 * the file and ignores its notes. That is what keeps the game audible on day
 * one and lets real audio land without touching a single call site.
 *
 * Browsers refuse to start an AudioContext before a user gesture, so the first
 * cue after a page load may be silently dropped — `unlockAudio()` is called
 * from the game's click handling to warm the context up.
 *
 * Everything is gated on the `enableSoundEffects` setting: `playSfx` becomes a
 * no-op when the player turned sound off, so callers never check it.
 */

import { useGameStore } from '../stores/GameStore';

export type SfxCue =
  /** A technology was stolen — short rising fanfare. */
  | 'stolenTechnology'
  /** The diplomat's cover was blown — descending alarm. */
  | 'coverBlown'
  /** A city fell to the player's forces before the modern era. */
  | 'cityCapturedClassic'
  /** A city fell to the player's forces in the modern era. */
  | 'cityCapturedModern'
  /** A menu choice was taken. */
  | 'uiSelect'
  /** A unit lands a blow. */
  | 'unitStrike'
  /** A submarine attacks — a torpedo run instead of a generic blow. */
  | 'torpedoAttack'
  /** A unit is destroyed. */
  | 'unitDefeated'
  /** A unit was disbanded to cover upkeep (or by order). */
  | 'unitDisbanded'
  /** An air unit takes off from a city or a carrier. */
  | 'airUnitLaunch'
  /** A tank rolls out of its tile. */
  | 'tankMove'
  /** A city comes under assault. */
  | 'cityAttacked'
  /** A barracks finished in one of the player's cities. */
  | 'barracksBuilt'
  /** A nuclear warhead detonated — the sound of the century. */
  | 'nuclearStrike';

/**
 * Where a cue's sound comes from.
 *
 * Every cue ships as synthesized notes — the game needs a sound on day one,
 * and oscillator beeps cost no bytes. Real recordings replace them one at a
 * time by filling a row here with a path under `public/assets/sfx/`; the
 * moment a cue has a file, that file wins and the notes below are ignored for
 * it. Nothing else in the game changes, so an .ogg can land in a single commit
 * and be reverted the same way.
 *
 * Leave a row out (or set it to '') to keep the synthesized version.
 *
 * Exported so a test — and, later, a manifest loader — can register a file at
 * runtime without editing this module. `playSfx` reads it live rather than
 * snapshotting it, so a row added after load takes effect immediately.
 */
export const CUE_FILES: Partial<Record<SfxCue, string>> = {
  // ── Shipped recordings, live today ────────────────────────────────
  'cityCapturedClassic': '/assets/sfx/city-captured-classic.mp3',
  'cityCapturedModern': '/assets/sfx/city-captured-modern.mp3',
  'cityAttacked': '/assets/sfx/city-attacked.mp3',
  'barracksBuilt': '/assets/sfx/barracks-built.mp3',
  'torpedoAttack': '/assets/sfx/torpedo-attack.mp3',
  'airUnitLaunch': '/assets/sfx/air-unit-launch.mp3',
  'tankMove': '/assets/sfx/tank-move.mp3',

  // ── Still synthesized — uncomment a row once its file lands ───────
  // 'unitStrike':       '/assets/sfx/unit-strike.ogg',
  // 'unitDefeated':     '/assets/sfx/unit-defeated.ogg',
  // 'unitDisbanded':    '/assets/sfx/unit-disbanded.ogg',
  // 'stolenTechnology': '/assets/sfx/stolen-technology.ogg',
  // 'coverBlown':       '/assets/sfx/cover-blown.ogg',
  // 'uiSelect':         '/assets/sfx/ui-select.ogg',
  // 'nuclearStrike':    '/assets/sfx/nuclear-strike.ogg',
};

/**
 * One note: an oscillator tone, a noise burst, or both layered.
 *
 * `freq`/`type` drive the oscillator and `noise` drives a band-limited noise
 * burst; a note with only `noise` (freq 0) is pure noise. The nuclear strike
 * needs both — a noise crack and a sub-bass sweep are two different sounds and
 * neither is a convincing explosion alone.
 */
interface Note {
  freq: number;
  at: number;
  dur: number;
  /** 0…1 loudness before the global cue gain. */
  gain?: number;
  type?: OscillatorType;
  /** 0…1 loudness of the noise band layered into this note. */
  noise?: number;
  /** Low-pass corner for the noise, in Hz — an explosion is 200–900 Hz. */
  cutoff?: number;
}

/**
 * The cues. Deliberately short and dry: Civ I's sound was a couple of square
 * blips, and anything longer becomes annoying by the twentieth capture.
 */
const CUES: Record<SfxCue, Note[]> = {
  stolenTechnology: [
    { freq: 523, at: 0.0, dur: 0.09 },
    { freq: 659, at: 0.08, dur: 0.09 },
    { freq: 784, at: 0.16, dur: 0.11 },
    { freq: 1047, at: 0.26, dur: 0.22 },
  ],
  coverBlown: [
    { freq: 392, at: 0.0, dur: 0.12, type: 'sawtooth' },
    { freq: 330, at: 0.11, dur: 0.12, type: 'sawtooth' },
    { freq: 262, at: 0.22, dur: 0.16, type: 'sawtooth' },
    { freq: 196, at: 0.36, dur: 0.28, type: 'sawtooth', gain: 0.7 },
  ],
  cityCapturedClassic: [
    { freq: 392, at: 0.0, dur: 0.11 },
    { freq: 523, at: 0.1, dur: 0.11 },
    { freq: 659, at: 0.2, dur: 0.11 },
    { freq: 784, at: 0.3, dur: 0.26 },
  ],
  // The modern variant is the same call with an extra step: the classic
  // four-note arch up to the octave, then a fifth note on top of it.
  cityCapturedModern: [
    { freq: 440, at: 0.0, dur: 0.11 },
    { freq: 554, at: 0.1, dur: 0.11 },
    { freq: 659, at: 0.2, dur: 0.11 },
    { freq: 880, at: 0.3, dur: 0.12 },
    { freq: 1109, at: 0.42, dur: 0.3 },
  ],
  // Under assault: an urgent fall rather than a fanfare — the city is not
  // taken yet, so this must not sound like the capture cue.
  cityAttacked: [
    { freq: 440, at: 0.0, dur: 0.1, type: 'sawtooth', gain: 0.8 },
    { freq: 349, at: 0.09, dur: 0.1, type: 'sawtooth', gain: 0.8 },
    { freq: 262, at: 0.18, dur: 0.18, type: 'sawtooth', gain: 0.7 },
  ],
  // A barracks is a small domestic win: two crisp notes, nothing ceremonial.
  barracksBuilt: [
    { freq: 587, at: 0.0, dur: 0.1 },
    { freq: 784, at: 0.1, dur: 0.22 },
  ],
  uiSelect: [{ freq: 660, at: 0.0, dur: 0.05 }],

  // ── Unit cues ──────────────────────────────────────────────────────
  // These fire on every combat round, so they are shorter and quieter than
  // the event fanfares: a dull knock for the blow, a falling pair for the
  // kill. Nothing here should still be ringing when the next round resolves.
  unitStrike: [
    { freq: 180, at: 0.0, dur: 0.06, type: 'triangle' },
    { freq: 90, at: 0.01, dur: 0.09, type: 'triangle', gain: 0.8 },
  ],
  unitDefeated: [
    { freq: 320, at: 0.0, dur: 0.1, type: 'sawtooth', gain: 0.9 },
    { freq: 150, at: 0.09, dur: 0.14, type: 'sawtooth', gain: 0.7 },
    { freq: 70, at: 0.2, dur: 0.2, type: 'triangle', gain: 0.6 },
  ],
  unitDisbanded: [
    // A quieter, unbloodier close — the unit walked away rather than fell.
    { freq: 300, at: 0.0, dur: 0.08, type: 'triangle', gain: 0.7 },
    { freq: 200, at: 0.08, dur: 0.14, type: 'triangle', gain: 0.5 },
  ],

  // ── Movement and weapon cues ───────────────────────────────────────
  // These fire on a player action rather than on a combat round, and the
  // two movement ones fire at most once per unit per turn (the call sites
  // in EngineEventHandlers rate them): a rumble under every step of a
  // three-tile drive would be a drone, and worse for a ten-tile sortie.
  torpedoAttack: [
    // A hit below the waterline: a dull crack that sinks away.
    { freq: 220, at: 0.0, dur: 0.09, type: 'triangle', gain: 0.9 },
    { freq: 110, at: 0.06, dur: 0.16, type: 'triangle', gain: 0.8 },
    { freq: 55, at: 0.18, dur: 0.24, type: 'triangle', gain: 0.6 },
  ],
  airUnitLaunch: [
    // Rolling off the runway: a short sawtooth climb.
    { freq: 196, at: 0.0, dur: 0.1, type: 'sawtooth', gain: 0.7 },
    { freq: 262, at: 0.07, dur: 0.1, type: 'sawtooth', gain: 0.7 },
    { freq: 392, at: 0.14, dur: 0.14, type: 'sawtooth', gain: 0.6 },
  ],
  tankMove: [
    // Tracks: two low notes, deliberately shorter than a combat cue.
    { freq: 98, at: 0.0, dur: 0.09, type: 'triangle', gain: 0.8 },
    { freq: 74, at: 0.07, dur: 0.12, type: 'triangle', gain: 0.6 },
  ],
  // A nuclear detonation is the only cue that is allowed to be long: the
  // player fires one at most a handful of times a game, and a short crack
  // reads as a rifle. Three layers — a noise crack, a sub-bass body, and a
  // long low rumble tail — come to about two seconds.
  nuclearStrike: [
    // 1. The flash: a bright noise crack with the low end already cut in.
    { freq: 0, at: 0.0, dur: 0.5, gain: 0.9, noise: 1, cutoff: 900 },
    // 2. The body: a sine well below the bass clef, falling as it opens up.
    { freq: 90, at: 0.005, dur: 0.55, type: 'sine', gain: 1 },
    { freq: 52, at: 0.08, dur: 0.6, type: 'sine', gain: 0.85 },
    // 3. The tail: a low rumble under everything, and the drifting debris.
    { freq: 0, at: 0.18, dur: 1.5, gain: 0.5, noise: 0.75, cutoff: 260 },
    { freq: 38, at: 0.2, dur: 1.4, type: 'triangle', gain: 0.5 },
  ],
};

/** Shared context, created lazily on the first cue. */
let context: AudioContext | null = null;

/** One second of white noise, rebuilt per context and reused by every burst. */
let noiseBuffer: AudioBuffer | null = null;

function getNoiseBuffer(ctx: AudioContext): AudioBuffer | null {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  try {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffer = buffer;
  } catch {
    return null;
  }
  return noiseBuffer;
}

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) {
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }
  return context;
}

/**
 * Warm the audio context up after a user gesture, so the first real cue is not
 * swallowed by the browser's autoplay policy. Safe to call often.
 */
export function unlockAudio(): void {
  const ctx = getContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => { /* nothing to do — the next cue retries */ });
  }
}

/**
 * Drop the cached AudioContext so the next cue builds a fresh one.
 *
 * Exists for tests: the context is module state, so two assertions in one file
 * would otherwise share whichever fake the first one installed. Nothing in the
 * game calls it — a real context is cheap to keep and expensive to recreate.
 */
export function disposeAudio(): void {
  context = null;
  noiseBuffer = null;
}

/**
 * Play one of the game's cues. No-op when sound is off in settings, or when
 * the browser has no audio at all.
 *
 * A cue with an entry in `CUE_FILES` plays that file instead of the
 * synthesized notes — that is the whole .ogg replacement mechanism: add a row
 * to the table, reload, and the recording takes over.
 */
export function playSfx(cue: SfxCue): void {
  if (!useGameStore.getState().settings.enableSoundEffects) return;

  const file = CUE_FILES[cue];
  if (file) {
    playFile(file, cue);
    return;
  }

  const ctx = getContext();
  if (!ctx || ctx.state === 'suspended') {
    // Not unlocked yet (no user gesture): try once, and drop the cue rather
    // than queueing it behind a context that may never start.
    ctx?.resume().catch(() => undefined);
    if (!ctx) return;
    if (ctx.state === 'suspended') return;
  }

  const notes = CUES[cue];
  if (!notes) return;
  const start = ctx.currentTime + 0.02;
  const master = ctx.createGain();
  master.gain.value = (UNIT_CUE_GAIN[cue] ?? 1) * BASE_GAIN;
  master.connect(ctx.destination);

  for (const note of notes) {
    const t0 = start + note.at;
    const t1 = t0 + note.dur;
    // A noise band: white noise through a low-pass, which is what an
    // explosion actually is — no pitch, just a pressure front and the
    // spectrum falling off above the corner frequency.
    if (note.noise) {
      const buffer = getNoiseBuffer(ctx);
      if (buffer) {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = note.cutoff ?? 800;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.0001, t0);
        ng.gain.exponentialRampToValueAtTime(note.noise, t0 + 0.01);
        ng.gain.exponentialRampToValueAtTime(0.0001, Math.max(t1, t0 + 0.05));
        src.connect(filter);
        filter.connect(ng);
        ng.connect(master);
        src.start(t0);
        src.stop(t1 + 0.02);
      }
    }
    // A tone: `freq: 0` marks a noise-only note.
    if (note.freq > 0) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = note.type ?? 'square';
      osc.frequency.value = note.freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(note.gain ?? 1, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t1);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t0);
      osc.stop(t1 + 0.02);
    }
  }
}

/**
 * Loudness of the one-off event fanfares — a stolen technology, a captured
 * city — which are the sounds a player should clearly hear.
 */
const BASE_GAIN = 0.18;

/**
 * Relative loudness per cue, as a multiplier on `BASE_GAIN`.
 *
 * The unit cues fire on every combat round while the event fanfares fire once
 * per game, so the strikes and deaths sit underneath rather than on top of
 * everything the player is listening for: 0.55 × 0.18 is a blow heard under a
 * fanfare, not a blow shouted over it.
 *
 * The movement and weapon cues follow the same rule for the same reason —
 * they fire on a player action, not on a once-a-game event, so they stay
 * under the fanfares. `cityAttacked` and `barracksBuilt` are closer to the
 * fanfare end: both are news the player should not miss.
 */
const UNIT_CUE_GAIN: Partial<Record<SfxCue, number>> = {
  unitStrike: 0.55,
  unitDefeated: 0.7,
  unitDisbanded: 0.6,
  torpedoAttack: 0.65,
  airUnitLaunch: 0.6,
  tankMove: 0.5,
  cityAttacked: 0.8,
  barracksBuilt: 0.85,
  // A nuclear detonation is the loudest thing in the game, and the one cue
  // that earns it: it fires a handful of times per game at most.
  nuclearStrike: 1,
};

/** One loaded file per path, so a cue repeated in a battle is not refetched. */
const fileCache = new Map<string, HTMLAudioElement>();

function playFile(path: string, cue: SfxCue): void {
  if (typeof Audio === 'undefined') return;
  try {
    let audio = fileCache.get(path);
    if (!audio) {
      audio = new Audio(path);
      // A failed load must not surface as an unhandled rejection in the
      // console on every strike.
      audio.preload = 'auto';
      fileCache.set(path, audio);
    }
    // `cloneNode` lets the same file overlap itself — a second blow landing
    // before the first finished restarts it rather than being dropped.
    const voice = audio.cloneNode(true) as HTMLAudioElement;
    voice.volume = CUE_FILE_VOLUME[cue] ?? DEFAULT_FILE_VOLUME;
    void voice.play().catch(() => {
      // Autoplay blocked before the first gesture, or the file is missing.
      // The synthesized cue is not retried: a half-configured game must not
      // double up when the file arrives.
    });
  } catch {
    // Audio is unavailable in this context; nothing to play.
  }
}

/**
 * Per-cue loudness for file-backed cues, kept below the Web Audio master gain.
 *
 * A row per cue rather than one number for all of them: a tank rumble that
 * fires every time the player drives and a city-capture fanfare that fires
 * once a game have no business sharing a level. Cues with no row fall back to
 * `DEFAULT_FILE_VOLUME`.
 */
const CUE_FILE_VOLUME: Partial<Record<SfxCue, number>> = {
  tankMove: 0.35,
  airUnitLaunch: 0.4,
  torpedoAttack: 0.45,
  cityAttacked: 0.5,
  barracksBuilt: 0.55,
  cityCapturedClassic: 0.6,
  cityCapturedModern: 0.6,
};

/** Volume for a file-backed cue with no explicit row. */
const DEFAULT_FILE_VOLUME = 0.45;
