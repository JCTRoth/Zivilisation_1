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
  | 'uiSelect';

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
 * Play one of the game's cues. No-op when sound is off in settings, when the
 * browser has no Web Audio, or when the cue is currently playing (a capture in
 * the same frame must not stack ten copies of the fanfare).
 */
export function playSfx(cue: SfxCue): void {
  if (!useGameStore.getState().settings.enableSoundEffects) return;
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
  master.gain.value = 0.18;
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
