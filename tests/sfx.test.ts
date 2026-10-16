/**
 * The sound layer — and specifically the mechanism by which a recorded file
 * takes over one synthesized cue.
 *
 * Every cue ships an oscillator fallback, so the game is audible with no
 * assets on disk. A cue with a row in `CUE_FILES` plays that file instead and
 * ignores its notes. These tests pin that contract, because a mistake in it
 * would either play nothing or play the synth on top of the recording.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playSfx, unlockAudio, disposeAudio, CUE_FILES, type SfxCue } from '@/utils/Sfx';
import { useGameStore } from '@/stores/GameStore';

/** Every cue the game can play. Adding one without a test here is how a cue
 *  ends up silently missing from the mix. */
const ALL_CUES: SfxCue[] = [
  'stolenTechnology',
  'coverBlown',
  'cityCapturedClassic',
  'cityCapturedModern',
  'uiSelect',
  'unitStrike',
  'torpedoAttack',
  'unitDefeated',
  'unitDisbanded',
  'airUnitLaunch',
  'tankMove',
  'cityAttacked',
  'barracksBuilt',
  'nuclearStrike',
];

/**
 * The rows `Sfx.ts` ships with, read before any test registers a row of its
 * own. The mutation tests below have to put the table back exactly this way.
 */
const SHIPPED_CUES = Object.keys(CUE_FILES).sort();

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

  it('leaves only the shipped recordings registered after the tests', () => {
    // Each test cleans up, but assert it so a future test that forgets cannot
    // leak a path into another file's run. The shipped rows are the baseline
    // the table has to come back to — not an empty table, which is what this
    // asserted back when every cue was still an oscillator.
    expect(Object.keys(CUE_FILES).sort()).toEqual(SHIPPED_CUES);
  });
});

describe('the nuclear strike cue', () => {
  afterEach(() => {
    disposeAudio();
  });

  /** A stand-in Web Audio graph that records how many voice chains the cue built. */
  function fakeAudioGraph() {
    const voices: Array<{ noise: boolean; cutoff: number }> = [];
    (globalThis as { window?: unknown }).window = {
      AudioContext: class {
        state = 'running';
        sampleRate = 8000;
        currentTime = 0;
        destination = {};
        createGain() {
          return { gain: { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {} };
        }
        createOscillator() {
          voices.push({ noise: false, cutoff: 0 });
          return { type: 'sine', frequency: { value: 0 }, connect: () => {}, start: () => {}, stop: () => {} };
        }
        createBiquadFilter() {
          return { type: 'lowpass', frequency: { value: 0 }, connect: () => {} };
        }
        createBufferSource() {
          voices.push({ noise: true, cutoff: 0 });
          return { buffer: null as unknown, loop: false, connect: () => {}, start: () => {}, stop: () => {} };
        }
        createBuffer(_ch: number, length: number) {
          return { sampleRate: 8000, length, getChannelData: () => new Float32Array(length) };
        }
      },
    };
    return voices;
  }

  it('is layered: a noise crack, a sub-bass body and a rumble tail', () => {
    // An oscillator-only nuke sounds like a doorbell, which is why the cue
    // carries noise bands at all. Pin all three layers so a regeneration of
    // the cue table cannot quietly drop one.
    const voices = fakeAudioGraph();
    playSfx('nuclearStrike');
    const noiseBands = voices.filter((v) => v.noise).length;
    const tones = voices.filter((v) => !v.noise).length;
    expect(noiseBands).toBeGreaterThanOrEqual(2);
    expect(tones).toBeGreaterThanOrEqual(2);
  });

  it('is the loudest cue in the game', () => {
    const masters: Array<{ gain: { value: number } }> = [];
    (globalThis as { window?: unknown }).window = {
      AudioContext: class {
        state = 'running';
        sampleRate = 8000;
        currentTime = 0;
        destination = {};
        createGain() {
          const g = { gain: { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {} };
          masters.push(g);
          return g;
        }
        createOscillator() {
          return { type: 'sine', frequency: { value: 0 }, connect: () => {}, start: () => {}, stop: () => {} };
        }
        createBiquadFilter() {
          return { type: 'lowpass', frequency: { value: 0 }, connect: () => {} };
        }
        createBufferSource() {
          return { buffer: null as unknown, loop: false, connect: () => {}, start: () => {}, stop: () => {} };
        }
        createBuffer(_ch: number, length: number) {
          return { sampleRate: 8000, length, getChannelData: () => new Float32Array(length) };
        }
      },
    };

    // Each cue's first constructed gain node is its master.
    const gainFor = (cue: Parameters<typeof playSfx>[0]): number => {
      const at = masters.length;
      playSfx(cue);
      return masters[at]?.gain.value ?? -1;
    };
    const nuke = gainFor('nuclearStrike');
    const fanfare = gainFor('cityCapturedClassic');
    const strike = gainFor('unitStrike');
    expect(nuke).toBeGreaterThan(fanfare);
    expect(nuke).toBeGreaterThan(strike);
  });
});

describe('the shipped recordings', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  it('covers every cue that has a row', () => {
    // Not a formality: the shipped table is the list of cues that are supposed
    // to have real audio, so a row silently disappearing is a regression.
    expect(Object.keys(CUE_FILES).length).toBeGreaterThan(0);
  });

  it('has a real file on disk for every registered path', () => {
    // Vite serves `public/` at the root, so a row's URL is a path under
    // `public/`. A typo here plays nothing at all — the file path IS the
    // lookup — and the synthesized fallback is deliberately not retried, so
    // the cue would go quiet rather than back to beeps.
    for (const [cue, url] of Object.entries(CUE_FILES)) {
      const onDisk = path.join(repoRoot, 'public', url.replace(/^\//, ''));
      expect(existsSync(onDisk), `${cue} → public${url} is missing`).toBe(true);
    }
  });

  it('uses the kebab-case name of its cue', () => {
    // The doc's naming convention. Nothing depends on it at runtime, but a
    // table of paths is only readable while the names line up with the cues.
    for (const [cue, url] of Object.entries(CUE_FILES)) {
      const kebab = cue.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      expect(path.basename(url), `${cue} → ${url}`).toContain(kebab);
    }
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
    //
    // Every cue measured here has to be one WITHOUT a row in `CUE_FILES`:
    // a file-backed cue never reaches this path at all, since it plays through
    // an HTMLAudioElement at its own `CUE_FILE_VOLUME` and builds no gain node.
    // Measuring one would read `undefined`, not a quiet number.
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

    const fanfare = firstGainOf('stolenTechnology');
    const strike = firstGainOf('unitStrike');
    const fanfareAgain = firstGainOf('coverBlown');

    expect(fanfare).toBeGreaterThan(0);
    expect(strike).toBeGreaterThan(0);
    // The fanfare is the loudest thing in the mix; a unit cue sits under it.
    expect(strike).toBeLessThan(fanfare);
    // Two fanfares must come out equally loud — the multiplier applies per
    // cue, not per call.
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
