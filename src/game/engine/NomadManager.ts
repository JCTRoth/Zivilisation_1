/**
 * Nomads — the opening visitors.
 *
 * Once per single-human game, shortly after the first city stands, a neutral
 * horde camps near the player's borders and sends an envoy to the court. The
 * parley offers four roads — buy a technology, take their maps, hire the
 * horde, or pass in peace — and whichever is taken, the camp remains on the
 * map as a race: any civilization may hire the wanderers before they walk
 * off into the fog.
 *
 * Design rules (mirroring TeamCoordinator):
 *   * **Neutral, not hostile.** The horde owns id -1 (BARBARIAN_CIV_ID) —
 *     contact recording skips it, no civ is at war with it, the AI never
 *     targets it. It is scenery with a contract, not a combatant.
 *   * **Stateless across loads.** Nothing here is persisted; a loaded game
 *     simply has no nomads (v1).
 *   * **Human games only.** Single human seat — hotseat would need to pick
 *     whose court receives them, AI-only games have nobody to talk to.
 *   * **Fair by construction.** The tech price is half the raw research cost
 *     (clamped), the hire price sits above the units' build cost, and the
 *     camp only lingers long enough for the world to race you to it.
 */
import type GameEngine from './GameEngine';
import type { AudienceChoice, Civilization } from '../../../types/game';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import { UNIT_PROPS } from '@/utils/Constants';
import { TECHNOLOGIES_DATA } from '@/data/TechnologyData';
import {
  NOMAD_AI_HIRE_BASE_CHANCE,
  NOMAD_AI_HIRE_DIPLOMACY_BONUS,
  NOMAD_AI_HIRE_MIN_ROUND_GAP,
  NOMAD_CAMP_LINGER_ROUNDS,
  NOMAD_HIRE_COST_FACTOR,
  NOMAD_MAP_REVEAL_RADIUS,
  NOMAD_PARLEY_DELAY_ROUNDS,
  NOMAD_PASS_DEPART_ROUNDS,
  NOMAD_PROXIMITY_DISTANCE,
  NOMAD_REOFFER_COOLDOWN_ROUNDS,
  NOMAD_SPAWN_MAX_DISTANCE,
  NOMAD_SPAWN_MIN_DISTANCE,
  NOMAD_SPAWN_UNITS,
  NOMAD_TECH_PRICE_DIVISOR,
  NOMAD_TECH_PRICE_MAX,
  NOMAD_TECH_PRICE_MIN,
  NOMAD_TRIGGER_FALLBACK_ROUND,
  NOMAD_TRIGGER_ROUND,
} from '@/data/NomadConstants';

/** What a resolved parley did — the UI turns this into a localized toast. */
export interface NomadOutcome {
  ok: boolean;
  /** `noGold`: the treasury cannot meet the hire price (UI shows the hint). */
  result?: 'tech' | 'techGift' | 'maps' | 'hire' | 'pass' | 'noGold';
  params?: Record<string, string | number>;
}

interface NomadPending {
  /** The technology the button promised (never re-rolled at resolve time). */
  tech?: string;
  /** The gold the button promised. */
  price?: number;
}

export class NomadManager {
  private readonly gameEngine: GameEngine;

  private spawned = false;
  private hired = false;
  private departed = false;
  private camp: { col: number; row: number } | null = null;
  private campUnitIds: string[] = [];
  private hireCost = 0;

  private firstAudienceAt = -1;
  private parleyEmitted = false;
  private parleyDone = false;
  private secondEmitted = false;
  /** Which emission is currently on screen (null = none / already resolved). */
  private liveParley: 'first' | 'second' | null = null;
  private lastEmitRound = -1;
  private parleyResolvedRound = -1;
  private departAt: number | null = null;
  private lastRound = 0;
  private pending: NomadPending | null = null;

  constructor(gameEngine: GameEngine) {
    this.gameEngine = gameEngine;
  }

  // ── State for the UI / tests ────────────────────────────────────────────

  get isSpawned(): boolean { return this.spawned; }
  get isParleyDone(): boolean { return this.parleyDone; }
  get isHired(): boolean { return this.hired; }
  get isDeparted(): boolean { return this.departed; }
  get campTile(): { col: number; row: number } | null { return this.camp ? { ...this.camp } : null; }

  /** Drop all state (new game / load): v1 nomads never survive a save. */
  reset(): void {
    this.spawned = false;
    this.hired = false;
    this.departed = false;
    this.camp = null;
    this.campUnitIds = [];
    this.hireCost = 0;
    this.firstAudienceAt = -1;
    this.parleyEmitted = false;
    this.parleyDone = false;
    this.secondEmitted = false;
    this.liveParley = null;
    this.lastEmitRound = -1;
    this.parleyResolvedRound = -1;
    this.departAt = null;
    this.lastRound = 0;
    this.pending = null;
  }

  // ── The per-round state machine ────────────────────────────────────────

  processRound(round: number): void {
    this.lastRound = round;
    if (this.gameEngine.isGameOver) return;
    // Single human seat only: hotseat would have to pick whose court they
    // visit, and an all-AI game has nobody to send an envoy to.
    const humanId = this.humanCivId();
    if (humanId === null) return;
    if (this.hired || this.departed) return;

    if (!this.spawned) {
      const hasCity = (this.gameEngine.cities ?? []).some((c) => c.civilizationId === humanId);
      const due = (round >= NOMAD_TRIGGER_ROUND && hasCity)
        || round >= NOMAD_TRIGGER_FALLBACK_ROUND;
      if (due) this.spawn(round, humanId);
      return;
    }

    if (!this.campAlive()) {
      // The player (or a stray battle) wiped the camp — no wanders-off toast,
      // the story simply ends.
      this.departed = true;
      return;
    }

    if (!this.parleyDone) {
      if (!this.parleyEmitted && round >= this.firstAudienceAt) {
        this.emitParley(false, round);
        return;
      }
      // The player dismissed the envoy: it re-offers when they stand at the
      // camp — never every round, never while an emission is on screen.
      if (
        this.parleyEmitted
        && this.liveParley !== null
        && round >= this.lastEmitRound + NOMAD_REOFFER_COOLDOWN_ROUNDS
        && this.playerNearCamp(humanId)
      ) {
        this.emitParley(false, round);
      }
      return;
    }

    // The camp outlived its parley: any civilization may hire it (the AI
    // race), the player may still ask for it, and eventually it walks away.
    if (
      this.liveParley === null
      && round >= this.parleyResolvedRound + NOMAD_AI_HIRE_MIN_ROUND_GAP
    ) {
      this.tryAiHire(humanId);
      if (this.hired) return;
    }
    if (
      this.liveParley === null
      && !this.secondEmitted
      && round >= this.lastEmitRound + NOMAD_REOFFER_COOLDOWN_ROUNDS
      && this.playerNearCamp(humanId)
    ) {
      this.emitParley(true, round);
      return;
    }
    if (this.departAt !== null && round >= this.departAt) {
      this.depart();
    }
  }

  // ── The parley ─────────────────────────────────────────────────────────

  /**
   * Resolve one of the parley's doors. The tech and price are whatever the
   * BUTTON promised (`pending`), never re-rolled — a promised deal must not
   * change while the modal is open. A successful choice emits NOMAD_RESOLVED
   * so the store re-syncs (gold, techs, converted units).
   */
  resolveParley(choiceId: string): NomadOutcome {
    if (this.liveParley === null || !this.spawned || this.departed || this.hired) {
      return { ok: false };
    }
    const humanId = this.humanCivId();
    if (humanId === null) return { ok: false };
    const human = this.gameEngine.civilizations?.[humanId];
    if (!human) return { ok: false };
    this.liveParley = null;

    const outcome = this.applyChoice(choiceId, humanId, human);
    if (outcome.ok) {
      this.gameEngine.onStateChange?.('NOMAD_RESOLVED', { result: outcome.result });
    }
    return outcome;
  }

  private applyChoice(
    choiceId: string,
    humanId: number,
    human: Civilization,
  ): NomadOutcome {
    switch (choiceId) {
      case 'tech':
      case 'maps': {
        if (choiceId === 'tech') {
          const tech = this.pending?.tech;
          if (!tech) return { ok: false };
          const price = this.pending?.price ?? 0;
          const gold = human.resources?.gold ?? 0;
          const free = gold < price;
          if (!free) human.resources.gold = gold - price;
          this.gameEngine.grantTech(humanId, tech);
          this.parleyDone = true;
          this.parleyResolvedRound = this.lastRound;
          this.departAt = this.lastRound + NOMAD_CAMP_LINGER_ROUNDS;
          const techName = TECHNOLOGIES_DATA.find((t) => t.id === tech)?.name ?? tech;
          return {
            ok: true,
            result: free ? 'techGift' : 'tech',
            params: { tech: techName, gold: price },
          };
        }
        // Their maps: a swath of the unknown world, no walking required.
        this.gameEngine.revealArea(this.camp!.col, this.camp!.row, NOMAD_MAP_REVEAL_RADIUS, humanId);
        this.parleyDone = true;
        this.parleyResolvedRound = this.lastRound;
        this.departAt = this.lastRound + NOMAD_CAMP_LINGER_ROUNDS;
        return { ok: true, result: 'maps' };
      }

      case 'hire': {
        const cost = this.hireCost;
        if ((human.resources?.gold ?? 0) < cost) return { ok: false, result: 'noGold' };
        human.resources.gold = (human.resources.gold ?? 0) - cost;
        this.convertUnits(humanId);
        this.hired = true;
        this.parleyDone = true;
        this.parleyResolvedRound = this.lastRound;
        return { ok: true, result: 'hire', params: { gold: cost } };
      }

      case 'pass':
      case 'farewell': {
        this.parleyDone = true;
        this.parleyResolvedRound = this.lastRound;
        this.departAt = this.lastRound + NOMAD_PASS_DEPART_ROUNDS;
        return { ok: true, result: 'pass' };
      }

      default:
        return { ok: false };
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /** The one human seat, or null (hotseat / all-AI games are out in v1). */
  private humanCivId(): number | null {
    const seats = this.gameEngine.gameSettings?.humanPlayerIds ?? [0];
    if (seats.length !== 1) return null;
    const id = seats[0];
    return this.gameEngine.civilizations?.[id]?.isHuman === true ? id : null;
  }

  private unitById(id: string) {
    return (this.gameEngine.units ?? []).find((u) => u.id === id && !u.isDefeated);
  }

  private campAlive(): boolean {
    return this.campUnitIds.some((id) => this.unitById(id) !== undefined);
  }

  /** Where they visit from: the human's first city, else their first unit. */
  private anchorFor(humanId: number): { col: number; row: number } | null {
    const city = (this.gameEngine.cities ?? []).find((c) => c.civilizationId === humanId);
    if (city) return city;
    const unit = (this.gameEngine.units ?? []).find(
      (u) => u.civilizationId === humanId && !u.isDefeated,
    );
    return unit ?? null;
  }

  /**
   * A camp tile near the anchor: passable, unoccupied, no village (no free
   * hut pop on arrival), on the SAME landmass (a camp across the water is a
   * camp nobody visits). Deterministic ring search — first match wins.
   */
  private findCampTile(anchor: { col: number; row: number }): { col: number; row: number } | null {
    const grid = this.gameEngine.squareGrid;
    const anchorLandmass = this.gameEngine.getLandmassId?.(anchor.col, anchor.row) ?? -1;
    for (
      let r = NOMAD_SPAWN_MIN_DISTANCE;
      r <= NOMAD_SPAWN_MAX_DISTANCE;
      r++
    ) {
      for (let dc = -r; dc <= r; dc++) {
        for (let dr = -r; dr <= r; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== r) continue;
          const col = anchor.col + dc;
          const row = anchor.row + dr;
          if (grid && !grid.isValidSquare(col, row)) continue;
          if (!this.gameEngine.isTilePassable?.(col, row)) continue;
          if (this.gameEngine.getUnitAt?.(col, row)) continue;
          if (this.gameEngine.getCityAt?.(col, row)) continue;
          if (this.gameEngine.getTileAt?.(col, row)?.village) continue;
          if (
            anchorLandmass >= 0
            && typeof this.gameEngine.getLandmassId === 'function'
            && this.gameEngine.getLandmassId(col, row) !== anchorLandmass
          ) continue;
          return { col, row };
        }
      }
    }
    return null;
  }

  private spawn(round: number, humanId: number): void {
    const anchor = this.anchorFor(humanId);
    if (!anchor) return; // no city and no unit yet — try again next round
    const tile = this.findCampTile(anchor);
    if (!tile) return; // no room near the court — try again next round

    const ids: string[] = [];
    for (const type of NOMAD_SPAWN_UNITS) {
      const unit = this.gameEngine.createUnit(BARBARIAN_CIV_ID, type, tile.col, tile.row);
      if (unit) {
        // A camp holds its ground: the horde waits for your answer — and a
        // fortified unit sits OUT its turn (moves spent), as the engine's
        // unit-state law requires.
        unit.isFortified = true;
        unit.movesRemaining = 0;
        ids.push(unit.id);
      }
    }
    if (ids.length === 0) return;

    this.spawned = true;
    this.camp = { ...tile };
    this.campUnitIds = ids;
    this.firstAudienceAt = round + NOMAD_PARLEY_DELAY_ROUNDS;
    // The price the buttons will promise.
    this.hireCost = Math.ceil(
      ids.reduce((sum, id) => {
        const type = String(this.unitById(id)?.type ?? '');
        return sum + (UNIT_PROPS[type]?.cost ?? 10);
      }, 0) * NOMAD_HIRE_COST_FACTOR,
    );
    // You SEE the strangers arrive — and so does the story.
    this.gameEngine.revealArea(tile.col, tile.row, 4, humanId);
    this.gameEngine.onStateChange?.('NOMAD_SIGHTED', { col: tile.col, row: tile.row });
  }

  private emitParley(second: boolean, round: number): void {
    const humanId = this.humanCivId();
    if (humanId === null) return;
    const choices: AudienceChoice[] = [];
    let techOffered: string | undefined;
    let goldAmount: number | undefined;
    this.pending = null;

    if (!second) {
      const tech = this.gameEngine.pickFreeTech(humanId);
      if (tech) {
        const raw = TECHNOLOGIES_DATA.find((t) => t.id === tech)?.cost ?? 60;
        const price = Math.max(
          NOMAD_TECH_PRICE_MIN,
          Math.min(NOMAD_TECH_PRICE_MAX, Math.floor(raw / NOMAD_TECH_PRICE_DIVISOR)),
        );
        this.pending = { tech, price };
        const gold = this.gameEngine.civilizations?.[humanId]?.resources?.gold ?? 0;
        choices.push({
          id: 'tech',
          labelKey: gold >= price ? 'nomad.choice.tech' : 'nomad.choice.techGift',
          labelParams: { tech, gold: price },
          variant: 'accept',
        });
        techOffered = tech;
        goldAmount = price;
      }
      choices.push({ id: 'maps', labelKey: 'nomad.choice.maps', variant: 'accept' });
      choices.push({
        id: 'hire',
        labelKey: 'nomad.choice.hire',
        labelParams: { gold: this.hireCost },
        variant: 'accept',
      });
      choices.push({ id: 'pass', labelKey: 'nomad.choice.pass', variant: 'pass' });
      this.parleyEmitted = true;
    } else {
      choices.push({
        id: 'hire',
        labelKey: 'nomad.choice.hire',
        labelParams: { gold: this.hireCost },
        variant: 'accept',
      });
      choices.push({ id: 'farewell', labelKey: 'nomad.choice.farewell', variant: 'pass' });
      this.secondEmitted = true;
    }

    this.lastEmitRound = round;
    this.liveParley = second ? 'second' : 'first';
    this.gameEngine.onStateChange?.('NOMAD_PARLEY', {
      speakerNameKey: 'nomad.chieftain',
      speakerIcon: '🐎',
      leadKey: second ? 'nomad.parley.leadSecond' : 'nomad.parley.lead',
      choices,
      techOffered,
      goldAmount,
    });
  }

  /** Every eligible AI court may bid for the horde, cheapest chance first. */
  private tryAiHire(humanId: number): void {
    const cost = this.hireCost;
    for (const civ of this.gameEngine.civilizations ?? []) {
      if (!civ.isAlive || civ.id === humanId || civ.isHuman === true) continue;
      if ((civ.resources?.gold ?? 0) < cost) continue;
      const diplomacy = civ.personality?.diplomacy ?? 5;
      const chance = Math.min(
        0.5,
        NOMAD_AI_HIRE_BASE_CHANCE + diplomacy * NOMAD_AI_HIRE_DIPLOMACY_BONUS,
      );
      if (Math.random() < chance) {
        civ.resources.gold = (civ.resources.gold ?? 0) - cost;
        this.convertUnits(civ.id);
        this.hired = true;
        this.gameEngine.onStateChange?.('NOMAD_HIRED', { civId: civ.id });
        return;
      }
    }
  }

  /** The horde changes colors: neutral units become the owner's units. */
  private convertUnits(ownerId: number): void {
    for (const id of this.campUnitIds) {
      const unit = this.unitById(id);
      if (!unit) continue;
      unit.civilizationId = ownerId;
      unit.isFortified = false;
      // Usable at once — the hiring court may still be mid-turn (the owner's
      // next turn start would refill moves anyway).
      unit.movesRemaining = unit.maxMoves ?? unit.movesRemaining;
      unit.orders = null;
    }
  }

  private depart(): void {
    const leaving = new Set(this.campUnitIds);
    this.gameEngine.units = (this.gameEngine.units ?? []).filter((u) => !leaving.has(u.id));
    this.campUnitIds = [];
    this.departed = true;
    this.gameEngine.onStateChange?.('NOMAD_DEPARTED', {});
  }

  private playerNearCamp(humanId: number): boolean {
    if (!this.camp) return false;
    return (this.gameEngine.units ?? []).some(
      (u) =>
        u.civilizationId === humanId
        && !u.isDefeated
        && Math.max(Math.abs(u.col - this.camp!.col), Math.abs(u.row - this.camp!.row))
          <= NOMAD_PROXIMITY_DISTANCE,
    );
  }
}
