/**
 * NomadAI — the tribe's strategy brain.
 *
 * NomadManager owns the state machine; this file owns the MIND: a set of
 * stances the tribe reviews every `NOMAD_STRATEGY_REVIEW_ROUNDS` rounds
 * (and instantly whenever anger takes it). Each stance is a score over the
 * tribe's situation — routes still open, chest fullness, war-readiness,
 * the clan's temperament, and WHERE IN HISTORY they are (early tribes lay
 * roads, late tribes grow careful or warlike) — plus a small random jitter
 * so two identical games still drift apart. The winner becomes a PLAN of
 * on/off knobs that NomadManager executes: build a travelling bazaar, table
 * the city market, muster the camp, broker knowledge, beg from the player.
 *
 * The stances are announced (`NOMAD_STRATEGY`) — the player gets to WATCH
 * the nomads change their mind, which is the point: strategy you can see.
 *
 * Design rules:
 *   * **Anger overrides everything.** A tribe at war with you spends its
 *     gold on treachery, not trade — `bribery` is forced, not scored.
 *   * **Pure decisions.** `review`/`plan` touch no engine state; the
 *     manager feeds them a snapshot (`NomadSituation`) and executes the
 *     result, so the brain is testable on its own.
 *   * **Money first.** The user's law: the nomads are *typically* money
 *     makers — roads and treasury dominate the early board; steel and
 *     bribery are the exceptions, not the norm.
 */
import {
  NOMAD_CAMP_MUSTER_LIMIT,
  NOMAD_CITY_OFFER_MIN_GOLD,
  NOMAD_MONEY_REQUEST_BELOW,
  NOMAD_STRATEGY_REVIEW_ROUNDS,
  NOMAD_TRADE_ROUTE_LIMIT,
  type NomadPersonality,
} from '@/data/NomadConstants';

/** What the tribe is currently about. */
export type NomadStance = 'roads' | 'treasury' | 'market' | 'steel' | 'bribery';

/** A snapshot of everything the brain is allowed to know. */
export interface NomadSituation {
  round: number;
  treasury: number;
  routeCount: number;
  /** Camp soldiers alive beyond the spawned horde (the muster's output). */
  garrisonExtra: number;
  standing: 'neutral' | 'friendly' | 'angry';
  personality: NomadPersonality | null;
  ownedCityCount: number;
}

/** The knobs NomadManager executes for one round. */
export interface NomadPlan {
  stance: NomadStance;
  /** Spend the chest on a new travelling bazaar (roads/steel invest). */
  buildBazaar: boolean;
  /** The city market may table an offer — 'market' also waives the 450 gate. */
  offerCities: boolean;
  /** Bribe troops near the horde (only ever true while angry). */
  bribe: boolean;
  /** Muster camp soldiers (steel stance, still limit + gold gated). */
  muster: boolean;
  /** Broker a technology to an AI court for gold. */
  sellKnowledge: boolean;
  /** Swallow pride and ask the player for gold (broke chest). */
  askForMoney: boolean;
}

/** Review order — the tie-break when two stances score the same. */
const REVIEW_ORDER: readonly NomadStance[] = ['roads', 'treasury', 'market', 'steel', 'bribery'];

/** Type guard for a stance string arriving over the event bus. */
export function isNomadStance(value: string): value is NomadStance {
  return (REVIEW_ORDER as readonly string[]).includes(value);
}

export class NomadAI {
  private stance: NomadStance = 'roads';

  get currentStance(): NomadStance {
    return this.stance;
  }

  reset(): void {
    this.stance = 'roads';
  }

  /**
   * Re-score the world when a review is due — every
   * `NOMAD_STRATEGY_REVIEW_ROUNDS` rounds, or at once the moment the tribe
   * turns angry (revenge does not wait for the quarterly meeting).
   * Returns the NEW stance when it changed, null when it held.
   */
  review(s: NomadSituation): NomadStance | null {
    const angry = s.standing === 'angry';
    if (!angry && s.round % NOMAD_STRATEGY_REVIEW_ROUNDS !== 0) return null;
    const next = this.choose(s);
    if (next === this.stance) return null;
    this.stance = next;
    return next;
  }

  /** The plan for this round, derived from the held stance + situation. */
  plan(s: NomadSituation): NomadPlan {
    const broke = s.treasury < NOMAD_MONEY_REQUEST_BELOW;
    const angry = s.standing === 'angry';
    return {
      stance: this.stance,
      buildBazaar: !angry && (this.stance === 'roads' || this.stance === 'steel'),
      offerCities: this.stance === 'market',
      bribe: angry,
      muster: !angry && this.stance === 'steel',
      sellKnowledge: !angry,
      askForMoney: !angry && broke,
    };
  }

  /** Highest score wins; REVIEW_ORDER breaks ties; jitter varies the board. */
  private choose(s: NomadSituation): NomadStance {
    let best: NomadStance = REVIEW_ORDER[0];
    let bestScore = -Infinity;
    for (const stance of REVIEW_ORDER) {
      const score = scoreStance(stance, s) + Math.floor(Math.random() * 2);
      if (score > bestScore) {
        best = stance;
        bestScore = score;
      }
    }
    return best;
  }
}

/**
 * The scoring table. Read it as the tribe's priorities over a lifetime:
 * early rounds (roads) → chest-filling (treasury) → the city market once
 * a price is in reach → steel as the world grows old — with the clan's
 * temperament tilting the whole curve, and anger scoring off the board.
 */
function scoreStance(stance: NomadStance, s: NomadSituation): number {
  const { round, treasury, routeCount, garrisonExtra, standing, personality, ownedCityCount } = s;

  if (stance === 'bribery') return standing === 'angry' ? 1000 : 0;

  switch (stance) {
    case 'roads':
      // Lay roads while cities wait unsigned, and while the world is young.
      return (
        2
        + (routeCount < NOMAD_TRADE_ROUTE_LIMIT ? 2 : 0)
        + (round < 40 ? 2 : 0)
        + (personality === 'trader' ? 2 : 0)
      );
    case 'treasury':
      // Fill the chest once the roads are running — mystics love a full vault.
      return (
        1
        + (treasury >= NOMAD_CITY_OFFER_MIN_GOLD / 2 ? 1 : 0)
        + (routeCount >= 2 ? 1 : 0)
        + (round >= 80 ? 1 : 0)
        + (personality === 'mystic' ? 2 : 0)
      );
    case 'market':
      // Buy cities when a price is in reach, when the world is mid-aged,
      // and when they already own one (they like the taste).
      return (
        (treasury >= NOMAD_CITY_OFFER_MIN_GOLD ? 3 : 0)
        + (round >= 40 ? 1 : 0)
        + (ownedCityCount >= 1 ? 1 : 0)
        + (personality === 'trader' ? 1 : 0)
        + (personality === 'mystic' ? 1 : 0)
      );
    case 'steel':
      // Muster only while the camp has room, and warriors love a late game.
      return (
        (garrisonExtra < NOMAD_CAMP_MUSTER_LIMIT ? 1 : 0)
        + (round >= 60 ? 1 : 0)
        + (personality === 'warrior' ? 3 : 0)
      );
  }
}
