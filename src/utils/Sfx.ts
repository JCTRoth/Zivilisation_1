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
import { configureSoundEngine, requestSound } from './SoundEngine';

export type SfxCue =
  /** A technology was stolen — short rising fanfare. */
  | 'stolenTechnology'
  /** The diplomat's cover was blown — descending alarm. */
  | 'coverBlown'
  /** A spy was caught in the act. */
  | 'spyCatched'
  /** A city fell to the player's forces before the modern era. */
  | 'cityCapturedClassic'
  /** A city fell to the player's forces in the modern era. */
  | 'cityCapturedModern'
  /** A menu choice was taken. */
  | 'uiSelect'
  /**
   * The game's news cues — the moments a player should hear even when nothing
   * is moving or shooting.
   *
   * Every one of these is synthesized and gated to the player's own affairs:
   * a rival's economy running is not sound design, but a war the player is
   * party to, a Wonder they finished, a city they lost and a unit they built
   * all are. They sit in the `event` family so they queue ahead of combat and
   * never stutter under it.
   */
  /** The player is dragged into a war. */
  | 'warDeclared'
  /** Hostilities end — a peace treaty or a ceasefire. One cue for both. */
  | 'peaceMade'
  /** The player finishes a Wonder — the biggest single achievement. */
  | 'wonderCompleted'
  /** The player loses a city to a rival. Never a fanfare. */
  | 'cityLost'
  /** A civilisation is wiped out — the player's, or one the player destroyed. */
  | 'civEliminated'
  /** One of the player's cities starves and is razed. */
  | 'cityStarved'
  /** One of the player's cities tips into unrest. */
  | 'cityDisorder'
  /** A unit rolls out of one of the player's cities, bought or built. */
  | 'unitProduced'
  /** One of the player's caravans opens a trade route. */
  | 'tradeRouteEstablished'
  /** One of the player's units is promoted to the next rank. */
  | 'unitPromoted'
  /**
   * A unit carrying machine guns opens up — Mech. Inf. and nothing else.
   *
   * Deliberately narrow: every other land unit falls through to
   * `impactStrike`, so a legion does not fire a machine gun it never had.
   */
  | 'machineGunStrike'
  /** A blow lands from a unit with no machine gun — a melee or siege impact. */
  | 'impactStrike'
  /** A surface warship fires its guns — the naval blow. */
  | 'navalStrike'
  /** A fighter or bomber makes its attack run. */
  | 'airStrike'
  /** A missile leaves its launcher — the breath before the boom. */
  | 'missileLaunch'
  /** An SDI battery kills an incoming warhead mid-air — the scramble. */
  | 'sdiIntercept'
  /** A submarine attacks — a torpedo run instead of a generic blow. */
  | 'torpedoAttack'
  /** A unit is destroyed. */
  | 'unitDefeated'
  /** A unit was disbanded to cover upkeep (or by order). */
  | 'unitDisbanded'
  /** The player picked up one of their units — a reporting-in blip. */
  | 'unitSelected'
  /**
   * The player clicked a unit they had ALREADY acknowledged within the last few
   * seconds — a bare grunt. Deliberately not another `unitSelected`: the player
   * has just heard the full introduction, and a second "Yes, Commander?" over
   * the top of it is the game repeating itself. This is the "still here" that
   * answers a re-click without repeating.
   */
  | 'unitReSelected'
  /** The player picked up a submarine — a sonar acknowledgement. */
  | 'submarineSelected'
  /** The player picked up an artillery piece — a reporting-in blip. */
  | 'artillerieSelected'
  /** The player picked up an archer — a reporting-in blip. */
  | 'archerSelected'
  /** An air unit takes off from a city or a carrier. */
  | 'airUnitLaunch'
  /** An air unit, already airborne, is given a target. */
  | 'airUnitInAirTargetSet'
  /** An air unit, after striking, heads back to base. */
  | 'airUnitReturningToBase'
  /** A tank rolls out of its tile. */
  | 'tankMove'
  /** A horse unit (chariot/knights/cavalry) moves out. */
  | 'horseUnitMoves'
  /** Mechanised infantry rolls out of its tile — the same beat as a tank. */
  | 'mechInfMove'
  /** The player founded a city — the cheer off the new walls. */
  | 'cityFounded'
  /** A city comes under assault. */
  | 'cityAttacked'
  /** A barracks finished in one of the player's cities. */
  | 'barracksBuilt'
  /** A sabotage went through — the target goes dark. */
  | 'sabotageSuccess'
  /** A building or unit rolled out of one of the player's cities. */
  | 'productionComplete'
  /** A nuclear warhead detonated — the sound of the century. */
  | 'nuclearStrike';


export const CUE_FILES: Partial<Record<SfxCue, string>> = {
  // ── Shipped recordings, live today ────────────────────────────────
  'cityCapturedClassic': '/assets/sfx/city-captured-classic.mp3',
  'cityCapturedModern': '/assets/sfx/city-captured-modern.mp3',
  'cityAttacked': '/assets/sfx/city-attacked.mp3',
  'barracksBuilt': '/assets/sfx/barracks-built.mp3',
  'torpedoAttack': '/assets/sfx/torpedo-attack.mp3',
  // airUnitLaunch used to be the mp3 below; the Warzone 2100 takeoff is the
  // main recording now (with scramble and return as secondaries), so the mp3
  // stays on disk but no row points at it any more.
  'tankMove': '/assets/sfx/tank-move.mp3',
  'mechInfMove': '/assets/sfx/mech-inf-move.opus',
  'cityFounded': '/assets/sfx/city-founded.opus',

  // ── Warzone 2100 recordings (GPLv2, see public/assets/sfx/warzone2100/) ──
  // One row per cue, always the MAIN recording — secondaries live in the
  // SoundEngine manifest, which picks the actual file per play.
  'machineGunStrike': '/assets/sfx/warzone2100/machine-gun-strike-1.ogg',
  'navalStrike': '/assets/sfx/warzone2100/naval-strike-1.ogg',
  'airStrike': '/assets/sfx/warzone2100/air-strike-1.ogg',
  'missileLaunch': '/assets/sfx/warzone2100/missile-launch-1.ogg',
  'sdiIntercept': '/assets/sfx/warzone2100/sdi-intercept-1.ogg',
  'nuclearStrike': '/assets/sfx/warzone2100/nuclear-strike-1.ogg',
  'submarineSelected': '/assets/sfx/warzone2100/submarine-selected-1.ogg',
  'artillerieSelected': '/assets/sfx/warzone2100/artillerie-selected-1.ogg',
  'archerSelected': '/assets/sfx/archer_selected.opus',
  'horseUnitMoves': '/assets/sfx/horse_unit_moves.opus',
  'airUnitInAirTargetSet': '/assets/sfx/warzone2100/air-unit-in-air-target-set.ogg',
  'airUnitReturningToBase': '/assets/sfx/warzone2100/air-unit-returning-to-base.ogg',
  'sabotageSuccess': '/assets/sfx/warzone2100/sabotage-success-1.ogg',
  'spyCatched': '/assets/sfx/warzone2100/spy_catched.ogg',
  'productionComplete': '/assets/sfx/warzone2100/production-complete-1.ogg',

  // ── Still synthesized — uncomment a row once its file lands ───────
  // 'unitDefeated':     '/assets/sfx/unit-defeated.ogg',
  // 'unitDisbanded':    '/assets/sfx/unit-disbanded.ogg',
  // 'stolenTechnology': '/assets/sfx/stolen-technology.ogg',
  // 'coverBlown':       '/assets/sfx/cover-blown.ogg',
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
  spyCatched: [
    // Caught: three short descending snaps.
    { freq: 440, at: 0.0, dur: 0.08, type: 'sawtooth', gain: 0.7 },
    { freq: 330, at: 0.07, dur: 0.08, type: 'sawtooth', gain: 0.7 },
    { freq: 220, at: 0.14, dur: 0.16, type: 'sawtooth', gain: 0.6 },
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
  cityFounded: [
    // Settlers cheering a new city into being: a bright four-step rise that
    // lands on the octave. The arch is the same shape as the capture fanfares
    // because both are "a city is yours now" — but it climbs a step higher
    // than the classical march, so founding and capturing stay tellable apart.
    { freq: 523, at: 0.0, dur: 0.08 },
    { freq: 659, at: 0.07, dur: 0.08 },
    { freq: 784, at: 0.14, dur: 0.08 },
    { freq: 1047, at: 0.21, dur: 0.18 },
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
  machineGunStrike: [
    // A burst, not one note: the recording is a short burst of automatic fire,
    // so the fallback is three rising cracks rather than a single blow. Kept
    // under a tenth of a second of tail so it never overlaps the next round.
    { freq: 220, at: 0.0, dur: 0.04, type: 'sawtooth', gain: 0.55 },
    { freq: 280, at: 0.03, dur: 0.04, type: 'sawtooth', gain: 0.5 },
    { freq: 330, at: 0.06, dur: 0.05, type: 'sawtooth', gain: 0.45 },
    { freq: 110, at: 0.02, dur: 0.07, type: 'triangle', gain: 0.5 },
  ],
  impactStrike: [
    // No firearm involved: a dull knock with the body falling away under it.
    // This is the melee/siege/tank blow — the sound of something hitting
    // something, rather than something firing.
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
  airUnitInAirTargetSet: [
    // A target is called in mid-air: two rising steps.
    { freq: 440, at: 0.0, dur: 0.08, type: 'sawtooth', gain: 0.6 },
    { freq: 660, at: 0.07, dur: 0.1, type: 'sawtooth', gain: 0.6 },
  ],
  airUnitReturningToBase: [
    // Heading home: a falling pair.
    { freq: 392, at: 0.0, dur: 0.1, type: 'sawtooth', gain: 0.6 },
    { freq: 262, at: 0.09, dur: 0.14, type: 'sawtooth', gain: 0.5 },
  ],
  tankMove: [
    // Tracks: two low notes, deliberately shorter than a combat cue.
    { freq: 98, at: 0.0, dur: 0.09, type: 'triangle', gain: 0.8 },
    { freq: 74, at: 0.07, dur: 0.12, type: 'triangle', gain: 0.6 },
  ],
  horseUnitMoves: [
    // Hooves: three quick low taps.
    { freq: 180, at: 0.0, dur: 0.06, type: 'triangle', gain: 0.7 },
    { freq: 160, at: 0.05, dur: 0.06, type: 'triangle', gain: 0.6 },
    { freq: 140, at: 0.1, dur: 0.08, type: 'triangle', gain: 0.5 },
  ],
  mechInfMove: [
    // Mech. Inf. stands in for the tank's tracks: a heavier two-note grind
    // that sits a little lower, because the recording it replaces is a tracked
    // vehicle rather than a pair of marching boots.
    { freq: 84, at: 0.0, dur: 0.1, type: 'triangle', gain: 0.85 },
    { freq: 62, at: 0.08, dur: 0.14, type: 'triangle', gain: 0.65 },
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

  // ── Warzone 2100 cues: synth fallbacks for the new recordings ──────
  // Every cue keeps oscillators for the day its file is missing — same
  // contract as the rest of the table. Each fallback is deliberately short
  // and shaped like the recording it stands in for.
  navalStrike: [
    // Naval guns: two flat cracks, heavier than the infantry knock.
    { freq: 240, at: 0.0, dur: 0.08, type: 'square', gain: 0.8 },
    { freq: 160, at: 0.09, dur: 0.12, type: 'square', gain: 0.7 },
  ],
  airStrike: [
    // An attack run diving in: three falling steps.
    { freq: 880, at: 0.0, dur: 0.1, type: 'sine', gain: 0.5 },
    { freq: 660, at: 0.09, dur: 0.1, type: 'sine', gain: 0.5 },
    { freq: 440, at: 0.18, dur: 0.16, type: 'sine', gain: 0.6 },
  ],
  missileLaunch: [
    // A launch climbing away: three rising steps.
    { freq: 220, at: 0.0, dur: 0.14, type: 'sawtooth', gain: 0.6 },
    { freq: 440, at: 0.12, dur: 0.14, type: 'sawtooth', gain: 0.6 },
    { freq: 880, at: 0.24, dur: 0.2, type: 'sawtooth', gain: 0.5 },
  ],
  sdiIntercept: [
    // The laser firing: a hard bright zap and its echo.
    { freq: 1760, at: 0.0, dur: 0.1, type: 'sawtooth', gain: 0.6 },
    { freq: 880, at: 0.09, dur: 0.16, type: 'sawtooth', gain: 0.5 },
  ],
  unitSelected: [
    // Reporting in: two crisp blips.
    { freq: 520, at: 0.0, dur: 0.05 },
    { freq: 780, at: 0.05, dur: 0.08 },
  ],
  unitReSelected: [
    // The grunt for a re-click: ONE short downward blip, a quarter the length
    // of the full acknowledgement and falling rather than rising, so it reads
    // as "still here" instead of as the start of another introduction.
    { freq: 420, at: 0.0, dur: 0.07, gain: 0.32 },
  ],
  artillerieSelected: [
    // Reporting in: two crisp blips, a touch heavier.
    { freq: 480, at: 0.0, dur: 0.06 },
    { freq: 720, at: 0.06, dur: 0.09 },
  ],
  archerSelected: [
    // Reporting in: two quick blips.
    { freq: 560, at: 0.0, dur: 0.05 },
    { freq: 840, at: 0.05, dur: 0.07 },
  ],
  submarineSelected: [
    // A sonar acknowledgement: two spaced pings.
    { freq: 880, at: 0.0, dur: 0.14, type: 'sine', gain: 0.6 },
    { freq: 880, at: 0.24, dur: 0.14, type: 'sine', gain: 0.4 },
  ],
  sabotageSuccess: [
    // The target goes dark: two falling snaps.
    { freq: 300, at: 0.0, dur: 0.08, type: 'sawtooth', gain: 0.7 },
    { freq: 150, at: 0.07, dur: 0.14, type: 'sawtooth', gain: 0.6 },
  ],
  productionComplete: [
    // Rolling out: a bright two-note confirm.
    { freq: 659, at: 0.0, dur: 0.09 },
    { freq: 880, at: 0.08, dur: 0.14 },
  ],

  // ── The news cues ───────────────────────────────────────────────────
  // The moments that are not about combat but decide the game. Each one is
  // shaped to be unmistakable from the cues above: a war is drums, a Wonder is
  // a slow radiance, a lost city falls in a minor, a bell tolls for a dead
  // people. Two of them (a peace treaty and a ceasefire) deliberately share a
  // voice — "the fighting stopped" is one event wearing two hats.
  warDeclared: [
    // Drums, not a melody: two low square thumps a tritone apart with a noise
    // slap on the first, so it reads as a mobilisation rather than as the
    // descending alarm `coverBlown` and `cityAttacked` already use.
    { freq: 0, at: 0.0, dur: 0.1, gain: 0.7, noise: 0.7, cutoff: 500 },
    { freq: 147, at: 0.0, dur: 0.16, type: 'square', gain: 0.75 },
    { freq: 0, at: 0.17, dur: 0.1, gain: 0.6, noise: 0.6, cutoff: 450 },
    { freq: 104, at: 0.17, dur: 0.24, type: 'square', gain: 0.7 },
  ],
  peaceMade: [
    // A gentle major cadence that comes to rest — the opposite shape to
    // `warDeclared`, so the two are never confusable across a long game.
    { freq: 392, at: 0.0, dur: 0.16, type: 'triangle', gain: 0.6 },
    { freq: 494, at: 0.12, dur: 0.16, type: 'triangle', gain: 0.6 },
    { freq: 587, at: 0.24, dur: 0.34, type: 'triangle', gain: 0.65 },
    { freq: 784, at: 0.24, dur: 0.34, gain: 0.3 },
  ],
  wonderCompleted: [
    // The largest thing in the game, and it should take the longest: a slow
    // five-step rise to a held twelfth. `cityFounded` is the same direction but
    // a third of the speed, so the two never blur together.
    { freq: 392, at: 0.0, dur: 0.18, type: 'triangle', gain: 0.6 },
    { freq: 494, at: 0.16, dur: 0.18, type: 'triangle', gain: 0.6 },
    { freq: 587, at: 0.32, dur: 0.18, type: 'triangle', gain: 0.65 },
    { freq: 784, at: 0.48, dur: 0.18, type: 'triangle', gain: 0.7 },
    { freq: 1175, at: 0.66, dur: 0.44, type: 'triangle', gain: 0.75 },
    { freq: 1568, at: 0.66, dur: 0.44, gain: 0.28 },
  ],
  cityLost: [
    // A slow fall in a minor with the last note left hanging. Deliberately NOT
    // a fanfare and deliberately not `coverBlown`'s sawtooth urgency — this is
    // grief, and it must not sound like the player won something.
    { freq: 440, at: 0.0, dur: 0.14, type: 'triangle', gain: 0.7 },
    { freq: 392, at: 0.13, dur: 0.14, type: 'triangle', gain: 0.65 },
    { freq: 330, at: 0.26, dur: 0.16, type: 'triangle', gain: 0.6 },
    { freq: 262, at: 0.4, dur: 0.2, type: 'triangle', gain: 0.6 },
    { freq: 196, at: 0.58, dur: 0.36, type: 'triangle', gain: 0.55 },
  ],
  civEliminated: [
    // A bell toll for a people who are no more: one deep strike with a
    // dissonant partial over it, then silence. A toll, not a tune.
    { freq: 0, at: 0.0, dur: 0.06, gain: 0.5, noise: 0.5, cutoff: 700 },
    { freq: 98, at: 0.0, dur: 1.1, type: 'sine', gain: 1 },
    { freq: 147, at: 0.01, dur: 0.85, type: 'sine', gain: 0.4 },
    { freq: 49, at: 0.02, dur: 1.2, type: 'sine', gain: 0.5 },
  ],
  cityStarved: [
    // Famine: thin, and it dies away rather than resolving. A hollow fifth
    // that empties out, the opposite of every fanfare in the table.
    { freq: 330, at: 0.0, dur: 0.14, type: 'triangle', gain: 0.55 },
    { freq: 247, at: 0.14, dur: 0.16, type: 'triangle', gain: 0.45 },
    { freq: 165, at: 0.3, dur: 0.28, type: 'triangle', gain: 0.35 },
    { freq: 0, at: 0.3, dur: 0.2, gain: 0.25, noise: 0.35, cutoff: 300 },
  ],
  cityDisorder: [
    // A mob: an agitated rise that turns on itself. Mid-register and
    // restless, so it cannot be mistaken for `cityAttacked`'s urgent fall.
    { freq: 330, at: 0.0, dur: 0.09, type: 'sawtooth', gain: 0.6 },
    { freq: 392, at: 0.08, dur: 0.09, type: 'sawtooth', gain: 0.6 },
    { freq: 349, at: 0.16, dur: 0.09, type: 'sawtooth', gain: 0.55 },
    { freq: 311, at: 0.24, dur: 0.12, type: 'sawtooth', gain: 0.5 },
    { freq: 110, at: 0.0, dur: 0.3, type: 'triangle', gain: 0.4 },
  ],
  unitProduced: [
    // A unit rolling out of the workshop: three even stamps rather than an
    // arch, so it is neither `barracksBuilt` nor `productionComplete` and does
    // not steal the electrification whistle.
    { freq: 440, at: 0.0, dur: 0.08, type: 'square', gain: 0.55 },
    { freq: 523, at: 0.09, dur: 0.08, type: 'square', gain: 0.55 },
    { freq: 659, at: 0.18, dur: 0.2, type: 'square', gain: 0.6 },
  ],
  tradeRouteEstablished: [
    // A small welcoming gesture: a rising third and fifth, soft, over a wide
    // city hum. Warm rather than triumphant — it is commerce, not conquest.
    { freq: 349, at: 0.0, dur: 0.12, type: 'triangle', gain: 0.5 },
    { freq: 440, at: 0.1, dur: 0.12, type: 'triangle', gain: 0.5 },
    { freq: 523, at: 0.2, dur: 0.24, type: 'triangle', gain: 0.55 },
    { freq: 262, at: 0.0, dur: 0.3, type: 'triangle', gain: 0.3 },
  ],
  unitPromoted: [
    // Small and warm, and deliberately in the `unit` family so it sits under
    // every event fanfare. A rising third with the octave on top.
    { freq: 659, at: 0.0, dur: 0.06, gain: 0.5 },
    { freq: 784, at: 0.05, dur: 0.06, gain: 0.5 },
    { freq: 1047, at: 0.1, dur: 0.12, gain: 0.5 },
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
 * The call goes through the SoundEngine, which applies the cooldowns, the
 * single-voice serialization and the main/secondary recording choice before
 * anything below fires. A cue with an entry in `CUE_FILES` plays that file
 * instead of the synthesized notes — that is the whole .ogg replacement
 * mechanism: add a row to the table, reload, and the recording takes over.
 */
export function playSfx(cue: SfxCue): void {
  if (!useGameStore.getState().settings.enableSoundEffects) return;
  requestSound(cue);
}

/**
 * The synthesized path, as a backend the SoundEngine can call.
 *
 * Unchanged behaviour: the notes play through a Web Audio graph, and a
 * missing context (node, locked autoplay) plays nothing rather than throwing.
 */
function playSynthNotes(cue: SfxCue): void {
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
  machineGunStrike: 0.55,
  impactStrike: 0.55,
  navalStrike: 0.55,
  airStrike: 0.55,
  missileLaunch: 0.6,
  sdiIntercept: 0.65,
  unitSelected: 0.5,
  // Quieter than the full acknowledgement: it is an aside, not an answer.
  unitReSelected: 0.32,
  submarineSelected: 0.5,
  sabotageSuccess: 0.6,
  productionComplete: 0.6,
  unitDefeated: 0.7,
  unitDisbanded: 0.6,
  torpedoAttack: 0.65,
  airUnitLaunch: 0.6,
  tankMove: 0.5,
  mechInfMove: 0.5,
  cityAttacked: 0.8,
  barracksBuilt: 0.85,
  // Founding a city is the player's own news, at the same weight as taking
  // one — both happen a handful of times a game and neither should be missed.
  cityFounded: 0.85,
  // The capture fanfares sit under the nuclear strike in the synth ladder —
  // the detonation is the loudest thing in the game on either path.
  cityCapturedClassic: 0.85,
  cityCapturedModern: 0.85,
  // ── The news cues ───────────────────────────────────────────────────
  // A Wonder is the biggest thing that can happen, so it takes the top of the
  // event range. War and a dead civilisation are alarms, not celebrations —
  // loud enough to stop the player, not loud enough to cheer. A lost city sits
  // UNDER the fanfare line on purpose: bad news must never out-shout good.
  wonderCompleted: 0.85,
  warDeclared: 0.8,
  civEliminated: 0.8,
  peaceMade: 0.75,
  cityLost: 0.7,
  unitProduced: 0.65,
  cityDisorder: 0.6,
  cityStarved: 0.6,
  tradeRouteEstablished: 0.6,
  // A promotion is a reward on one unit, mid-battle. `unit` family, and the
  // quietest of the news cues, so a lucky streak cannot drown out a war.
  unitPromoted: 0.5,
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
  // The quietest recording there is, tied with the tank: the player drives a
  // mech. Inf. every turn just like a tank, and its rumble is a long one.
  mechInfMove: 0.35,
  submarineSelected: 0.5,
  artillerieSelected: 0.5,
  archerSelected: 0.5,
  horseUnitMoves: 0.5,
  airUnitInAirTargetSet: 0.45,
  airUnitReturningToBase: 0.45,
  torpedoAttack: 0.45,
  machineGunStrike: 0.55,
  // No `impactStrike` row on purpose: it ships no recording, so it never
  // reaches `playFile` and a number here would be dead config. Its loudness is
  // the `UNIT_CUE_GAIN` multiplier instead.
  navalStrike: 0.55,
  airStrike: 0.5,
  missileLaunch: 0.55,
  sdiIntercept: 0.6,
  sabotageSuccess: 0.55,
  spyCatched: 0.55,
  productionComplete: 0.55,
  cityAttacked: 0.5,
  barracksBuilt: 0.55,
  cityCapturedClassic: 0.6,
  cityCapturedModern: 0.6,
  cityFounded: 0.6,
  // The great explosion is the loudest recording in the mix — and the rarest.
  nuclearStrike: 0.75,
};

/** Volume for a file-backed cue with no explicit row. */
const DEFAULT_FILE_VOLUME = 0.45;

/**
 * Register the transport with the SoundEngine: files play through
 * HTMLAudio, everything else through the oscillator graph above.
 * Registered at module load so `playSfx` — the only caller-facing entry —
 * always has a backend behind it.
 */
configureSoundEngine({
  backend: {
    playFile: (path, cue) => playFile(path, cue),
    playSynth: (cue) => playSynthNotes(cue),
  },
  fileLookup: (cue) => CUE_FILES[cue],
  isEnabled: () => useGameStore.getState().settings.enableSoundEffects,
});
