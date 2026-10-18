/**
 * The music layer — state-driven BGM.
 *
 * The contract these tests pin, in the order the module doc states it:
 * the game announces a scene and the module owns everything else. A track is
 * chosen from the table, streamed through one voice at a time, crossfaded,
 * preloaded ahead of the scene and released when the scene is left; the bus
 * volume scales with the settings, ducks for the narrative cues and holds the
 * switch: off means the asset is not even fetched.
 *
 * The transport is stubbed the same way `tests/sfx.test.ts` stubs `Audio`,
 * and the ramps run on fake timers — the module's timers ARE its behaviour, so
 * the suite drives them instead of waiting for them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MUSIC_TRACKS,
  MUSIC_CROSSFADE_MS,
  MUSIC_VOLUME_RAMP_MS,
  MUSIC_DUCK_FADE_MS,
  MUSIC_DUCK_HOLD_MS,
  MUSIC_DUCK_LEVEL,
  MUSIC_DUCK_RESTORE_MS,
  disposeMusic,
  duckMusic,
  preloadMusic,
  setMusicState,
} from '@/utils/Music';
import { playSfx, unlockAudio } from '@/utils/Sfx';
import { resetSoundPolicy } from '@/utils/SoundEngine';
import { useGameStore } from '@/stores/GameStore';

/** The gameplay row is the subject of almost every test below. */
const GAMEPLAY_TRACK = MUSIC_TRACKS.gameplay;
if (!GAMEPLAY_TRACK) {
  throw new Error('the gameplay row missing — every test below assumes it');
}
const GAMEPLAY_FILE = GAMEPLAY_TRACK.file;

/** The store's default music volume, read through the settings object. */
const busVolume = (): number => {
  const value = useGameStore.getState().settings.musicVolume;
  return typeof value === 'number' ? value : 0.4;
};

/** The element volume a full (unducked) gameplay voice should hold. */
const fullGameplayVolume = (): number => busVolume() * GAMEPLAY_TRACK.trim;

/** One recording element created by the fake `Audio` below. */
interface FakeElement {
  src: string;
  volume: number;
  loop: boolean;
  preload: string;
  playCalls: number;
  pauseCalls: number;
  loadCalls: number;
  srcRemoved: boolean;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
}

/** Everything the fake constructor produced, in creation order. */
let created: FakeElement[] = [];

/** Install a recording stand-in for `Audio`. */
function installFakeAudio(options: { rejectPlay?: boolean } = {}): void {
  created = [];
  (globalThis as { Audio?: unknown }).Audio = class {
    src: string;
    volume = 0;
    loop = false;
    preload = '';
    playCalls = 0;
    pauseCalls = 0;
    loadCalls = 0;
    srcRemoved = false;
    constructor(src: string) {
      this.src = src;
      created.push(this as unknown as FakeElement);
    }
    play(): Promise<void> {
      this.playCalls += 1;
      return options.rejectPlay
        ? Promise.reject(new Error('autoplay blocked'))
        : Promise.resolve();
    }
    pause(): void {
      this.pauseCalls += 1;
    }
    load(): void {
      this.loadCalls += 1;
    }
    removeAttribute(name: string): void {
      if (name === 'src') this.srcRemoved = true;
    }
  };
}

/** The single created element that carries a path. */
function elementFor(file: string): FakeElement {
  const found = created.find((el) => el.src === file);
  if (!found) throw new Error(`no element was created for ${file}`);
  return found;
}

/** Restore the settings the suite shares through the real store. */
function restoreSettings(): void {
  useGameStore.getState().actions.updateSettings({
    enableBackgroundMusic: true,
    musicVolume: 0.4,
    enableSoundEffects: true,
  });
}

beforeEach(() => {
  disposeMusic();
  vi.useFakeTimers();
  installFakeAudio();
  resetSoundPolicy();
  restoreSettings();
});

afterEach(() => {
  disposeMusic();
  vi.useRealTimers();
  restoreSettings();
  resetSoundPolicy();
  delete (globalThis as { Audio?: unknown }).Audio;
});

describe('the music table', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  it('registers the shipped track under public/assets/music', () => {
    // The scene registry is the integration point — a renamed file or a moved
    // folder is a silent soundtrack, so the row itself is pinned here.
    expect(GAMEPLAY_FILE).toBe('/assets/music/Get_it_going.opus');
    expect(GAMEPLAY_TRACK.trim).toBeGreaterThan(0);
    expect(GAMEPLAY_TRACK.trim).toBeLessThanOrEqual(1);
  });

  it('has a real file on disk for every registered track', () => {
    // Vite serves `public/` at the root, so a row's URL is a path under
    // `public/`. A typo plays nothing at all — the path IS the lookup.
    for (const [state, track] of Object.entries(MUSIC_TRACKS)) {
      expect(track, `${state} has no track`).toBeTruthy();
      const onDisk = path.join(repoRoot, 'public', track.file.replace(/^\//, ''));
      expect(existsSync(onDisk), `${state} → public${track.file} is missing`).toBe(true);
    }
  });
});

describe('state-driven playback', () => {
  it('plays the gameplay recording when the gameplay scene begins', () => {
    setMusicState('gameplay');

    expect(created).toHaveLength(1);
    const el = elementFor(GAMEPLAY_FILE);
    expect(el.loop).toBe(false);
    expect(el.playCalls).toBe(1);

    // The fade-in is the crossfade: from silence to the bus level.
    vi.advanceTimersByTime(MUSIC_CROSSFADE_MS);
    expect(el.volume).toBeCloseTo(fullGameplayVolume(), 6);
  });

  it('is idempotent while the scene does not change', () => {
    setMusicState('gameplay');
    setMusicState('gameplay');

    expect(created).toHaveLength(1);
    expect(elementFor(GAMEPLAY_FILE).playCalls).toBe(1);
  });

  it('crossfades the old scene out, releases it, and leaves a scene without a track silent', () => {
    setMusicState('gameplay');
    vi.advanceTimersByTime(MUSIC_CROSSFADE_MS);
    const el = elementFor(GAMEPLAY_FILE);

    // `menu` has no track yet: leaving gameplay is a fade into silence, and
    // the element is released once it is quiet — a scene that is gone must
    // not hold a streamed buffer.
    setMusicState('menu');
    expect(created).toHaveLength(1);
    vi.advanceTimersByTime(MUSIC_CROSSFADE_MS);

    expect(el.volume).toBeCloseTo(0, 6);
    expect(el.pauseCalls).toBe(1);
    expect(el.srcRemoved).toBe(true);
  });

  it('plays nothing for a scene without a track', () => {
    setMusicState('gameOver');
    vi.advanceTimersByTime(MUSIC_CROSSFADE_MS);
    expect(created).toHaveLength(0);
  });
});

describe('the music switch and the bus volume', () => {
  it('does not even fetch the track while the music is off', () => {
    useGameStore.getState().actions.updateSettings({ enableBackgroundMusic: false });
    setMusicState('gameplay');
    vi.advanceTimersByTime(MUSIC_CROSSFADE_MS);

    expect(created).toHaveLength(0);
  });

  it('starts the current scene when the switch comes back on', () => {
    useGameStore.getState().actions.updateSettings({ enableBackgroundMusic: false });
    setMusicState('gameplay');

    // The settings subscription is what turns the switch into sound: the
    // scene was announced while muted, and playing it is the same request.
    useGameStore.getState().actions.updateSettings({ enableBackgroundMusic: true });
    expect(created).toHaveLength(1);
    expect(elementFor(GAMEPLAY_FILE).playCalls).toBe(1);
  });

  it('fades out and releases the track when the switch goes off', () => {
    setMusicState('gameplay');
    vi.advanceTimersByTime(MUSIC_CROSSFADE_MS);
    const el = elementFor(GAMEPLAY_FILE);

    useGameStore.getState().actions.updateSettings({ enableBackgroundMusic: false });
    vi.advanceTimersByTime(MUSIC_VOLUME_RAMP_MS);

    expect(el.volume).toBeCloseTo(0, 6);
    expect(el.pauseCalls).toBe(1);
    expect(el.srcRemoved).toBe(true);
  });

  it('scales the element volume by the bus volume and the track trim', () => {
    useGameStore.getState().actions.updateSettings({ musicVolume: 0.8 });
    setMusicState('gameplay');
    vi.advanceTimersByTime(MUSIC_CROSSFADE_MS);

    const el = elementFor(GAMEPLAY_FILE);
    expect(el.volume).toBeCloseTo(0.8 * GAMEPLAY_TRACK.trim, 6);

    // A live volume change glides — no snap on the slider.
    useGameStore.getState().actions.updateSettings({ musicVolume: 0.2 });
    vi.advanceTimersByTime(MUSIC_VOLUME_RAMP_MS);
    expect(el.volume).toBeCloseTo(0.2 * GAMEPLAY_TRACK.trim, 6);
  });
});

describe('ducking', () => {
  it('steps the bus back for a duck and glides it back afterwards', () => {
    setMusicState('gameplay');
    vi.advanceTimersByTime(MUSIC_CROSSFADE_MS);
    const el = elementFor(GAMEPLAY_FILE);

    duckMusic();
    vi.advanceTimersByTime(MUSIC_DUCK_FADE_MS);
    expect(el.volume).toBeCloseTo(fullGameplayVolume() * MUSIC_DUCK_LEVEL, 6);

    vi.advanceTimersByTime(MUSIC_DUCK_HOLD_MS + MUSIC_DUCK_RESTORE_MS);
    expect(el.volume).toBeCloseTo(fullGameplayVolume(), 6);
  });

  it('ducks for the news cues only — a click never moves the bus', () => {
    setMusicState('gameplay');
    vi.advanceTimersByTime(MUSIC_CROSSFADE_MS);
    const el = elementFor(GAMEPLAY_FILE);

    // A UI click is chatter: the music must not step aside for it. Advance
    // past the cue's hold so the next request is not queued behind it.
    playSfx('uiSelect');
    vi.advanceTimersByTime(MUSIC_DUCK_FADE_MS + 1_000);
    expect(el.volume).toBeCloseTo(fullGameplayVolume(), 6);

    // Declaring war is news the player must hear: the bus steps back.
    resetSoundPolicy();
    playSfx('warDeclared');
    vi.advanceTimersByTime(MUSIC_DUCK_FADE_MS);
    expect(el.volume).toBeCloseTo(fullGameplayVolume() * MUSIC_DUCK_LEVEL, 6);
  });
});

describe('preload and release', () => {
  it('warms the next scene without playing it, and takes it over when the scene arrives', () => {
    preloadMusic('gameplay');

    // Buffered, not playing: that is what a loading screen buys.
    expect(created).toHaveLength(1);
    const el = elementFor(GAMEPLAY_FILE);
    expect(el.playCalls).toBe(0);

    // Entering the scene takes the warmed element over instead of fetching
    // the track a second time.
    setMusicState('gameplay');
    expect(created).toHaveLength(1);
    expect(el.playCalls).toBe(1);
  });

  it('does not warm anything while the music is off', () => {
    useGameStore.getState().actions.updateSettings({ enableBackgroundMusic: false });
    preloadMusic('gameplay');
    expect(created).toHaveLength(0);
  });
});

describe('autoplay unlock', () => {
  it('retries blocked playback on the first user gesture', async () => {
    installFakeAudio({ rejectPlay: true });
    setMusicState('gameplay');
    const el = elementFor(GAMEPLAY_FILE);
    expect(el.playCalls).toBe(1);

    // Let the rejected promise settle so the block is remembered.
    await Promise.resolve();

    // `unlockAudio` is the game's one entry point for warming audio after a
    // gesture; the music layer must be retried there too.
    unlockAudio();
    expect(el.playCalls).toBe(2);
  });

  it('does not retry when nothing was blocked', () => {
    setMusicState('gameplay');
    const el = elementFor(GAMEPLAY_FILE);
    expect(el.playCalls).toBe(1);

    unlockAudio();
    expect(el.playCalls).toBe(1);
  });
});
