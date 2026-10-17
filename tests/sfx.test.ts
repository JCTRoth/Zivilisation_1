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
import { resetSoundPolicy, SOUND_MANIFEST } from '@/utils/SoundEngine';
import { useGameStore } from '@/stores/GameStore';

/** Every cue the game can play. Adding one without a test here is how a cue
 *  ends up silently missing from the mix. */
const ALL_CUES: SfxCue[] = [
  'stolenTechnology',
  'coverBlown',
  'cityCapturedClassic',
  'cityCapturedModern',
  'uiSelect',
  'machineGunStrike',
  'impactStrike',
  'navalStrike',
  'airStrike',
  'missileLaunch',
  'sdiIntercept',
  'torpedoAttack',
  'unitDefeated',
  'unitDisbanded',
  'unitSelected',
  'submarineSelected',
  'airUnitLaunch',
  'tankMove',
  'mechInfMove',
  'cityAttacked',
  'cityFounded',
  'warDeclared',
  'peaceMade',
  'wonderCompleted',
  'cityLost',
  'civEliminated',
  'cityStarved',
  'cityDisorder',
  'unitProduced',
  'tradeRouteEstablished',
  'unitPromoted',
  'barracksBuilt',
  'sabotageSuccess',
  'productionComplete',
  'nuclearStrike',
];

/**
 * The SoundEngine behind `playSfx` suppresses a cue re-fired inside its
 * cooldown window — without a reset between tests, one file's assertions
 * would silence another's. Every test starts from a cold engine.
 */
beforeEach(() => {
  resetSoundPolicy();
});

/**
 * Run `fn` with `cue`'s recording unassigned, so the test hears the
 * synthesized fallback the cue ships for the day its file goes missing.
 * Both the manifest entry and the `CUE_FILES` row are lifted and restored —
 * the shipped assignment is exactly what the next file finds.
 */
function withoutRecording(cue: SfxCue, fn: () => void): void {
  const manifest = SOUND_MANIFEST[cue];
  const row = CUE_FILES[cue];
  delete SOUND_MANIFEST[cue];
  delete CUE_FILES[cue];
  try {
    fn();
  } finally {
    if (manifest) SOUND_MANIFEST[cue] = manifest;
    if (row) CUE_FILES[cue] = row;
  }
}

/** Async twin of `withoutRecording`, for tests that await the queue drain. */
async function withoutRecordingAsync(cue: SfxCue, fn: () => Promise<void>): Promise<void> {
  const manifest = SOUND_MANIFEST[cue];
  const row = CUE_FILES[cue];
  delete SOUND_MANIFEST[cue];
  delete CUE_FILES[cue];
  try {
    await fn();
  } finally {
    if (manifest) SOUND_MANIFEST[cue] = manifest;
    if (row) CUE_FILES[cue] = row;
  }
}

/**
 * Run `fn` with `CUE_FILES[cue]` temporarily set — the live-registration
 * probe — restoring the shipped row (or its absence) afterwards so the
 * "leaves only the shipped recordings" test below keeps passing.
 */
function withRow(cue: SfxCue, path: string, fn: () => void): void {
  const row = CUE_FILES[cue];
  CUE_FILES[cue] = path;
  try {
    fn();
  } finally {
    if (row) CUE_FILES[cue] = row;
    else delete CUE_FILES[cue];
  }
}

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
    // must not even fetch the asset. `coverBlown` is the probe because it has
    // no recording — but the point holds for every cue, file or not.
    playSfx('coverBlown');
    expect(created).toEqual([]);
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

    withRow('machineGunStrike', '/assets/sfx/custom-gun.ogg', () => {
      playSfx('machineGunStrike');
      expect(created).toEqual(['/assets/sfx/custom-gun.ogg']);
    });
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
    withRow('unitDefeated', '/assets/sfx/unit-defeated.ogg', () => {
      playSfx('unitDefeated');
      expect(created).toEqual(['/assets/sfx/unit-defeated.ogg']);
    });
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
    // an asset. `coverBlown` is the probe: it has no recording and none is
    // planned, so this stays an unmapped cue whatever lands next.
    playSfx('coverBlown');
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
    withoutRecording('nuclearStrike', () => {
      const voices = fakeAudioGraph();
      playSfx('nuclearStrike');
      const noiseBands = voices.filter((v) => v.noise).length;
      const tones = voices.filter((v) => !v.noise).length;
      expect(noiseBands).toBeGreaterThanOrEqual(2);
      expect(tones).toBeGreaterThanOrEqual(2);
    });
  });

  it('is the loudest cue in the game', async () => {
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
    // The shipped recordings win over the oscillators, so the synth ladder is
    // measured with every involved recording lifted — otherwise two of the
    // three reads would hit the file path, build no gain node, and compare
    // against -1.
    let nuke = -1;
    let fanfare = -1;
    let strike = -1;
    // Same queue drain as below: the three synth ladders play one after
    // another, so the test waits for each voice to free before reading on.
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    await withoutRecordingAsync('nuclearStrike', () => withoutRecordingAsync('cityCapturedClassic', () => withoutRecordingAsync(
      'machineGunStrike',
      async () => {
        nuke = gainFor('nuclearStrike');
        await sleep(700);
        fanfare = gainFor('cityCapturedClassic');
        await sleep(700);
        strike = gainFor('machineGunStrike');
      },
    )));
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

  it('keeps a combat round under an event fanfare', async () => {
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

    // `impactStrike` is the cue for a land unit with no machine gun and it ships
    // no recording, so it always reaches the synth path — the ladder this test
    // was written for, with nothing to lift first.
    let fanfare = -1;
    let strike = -1;
    let fanfareAgain = -1;
    // The engine serializes: while one cue is still ringing the next waits
    // its turn instead of overlapping it. The waits below are that queue
    // draining — each cue's master lands exactly where the index arithmetic
    // expects it, just a beat later.
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    fanfare = firstGainOf('stolenTechnology');
    await sleep(700);
    strike = firstGainOf('impactStrike');
    await sleep(700);
    fanfareAgain = firstGainOf('coverBlown');

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
