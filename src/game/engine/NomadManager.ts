/**
 * Nomads — a relationship, not an event.
 *
 * Three clans (the Sandborne traders, the Ironhoof riders, the Greywind
 * seers) with three temperaments visit once per single-human game. What
 * happens after is remembered:
 *
 *   * **Dealt with** (tech / maps / hire) → standing `friendly`. They leave
 *     after the linger window and ONE return visit follows 30 rounds later,
 *     bringing a bigger chart of the unknown world as their gift.
 *   * **Refused** → refusals accumulate per clan tolerance; beyond it, or if
 *     you **attack the camp**, they turn `angry`: the horde wakes and raids
 *     you (troops bleed in fights, stores stolen at the gates) for 12 rounds,
 *     then walks away for good.
 *   * **Settled** (random door, per clan chance) → a settlement beside your
 *     city: your fields feed it (−2 food/turn in the city balance) and their
 *     spears stand ready (free defenders raised for you).
 *
 * Design rules (mirroring TeamCoordinator):
 *   * **Neutral, not hostile by default.** Civ id -1 (with the barbarians):
 *     contact recording skips it, no civ is at war with the camp.
 *   * **Stateless across loads.** Nothing is persisted; a loaded game has no
 *     nomads (v1). The settlement TILE flag does persist — its food/denfense
 *     effects live in engine code that reads the map, not in this manager.
 *   * **Single human seat only.**
 *   * **Fair by construction.** Half research cost (clan-adjusted), above
 *     build cost for the horde (clan-adjusted), the promised terms are what
 *     the BUTTON said.
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
  NOMAD_CLANS,
  NOMAD_HIRE_COST_FACTOR,
  NOMAD_MAP_REVEAL_RADIUS,
  NOMAD_MAX_VISITS,
  NOMAD_PARLEY_DELAY_ROUNDS,
  NOMAD_PASS_DEPART_ROUNDS,
  NOMAD_PROXIMITY_DISTANCE,
  NOMAD_RAID_COOLDOWN_ROUNDS,
  NOMAD_RAID_GOLD_MAX,
  NOMAD_RAID_GOLD_MIN,
  NOMAD_RAID_GOLD_SHARE,
  NOMAD_RAID_ROUNDS,
  NOMAD_REOFFER_COOLDOWN_ROUNDS,
  NOMAD_RETURN_DELAY_ROUNDS,
  NOMAD_RETURN_MAP_RADIUS,
  NOMAD_SETTLEMENT_DEFENDERS,
  NOMAD_SETTLEMENT_MAX_DISTANCE,
  NOMAD_SPAWN_MAX_DISTANCE,
  NOMAD_SPAWN_MIN_DISTANCE,
  NOMAD_SPAWN_UNITS,
  NOMAD_TECH_PRICE_DIVISOR,
  NOMAD_TECH_PRICE_MAX,
  NOMAD_TECH_PRICE_MIN,
  NOMAD_TRIGGER_FALLBACK_ROUND,
  NOMAD_TRIGGER_ROUND,
  type NomadClan,
  type NomadPersonality,
} from '@/data/NomadConstants';

/** What a resolved parley did — the UI turns this into a localized toast. */
export interface NomadOutcome {
  ok: boolean;
  /** `noGold`: the treasury cannot meet the hire price (UI shows the hint). */
  result?: 'tech' | 'techGift' | 'maps' | 'hire' | 'settle' | 'pass' | 'noGold';
  params?: Record<string, string | number>;
}

interface NomadPending {
  /** The technology the button promised (never re-rolled at resolve time). */
  tech?: string;
  /** The gold the button promised. */
  price?: number;
  /** The settlement tile the button offered (never re-picked at resolve). */
  settle?: { col: number; row: number; cityId: string };
}

export type NomadStanding = 'neutral' | 'friendly' | 'angry';

export class NomadManager {
  private readonly gameEngine: GameEngine;

  // ── The relationship (one per game) ────────────────────────────────────
  private clan: NomadClan | null = null;
  private standing: NomadStanding = 'neutral';
  private refusals = 0;
  private visitCount = 0;
  private settled = false;
  private hired = false;
  private angrySince = -1;
  private pendingReturnAt: number | null = null;
  private readonly raidCooldowns = new Map<string, number>();

  // ── The current camp (per visit) ──────────────────────────────────────
  private camp: { col: number; row: number } | null = null;
  private campUnitIds: string[] = [];
  private hireCost = 0;
  private departed = false;

  // ── The current parley ────────────────────────────────────────────────
  private firstAudienceAt = -1;
  private parleyEmitted = false;
  private parleyDone = false;
  private secondEmitted = false;
  private liveParley: 'first' | 'second' | null = null;
  private lastEmitRound = -1;
  private parleyResolvedRound = -1;
  private departAt: number | null = null;
  private lastRound = 0;
  private pending: NomadPending | null = null;
  private settleRolled = false;

  constructor(gameEngine: GameEngine) {
    this.gameEngine = gameEngine;
  }

  // ── State for the UI / tests ───────────────────────────────────────────

  get isSpawned(): boolean { return this.visitCount > 0; }
  get isParleyDone(): boolean { return this.parleyDone && this.visitCount > 0 && this.campAlive(); }
  get isHired(): boolean { return this.hired; }
  get isDeparted(): boolean { return this.departed && !this.campAlive(); }
  get isSettled(): boolean { return this.settled; }
  get isAngry(): boolean { return this.standing === 'angry'; }
  get currentStanding(): NomadStanding { return this.standing; }
  get visits(): number { return this.visitCount; }
  get currentClan(): NomadClan | null { return this.clan ? { ...this.clan } : null; }
  /** The rolled clan's temperament ('trader' | 'warrior' | 'mystic'). */
  get currentPersonality(): NomadPersonality | null { return this.clan?.personality ?? null; }
  get campTile(): { col: number; row: number } | null { return this.camp ? { ...this.camp } : null; }

  /** Drop all state (new game / load): v1 nomads never survive a save. */
  reset(): void {
    this.clan = null;
    this.standing = 'neutral';
    this.refusals = 0;
    this.visitCount = 0;
    this.settled = false;
    this.hired = false;
    this.angrySince = -1;
    this.pendingReturnAt = null;
    this.raidCooldowns.clear();
    this.camp = null;
    this.campUnitIds = [];
    this.hireCost = 0;
    this.departed = false;
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
    this.settleRolled = false;
  }

  // ── The per-round state machine ───────────────────────────────────────

  processRound(round: number): void {
    this.lastRound = round;
    if (this.gameEngine.isGameOver) return;
    const humanId = this.humanCivId();
    if (humanId === null) return;
    if (this.settled || this.hired) return;

    // Anger from an attack: an injured or missing camp unit means somebody
    // drew first blood (only combat does either).
    if (this.campAlive() && this.standing !== 'angry' && this.wasAttacked()) {
      this.goAngry();
    }

    // Angry camps prey on the player, then leave for good.
    if (this.standing === 'angry') {
      if (!this.campAlive()) return; // wiped out — nothing left to raid with
      this.raidRound(humanId, round);
      if (round >= this.angrySince + NOMAD_RAID_ROUNDS) this.depart();
      return;
    }

    // The first visit.
    if (this.visitCount === 0) {
      const hasCity = (this.gameEngine.cities ?? []).some((c) => c.civilizationId === humanId);
      const due = (round >= NOMAD_TRIGGER_ROUND && hasCity)
        || round >= NOMAD_TRIGGER_FALLBACK_ROUND;
      if (due) this.spawnVisit(round, humanId);
      return;
    }

    // The standing camp: parley, race, departure.
    if (this.campAlive()) {
      if (!this.parleyDone) {
        if (!this.parleyEmitted && round >= this.firstAudienceAt) {
          this.emitParley(false, round);
          return;
        }
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
      if (this.liveParley === null && round >= this.parleyResolvedRound + NOMAD_AI_HIRE_MIN_ROUND_GAP) {
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
      return;
    }

    // No camp: a friendly court has earned its return visit.
    if (
      this.pendingReturnAt !== null
      && round >= this.pendingReturnAt
      && this.visitCount < NOMAD_MAX_VISITS
    ) {
      this.pendingReturnAt = null;
      const spawned = this.spawnVisit(round, humanId);
      if (spawned && this.standing === 'friendly') {
        // "If they were friendly before, they show you some part of the map."
        this.gameEngine.revealArea(this.camp!.col, this.camp!.row, NOMAD_RETURN_MAP_RADIUS, humanId);
        this.gameEngine.onStateChange?.('NOMAD_RETURN_GIFT', {});
      }
    }
  }

  // ── The parley ─────────────────────────────────────────────────────────

  /**
   * Resolve one of the parley's doors. The terms are whatever the BUTTON
   * promised (`pending`), never re-rolled. A successful choice emits
   * NOMAD_RESOLVED so the store re-syncs (gold, techs, converted units).
   */
  resolveParley(choiceId: string): NomadOutcome {
    if (this.liveParley === null || this.visitCount === 0 || this.departed || this.hired || this.settled) {
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
          this.standing = 'friendly';
          this.endVisitWithLinger();
          const techName = TECHNOLOGIES_DATA.find((t) => t.id === tech)?.name ?? tech;
          return {
            ok: true,
            result: free ? 'techGift' : 'tech',
            params: { tech: techName, gold: price },
          };
        }
        this.gameEngine.revealArea(this.camp!.col, this.camp!.row, NOMAD_MAP_REVEAL_RADIUS, humanId);
        this.standing = 'friendly';
        this.endVisitWithLinger();
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

      case 'settle': {
        const offer = this.pending?.settle;
        if (!offer) return { ok: false };
        const tile = this.gameEngine.getTileAt?.(offer.col, offer.row);
        if (!tile) return { ok: false };
        // The settlement outlives the visit: its effects are read from the
        // map (city food drain, defenders raised here).
        tile.nomadSettlement = true;
        for (let i = 0; i < NOMAD_SETTLEMENT_DEFENDERS; i++) {
          this.gameEngine.createUnit(humanId, 'warriors', offer.col, offer.row);
        }
        this.settled = true;
        this.parleyDone = true;
        this.parleyResolvedRound = this.lastRound;
        this.removeCampUnits(); // the wanderers are home — the camp is gone
        this.camp = null;
        this.departed = true;
        const city = (this.gameEngine.cities ?? []).find((c) => c.id === offer.cityId);
        return { ok: true, result: 'settle', params: { city: city?.name ?? '' } };
      }

      case 'pass':
      case 'farewell': {
        this.refusals += 1;
        this.parleyDone = true;
        this.parleyResolvedRound = this.lastRound;
        const tolerance = this.clan?.angerTolerance ?? 2;
        if (this.refusals > tolerance) {
          // Beyond their patience: the camp does not leave — it turns.
          this.goAngry();
          return { ok: true, result: 'pass' };
        }
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

  /** Dealt-with visit: the camp lingers for the race, then walks away. */
  private endVisitWithLinger(): void {
    this.parleyDone = true;
    this.parleyResolvedRound = this.lastRound;
    this.departAt = this.lastRound + NOMAD_CAMP_LINGER_ROUNDS;
  }

  /** Any camp unit hurt or missing = somebody drew first blood. */
  private wasAttacked(): boolean {
    for (const id of this.campUnitIds) {
      const unit = this.unitById(id);
      if (!unit) return true;
      if (unit.health < 100) return true;
    }
    return false;
  }

  private goAngry(): void {
    if (this.standing === 'angry') return;
    this.standing = 'angry';
    this.angrySince = this.lastRound;
    this.liveParley = null;
    this.departAt = null;
    this.pendingReturnAt = null;
    // The camp wakes: no more holding position.
    for (const id of this.campUnitIds) {
      const unit = this.unitById(id);
      if (!unit) continue;
      unit.isFortified = false;
      unit.orders = null;
      unit.movesRemaining = unit.maxMoves ?? unit.movesRemaining;
    }
    this.gameEngine.onStateChange?.('NOMAD_ANGRY', {});
  }

  /**
   * One round of trouble: attack anything standing next to the horde,
   * otherwise march on the nearest city — and once at the gates, raid the
   * stores (with a cooldown, so an untouched camp drains slowly).
   */
  private raidRound(humanId: number, round: number): void {
    const cities = (this.gameEngine.cities ?? []).filter((c) => c.civilizationId === humanId);
    for (const id of this.campUnitIds) {
      const unit = this.unitById(id);
      if (!unit) continue;
      if ((unit.movesRemaining ?? 0) <= 0) {
        unit.movesRemaining = unit.maxMoves ?? 1; // a raider fights every round
      }

      const grid = this.gameEngine.squareGrid;
      const neighbors = grid?.getNeighbors?.(unit.col, unit.row) ?? [];

      // Next to an enemy AND able to reach it? Fight it. `canUnitMoveTo` is
      // the authority (rivers, water, range) — a passable-looking tile can
      // still be uncrossable, and a blocked attack must not stall the raid.
      const attackTarget = neighbors.find((n) => {
        const target = this.gameEngine.getUnitAt?.(n.col, n.row);
        if (!target || target.civilizationId !== humanId || target.isDefeated) return false;
        return this.gameEngine.canUnitMoveTo?.(unit.id, n.col, n.row) ?? false;
      });
      if (attackTarget) {
        this.gameEngine.moveUnit(unit.id, attackTarget.col, attackTarget.row);
        continue;
      }

      // Otherwise march on the nearest city and raid what it stores.
      const city = cities
        .map((c) => ({ c, d: Math.max(Math.abs(c.col - unit.col), Math.abs(c.row - unit.row)) }))
        .sort((a, b) => a.d - b.d)[0];
      if (!city) continue;
      if (city.d <= 1) {
        this.raidCity(city.c, humanId, round);
        continue;
      }
      // The greedy step asks the SAME gate the movement pipeline uses: a
      // tile that is passable but not enterable (a wide river the unit
      // cannot ford) would otherwise be picked every round and the horde
      // would mill against it forever.
      const step = neighbors
        .filter((n) => !this.gameEngine.getUnitAt?.(n.col, n.row))
        .filter((n) => this.gameEngine.canUnitMoveTo?.(unit.id, n.col, n.row) ?? false)
        .map((n) => ({ n, d: Math.max(Math.abs(n.col - city.c.col), Math.abs(n.row - city.c.row)) }))
        .sort((a, b) => a.d - b.d || a.n.col - b.n.col || a.n.row - b.n.row)[0];
      if (step) this.gameEngine.moveUnit(unit.id, step.n.col, step.n.row);
    }
  }

  private raidCity(city: { id: string; name?: string; population?: number }, humanId: number, round: number): void {
    const last = this.raidCooldowns.get(city.id) ?? -Infinity;
    if (round - last < NOMAD_RAID_COOLDOWN_ROUNDS) return;
    this.raidCooldowns.set(city.id, round);
    const human = this.gameEngine.civilizations?.[humanId];
    const treasury = human?.resources?.gold ?? 0;
    const stolen = Math.max(
      NOMAD_RAID_GOLD_MIN,
      Math.min(NOMAD_RAID_GOLD_MAX, Math.floor(treasury * NOMAD_RAID_GOLD_SHARE)),
    );
    if (human) human.resources.gold = Math.max(0, treasury - stolen);
    this.gameEngine.onStateChange?.('NOMAD_RAID', {
      city: city.name ?? '', gold: Math.min(stolen, treasury),
    });
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

  private findCampTile(anchor: { col: number; row: number }): { col: number; row: number } | null {
    const grid = this.gameEngine.squareGrid;
    const anchorLandmass = this.gameEngine.getLandmassId?.(anchor.col, anchor.row) ?? -1;
    for (let r = NOMAD_SPAWN_MIN_DISTANCE; r <= NOMAD_SPAWN_MAX_DISTANCE; r++) {
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
          if (this.gameEngine.getTileAt?.(col, row)?.nomadSettlement) continue;
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

  /** A tile beside the player's city the wanderers may plant stakes on. */
  private findSettlementTile(humanId: number): { col: number; row: number; cityId: string } | null {
    const grid = this.gameEngine.squareGrid;
    const cities = (this.gameEngine.cities ?? []).filter((c) => c.civilizationId === humanId);
    for (const city of cities) {
      for (let dc = -NOMAD_SETTLEMENT_MAX_DISTANCE; dc <= NOMAD_SETTLEMENT_MAX_DISTANCE; dc++) {
        for (let dr = -NOMAD_SETTLEMENT_MAX_DISTANCE; dr <= NOMAD_SETTLEMENT_MAX_DISTANCE; dr++) {
          if (dc === 0 && dr === 0) continue;
          if (Math.max(Math.abs(dc), Math.abs(dr)) > NOMAD_SETTLEMENT_MAX_DISTANCE) continue;
          const col = city.col + dc;
          const row = city.row + dr;
          if (grid && !grid.isValidSquare(col, row)) continue;
          if (!this.gameEngine.isTilePassable?.(col, row)) continue;
          if (this.gameEngine.getUnitAt?.(col, row)) continue;
          if (this.gameEngine.getCityAt?.(col, row)) continue;
          if (this.gameEngine.getTileAt?.(col, row)?.village) continue;
          if (this.gameEngine.getTileAt?.(col, row)?.nomadSettlement) continue;
          return { col, row, cityId: city.id };
        }
      }
    }
    return null;
  }

  /**
   * Raise the camp. The SAME clan returns on a return visit (they are who
   * you met); the first visit rolls one. Returns false when there is no
   * room near the court — the caller retries next round.
   */
  private spawnVisit(round: number, humanId: number): boolean {
    if (!this.clan) {
      this.clan = NOMAD_CLANS[Math.floor(Math.random() * NOMAD_CLANS.length)];
    }
    const anchor = this.anchorFor(humanId);
    if (!anchor) return false;
    const tile = this.findCampTile(anchor);
    if (!tile) return false;

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
    if (ids.length === 0) return false;

    this.camp = { ...tile };
    this.campUnitIds = ids;
    this.departed = false;
    this.parleyEmitted = false;
    this.parleyDone = false;
    this.secondEmitted = false;
    this.liveParley = null;
    this.pending = null;
    this.settleRolled = false;
    this.firstAudienceAt = round + NOMAD_PARLEY_DELAY_ROUNDS;
    this.hireCost = Math.ceil(
      ids.reduce((sum, id) => {
        const type = String(this.unitById(id)?.type ?? '');
        return sum + (UNIT_PROPS[type]?.cost ?? 10);
      }, 0) * NOMAD_HIRE_COST_FACTOR * (this.clan?.hirePriceFactor ?? 1),
    );
    this.visitCount += 1;
    // You SEE the strangers arrive — and so does the story.
    this.gameEngine.revealArea(tile.col, tile.row, 4, humanId);
    this.gameEngine.onStateChange?.('NOMAD_SIGHTED', {
      col: tile.col,
      row: tile.row,
      clan: this.clan?.id,
      visit: this.visitCount,
    });
    return true;
  }

  private emitParley(second: boolean, round: number): void {
    const humanId = this.humanCivId();
    if (humanId === null || !this.clan) return;
    const clan = this.clan;
    const returning = this.visitCount > 1;
    const choices: AudienceChoice[] = [];
    let techOffered: string | undefined;
    let goldAmount: number | undefined;
    this.pending = null;
    this.settleRolled = false;

    if (!second) {
      const tech = this.gameEngine.pickFreeTech(humanId);
      if (tech) {
        const raw = TECHNOLOGIES_DATA.find((t) => t.id === tech)?.cost ?? 60;
        const price = Math.max(
          NOMAD_TECH_PRICE_MIN,
          Math.min(
            NOMAD_TECH_PRICE_MAX,
            Math.floor((Math.floor(raw / NOMAD_TECH_PRICE_DIVISOR)) * clan.techPriceFactor),
          ),
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
      // On a return visit the map comes as their GIFT (revealed at spawn),
      // so the paid doors remain and the door itself is gone.
      if (!returning) {
        choices.push({ id: 'maps', labelKey: 'nomad.choice.maps', variant: 'accept' });
      }
      // A clan may propose to settle beside your city (their gamble, their
      // chance) — and the offered tile is remembered for the resolve.
      const settleTile = this.findSettlementTile(humanId);
      if (settleTile) {
        this.settleRolled = Math.random() < clan.settleChance;
        if (this.settleRolled) {
          const cityName =
            (this.gameEngine.cities ?? []).find((c) => c.id === settleTile.cityId)?.name ?? '';
          choices.push({
            id: 'settle',
            labelKey: 'nomad.choice.settle',
            labelParams: { city: cityName },
            variant: 'accept',
          });
          this.pending = { ...(this.pending ?? {}), settle: settleTile };
        }
      }
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
      speaker: {
        nameKey: clan.nameKey,
        subKey: clan.epithetKey,
        icon: clan.icon,
        image: clan.image,
      },
      leadKey: second ? 'nomad.parley.leadSecond'
        : returning ? clan.returnLeadKey
          : clan.leadKey,
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

  private removeCampUnits(): void {
    const leaving = new Set(this.campUnitIds);
    this.gameEngine.units = (this.gameEngine.units ?? []).filter((u) => !leaving.has(u.id));
    this.campUnitIds = [];
  }

  /**
   * The camp walks off. Only a dealt-with (friendly) court earns the return
   * visit — the door for it opens on this departure.
   */
  private depart(): void {
    this.removeCampUnits();
    this.camp = null;
    this.departed = true;
    this.gameEngine.onStateChange?.('NOMAD_DEPARTED', {});
    if (this.standing === 'friendly' && this.visitCount < NOMAD_MAX_VISITS) {
      this.pendingReturnAt = this.lastRound + NOMAD_RETURN_DELAY_ROUNDS;
    }
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
