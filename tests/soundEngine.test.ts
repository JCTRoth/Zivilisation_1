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
  selectionAckFor,
  playUnitSelection,
  SELECTION_REPEAT_WINDOW_MS,
  cityAssaultCue,
  SOUND_MANIFEST,
  SOUND_COOLDOWNS_MS,
  CUE_CATEGORY,
} from '@/utils/SoundEngine';
import { CUE_FILES, type SfxCue } from '@/utils/Sfx';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Long enough for the one voice to finish whatever is ringing on it. */
const CLEAR_VOICE_MS = 5_000;

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
  it('a movement sound replays only after 10 seconds', () => {
    const h = harness();
    expect(SOUND_COOLDOWNS_MS.unit).toBe(10_000);
    expect(requestSound('tankMove')).toBe('played');
    expect(requestSound('tankMove')).toBe('dropped-cooldown');
    h.advance(9_999);
    expect(requestSound('tankMove')).toBe('dropped-cooldown');
    h.advance(1);
    expect(requestSound('tankMove')).toBe('played');
  });

  it('a selection acknowledgement is NOT held to the 10 s window', () => {
    // The old rule held selections to the same 10 s family as movement, so
    // picking up five units in a row produced one acknowledgement and four
    // silences. Selection is a conversation with a particular unit and is gated
    // per unit instead (see `selectionAckFor`), so its family window is only
    // long enough to stop one click from machine-gunning.
    const h = harness();
    expect(SOUND_COOLDOWNS_MS.selection).toBeLessThan(1_000);
    expect(requestSound('unitSelected')).toBe('played');
    // Clear the voice as well as the cooldown — the one voice at a time rule is
    // unchanged and is what makes these `queued` rather than `played`.
    h.advance(CLEAR_VOICE_MS);
    expect(requestSound('archerSelected')).toBe('played');
    h.advance(CLEAR_VOICE_MS);
    expect(requestSound('submarineSelected')).toBe('played');
  });

  it('still stops one click from producing three blips', () => {
    const h = harness();
    expect(requestSound('unitSelected')).toBe('played');
    expect(requestSound('unitSelected')).toBe('dropped-cooldown');
    h.advance(CLEAR_VOICE_MS);
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
    expect(order[2]).toContain('uiSelect');
  });

  it('drops the least important waiter when the line is full', () => {
    const h = harness();
    expect(requestSound('nuclearStrike')).toBe('played'); // holds 4.67 s
    expect(requestSound('cityAttacked')).toBe('queued'); // priority 0
    expect(requestSound('tankMove')).toBe('queued'); // priority 3
    expect(requestSound('mechInfMove')).toBe('queued'); // priority 3 — line now full
    // A newcomer no more important than the least important waiter is dropped
    // rather than evicting anything: a click never bumps a fanfare.
    expect(requestSound('unitPromoted')).toBe('dropped-busy');
    h.advance(10_000);
    expect(h.played.filter((p) => p.what.includes('unitPromoted'))).toHaveLength(0);
  });

  it('a unit answering a click outranks the movement chatter behind it', () => {
    // The acknowledgement is what the player is listening for; an order they
    // just issued must not push it out of the line.
    const h = harness();
    expect(requestSound('nuclearStrike')).toBe('played'); // holds 4.67 s
    expect(requestSound('cityAttacked')).toBe('queued'); // priority 0
    expect(requestSound('tankMove')).toBe('queued'); // priority 3
    expect(requestSound('mechInfMove')).toBe('queued'); // priority 3 — line now full
    // The ack (priority 2) evicts the least important waiter (a movement cue).
    expect(requestSound('unitSelected')).toBe('queued');
    h.advance(10_000);
    expect(h.played.some((p) => p.what === 'unitSelected')).toBe(true);
    const movement = h.played.filter((p) => p.what.includes('tank-move') || p.what.includes('mech'));
    expect(movement.length).toBe(1); // one of the two was evicted
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
    expect(pickVariant('machineGunStrike', () => 0.99)).toContain('machine-gun-strike-2.ogg');
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
      'naval-strike-1.ogg': 1.74,
      'air-strike-1.ogg': 1.16,
      'missile-launch-1.ogg': 1.07,
      'nuclear-strike-1.ogg': 4.67,
      'submarine-selected-1.ogg': 1.36,
      'submarine-selected-2.ogg': 1.5,
      'artillerie-selected-1.ogg': 0.51,
      'artillerie-selected-2.ogg': 0.51,
      'air-unit-in-air-target-set.ogg': 0.5,
      'air-unit-returning-to-base.ogg': 0.5,
      'sdi-intercept-1.ogg': 1.31,
      'sabotage-success-1.ogg': 1.85,
      'spy_catched.ogg': 1.0,
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

describe('selection — a unit answers once, then grunts', () => {
  it('gives the full acknowledgement the first time a unit is picked up', () => {
    expect(selectionAckFor('u1', 1_000)).toBe('ack');
  });

  it('grunts instead of re-introducing itself inside the window', () => {
    selectionAckFor('u1', 1_000);
    // 4 s is the midpoint of the 3–5 s window the rule asks for.
    expect(SELECTION_REPEAT_WINDOW_MS).toBeGreaterThanOrEqual(3_000);
    expect(SELECTION_REPEAT_WINDOW_MS).toBeLessThanOrEqual(5_000);
    expect(selectionAckFor('u1', 1_000 + 500)).toBe('brief');
    expect(selectionAckFor('u1', 1_000 + 2_500)).toBe('brief');
  });

  it('introduces itself again once the window has passed', () => {
    selectionAckFor('u1', 1_000);
    expect(selectionAckFor('u1', 1_000 + SELECTION_REPEAT_WINDOW_MS)).toBe('ack');
  });

  it('treats every unit as its own conversation', () => {
    // The whole point of the change: picking up five units in a row must give
    // five acknowledgements. The old shared cooldown gave one.
    expect(selectionAckFor('a', 1_000)).toBe('ack');
    expect(selectionAckFor('b', 1_000)).toBe('ack');
    expect(selectionAckFor('c', 1_000)).toBe('ack');
    expect(selectionAckFor('d', 1_000)).toBe('ack');
    expect(selectionAckFor('e', 1_000)).toBe('ack');
  });

  it('forgets nothing within a turn but is not a permanent record', () => {
    // The ledger answers "did we just acknowledge this unit?", not "have we
    // ever". A unit picked up two minutes later is a new introduction.
    selectionAckFor('u1', 1_000);
    expect(selectionAckFor('u1', 1_000 + 120_000)).toBe('ack');
  });

  it('plays the grunt on a re-click and the real acknowledgement otherwise', () => {
    const h = harness();
    expect(playUnitSelection('u1', false, 'warrior', 1_000)).toBe('unitSelected');
    h.advance(CLEAR_VOICE_MS);
    // Same unit, same moment in the policy clock: the grunt.
    expect(playUnitSelection('u1', false, 'warrior', 1_001)).toBe('unitReSelected');
    // A different unit, still the full answer.
    h.advance(CLEAR_VOICE_MS);
    expect(playUnitSelection('u2', true, 'submarine', 1_002)).toBe('submarineSelected');
  });

  it('keeps each unit type speaking in its own voice on the FIRST click', () => {
    expect(playUnitSelection('s1', true, 'submarine', 1_000)).toBe('submarineSelected');
    expect(playUnitSelection('a1', false, 'archer', 1_000)).toBe('archerSelected');
    expect(playUnitSelection('w1', false, 'warrior', 1_000)).toBe('unitSelected');
  });

  it('returns null when the game is muted', () => {
    configureSoundEngine({
      backend: { playFile: () => {}, playSynth: () => {} },
      isEnabled: () => false,
    });
    resetSoundPolicy();
    expect(playUnitSelection('u1', false, 'warrior', 1_000)).toBeNull();
    // A muted click still counts as a click: the unit does not hold the answer
    // back and shout it later.
    expect(selectionAckFor('u1', 2_000)).toBe('brief');
  });
});
