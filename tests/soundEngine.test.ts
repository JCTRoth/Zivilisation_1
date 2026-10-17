/**
 * The SoundEngine policy — cooldowns, serialization, variant choice.
 *
 * `tests/sfx.test.ts` pins the transport (files win, synths fall back, the
 * mix ladder). This file pins the POLICY that sits in front of it: a unit
 * stays quiet for 10 s after it speaks, an attack for 4 s, two sounds never
 * overlap, and a cue with several recordings plays its main one most of the
 * time. Everything runs on a fake clock, a fake scheduler and a recording
 * backend — no audio hardware, no wall-clock flakiness.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  configureSoundEngine,
  resetSoundPolicy,
  requestSound,
  pickVariant,
  cueDurationSec,
  unitAttackCue,
  unitSelectCue,
  cityAssaultCue,
  SOUND_MANIFEST,
  SOUND_COOLDOWNS_MS,
  CUE_CATEGORY,
} from '@/utils/SoundEngine';
import { CUE_FILES, type SfxCue } from '@/utils/Sfx';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** A controllable world for the engine: time, randomness and sound output. */
function harness() {
  let now = 1_000_000;
  const played: Array<{ kind: 'file' | 'synth'; what: string; at: number }> = [];
  const timers: Array<{ fn: () => void; at: number }> = [];
  configureSoundEngine({
    backend: {
      playFile: (file) => { played.push({ kind: 'file', what: file, at: now }); },
      playSynth: (cue) => { played.push({ kind: 'synth', what: cue, at: now }); },
    },
    fileLookup: (cue) => CUE_FILES[cue],
    isEnabled: () => true,
    now: () => now,
    random: () => 0.0, // deterministic unless a test overrides it
    schedule: (fn, ms) => { timers.push({ fn, at: now + ms }); },
  });
  resetSoundPolicy();
  return {
    played,
    /** Move the clock forward, firing every timer whose time has come. */
    advance(ms: number): void {
      const target = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > target) break;
        timers.shift();
        now = next.at;
        next.fn();
      }
      now = target;
    },
  };
}

beforeEach(() => {
  harness();
});

describe('cooldowns — one voice per family per window', () => {
  it('a unit sound replays only after 10 seconds', () => {
    const h = harness();
    expect(SOUND_COOLDOWNS_MS.unit).toBe(10_000);
    expect(requestSound('unitSelected')).toBe('played');
    expect(requestSound('unitSelected')).toBe('dropped-cooldown');
    h.advance(9_999);
    expect(requestSound('unitSelected')).toBe('dropped-cooldown');
    h.advance(1);
    expect(requestSound('unitSelected')).toBe('played');
  });

  it('an attack sound replays only after 4 seconds', () => {
    const h = harness();
    expect(SOUND_COOLDOWNS_MS.attack).toBe(4_000);
    expect(requestSound('machineGunStrike')).toBe('played');
    expect(requestSound('machineGunStrike')).toBe('dropped-cooldown');
    h.advance(4_000);
    expect(requestSound('machineGunStrike')).toBe('played');
  });

  it('cooldowns are per cue, not global — a blow does not mute a click', () => {
    harness();
    expect(requestSound('machineGunStrike')).toBe('played');
    // A different cue, even in a busier family, is unaffected. (uiSelect is
    // short enough to play straight through the strike's voice hold.)
    expect(requestSound('uiSelect')).toBe('queued');
  });

  it('a muted game plays nothing and stamps no cooldown', () => {
    configureSoundEngine({
      backend: { playFile: () => {}, playSynth: () => {} },
      fileLookup: (cue) => CUE_FILES[cue],
      isEnabled: () => false,
      now: () => 0,
      random: () => 0,
      schedule: () => {},
    });
    resetSoundPolicy();
    expect(requestSound('machineGunStrike')).toBe('muted');
  });
});

describe('serialization — never two sounds at once', () => {
  it('queues a second cue behind the first instead of overlapping it', () => {
    const h = harness();
    expect(requestSound('machineGunStrike')).toBe('played'); // holds the voice 1.5 s
    expect(requestSound('cityAttacked')).toBe('queued');
    expect(h.played).toHaveLength(1);
    h.advance(1_500);
    expect(h.played).toHaveLength(2);
    expect(h.played[1].what).toContain('city-attacked');
  });

  it('drains the queue most important first — a fanfare bumps a click', () => {
    const h = harness();
    expect(requestSound('machineGunStrike')).toBe('played');
    expect(requestSound('uiSelect')).toBe('queued');
    expect(requestSound('cityAttacked')).toBe('queued');
    h.advance(10_000);
    const order = h.played.map((p) => p.what);
    expect(order[0]).toContain('machine-gun-strike');
    expect(order[1]).toContain('city-attacked');
    expect(order[2]).toContain('ui-select');
  });

  it('drops the least important waiter when the line is full', () => {
    const h = harness();
    expect(requestSound('nuclearStrike')).toBe('played'); // holds 4.67 s
    expect(requestSound('cityAttacked')).toBe('queued'); // priority 0
    expect(requestSound('unitSelected')).toBe('queued'); // priority 2
    expect(requestSound('tankMove')).toBe('queued'); // priority 2 — line full
    // A fourth unit sound is no more important than the least important
    // waiter, so it is dropped rather than evicting real news.
    expect(requestSound('submarineSelected')).toBe('dropped-busy');
    h.advance(10_000);
    // The submarine ping never got in; everything else played exactly once.
    expect(h.played.filter((p) => p.what.includes('submarine'))).toHaveLength(0);
    expect(h.played).toHaveLength(4);
  });

  it('a queued cue does not re-trigger its own cooldown on the way out', () => {
    const h = harness();
    expect(requestSound('machineGunStrike')).toBe('played');
    expect(requestSound('cityAttacked')).toBe('queued');
    h.advance(10_000);
    expect(h.played.filter((p) => p.what.includes('city-attacked'))).toHaveLength(1);
  });
});

describe('variants — the main recording plays most of the time', () => {
  it('weight 70 of 100 means the main file on a low roll', () => {
    expect(pickVariant('machineGunStrike', () => 0.0)).toContain('machine-gun-strike-1.ogg');
    expect(pickVariant('machineGunStrike', () => 0.69)).toContain('machine-gun-strike-1.ogg');
    expect(pickVariant('machineGunStrike', () => 0.71)).not.toContain('machine-gun-strike-1.ogg');
    expect(pickVariant('machineGunStrike', () => 0.99)).toContain('machine-gun-strike-3.ogg');
  });

  it('a single-file cue always resolves to its one recording', () => {
    expect(pickVariant('nuclearStrike', () => 0.99)).toContain('nuclear-strike-1.ogg');
  });

  it('a runtime CUE_FILES row that differs from the shipped main wins outright', () => {
    // The live-registration contract: repointing one cue repoints it, without
    // touching the variant table.
    const live = { ...CUE_FILES, machineGunStrike: '/assets/sfx/custom-strike.ogg' };
    configureSoundEngine({
      backend: { playFile: () => {}, playSynth: () => {} },
      fileLookup: (cue) => live[cue],
      isEnabled: () => true,
      now: () => 0,
      random: () => 0.99, // would otherwise pick a secondary
      schedule: () => {},
    });
    resetSoundPolicy();
    expect(pickVariant('machineGunStrike')).toBe('/assets/sfx/custom-strike.ogg');
  });

  it('every manifest file exists on disk, under the warzone folder', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const files = new Set<string>();
    for (const [cue, manifest] of Object.entries(SOUND_MANIFEST)) {
      // Duration-only legacy entries (mp3 cues) carry no variant list —
      // their single file comes from `CUE_FILES`, covered by sfx.test.ts.
      if (!manifest?.variants || manifest.variants.length === 0) continue;
      for (const variant of manifest.variants) {
        expect(variant.file, `${cue} variant`).toMatch(/^\/assets\/sfx\/warzone2100\//);
        const onDisk = path.join(repoRoot, 'public', variant.file.replace(/^\//, ''));
        expect(existsSync(onDisk), `${cue} → ${variant.file} is missing`).toBe(true);
        files.add(variant.file);
      }
    }
    // Sixteen recordings shipped, sixteen wired — a file on disk that no cue
    // plays is a dead asset, and a cue with no file is a silent promise.
    expect(files.size).toBe(16);
  });

  it('one file, one purpose — no recording serves two cues', () => {
    const seen = new Map<string, string>();
    for (const [cue, manifest] of Object.entries(SOUND_MANIFEST)) {
      for (const variant of manifest?.variants ?? []) {
        const owner = seen.get(variant.file);
        expect(owner, `${variant.file} is used by ${cue} and ${owner}`).toBeUndefined();
        seen.set(variant.file, cue);
      }
    }
  });

  it('the main recording is first in every variant list', () => {
    // Convention the doc promises: variants[0] is the main file, and the
    // CUE_FILES row points at it. Duration-only legacy entries are skipped —
    // they have no list by design.
    for (const [cue, manifest] of Object.entries(SOUND_MANIFEST)) {
      if (!manifest?.variants || manifest.variants.length === 0) continue;
      const main = manifest.variants[0]?.file;
      expect(main, `${cue} main file`).toBeDefined();
      expect(CUE_FILES[cue as SfxCue], `${cue} CUE_FILES row`).toBe(main);
    }
  });

  it('every manifest duration covers its longest file', () => {
    // Serialization holds the voice for `durationSec`; shorter than the file
    // and the next cue steps on the tail.
    const measured: Record<string, number> = {
      'machine-gun-strike-1.ogg': 1.0,
      'machine-gun-strike-2.ogg': 1.5,
      'machine-gun-strike-3.ogg': 0.92,
      'naval-strike-1.ogg': 1.74,
      'air-strike-1.ogg': 1.16,
      'missile-launch-1.ogg': 1.07,
      'nuclear-strike-1.ogg': 4.67,
      'unit-selected-1.ogg': 0.51,
      'submarine-selected-1.ogg': 1.36,
      'submarine-selected-2.ogg': 1.5,
      'air-unit-launch-1.ogg': 1.06,
      'air-unit-launch-3.ogg': 1.05,
      'sdi-intercept-1.ogg': 1.31,
      'ui-select-1.ogg': 0.3,
      'sabotage-success-1.ogg': 1.85,
      'production-complete-1.ogg': 1.18,
    };
    for (const [cue, manifest] of Object.entries(SOUND_MANIFEST)) {
      for (const variant of manifest?.variants ?? []) {
        const base = variant.file.split('/').pop() as string;
        expect(
          manifest?.durationSec ?? 0,
          `${cue} holds the voice shorter than ${base}`,
        ).toBeGreaterThanOrEqual(measured[base] ?? 0);
      }
      expect(cueDurationSec(cue as SfxCue)).toBe(manifest?.durationSec);
    }
  });
});

describe('unit → cue mapping', () => {
  it('every hull fires its own weapon sound', () => {
    expect(unitAttackCue(true, false, false)).toBe('torpedoAttack');
    expect(unitAttackCue(false, false, true)).toBe('airStrike');
    expect(unitAttackCue(false, true, false)).toBe('navalStrike');
    // Machine guns only for a unit that carries them …
    expect(unitAttackCue(false, false, false, true)).toBe('machineGunStrike');
    // … and a plain impact for a land unit that does not.
    expect(unitAttackCue(false, false, false)).toBe('impactStrike');
  });

  // Structural rule: a cue is only ever allowed to serve ONE unit class —
  // a single sound must never be shared by two different weapon platforms.
  // The five classes (submarine / air / surface naval / gun-armed ground /
  // plain ground) therefore have to map to five distinct cues. If two
  // branches collapse onto the same cue, a future change silently reuses a
  // weapon sound for a whole class that was meant to speak with its own voice.
  it('keeps the weapon cues one-to-one (no shared cue across two unit classes)', () => {
    const cues = [
      unitAttackCue(true, false, false),
      unitAttackCue(false, false, true),
      unitAttackCue(false, true, false),
      unitAttackCue(false, false, false, true),
      unitAttackCue(false, false, false),
    ];
    expect(new Set(cues).size).toBe(cues.length);
  });

  it('a machine gun is the narrowest claim on a cue', () => {
    // The recording behind `machineGunStrike` is Warzone's
    // `short_machine_gun_fire`, so a flag flipped on for the wrong unit puts a
    // burst of automatic fire in the hands of a legion. Only the caller that
    // knows the unit type may set it, and the default must be "no machine gun"
    // so a forgotten argument is silent rather than wrong.
    expect(unitAttackCue(false, false, false)).not.toBe('machineGunStrike');
    expect(unitAttackCue(false, false, false, false)).toBe('impactStrike');
    // A machine-gunned unit is still a ground unit: the flag cannot override
    // the platform branches above it.
    expect(unitAttackCue(true, false, false, true)).toBe('torpedoAttack');
    expect(unitAttackCue(false, true, false, true)).toBe('navalStrike');
    expect(unitAttackCue(false, false, true, true)).toBe('airStrike');
  });

  it('a submarine answers selection with sonar, everything else reports in', () => {
    expect(unitSelectCue(true)).toBe('submarineSelected');
    expect(unitSelectCue(false)).toBe('unitSelected');
  });

  it('every cue in the manifest has a cooldown family', () => {
    for (const cue of Object.keys(SOUND_MANIFEST) as SfxCue[]) {
      expect(CUE_CATEGORY[cue], `${cue} category`).toBeDefined();
    }
  });
});

describe('city assault — who is allowed to sound the city', () => {
  // The cue is a gunpowder bombardment: walls under fire. It starts with the
  // Musketeer and covers what the gunpowder line leads to.
  it('sounds for gunpowder infantry and artillery', () => {
    for (const unitType of ['musketeer', 'riflemen', 'mech_inf', 'cannon', 'artillery']) {
      expect(cityAssaultCue(unitType), `${unitType} should bombard`).toBe(true);
    }
  });

  // A sword or a stone engine does not bombard walls.
  it('stays silent for pre-gunpowder land units', () => {
    for (const unitType of [
      'warrior', 'archer', 'phalanx', 'chariot', 'knights', 'legion',
      'catapult', 'scout', 'cavalry',
    ]) {
      expect(cityAssaultCue(unitType), `${unitType} should not bombard`).toBe(false);
    }
  });

  // The Tank has its own guns and its own movement rumble; an attack run or a
  // naval broadside is not an assault on the walls.
  it('stays silent for a tank, an aircraft or a ship', () => {
    for (const unitType of ['tank', 'fighter', 'bomber', 'cruiser', 'destroyer', 'battleship', 'submarine']) {
      expect(cityAssaultCue(unitType), `${unitType} should not bombard`).toBe(false);
    }
  });

  it('treats an unknown or missing attacker as no assault', () => {
    // Fail closed. A new unit type added without a decision here must not
    // inherit a city fanfare nobody reasoned about.
    expect(cityAssaultCue(undefined)).toBe(false);
    expect(cityAssaultCue('')).toBe(false);
    expect(cityAssaultCue('some_future_unit')).toBe(false);
    expect(cityAssaultCue('Musketeer')).toBe(false); // exact match, not fuzzy
  });
});

describe('resetSoundPolicy', () => {
  it('a reset engine plays a cue it just suppressed', () => {
    harness();
    expect(requestSound('machineGunStrike')).toBe('played');
    expect(requestSound('machineGunStrike')).toBe('dropped-cooldown');
    resetSoundPolicy();
    expect(requestSound('machineGunStrike')).toBe('played');
  });
});
