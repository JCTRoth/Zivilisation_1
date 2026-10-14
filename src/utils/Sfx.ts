/**
 * Sfx - the game's entire sound budget, synthesized.
 *
 * The project ships no audio assets and no audio library, so the few cues the
 * game needs (a stolen technology, a cover blown, a conquered city) are built
 * out of oscillator beeps at play time. That keeps the bundle empty, works
 * offline, and lets every cue be tuned in one place.
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
  /** A city fell to the player's forces. */
  | 'cityCaptured'
  /** A menu choice was taken. */
  | 'uiSelect'
  /** A unit lands a blow. */
  | 'unitStrike'
  /** A unit is destroyed. */
  | 'unitDefeated'
  /** A unit was disbanded to cover upkeep (or by order). */
  | 'unitDisbanded';

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
  // 'unitStrike':       '/assets/sfx/unit-strike.ogg',
  // 'unitDefeated':     '/assets/sfx/unit-defeated.ogg',
  // 'unitDisbanded':    '/assets/sfx/unit-disbanded.ogg',
  // 'cityCaptured':     '/assets/sfx/city-captured.ogg',
  // 'stolenTechnology': '/assets/sfx/stolen-technology.ogg',
  // 'coverBlown':       '/assets/sfx/cover-blown.ogg',
  // 'uiSelect':         '/assets/sfx/ui-select.ogg',
};

/** One oscillator note: frequency in Hz, starting at `at` seconds. */
interface Note {
  freq: number;
  at: number;
  dur: number;
  /** 0…1 loudness before the global cue gain. */
  gain?: number;
  type?: OscillatorType;
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
  cityCaptured: [
    { freq: 392, at: 0.0, dur: 0.11 },
    { freq: 523, at: 0.1, dur: 0.11 },
    { freq: 659, at: 0.2, dur: 0.11 },
    { freq: 784, at: 0.3, dur: 0.26 },
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
};

/** Shared context, created lazily on the first cue. */
let context: AudioContext | null = null;

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
    playFile(file);
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
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = note.type ?? 'square';
    osc.frequency.value = note.freq;
    const t0 = start + note.at;
    const t1 = t0 + note.dur;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(note.gain ?? 1, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t1 + 0.02);
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
 */
const UNIT_CUE_GAIN: Partial<Record<SfxCue, number>> = {
  unitStrike: 0.55,
  unitDefeated: 0.7,
  unitDisbanded: 0.6,
};

/** One loaded file per path, so a cue repeated in a battle is not refetched. */
const fileCache = new Map<string, HTMLAudioElement>();

function playFile(path: string): void {
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
    voice.volume = UNIT_CUE_VOLUME;
    void voice.play().catch(() => {
      // Autoplay blocked before the first gesture, or the file is missing.
      // The synthesized cue is not retried: a half-configured game must not
      // double up when the file arrives.
    });
  } catch {
    // Audio is unavailable in this context; nothing to play.
  }
}

/** Volume for file-backed cues, kept below the Web Audio master gain. */
const UNIT_CUE_VOLUME = 0.45;
