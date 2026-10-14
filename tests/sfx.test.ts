/**
 * The sound layer — and specifically the mechanism by which recorded .ogg
 * files replace the synthesized cues one at a time.
 *
 * The game ships no audio assets: every cue is an oscillator. Real recordings
 * are meant to land in `CUE_FILES` one by one, and the moment a row is filled
 * that file wins over the notes. These tests pin that contract, because it is
 * invisible until the first .ogg arrives — at which point a mistake in it
 * would either play nothing or play the synth on top of the recording.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { playSfx, unlockAudio, disposeAudio, CUE_FILES, type SfxCue } from '@/utils/Sfx';
import { useGameStore } from '@/stores/GameStore';

/** Every cue the game can play. Adding one without a test here is how a cue
 *  ends up silently missing from the mix. */
const ALL_CUES: SfxCue[] = [
  'stolenTechnology',
  'coverBlown',
  'cityCaptured',
  'uiSelect',
  'unitStrike',
  'unitDefeated',
  'unitDisbanded',
];

describe('playSfx — gated by the settings switch', () => {
  afterEach(() => {
    delete (globalThis as { Audio?: unknown }).Audio;
    useGameStore.getState().actions.updateSettings({ enableSoundEffects: true });
  });

  it('plays nothing at all when sound is off', () => {
    const created: string[] = [];
    (globalThis as { Audio?: unknown }).Audio = class {
      constructor(path: string) { created.push(path); }
      preload = '';
      volume = 1;
      cloneNode() { return this; }
      play() { return Promise.resolve(); }
    };
    useGameStore.getState().actions.updateSettings({ enableSoundEffects: false });

    // The switch has to short-circuit BEFORE the file lookup: a muted game
    // must not even fetch the asset.
    CUE_FILES.unitStrike = '/assets/sfx/unit-strike.ogg';
    playSfx('unitStrike');
    expect(created).toEqual([]);

    delete CUE_FILES.unitStrike;
  });

  it('plays the registered file for a cue that has one', () => {
    const created: string[] = [];
    (globalThis as { Audio?: unknown }).Audio = class {
      constructor(path: string) { created.push(path); }
      preload = '';
      volume = 1;
      cloneNode() { return this; }
      play() { return Promise.resolve(); }
    };

    CUE_FILES.unitStrike = '/assets/sfx/unit-strike.ogg';
    playSfx('unitStrike');
    expect(created).toEqual(['/assets/sfx/unit-strike.ogg']);

    delete CUE_FILES.unitStrike;
  });

  it('reads CUE_FILES live, so a row registered after import still applies', () => {
    const created: string[] = [];
    (globalThis as { Audio?: unknown }).Audio = class {
      constructor(path: string) { created.push(path); }
      preload = '';
      volume = 1;
      cloneNode() { return this; }
      play() { return Promise.resolve(); }
    };

    // The whole point of the design: filling a row replaces that one cue and
    // nothing else, without touching the module or restarting the game.
    expect(created).toEqual([]);
    CUE_FILES.unitDefeated = '/assets/sfx/unit-defeated.ogg';
    playSfx('unitDefeated');
    expect(created).toEqual(['/assets/sfx/unit-defeated.ogg']);
    delete CUE_FILES.unitDefeated;
  });

  it('does not double up: an unmapped cue never touches the file layer', () => {
    const created: string[] = [];
    (globalThis as { Audio?: unknown }).Audio = class {
      constructor(path: string) { created.push(path); }
      preload = '';
      volume = 1;
      cloneNode() { return this; }
      play() { return Promise.resolve(); }
    };

    // No row → the synthesized path runs (which in node finds no AudioContext
    // and returns quietly). The important half is that it does NOT reach for
    // an asset.
    playSfx('unitStrike');
    expect(created).toEqual([]);
  });
});

describe('the cue set', () => {
  it('every cue can be played without throwing, muted or not', () => {
    // The cheapest guard against a typo'd cue silently doing nothing: both
    // branches run, neither may throw.
    for (const cue of ALL_CUES) {
      expect(() => playSfx(cue)).not.toThrow();
    }
    useGameStore.getState().actions.updateSettings({ enableSoundEffects: false });
    for (const cue of ALL_CUES) {
      expect(() => playSfx(cue)).not.toThrow();
    }
    useGameStore.getState().actions.updateSettings({ enableSoundEffects: true });
  });

  it('leaves no files registered after the tests', () => {
    // Each test cleans up, but assert it so a future test that forgets cannot
    // leak a path into another file's run.
    expect(Object.keys(CUE_FILES).length).toBe(0);
  });
});

describe('the relative loudness of a cue', () => {
  afterEach(() => {
    disposeAudio();
    delete (globalThis as { window?: unknown }).window;
    useGameStore.getState().actions.updateSettings({ enableSoundEffects: true });
  });

  it('keeps a combat round under an event fanfare', () => {
    // A blow fires on every combat round; a fanfare fires once per game. If a
    // strike is louder than a stolen technology the mix inverts — which is what
    // happened when the multiplier was applied as an absolute value: the unit
    // cues came out ~3x louder than the fanfare while the comment said the
    // opposite.
    //
    // Two details make this measurable at all. The NODES are collected rather
    // than their values, because `createGain` runs before `playSfx` assigns a
    // loudness — snapshotting at creation would only ever record the zero a
    // gain starts from. And each cue's position is read from the array length
    // immediately before that cue, because a cue with more notes pushes every
    // later node further along and makes fixed indices guesswork.
    const masters: Array<{ gain: { value: number } }> = [];

    (globalThis as { window?: unknown }).window = {
      AudioContext: class {
        currentTime = 0;
        destination = {};
        createGain = () => {
          const node = {
            connect: () => {},
            gain: {
              value: 0,
              setValueAtTime: () => {},
              exponentialRampToValueAtTime: () => {},
            },
          };
          masters.push(node);
          return node;
        };
        createOscillator = () => ({
          type: 'square',
          frequency: { value: 0 },
          connect: () => {},
          start: () => {},
          stop: () => {},
        });
      },
    };
    disposeAudio();

    const firstGainOf = (cue: SfxCue): number => {
      const at = masters.length;
      playSfx(cue);
      return masters[at].gain.value;
    };

    const fanfare = firstGainOf('cityCaptured');
    const strike = firstGainOf('unitStrike');
    const fanfareAgain = firstGainOf('stolenTechnology');

    expect(fanfare).toBeGreaterThan(0);
    expect(strike).toBeGreaterThan(0);
    // The fanfare is the loudest thing in the mix; a unit cue sits under it.
    expect(strike).toBeLessThan(fanfare);
    // Two identical cues must produce identical loudness — the multiplier
    // applies per cue, not per call.
    expect(fanfareAgain).toBe(fanfare);
  });
});


describe('unlockAudio', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { window?: unknown }).window;
  });

  it('does not throw when the browser has no Web Audio at all', () => {
    // Node, and any browser with audio blocked.
    expect(() => unlockAudio()).not.toThrow();
  });

  it('resumes a suspended context when one exists', () => {
    // `getContext()` bails on `window` first, not on `AudioContext` — so both
    // have to be present before the resume path can even be reached.
    const resume = vi.fn().mockResolvedValue(undefined);
    (globalThis as { window?: unknown }).window = {
      AudioContext: class {
        state = 'suspended';
        resume = resume;
      },
    };
    try {
      unlockAudio();
      expect(resume).toHaveBeenCalled();
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
});
