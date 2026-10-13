/**
 * EspionagePolicy — which infiltration an AI diplomat runs once it stands in
 * a foreign city.
 *
 * Kept apart from `AIDiplomacyPolicy` for the same reason that file exists at
 * all: a branch ladder ("if aggressive then steal") produces behaviour nobody
 * can predict or pin in a test. Here every option is scored from the same
 * weights the rest of the diplomacy model uses, and the best one wins.
 *
 * The ordering the scores encode is deliberately Civ I's:
 *
 *   1. Found an embassy first — without a channel there is no negotiation at
 *      all, so an unfounded embassy outranks every other use of a diplomat.
 *   2. Then read the city (safe, always legal, never starts a war).
 *   3. Then take something, if the civ's temperament can live with the war
 *      that a stolen secret costs.
 *
 * Pure functions only — the caller supplies the context.
 */

import type { Attitude, DiplomaticStatus } from '../DiplomacyTypes';
import type { DiplomaticWeights } from './DiplomaticWeights';
import { seededNoise } from './ProposalScoring';

/**
 * Size of the seeded tiebreak jitter. Same amplitude `AIDiplomacyPolicy` uses,
 * so two infiltrations within half a point of each other are genuinely close
 * rather than resolved by list order.
 */
const TIEBREAK_AMPLITUDE = 0.5;

/** One infiltration worth considering, with the reasoning behind it. */export interface EspionageCandidate {
  action: 'establish_embassy' | 'investigate_city' | 'steal_technology' | 'industrial_sabotage';
  score: number;
  because: string;
}

export interface EspionageContext {
  civId: number;
  targetCivId: number;
  weights: DiplomaticWeights;
  status: DiplomaticStatus;
  attitude: Attitude;
  /** Turns of war wear, 0…EXHAUSTION_MAX. */
  exhaustion: number;
  /** Whether a channel already exists with this court. */
  hasEmbassy: boolean;
  /** Techs the target holds that we do not. */
  techsWeWant: string[];
  /** How much production the target has banked in this city (0 = nothing to break). */
  cityShields: number;
  /** Round number, for the seeded tiebreak. */
  round: number;
  sequence: number;
}

/** Score every infiltration worth attempting, best first. */
export function scoreEspionage(ctx: EspionageContext): EspionageCandidate[] {
  const out: EspionageCandidate[] = [];
  const { weights } = ctx;
  // Espionage is a peacetime trade. At war a city is entered with soldiers,
  // and the engine refuses these actions anyway — scoring them would only
  // produce candidates that cannot be executed.
  if (ctx.status === 'war') return out;

  // ── 1. The channel ────────────────────────────────────────────────
  // A civ that has not opened an embassy cannot negotiate at all, so this
  // outranks everything. A diplomatic civ is in a bigger hurry to have one;
  // a xenophobic one drags its feet.
  if (!ctx.hasEmbassy) {
    const eagerness = 14 + (weights.trustSensitivity / 10) * 6 - (weights.xenophobia / 10) * 6;
    push(out, 'establish_embassy', eagerness, 'no channel to this court yet');
  }

  // ── 2. Reading the city ───────────────────────────────────────────
  // Safe, always legal, and the one infiltration nobody declares war over.
  // A cautious civ likes it; a reckless one finds it boring.
  const readScore = 6 + (weights.trustSensitivity / 10) * 4 + (weights.paranoia / 10) * 3;
  push(out, 'investigate_city', readScore, 'read their ledgers without risk');

  // ── 3. Taking something ───────────────────────────────────────────
  // Stealing is the prize and the danger: it ALWAYS costs a war, so the score
  // has to clear a bar the safe options never face. Attitude leads, because
  // "do we like them" is the honest question — a civ at peace with a court it
  // likes does not torch that peace for one technology. War wear and loyalty
  // then pull the same way: an exhausted or principled civ leaves the secrets
  // alone, a grudging or belligerent one takes them.
  if (ctx.techsWeWant.length > 0) {
    const haul = Math.min(ctx.techsWeWant.length, 5);
    const friction = ctx.attitude === 'hostile' ? 6 : ctx.attitude === 'annoyed' ? 3 : ctx.attitude === 'friendly' ? -5 : -2;
    const reckless = (weights.vengeance / 10) * 3 + (weights.warmongering / 10) * 3;
    const restraint = (weights.loyalty / 10) * 4 + (weights.trustSensitivity / 10) * 3;
    const weary = ctx.exhaustion * 0.5;
    const stealScore = friction + haul * 1.5 + reckless - restraint - weary - 6;
    push(out, 'steal_technology', stealScore, `they hold ${haul} secret${haul === 1 ? '' : 's'} we lack`);
  }

  // ── 4. Breaking their industry ────────────────────────────────────
  // Worth it only when there is something banked to destroy and the civ is
  // already sour. Sabotaging an empty city is theatre; doing it to a friend
  // is just an unprovoked war.
  if (ctx.cityShields > 0) {
    const grievance = ctx.attitude === 'hostile' ? 8 : ctx.attitude === 'annoyed' ? 4 : 0;
    const spite = (weights.vengeance / 10) * 5 + (weights.warmongering / 10) * 3;
    const payoff = Math.min(ctx.cityShields, 20) * 0.2;
    push(out, 'industrial_sabotage', grievance + spite + payoff - 8, `they have ${ctx.cityShields} shields banked`);
  }

  return out.sort((a, b) => b.score - a.score);
}

/**
 * Pick the infiltration to run, or null when nothing is worth the risk.
 *
 * The same ±`TIEBREAK_AMPLITUDE` seeded jitter `chooseAction` applies: two
 * equally good options must not resolve by array order, or the first-listed
 * one would win every single time and the scores would be decoration.
 */
export function chooseEspionageAction(ctx: EspionageContext): EspionageCandidate | null {
  const candidates = scoreEspionage(ctx).filter((c) => c.score > 0);
  if (candidates.length === 0) return null;

  let best: EspionageCandidate | null = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const jitter = seededNoise([
      ctx.civId, ctx.targetCivId, candidate.action, ctx.round, ctx.sequence,
    ]) * TIEBREAK_AMPLITUDE;
    const score = candidate.score + jitter;
    if (score > bestScore) {
      bestScore = score;
      best = { ...candidate, score: Math.round(score * 100) / 100 };
    }
  }
  return best;
}

function push(out: EspionageCandidate[], action: EspionageCandidate['action'], score: number, because: string): void {
  out.push({ action, score: Math.round(score * 10) / 10, because });
}
