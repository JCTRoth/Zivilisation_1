/**
 * SoundEngine — the game's sound policy: what may play, when, and which
 * recording of it.
 *
 * `Sfx.ts` owns the TRANSPORT (oscillator synthesis, HTMLAudio file playback,
 * the settings switch). This module owns the POLICY, and it is the only thing
 * that decides whether a requested cue actually makes a noise:
 *
 *  1. **Cooldowns.** A cue replays at most once per its category window —
 *     unit sounds (selections, movement) every 10 s, attack sounds every 4 s,
 *     one-off events every 2.5 s, UI clicks every 0.4 s. A three-tile drive
 *     or a five-round battle must not machine-gun the same sample.
 *  2. **Serialization.** The game has exactly one voice: while a cue is still
 *     ringing, the next one waits in a small priority FIFO (events first,
 *     UI last; three deep, then the lowest priority is dropped). Two sounds
 *     never overlap — a torpedo never steps on a fanfare.
 *  3. **Variants.** A cue with several recordings plays its MAIN file most
 *     of the time (weight 70) and a secondary the rest — the same blow does
 *     not sound byte-identical every round, but it stays recognisable.
 *  4. **One file, one purpose.** The manifest below is the whole assignment
 *     of recordings to cues; a file appears in exactly one cue's variant
 *     list (pinned by `tests/soundEngine.test.ts`), so no sample ever means
 *     two different things.
 *
 * The engine is clock-, random- and backend-injectable, so the policy is
 * unit-testable without audio hardware: `tests/soundEngine.test.ts` drives it
 * with a fake clock and a recording backend. `Sfx.ts` registers the real
 * backend (and the `CUE_FILES` fallback for runtime-registered rows) at
 * module load; `playSfx` is a thin `requestSound` wrapper, so every existing
 * call site gets the policy without changing.
 */

import type { SfxCue } from './Sfx';
import { UNIT_TYPES } from '../data/UnitConstants';

/** Cooldown family of a cue — the anti-spam window it plays under. */
export type SoundCategory = 'selection' | 'unit' | 'attack' | 'event' | 'ui';

/**
 * How long a cue of each family stays quiet after firing.
 *
 * `selection` (0.3 s) is deliberately the shortest window in the game. A unit's
 * acknowledgement is not gated by a cooldown at all — it is gated by whether the
 * player is RE-SELECTING the same unit (see `SELECTION_REPEAT_WINDOW_MS`) — so
 * this family exists only to stop one player mashing the mouse from producing a
 * machine-gun of blips on a single click. It must stay well under the repeat
 * window, or selecting unit A and then unit B would silence B, which is exactly
 * the behaviour it replaced.
 *
 * `unit` (10 s) covers everything a unit says on its own — movement, launches:
 * the sounds the player triggers just by driving.
 * `attack` (4 s) covers every weapon, including the nuclear strike: blows land
 * round after round, and each one must be heard without machine-gunning.
 */
export const SOUND_COOLDOWNS_MS: Record<SoundCategory, number> = {
  selection: 300,
  unit: 10_000,
  attack: 4_000,
  event: 2_500,
  ui: 400,
};

/**
 * How long before re-selecting the SAME unit counts as a fresh introduction.
 *
 * 4 s — the midpoint of the 3–5 s window. Inside it the player is re-clicking
 * the unit they just acknowledged, so a full "Yes, Commander?" would be the
 * game repeating itself: it gets a bare grunt instead. Outside it, selecting
 * the unit is a new interaction and gets the full acknowledgement again.
 */
export const SELECTION_REPEAT_WINDOW_MS = 4_000;

/** One recording of a cue, with its share of the plays. */
interface SoundVariant {
  /** Path under `public/`, served at the root (e.g. `/assets/sfx/…`). */
  file: string;
  /** Relative likelihood. The main recording carries 70 — it plays most. */
  weight: number;
}

interface CueManifest {
  category: SoundCategory;
  /** Longest variant, in seconds — the voice stays busy this long. */
  durationSec: number;
  /**
   * The main recording first, secondaries after. Weights need not sum.
   * Omitted for legacy mp3 cues: their single file comes from `CUE_FILES`
   * via the engine's file fallback instead of being listed twice.
   */
  variants?: SoundVariant[];
}

const WZ = '/assets/sfx/warzone2100';

/**
 * Every Warzone 2100 recording, assigned to exactly one cue.
 *
 * Durations were measured off the files with ffprobe (mono 11025 Hz) and are
 * the serialization holds: while a file's seconds have not elapsed, the next
 * cue waits. Adding a recording here without wiring its cue in `Sfx.ts`
 * (`CUES` notes, `CUE_FILES` main row, `CUE_FILE_VOLUME`) leaves a dead
 * asset — the manifest test fails closed on that.
 */
export const SOUND_MANIFEST: Partial<Record<SfxCue, CueManifest>> = {
  machineGunStrike: {
    category: 'attack',
    durationSec: 1.5,
    variants: [
      { file: `${WZ}/machine-gun-strike-1.ogg`, weight: 70 },
      { file: `${WZ}/machine-gun-strike-2.ogg`, weight: 30 },
    ],
  },
  navalStrike: {
    category: 'attack',
    durationSec: 1.74,
    variants: [{ file: `${WZ}/naval-strike-1.ogg`, weight: 100 }],
  },
  airStrike: {
    category: 'attack',
    durationSec: 1.16,
    variants: [{ file: `${WZ}/air-strike-1.ogg`, weight: 100 }],
  },
  missileLaunch: {
    category: 'attack',
    durationSec: 1.07,
    variants: [{ file: `${WZ}/missile-launch-1.ogg`, weight: 100 }],
  },
  nuclearStrike: {
    category: 'attack',
    durationSec: 4.67,
    variants: [{ file: `${WZ}/nuclear-strike-1.ogg`, weight: 100 }],
  },
  submarineSelected: {
    category: 'selection',
    durationSec: 1.5,
    variants: [
      { file: `${WZ}/submarine-selected-1.ogg`, weight: 70 },
      { file: `${WZ}/submarine-selected-2.ogg`, weight: 30 },
    ],
  },
  artillerieSelected: {
    category: 'selection',
    durationSec: 0.51,
    variants: [
      { file: `${WZ}/artillerie-selected-1.ogg`, weight: 70 },
      { file: `${WZ}/artillerie-selected-2.ogg`, weight: 30 },
    ],
  },
  airUnitInAirTargetSet: {
    category: 'unit',
    durationSec: 0.5,
    variants: [{ file: `${WZ}/air-unit-in-air-target-set.ogg`, weight: 100 }],
  },
  airUnitReturningToBase: {
    category: 'unit',
    durationSec: 0.5,
    variants: [{ file: `${WZ}/air-unit-returning-to-base.ogg`, weight: 100 }],
  },
  sdiIntercept: {
    category: 'attack',
    durationSec: 1.31,
    variants: [{ file: `${WZ}/sdi-intercept-1.ogg`, weight: 100 }],
  },
  sabotageSuccess: {
    category: 'event',
    durationSec: 1.85,
    variants: [{ file: `${WZ}/sabotage-success-1.ogg`, weight: 100 }],
  },
  spyCatched: {
    category: 'event',
    durationSec: 1.0,
    variants: [{ file: `${WZ}/spy_catched.ogg`, weight: 100 }],
  },
  productionComplete: {
    category: 'event',
    durationSec: 1.18,
    variants: [{ file: `${WZ}/production-complete-1.ogg`, weight: 100 }],
  },
  // ── Legacy-style file cues (single recording, file from CUE_FILES) ──
  archerSelected: { category: 'selection', durationSec: 0.5 },
  horseUnitMoves: { category: 'unit', durationSec: 0.5 },

  // The repeat-click grunt: a unit re-selected inside its acknowledgement
  // window says this instead of introducing itself again. Synthesized, so it
  // has no file — one short downward blip, half the length of the real
  // acknowledgement, which is what makes it read as "still here" rather than
  // as a second "Yes, Commander?".
  unitReSelected: { category: 'selection', durationSec: 0.12 },

  // ── Legacy mp3 cues: duration only, the file comes from CUE_FILES ────
  // Measured off the shipped mp3s with ffprobe. The voice stays busy for the
  // whole file — a fanfare that is still ringing is still playing, and the
  // next cue waits its turn like everything else.
  torpedoAttack: { category: 'attack', durationSec: 3.88 },
  tankMove: { category: 'unit', durationSec: 1.71 },
  // Measured off the assets with ffprobe: the machinery rumble is the longest
  // movement cue in the game (1.863 s), which is exactly why it sits at the
  // quietest file volume — see CUE_FILE_VOLUME.
  mechInfMove: { category: 'unit', durationSec: 1.87 },
  cityAttacked: { category: 'event', durationSec: 3.95 },
  barracksBuilt: { category: 'event', durationSec: 6.75 },
  cityCapturedClassic: { category: 'event', durationSec: 2.63 },
  cityCapturedModern: { category: 'event', durationSec: 5.62 },
  // A shouted cheer, under a second (0.771 s) — short enough that founding a
  // second city in the same turn still gets its own voice.
  cityFounded: { category: 'event', durationSec: 0.78 },
  bribe: { category: 'event', durationSec: 0.8 },
};

/**
 * The cooldown family of every cue, including the ones with no recording
 * (they play through the synthesizer but spam exactly like a file would).
 */
export const CUE_CATEGORY: Record<SfxCue, SoundCategory> = {
  stolenTechnology: 'event',
  coverBlown: 'event',
  cityCapturedClassic: 'event',
  cityCapturedModern: 'event',
  // ── The news cues ───────────────────────────────────────────────────
  // All one-off news in the `event` family, so they queue ahead of combat
  // rather than being swallowed by it. `unitPromoted` is the exception: it is
  // a reward on a single unit that usually happens mid-battle, so it takes the
  // quiet `unit` family and sits under the fanfares.
  warDeclared: 'event',
  peaceMade: 'event',
  wonderCompleted: 'event',
  cityLost: 'event',
  civEliminated: 'event',
  cityStarved: 'event',
  cityDisaster: 'event',
  cityDisorder: 'event',
  unitProduced: 'event',
  tradeRouteEstablished: 'event',
  unitPromoted: 'unit',
  bribe: 'event',
  uiSelect: 'ui',
  machineGunStrike: 'attack',
  impactStrike: 'attack',
  navalStrike: 'attack',
  airStrike: 'attack',
  missileLaunch: 'attack',
  sdiIntercept: 'attack',
  torpedoAttack: 'attack',
  unitDefeated: 'attack',
  unitDisbanded: 'event',
  // Selection is its own family: the acknowledgement is gated per UNIT (see
  // `SELECTION_REPEAT_WINDOW_MS`), not by a shared window, so a player picking
  // five units in a row hears five units answer instead of one.
  unitSelected: 'selection',
  submarineSelected: 'selection',
  artillerieSelected: 'selection',
  archerSelected: 'selection',
  unitReSelected: 'selection',
  horseUnitMoves: 'unit',
  airUnitInAirTargetSet: 'unit',
  airUnitReturningToBase: 'unit',
  airUnitLaunch: 'unit',
  tankMove: 'unit',
  mechInfMove: 'unit',
  cityAttacked: 'event',
  cityFounded: 'event',
  barracksBuilt: 'event',
  sabotageSuccess: 'event',
  spyCatched: 'event',
  productionComplete: 'event',
  nuclearStrike: 'attack',
};

/**
 * Synthesized length, in seconds, of the cues with no recording.
 *
 * These are the holds for the synth-only cues, measured off the note tables in
 * `CUES`: the voice stays busy until the last note has rung out, so a shorter
 * hold would let the next cue step on the tail. `wonderCompleted` and
 * `civEliminated` are the long ones — both are rare and both are meant to land.
 */
const SYNTH_DURATIONS_SEC: Partial<Record<SfxCue, number>> = {
  stolenTechnology: 0.48,
  coverBlown: 0.64,
  unitDefeated: 0.4,
  unitDisbanded: 0.22,
  impactStrike: 0.1,
  warDeclared: 0.45,
  peaceMade: 0.62,
  wonderCompleted: 1.15,
  cityLost: 0.98,
  civEliminated: 1.25,
  cityStarved: 0.55,
  cityDisaster: 0.95,
  cityDisorder: 0.45,
  unitProduced: 0.42,
  tradeRouteEstablished: 0.48,
  unitPromoted: 0.25,
  bribe: 0.36,
};

/** How long a runtime-registered file (or an unknown synth) holds the voice. */
const DEFAULT_FILE_DURATION_SEC = 0.5;

/** Lower number plays first when several cues wait. */
const CATEGORY_PRIORITY: Record<SoundCategory, number> = {
  event: 0,
  attack: 1,
  // A unit answering a click outranks the movement chatter that usually
  // follows it, so the acknowledgement is never swallowed by its own orders.
  selection: 2,
  unit: 3,
  ui: 4,
};

/** The waiting line holds this many cues; anything more is dropped. */
const MAX_QUEUE = 3;

/** What happened to a cue request — returned by `requestSound`. */
export type SoundRequestStatus =
  /** Audible now. */
  | 'played'
  /** The voice is busy; the cue waits its turn. */
  | 'queued'
  /** The same cue fired inside its cooldown window. */
  | 'dropped-cooldown'
  /** The queue was full of more important sounds. */
  | 'dropped-busy'
  /** Sound is off in settings. */
  | 'muted';

/** The transport `Sfx.ts` plugs in — the engine never touches audio itself. */
interface SoundBackend {
  playFile: (path: string, cue: SfxCue) => void;
  playSynth: (cue: SfxCue) => void;
}

interface EngineConfig {
  backend: SoundBackend;
  /** The `CUE_FILES` table — the fallback for cues with no manifest entry. */
  fileLookup: (cue: SfxCue) => string | undefined;
  isEnabled: () => boolean;
  now: () => number;
  random: () => number;
  schedule: (fn: () => void, ms: number) => void;
}

let config: EngineConfig | null = null;
/** Last accepted play, per cue — the cooldown ledger. */
const lastPlayed = new Map<SfxCue, number>();
/**
 * When each unit last gave its acknowledgement, by unit id.
 *
 * This replaces the old rule, which was a 10 s cooldown on the cue itself: it
 * cut click-spam, but it was keyed on the SOUND rather than on the UNIT, so
 * selecting five units in a row played one acknowledgement and silenced the
 * other four. Selection is a conversation with a particular unit, so the
 * history belongs to the unit.
 */
const lastSelectionByUnit = new Map<string, number>();
/** Epoch ms until which the voice is busy. */
let busyUntil = 0;
/** Waiting cues, sorted by priority then arrival. */
let queue: Array<{ cue: SfxCue; at: number }> = [];
/** Bumped by `resetSoundPolicy` so stale drain timers die quietly. */
let generation = 0;

/**
 * Plug the transport in. Called once by `Sfx.ts` at module load; tests call
 * it with fakes. Anything but the backend may be omitted to keep the default.
 */
export function configureSoundEngine(partial: Partial<EngineConfig> & Pick<EngineConfig, 'backend'>): void {
  config = {
    fileLookup: () => undefined,
    isEnabled: () => true,
    now: () => Date.now(),
    random: () => Math.random(),
    schedule: (fn, ms) => { setTimeout(fn, ms); },
    ...partial,
  } as EngineConfig;
}

/**
 * Reset all policy state — cooldowns, the queue, the busy voice.
 *
 * Exists for tests: the engine is module state, so without this one file's
 * assertions would suppress another's. Nothing in the game calls it.
 */
export function resetSoundPolicy(): void {
  lastPlayed.clear();
  lastSelectionByUnit.clear();
  queue = [];
  busyUntil = 0;
  generation++;
}

/** How long `cue` holds the single voice, in seconds. */
export function cueDurationSec(cue: SfxCue): number {
  const manifest = SOUND_MANIFEST[cue];
  if (manifest) return manifest.durationSec;
  const filed = config?.fileLookup(cue);
  if (filed) return DEFAULT_FILE_DURATION_SEC;
  return SYNTH_DURATIONS_SEC[cue] ?? DEFAULT_FILE_DURATION_SEC;
}

/**
 * Which recording of `cue` plays — the main file with probability
 * `weight / total`, a secondary otherwise. Pure in (`random`, manifest),
 * so tests pin the "main plays most" contract without audio.
 *
 * A runtime `CUE_FILES` row that DIFFERS from the shipped main file wins
 * outright: filling a row still replaces that one cue live, exactly as
 * documented — the manifest only drives the shipped assignment. (This is
 * what lets a test — or a manifest loader — repoint one cue without
 * touching the variant table.)
 */
export function pickVariant(cue: SfxCue, random: () => number = config?.random ?? Math.random): string | null {
  const variants = SOUND_MANIFEST[cue]?.variants;
  const live = config?.fileLookup(cue);
  if (variants && variants.length > 0) {
    if (live && live !== variants[0]?.file) return live;
    const total = variants.reduce((sum, v) => sum + v.weight, 0);
    let roll = random() * total;
    for (const variant of variants) {
      roll -= variant.weight;
      if (roll <= 0) return variant.file;
    }
    return variants[variants.length - 1]?.file ?? null;
  }
  return live ?? null;
}

/**
 * Ask for a cue. The engine decides: mute, cooldown, queue, or play now.
 *
 * Synchronous and total — it never throws, and when the voice is free the
 * backend fires before this returns, which is what keeps the existing
 * call-and-assert tests honest.
 */
export function requestSound(cue: SfxCue): SoundRequestStatus {
  if (!config) return 'muted';
  if (!config.isEnabled()) return 'muted';

  const now = config.now();
  const cooldown = SOUND_COOLDOWNS_MS[CUE_CATEGORY[cue]];
  const last = lastPlayed.get(cue) ?? Number.NEGATIVE_INFINITY;
  if (now - last < cooldown) return 'dropped-cooldown';
  lastPlayed.set(cue, now);

  if (now < busyUntil) {
    const entry = { cue, at: now };
    const priorityOf = (c: SfxCue): number => CATEGORY_PRIORITY[CUE_CATEGORY[c]];
    if (queue.length >= MAX_QUEUE) {
      // Full: the newcomer only gets in by outranking the least important
      // waiter. A fanfare bumps a click; a click never bumps a fanfare.
      let worst = 0;
      for (let i = 1; i < queue.length; i++) {
        if (priorityOf(queue[i].cue) > priorityOf(queue[worst].cue)) worst = i;
      }
      if (priorityOf(cue) >= priorityOf(queue[worst].cue)) return 'dropped-busy';
      queue.splice(worst, 1);
    }
    queue.push(entry);
    queue.sort((a, b) => priorityOf(a.cue) - priorityOf(b.cue) || a.at - b.at);
    scheduleDrain();
    return 'queued';
  }

  playNow(cue, now);
  return 'played';
}

/** Fire the backend and hold the voice for the cue's duration. */
function playNow(cue: SfxCue, now: number): void {
  const backend = config?.backend;
  if (!backend) return;
  const file = pickVariant(cue);
  if (file) backend.playFile(file, cue);
  else backend.playSynth(cue);
  busyUntil = now + cueDurationSec(cue) * 1000;
  scheduleDrain();
}

/** Wake up when the voice frees and play the most important waiter. */
function scheduleDrain(): void {
  if (!config) return;
  const gen = generation;
  const wait = Math.max(0, busyUntil - config.now());
  config.schedule(() => {
    if (gen !== generation) return;
    if (!config) return;
    const next = queue.shift();
    if (!next) return;
    // The waiter was accepted already; its cooldown was stamped then.
    playNow(next.cue, config.now());
  }, wait);
}

// ─── Unit → cue mapping ────────────────────────────────────────────────
// Pure helpers, so the "which weapon sound for a fighter" decision is tested
// without a game: selection and attack sounds follow the hull, not a ladder.
//
// SOUND RULE (design invariant, not just style): one cue == one unit class.
// A cue may appear in `unitAttackCue` / `unitSelectCue` at most once, so a
// weapon sound is never shared by two different classes of hull. The five
// attack platforms below map to five distinct cues. Adding a new hull class
// requires a new cue + a dedicated asset first — do not reuse an existing cue
// to paper over a missing file.

/**
 * The blow a firing hull makes — torpedoes, naval guns, jets, machine guns, or
 * a plain impact.
 *
 * `hasMachineGun` is asked of the ATTACKER alone and must stay narrow: it is
 * true for Mech. Inf. and nothing else. The recording behind
 * `machineGunStrike` is Warzone's `short_machine_gun_fire`, so any unit granted
 * the flag without carrying machine guns makes the game say something untrue.
 * Everything else lands `impactStrike`, which is synthesized.
 */
export function unitAttackCue(
  isSubmarine: boolean,
  isNavalSurface: boolean,
  isAir: boolean,
  hasMachineGun = false,
): SfxCue {
  if (isSubmarine) return 'torpedoAttack';
  if (isAir) return 'airStrike';
  if (isNavalSurface) return 'navalStrike';
  if (hasMachineGun) return 'machineGunStrike';
  return 'impactStrike';
}

/**
 * The land units whose assault on a city is worth the city-attack cue.
 *
 * The city attack sound is a gunpowder bombardment — walls under fire — so it
 * starts with the Musketeer and everything the gunpowder line leads to. It is
 * NOT a generic "something attacked something" cue, which is why these three
 * kinds are excluded rather than falling through:
 *
 *  - pre-gunpowder land (warrior, archer, catapult, knights, legion, cavalry):
 *    a sword or a stone engine does not bombard walls;
 *  - the Tank: its own guns and its own movement rumble cover it;
 *  - aircraft and ships: an attack run or a naval broadside is not an
 *    assault on the walls, and their own cues already speak for them.
 *
 * Excluded attackers get no city cue at all rather than a fallback one — the
 * combat round still plays the blow that killed the defender.
 */
const CITY_ASSAULT_UNITS: ReadonlySet<string> = new Set<string>([
  UNIT_TYPES.MUSKETEER,
  UNIT_TYPES.RIFLEMEN,
  UNIT_TYPES.MECH_INF,
  UNIT_TYPES.CANNON,
  UNIT_TYPES.ARTILLERY,
]);

/** Whether `unitType` attacking a city should sound the city-attack cue. */
export function cityAssaultCue(unitType: string | undefined): boolean {
  return unitType !== undefined && CITY_ASSAULT_UNITS.has(unitType);
}

/** The acknowledgement a unit of `type` gives when the player picks it. */
export function unitSelectCue(isSubmarine: boolean, unitType?: string): SfxCue {
  if (isSubmarine) return 'submarineSelected';
  if (unitType === 'archer') return 'archerSelected';
  return 'unitSelected';
}

/** What a unit should do when the player clicks it. */
export type SelectionAck =
  /** First selection: the full "Yes, Commander?". */
  | 'ack'
  /** Re-selected inside the window: a bare grunt, or silence. */
  | 'brief';

/**
 * What this click deserves from THIS unit.
 *
 * The rule: a unit introduces itself the first time it is picked up. Clicking
 * it again within `SELECTION_REPEAT_WINDOW_MS` is the player re-issuing or
 * cancelling an order, not a new conversation — so it gets a short grunt, or
 * nothing at all. Clicking it after that window is a fresh introduction and
 * gets the full acknowledgement again.
 *
 * Stamps the ledger as a side effect, so call it exactly once per click.
 */
export function selectionAckFor(unitId: string, now: number = Date.now()): SelectionAck {
  const last = lastSelectionByUnit.get(unitId);
  lastSelectionByUnit.set(unitId, now);
  if (last === undefined) return 'ack';
  return now - last < SELECTION_REPEAT_WINDOW_MS ? 'brief' : 'ack';
}

/**
 * Play a unit's selection acknowledgement.
 *
 * Returns the cue it chose, or null when nothing was played — so a caller can
 * tell "the unit grunted" from "the unit stayed quiet" without knowing the
 * policy.
 */
export function playUnitSelection(
  unitId: string,
  isSubmarine: boolean,
  unitType: string | undefined,
  now: number = Date.now(),
): SfxCue | null {
  const ack = selectionAckFor(unitId, now);
  const cue: SfxCue = ack === 'brief'
    ? 'unitReSelected'
    : unitSelectCue(isSubmarine, unitType);
  return requestSound(cue) === 'muted' ? null : cue;
}
