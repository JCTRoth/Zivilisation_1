/**
 * AIManager - Manages AI behavior for civilizations
 * 
 * Coordinates all AI subsystems: strategy selection, technology research,
 * army coordination, building production, and unit targeting.
 */

import { AIUtility, scanAreaForEnemies, findInterceptPosition, findPatrolWaypoint, type ThreatAlert } from './AIUtility';
import { EnemySearcher } from '../EnemySearcher';
import { ABSOLUTE_MIN_GOLD, CITY_RADIUS, UNIT_MAINTENANCE } from '../EconomicManager';
import { bribeUnitCost } from '../DiplomacyManager';
import { UNIT_PROPS, TERRAIN_PROPS, IMPROVEMENT_PROPERTIES, IMPROVEMENT_TYPES, BUILDING_PROPERTIES } from '@/utils/Constants';
import {
  BARBARIAN_CIV_ID,
  AI_VILLAGE_ENEMY_CITY_OVERRIDE_RADIUS,
  calculateVillageTakeChance,
  villageDecisionRoll,
  villageEarlyGameFactor,
} from '@/data/VillageConstants';
import { isAutoScenario, MAX_CARAVAN_TRADE_ROUTES } from '@/data/GameConstants';
import { SettlementEvaluator, MIN_CITY_CENTER_DISTANCE } from '../SettlementEvaluator';
import { Pathfinding } from '../Pathfinding';
import { AIStrategySelector } from './AIStrategySelector';
import { AICoordinator } from './AICoordinator';
import { AIResearch } from './AIResearch';
import { computeAggression, planBulkAttack, BULK_ATTACK_STRENGTH_RATIO, type KnownTarget, type AggressionAssessment } from './AIAggression';
import {
  chooseFinalWarTarget,
  shouldDeclareFinalWar,
  type FinalWarCandidate,
  type FinalWarReach,
  type FinalWarRecord,
} from './AIFinalWar';
import { bestFishingGround, fishingRelevanceForCiv } from '../FisherEconomics';
import { analyzeCityBuildings, rememberBuildingSale } from './BuildingAnalyzer';
import { isSellableForBudget } from './BuildingEconomics';
import {
  planCityInfrastructure,
  INFRASTRUCTURE_POP_THRESHOLD,
  type InfrastructureDemand,
  type InfrastructureTile,
} from './InfrastructurePlanner';
import type {
  BudgetAggression,
  BuildingFundingCandidate,
  BuildingFundingPlan,
  FundingDemand,
} from './AICoordinator';
import { notify } from '@/utils/NotificationUtils';
import {
  createDefaultAIState,
  resolveAICivStrategy,
  canBuildUnit,
  type AIState,
  type AggressionState,
  type ArmyGroup,
  type StrategyProfile,
} from './AITypes';
import {
  classifyNavalTarget,
  scoreLandingSite,
  scoreNavalTarget,
  type NavalTargetClass,
} from './NavalDoctrine';
import {
  assessCityThreat,
  calculateDangerThreshold,
  collectCityThreatSamples,
  computeCityGarrisonStrength,
  scoreEnemyTarget,
  type CityThreatAssessment
} from './AIStrategy';
import type { DiplomatAction } from '../DiplomacyTypes';
import type { Unit, City, Civilization } from '../../../../types/game';
import GameEngine, { NUCLEAR_BLAST_RADIUS, type PlayerTurnStorage, type MapTile } from '../GameEngine';
import { getShuffledAdjacentTiles } from '../MovementHelper';
import { awaitPendingAnimations } from '../../rendering/GlideAnimation';
import { debugLog } from '../../../utils/DevLog';

// How much better (in settlement-score points) the best location must be for a
// settler to keep walking instead of founding at its current tile. Prevents
// settlers from chasing the 10x10 window maximum forever — as the settler
// moves, the window re-centers and the "best" spot keeps moving ahead.
const SETTLE_SCORE_THRESHOLD = 12;
// If the best settlement location is farther than this Chebyshev distance,
// found at the current tile instead of walking across the map.
const MAX_SETTLE_WALK_DISTANCE = 4;

/**
 * Late-game infrastructure mode.
 *
 * Above this city count the expansionist profiles stop treating "found another
 * city" as the default answer. A settler first works the fields of its own
 * cities — roads and irrigation are permanent, and a 7th city costs food
 * upkeep and shields before it pays anything back — and only goes looking for
 * a new site once the land it already owns is in good shape.
 */
const LATE_INFRA_CITY_THRESHOLD = 6;

/**
 * Profiles that switch to {@link LATE_INFRA_CITY_THRESHOLD} infrastructure
 * mode. The turtle and the wonder/science civs already under-expand and must
 * not be slowed down further; this is aimed at the two profiles that found
 * their way to a lot of cities and then kept sprawling.
 */
const LATE_INFRA_PROFILES: ReadonlySet<StrategyProfile> = new Set<StrategyProfile>([
  'early_expansion',
  'military_expansion',
]);

/**
 * A settler stops working a city once this fraction of that city's workable
 * area carries an improvement, and moves on. Full coverage is unreachable
 * (mountains, tundra and ocean tiles never take an improvement), so "every
 * tile improved" would park the settler forever.
 */
const CITY_AREA_IMPROVED_TARGET = 0.5;
/**
 * A MATURE city's area counts as built out at 3/4 improved (and every
 * irrigable and roadable tile gone). Lower than that and the city is still
 * paying for its citizens out of raw tiles: no roads means no trade, no trade
 * means no luxury, and no luxury means civil unrest at a size the empire
 * cannot afford.
 */
const CITY_AREA_BUILT_UP_TARGET = 0.75;

/**
 * A city is "mature" from size 6 on (the same threshold the infrastructure
 * planner uses for "fields are worth improving"). From that size the AI sends
 * its settlers to irrigate and pave the tiles around the city instead of
 * looking for somewhere else to found.
 */
const MATURE_CITY_POPULATION = INFRASTRUCTURE_POP_THRESHOLD;

/**
 * An enemy unit THIS close counts as a direct threat to the city: two tiles is
 * the city's own workable radius, so anything further out is not standing in
 * the fields and must not stop the works programme.
 */
const DIRECT_THREAT_RADIUS = 2;

/**
 * Rounds after the last assault during which the city counts as "under
 * ongoing attack" — the settler stays away for the whole siege, not just the
 * turn the catapult hit.
 */
const ONGOING_ATTACK_WINDOW = 6;

/**
 * How far outside a city's workable area irrigation may START when the city is
 * short of food. Fresh water only spreads one tile at a time, so a city whose
 * whole area is already irrigated can still gain food — but only by chaining a
 * ditch outward and then back onto its own fields. Three fields out is enough
 * to reach the next river; much more and the settler is decorating wilderness.
 */
const OUTSIDE_IRRIGATION_FIELDS = 3;

/**
 * How much better a site must score before a settler that has just finished
 * working its cities will walk to found it, instead of founding where it
 * stands. Stricter than {@link SETTLE_SCORE_THRESHOLD}: after a city's fields
 * are paved and watered, the bar for a NEW city is correspondingly higher.
 */
const LATE_SETTLE_SCORE_THRESHOLD = 20;

/** Terrains that accept an improvement at all (road / irrigation / mine). */
const IRRIGABLE_TERRAINS = ['grassland', 'plains', 'desert', 'forest', 'jungle', 'swamp'];
const MINABLE_TERRAINS = ['hills', 'mountains'];
/** Orthogonal offsets — irrigation spreads sideways and along a river, not diagonally. */
const ORTHOGONAL: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * How a thin treasury over a real-sized empire is handled.
 *
 * A civ is "starved" when it holds less than {@link LIQUIDATION_BUDGET_GOLD}
 * spendable gold AND owns more than {@link LIQUIDATION_CITY_THRESHOLD} cities.
 * Both halves matter: a young civ with 5 gold is a civ that simply has not grown
 * yet, and stripping it achieves nothing, while a 6-city empire holding 40 gold
 * cannot pay its own building upkeep for the month. Those liquidate hard —
 * {@link LIQUIDATION_RESERVE_TURNS} turns of upkeep as a buffer rather than the
 * one turn an at-war civ raises, because the problem is structural (an upkeep
 * bill that recurs) rather than a single bill to settle.
 */
const LIQUIDATION_BUDGET_GOLD = 50;
const LIQUIDATION_CITY_THRESHOLD = 4;
const LIQUIDATION_RESERVE_TURNS = 3;

const OSCILLATION_WINDOW = 6;
const OSCILLATION_THRESHOLD = 3;

/**
 * A committed bulk-attack plan is kept (without re-planning/resetting unit
 * assignments) for at most this many rounds, so an assault actually reaches
 * its target instead of being wiped mid-march.
 */
const OFFENSIVE_PLAN_MAX_AGE_ROUNDS = 20;

/** How long a lost city keeps the AI in "retaliate" mode. */
const RETALIATION_WINDOW_ROUNDS = 15;

/**
 * An AI colony mission: ferry a settler to a small, city-free island and found
 * a city there. Stages:
 *   gather → the settler walks to the coast and the ferry comes alongside;
 *   sail   → the settler is aboard and the ferry crosses to the island.
 * The mission lives in the civ's player storage so it survives across turns.
 */
interface ColonyMission {
  settlerId: string;
  ferryId: string | null;
  targetLandmassId: number;
  landTile: { col: number; row: number };
  waterTile: { col: number; row: number };
  stage: 'gather' | 'sail';
}

/**
 * A naval invasion: a landing force ferried to an enemy city on a landmass we
 * cannot walk to.
 *
 * A Ferry carries `transportCapacity` land units, so a mission is a whole
 * landing force and one hull, not a single spear: the AI repeats it to land an
 * army, exactly as a human would. The stages mirror the colony mission:
 *   gather → the troops walk to a coastal tile on their own landmass.
 *   sail   → the ferry is alongside, they board, and it crosses.
 *   siege  → the force is ashore and marches on the target city.
 *
 * Without this an AI-vs-AI game whose strait splits the civs is an unwinnable
 * stalemate: neither side can reach the other, so they trade declarations and
 * upkeep forever (a 465-round run: 17 wars, 3 attacks).
 */
interface InvasionMission {
  /** The landing force, in boarding order. */
  troopIds: string[];
  /** Units already put ashore, marching on the city. */
  landedIds: string[];
  ferryId: string | null;
  targetCityId: string;
  targetLandmassId: number;
  landTile: { col: number; row: number };
  waterTile: { col: number; row: number };
  rendezvous: { col: number; row: number };
  stage: 'gather' | 'sail' | 'siege';
}

/**
 * Civ-wide facts a sea-invasion reachability test needs. `null` stands for
 * "this civ cannot mount a sea invasion at all". Built once and passed down so
 * a loop over many remembered enemy positions does not re-filter the civ's
 * cities and re-check its buildable tech for every entry.
 */
interface SeaInvasionContext {
  /** Landmass the civ would sail from. */
  homeLandmass: number;
}

/** Turns a hull may fail to close on its destination before it re-targets. */
const NAVAL_STALL_TURNS = 2;

/** How far a re-targeted hull must put itself from the objective it gave up. */
const NAVAL_RETARGET_MIN_DISTANCE = 12;

/**
 * Units every city keeps, whatever else the civ wants to do.
 *
 * One is the floor that makes a city defensible at all, and it is also the
 * cheapest unit of happiness in the game: a garrisoned unit is content the city
 * does not have to buy with a temple. Cities used to hold units only by accident
 * — a soldier with nothing else to do would fortify next to one — so an empire
 * could end the game with undefended cities purely because every unit had been
 * drafted into an army.
 */
const MIN_GARRISON_PER_CITY = 1;

/**
 * The floor while an offensive is under way.
 *
 * Attacking means cities are unguarded for the duration of the march, and the
 * whole point of the minimum is that it survives the campaign. Two is still a
 * rounding error against an army, and it is what stops a civ from stripping its
 * cities bare the moment it wins a war.
 */
const MIN_GARRISON_WHILE_ATTACKING = 2;

/** How close a city must be to count as an army's base (rally or garrison). */
const ARMY_BASE_RADIUS = 3;

/**
 * Turns a settler keeps its blocked settlement targets before they are forgiven.
 *
 * Blocking is a response to one unreachable site, not a verdict on the map.
 */
const BLOCKED_TARGET_PATIENCE = 10;

/**
 * Turns a settler keeps chasing one settlement target before the lock is
 * dropped and the search is allowed to choose somewhere else.
 */
const LOCKED_TARGET_PATIENCE = 8;

/** Our own units a single enemy city tolerates before the blockade is a waste. */
const BLOCKADE_UNITS_PER_CITY = 2;

/** An enemy city worth starving has to actually depend on its fields. */
const BLOCKADE_MIN_FOOD = 2;

export class AIManager {
  private gameEngine: GameEngine;

  constructor(gameEngine: GameEngine) {
    this.gameEngine = gameEngine;
  }

  /**
   * Check if any sleeping/fortified human units have enemies in their line
   * of sight. If so, wake them and center the screen on the danger.
   * Returns true if an enemy was found (caller should pause AI turn).
   */
  private checkSleepingUnitsForEnemies(): boolean {
    const humanCivId = this.gameEngine.civilizations.findIndex(c => c.isHuman);
    if (humanCivId < 0) return false;

    const sleepingUnits = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId === humanCivId && (u.isSleeping || u.isFortified) && !u.isDefeated,
    );
    if (sleepingUnits.length === 0) return false;

    const enemyUnits = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId !== humanCivId && !u.isDefeated,
    );
    if (enemyUnits.length === 0) return false;

    for (const sleeping of sleepingUnits) {
      // Check 2-tile radius for enemies (typical line of sight)
      const sightRange = 2;
      for (const enemy of enemyUnits) {
        const dist = Math.abs(sleeping.col - enemy.col) + Math.abs(sleeping.row - enemy.row);
        if (dist <= sightRange) {
          debugLog(`[AI] Sleeping unit ${sleeping.id} (${sleeping.type}) woke — enemy ${enemy.id} (${enemy.type}) at (${enemy.col},${enemy.row})`);
          this.gameEngine.log('ai', `Sleeping unit woke — enemy spotted`, {
            unitId: sleeping.id, unitType: sleeping.type,
            enemyId: enemy.id, enemyType: enemy.type,
            action: 'sleep_wake',
          });

          // Wake the unit
          if (sleeping.isSleeping) {
            this.gameEngine.unitWake(sleeping.id);
          }
          if (sleeping.isFortified) {
            this.gameEngine.unfortifyUnit(sleeping.id);
          }

          // Center screen on the danger
          const store = this.gameEngine.storeActions;
          if (store?.focusCameraOnTile) {
            store.focusCameraOnTile(enemy.col, enemy.row);
          }

          // Notify the player
          notify('warning', `Enemy ${enemy.type} spotted near your ${sleeping.type}!`);

          return true;
        }
      }
    }
    return false;
  }

  /**
   * Process AI turn for a civilization
   */
  async processAITurn(civilizationId: number) {
    const civ = this.gameEngine.civilizations[civilizationId];
    if (!civ) {
      console.warn(`[AI] processAITurn: Civilization ${civilizationId} not found`);
      return;
    }
    if (civ.isHuman) {
      debugLog(`[AI] processAITurn: Skipping civilization ${civilizationId} - is human player`);
      return;
    }
    // Don't run AI while the game is paused
    if (this.gameEngine.isPaused) {
      console.warn(`[AI] processAITurn: Skipping civilization ${civilizationId} - game is paused`);
      return;
    }
    // CRITICAL: Only allow AI to act during its own turn
    if (this.gameEngine.activePlayer !== civilizationId) {
      console.warn(`[AI] processAITurn: Civilization ${civilizationId} attempted to act outside its turn (active player: ${this.gameEngine.activePlayer})`);
      return;
    }
    // Return promise so RoundManager can coordinate timeouts/end-of-turn
    return this.runAITurn(civilizationId).catch(err => console.error('AI turn error', err));
  }

  /**
   * Run an asynchronous AI turn for civilizationId
   */
  private async runAITurn(civilizationId: number) {
    const civ = this.gameEngine.civilizations[civilizationId];
    if (!civ || civ.isHuman) {
      debugLog(`[AI] runAITurn: Skipping civilization ${civilizationId} - not AI or is human`);
      return;
    }
    // CRITICAL: Verify this is still the active player before proceeding
    if (this.gameEngine.activePlayer !== civilizationId) {
      console.warn(`[AI] runAITurn: Turn changed before AI could act (expected: ${civilizationId}, actual: ${this.gameEngine.activePlayer})`);
      return;
    }
    // Don't run AI while the game is paused
    if (this.gameEngine.isPaused) {
      console.warn(`[AI] runAITurn: Skipping civilization ${civilizationId} - game is paused`);
      return;
    }
    debugLog(`[AI] 🤖 Starting AI turn for civilization ${civilizationId} (${civ.name})`);
    this.gameEngine.log('ai', `🤖 AI turn start — ${civ.name} (civ ${civilizationId})`, { civilizationId, action: 'turn_start', strategy: civ.productionProfile ?? 'balanced_growth' });

    // Pause before the AI acts so an observer can follow the game. The engine
    // owns the number: a self-playing scenario starts at zero and only pays
    // once an observer steps the speed down, while a watched game always pays
    // the readable pause it always paid.
    const turnStartDelay = this.gameEngine.getAITurnStartDelay?.() ?? 0;
    if (turnStartDelay > 0) {
      await this.gameEngine.sleep(turnStartDelay);
    }

    // The turn may have moved on during the delay (another path advanced the
    // phase chain). If we're no longer the active player, stop immediately —
    // continuing would process THIS civ's units on the WRONG player's turn
    // (turn-overlap), and the stale completion would advance the new player's
    // phases prematurely.
    if (this.gameEngine.activePlayer !== civilizationId) {
      console.warn(`[AI] runAITurn: Turn changed during AI start delay (expected: ${civilizationId}, actual: ${this.gameEngine.activePlayer}) — aborting stale AI turn`);
      return;
    }
    if (this.gameEngine.isPaused) {
      console.warn(`[AI] runAITurn: Game paused during AI start delay — aborting AI turn for civ ${civilizationId}`);
      return;
    }

    // ─── Phase 0: Initialize / retrieve AI state ───────────────────────
    const storage = this.gameEngine.getPlayerStorage?.(civilizationId);
    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;

    if (storage) {
      if (!storage.turnData) storage.turnData = {};
      if (!(storage.turnData as Record<string, unknown>).aiState) {
        (storage.turnData as Record<string, unknown>).aiState = createDefaultAIState();
        // Seed the research strategy from the civ's fixed production profile so
        // the AI researches in the same direction it produces.
        ((storage.turnData as Record<string, unknown>).aiState as AIState).strategyProfile =
          this.gameEngine.civilizations?.[civilizationId]?.productionProfile ?? 'balanced_growth';
      }
    }
    const aiState: AIState = (storage?.turnData?.aiState as AIState) ?? createDefaultAIState();

    // ─── Phase 1: Strategy evaluation ──────────────────────────────────
    const gameState = this.buildGameState(civilizationId);
    const newStrategy = AIStrategySelector.evaluateStrategy(civ, gameState, aiState);
    if (newStrategy !== aiState.strategyProfile) {
      debugLog(`[AI] Strategy changed: ${aiState.strategyProfile} -> ${newStrategy} for civ ${civilizationId}`);
      this.gameEngine.log('ai', `Strategy change — ${civ.name}: ${aiState.strategyProfile} → ${newStrategy}`, { civilizationId, action: 'strategy', from: aiState.strategyProfile, to: newStrategy });
      aiState.strategyProfile = newStrategy;
      aiState.lastStrategyEvaluation = roundNumber;
    }

    // ─── Phase 2: Technology research ──────────────────────────────────
    const researchUnlocked = typeof this.gameEngine.isResearchUnlocked === 'function'
      ? this.gameEngine.isResearchUnlocked()
      : true;
    if (!civ.currentResearch && researchUnlocked) {
      // selectResearch returns the chosen techId (string) or null.
      const techChoice = AIResearch.selectResearch(civ, resolveAICivStrategy(civ, aiState), gameState);
      if (techChoice) {
        this.gameEngine.log('ai', `Research — ${civ.name} selects ${techChoice} (${aiState.strategyProfile})`, { civilizationId, action: 'research', tech: techChoice, strategy: aiState.strategyProfile });
        debugLog(`[AI] Research selected: ${techChoice}`);
        aiState.researchPriority = { techId: techChoice, score: 0, reason: 'strategy' };
        // Use GameEngine's setResearch to properly set the tech
        if (typeof this.gameEngine.setResearch === 'function') {
          this.gameEngine.setResearch(civilizationId, techChoice);
        }
      }
    }

    // ─── Phase 2b: Government upgrade ───────────────────────────────
    // Evaluate the best government for the civ's situation and start a
    // revolution only when it is meaningfully better than the current one.
    // (No-op while already in anarchy / revolting.)
    if (this.gameEngine.governmentManager) {
      const govManager = this.gameEngine.governmentManager;
      if (!govManager.isInRevolution(civ)) {
        const bestGov = govManager.evaluateGovernmentForCiv(civ);
        if (bestGov) {
          debugLog(`[AI] ${civ.name} adopts ${bestGov} government (revolution)`);
          this.gameEngine.startRevolution(civilizationId, bestGov);
        }
      }
    }

    // ─── Phase 2c: AI Diplomacy ─────────────────────────────────────
    if (this.gameEngine.diplomacyManager) {
      this.gameEngine.diplomacyManager.processAIDiplomacy(civilizationId);
    }

    // ─── Phase 2d: Final war — nothing left to fight, pick the next one ──
    // Runs BEFORE the aggression read so the freshly declared war is visible
    // to the offensive plan, the army groups and the invasion mission below.
    this.maybeDeclareFinalWar(civ, storage, roundNumber);

    // ─── Phase 3: Situational aggression + offensive plan ─────────────
    const aggressionState = this.getAggressionState(civilizationId, storage, roundNumber);
    if (aggressionState.posture === 'aggressive') {
      debugLog(`[AI] ${civ.name} aggressive (score ${aggressionState.score}) — ${aggressionState.reasons.join(', ')}`);
      this.gameEngine.log?.('ai', `Aggression — ${civ.name} (score ${aggressionState.score})`, {
        civilizationId, action: 'aggression', score: aggressionState.score, reasons: aggressionState.reasons,
      });
    }

    this.updateOffensivePlan(civilizationId, storage, roundNumber);

    // Island colonization: keep the ferry-a-settler mission up to date.
    this.updateColonyMission(civ, storage);

    // Naval invasion: ferry a combat unit to an enemy city we cannot walk to.
    this.updateInvasionMission(civ, storage);

    // A committed, aggressive civ declares war on its chosen bulk target —
    // this is the "rush": war is started deliberately instead of waiting for
    // first contact, and the bulk army then presses the city.
    if (aggressionState.posture === 'aggressive' && this.gameEngine.diplomacyManager) {
      const plan = storage?.turnData?.offensivePlan as { targetCivId?: number } | undefined | null;
      const targetCivId = plan?.targetCivId;
      // Barbarians are always hostile but have no diplomacy relation — never
      // "declare war" on them (a no-op); just attack.
      if (typeof targetCivId === 'number' && targetCivId !== civilizationId && targetCivId !== BARBARIAN_CIV_ID) {
        const dm = this.gameEngine.diplomacyManager;
        // Never start a war the AI cannot prosecute. An AI-vs-AI run produced 17
        // declarations and 3 attacks: the Huns declared war on Russia from
        // another continent, mobilised nothing, and the war simply sat there
        // burning the treasury via upkeep. A war needs a reachable target.
        const canReachTarget = this.hasReachableEnemyTarget(civilizationId, {
          col: this.civCentroid(civilizationId).col,
          row: this.civCentroid(civilizationId).row,
        } as Unit, targetCivId);
        if (!canReachTarget) {
          debugLog(`[AI] ${civ.name} skips war on civ ${targetCivId} — no reachable target`);
          this.gameEngine.log?.('ai', `War declaration skipped — ${civ.name} cannot reach civ ${targetCivId}`, {
            civilizationId, action: 'declare_war_skipped', target: targetCivId, reason: 'no_reachable_target',
          });
        } else if (
          !dm.isAtWar(civilizationId, targetCivId) &&
          // A signed peace has to have had time to become a habit. The
          // diplomacy policy already imposes this 8-round cooldown
          // (`mayDeclareWar` → "peace is too young to abandon"); without it
          // here the military side re-declared the moment the enemy sued for
          // peace, and a 56-round test game logged 7 war/peace flips between
          // two civs that never took a city off each other.
          !this.peaceTooYoungToBreak(dm, civilizationId, targetCivId, roundNumber)
        ) {
          debugLog(`[AI] ${civ.name} declares war (aggression ${aggressionState.score}) — rush against civ ${targetCivId}`);
          this.gameEngine.log?.('ai', `War declaration — ${civ.name} rushes civ ${targetCivId}`, {
            civilizationId, action: 'declare_war', target: targetCivId, score: aggressionState.score,
          });
          dm.declareWar(civilizationId, targetCivId);
        }
      }
    }

    // Build army groups from known enemy positions. Army groups are LAND
    // formations: a target on another landmass (or behind water) is dropped
    // here — the navy/colony pipeline handles those — so a group can never
    // march to the coast and stall.
    //
    // A committed offensive plan is the army's SINGLE objective. Forming groups
    // from raw intel instead split the force: groups marched to stale sightings
    // while the plan assigned only a handful of stragglers, so a 17-unit army
    // gathered in waves and rarely pressed the siege (the "huge army but no
    // attacks" run). With a plan, every group marches on ITS target.
    const combatUnits = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId === civilizationId && this.isCombatUnit(u)
    );
    const reserveIds = this.getCityDefenseReserveIds(civilizationId, combatUnits);
    const offensiveUnits = combatUnits.filter((unit: Unit) => !reserveIds.has(unit.id));
    const plan = storage?.turnData?.offensivePlan as AIState['offensivePlan'] | null | undefined;
    const planGroupTargets = plan?.target && plan.reachableBy !== 'sea'
      ? [{
          col: plan.target.col,
          row: plan.target.row,
          type: (plan.targetType ?? 'city') as 'city' | 'unit',
          estimatedStrength: plan.targetDefense ?? 8,
        }]
      : null;
    const targets = planGroupTargets ?? this.getKnownEnemyTargets(civilizationId, storage)
      .filter((t) => this.engineTileReachableByLand(civilizationId, t.col, t.row));

    if (offensiveUnits.length >= 3 && targets.length > 0) {
      const distFn = (c1: number, r1: number, c2: number, r2: number) =>
        this.gameEngine.squareGrid?.squareDistance(c1, r1, c2, r2) ?? Infinity;

      aiState.armyGroups = AICoordinator.formArmyGroups(
        offensiveUnits, targets, aiState.armyGroups, distFn, {
          // Rally points must be passable land the group can walk to.
          isPassable: (col, row) => this.gameEngine.isTilePassable(col, row),
          // A unit on another landmass cannot join a land march.
          isReachable: (unit, target) => this.areLandConnected(unit.col, unit.row, target.col, target.row),
          // Drop groups whose target was captured/killed.
          isTargetValid: (target) => {
            const enemyUnit = this.gameEngine.getUnitAt(target.col, target.row);
            if (enemyUnit && enemyUnit.civilizationId !== civilizationId) return true;
            const enemyCity = this.gameEngine.getCityAt(target.col, target.row);
            return !!enemyCity && enemyCity.civilizationId !== civilizationId;
          },
          roundNumber,
        }
      );
      AICoordinator.updateGroupStatuses(
        aiState.armyGroups, offensiveUnits, distFn, roundNumber
      );
    } else if (aiState.armyGroups.length > 0) {
      // Do not keep stale groups when all available combat units are needed
      // for city defense.
      aiState.armyGroups = [];
    }

    // Save updated state back
    if (storage?.turnData) {
      storage.turnData.aiState = aiState;
    }

    // ─── Phase 3b: Building analysis ──────────────────────────────────
    // Fed the groups formed just above, so the auditor can tell whether a
    // barracks or a harbour belongs to a city the army is actually using.
    this.runBuildingAnalysis(civ, aiState.armyGroups);

    // ─── Phase 4: Process units ────────────────────────────────────────
    // Fortified units keep zero movement and sit out the turn (a garrison
    // inside a city is not even drawn on the map, so calling it up would be
    // noise). Release the ones that are no longer garrisons — a unit parked at
    // its own city stays entrenched, anything else is unfortified so it can act
    // again (unfortifying hands its movement back).
    for (const unit of this.gameEngine.units) {
      if (unit.civilizationId !== civilizationId) continue;
      if (!unit.isFortified || unit.isDefeated || unit.embarkedOn) continue;
      const isGarrison =
        this.isCombatUnit(unit) &&
        this.isAtOrAdjacentToFriendlyCity(unit) &&
        this.shouldKeepGarrisonFortified(unit, storage);
      if (isGarrison) continue;
      this.gameEngine.unfortifyUnit(unit.id);
    }

    const aiUnits = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId === civilizationId && (u.movesRemaining || 0) > 0 && !u.embarkedOn,
    );
    debugLog(`[AI] Found ${aiUnits.length} units with moves remaining for civilization ${civilizationId}`);

    for (const unit of aiUnits) {
      // If the game was paused mid-AI-turn, stop processing further units.
      if (this.gameEngine.isPaused) {
        console.warn(`[AI] runAITurn: Game paused mid-turn — stopping AI for civ ${civilizationId}`);
        return;
      }

      // Let the previous unit's visible movement/animation finish before acting
      // with this one, so the player can actually see what the AI is doing.
      // A no-op when animations are disabled and bounded so it can never stall
      // (or time out) the AI turn.
      await awaitPendingAnimations();

      // Check if any sleeping/fortified human units spotted enemies.
      // If so, pause the AI turn to alert the player.
      if (this.checkSleepingUnitsForEnemies()) {
        debugLog(`[AI] Pausing AI turn — sleeping unit spotted enemy`);
        // Give a player time to see the danger — but in a self-playing
        // scenario there is nobody to see it and the pause is pure dead time.
        if (!isAutoScenario(this.gameEngine.gameSettings?.mapType)) {
          await this.gameEngine.sleep(1500);
        }
        // Resume after brief pause — player can react on their turn
      }

      // Skip units that no longer exist (died in combat, disbanded for upkeep,
      // or consumed by founding a city) — prevents the "Skip: Unit not found"
      // warning spam and wasted processing on ghost units.
      if (!this.gameEngine.units.includes(unit)) {
        continue;
      }

      debugLog(`[AI] Processing unit ${unit.id} (${unit.type}) at (${unit.col},${unit.row}) with ${unit.movesRemaining} moves remaining`);

      // ── Oscillation detection: punish back-and-forth movement ──
      if (!unit.positionHistory) {
        unit.positionHistory = [];
      }

      // Only record position changes — a stuck unit (can't move) should not
      // accumulate the same position and trigger oscillation detection.
      const posHistory = unit.positionHistory;
      const currentPosTuple: [number, number] = [unit.col, unit.row];
      const currentPosKey = `${unit.col},${unit.row}`;
      const lastPos = posHistory.length > 0 ? posHistory[posHistory.length - 1] : null;
      if (!lastPos || lastPos[0] !== unit.col || lastPos[1] !== unit.row) {
        posHistory.push(currentPosTuple);
        if (posHistory.length > OSCILLATION_WINDOW) {
          posHistory.shift();
        }
      }

      // Single-pass frequency count with early exit
      const posCounts: Record<string, number> = {};
      let isOscillating = false;

      for (const pos of posHistory) {
        const key = `${pos[0]},${pos[1]}`;
        posCounts[key] = (posCounts[key] || 0) + 1;
        if (posCounts[key] >= OSCILLATION_THRESHOLD) {
          isOscillating = true;
          break; // Exit loop early as soon as threshold is met
        }
      }

      if (isOscillating) {
        console.warn(
          `[AI] 🔄🔄🔄 Civ: Unit ${unit.id} (${unit.type}) oscillating — visited ${currentPosKey} ${posCounts[currentPosKey]}x in last ${posHistory.length} positions, skipping`
        );
        
        this.gameEngine.log('ai', `Oscillation —   🔄🔄🔄 Civ ${civilizationId} ${unit.type}(${unit.id}) at (${unit.col},${unit.row})`, {
          civilizationId, 
          action: 'skip', 
          unitId: unit.id, 
          unitType: unit.type,
          reason: 'oscillation', 
          positions: posHistory.map(p => p.join(',')).join(' → '),
        });

        // Clear history after punishment so the unit can try fresh next turn
        posHistory.length = 0; 
        
        // Get all 8 adjacent tiles in a randomized order
        const adjacentTiles = getShuffledAdjacentTiles(unit.col, unit.row);
        let brokeLoop = false;

        for (const tile of adjacentTiles) {
          // Use your new engine method to check before moving
          if (this.gameEngine.canMoveUnit(unit.id, tile.col, tile.row)) {
            console.warn(`[AI] 🔄🔄🔄 Breaking oscillation: Attempting random move to (${tile.col}, ${tile.row})`);
            this.gameEngine.moveUnit(unit.id, tile.col, tile.row);
            brokeLoop = true;
            break; // Stop trying directions once one succeeds
          }
        }

        if (!brokeLoop) {
          console.warn(`[AI] 🔄🔄🔄 Cannot move unit ${unit.id} to ANY adjacent tile — skipping`);
          this.gameEngine.skipUnit(unit.id);
        }

        // Move to the next unit in the loop
        continue; 
      }

      // Safety: Prevent infinite loops by limiting iterations per unit
      let movementAttempts = 0;
      const MAX_MOVEMENT_ATTEMPTS = 50; // Reasonable limit for movement attempts
      let previousMoves = unit.movesRemaining;
      let stuckCounter = 0;
      const MAX_STUCK_ITERATIONS = 3; // If moves don't change for 3 iterations, unit is stuck

      // While this unit can move, pick targets and attempt actions
      while ((unit.movesRemaining || 0) > 0) {
        movementAttempts++;

        // Turn-overlap guard: if the TurnManager force-ended our turn (AI
        // timeout) and the next turn already started, STOP — otherwise we keep
        // moving units on the next player's turn (teleporting, moves reset, and
        // the stuck detector fires every turn).
        if (this.gameEngine.activePlayer !== civilizationId || this.gameEngine.isPaused) {
          debugLog(`[AI] Turn ${civilizationId} ended mid-processing — stopping unit ${unit.id}`);
          break;
        }

        // Check if unit is stuck (moves not decreasing)
        if (unit.movesRemaining === previousMoves) {
          stuckCounter++;
          if (stuckCounter >= MAX_STUCK_ITERATIONS) {
           console.warn(`[AI] ⚠️ Unit ${unit.id} stuck - moves not decreasing after ${stuckCounter} iterations, forcing skip`);
            this.gameEngine.log('ai', `Unit stalled — ${civ.name} ${unit.type}(${unit.id})`, { civilizationId, action: 'skip', unitId: unit.id, unitType: unit.type, reason: 'stuck' });
           this.gameEngine.skipUnit(unit.id);
            break;
          }
        } else {
          stuckCounter = 0; // Reset stuck counter if moves changed
        }
        previousMoves = unit.movesRemaining;

        if (movementAttempts > MAX_MOVEMENT_ATTEMPTS) {
         console.warn(`[AI] ⚠️ Unit ${unit.id} exceeded maximum movement attempts (${MAX_MOVEMENT_ATTEMPTS}), forcing skip`);
          this.gameEngine.log('ai', `Movement limit — ${civ.name} ${unit.type}(${unit.id})`, { civilizationId, action: 'skip', unitId: unit.id, unitType: unit.type, reason: 'max_movement_attempts' });
         this.gameEngine.skipUnit(unit.id);
          break;
        }

        // Diplomats negotiate instead of fighting: the moment one stands next
        // to a foreign city or unit it performs its diplomatic action rather
        // than attacking (Civ I: diplomacy is initiated on physical contact).
        // The action consumes the diplomat's moves, ending its processing.
        if (unit.type === 'diplomat') {
          const diplomatInfo = this.gameEngine.getDiplomatActions?.(unit.id);
          if (diplomatInfo) {
            this.executeAIDiplomatAction(unit, diplomatInfo);
            break;
          }
        }

        // Nuclear weapons are LAUNCHED, not marched. This branch runs before
        // any targeting so a warhead is never swept into `isCombatUnit` land
        // targeting and walked into a melee it has 0 defense for: the AI picks
        // the best key target it can see, detonates, and the unit is gone.
        // With no worthwhile target the warhead is held for next turn.
        if (unit.type === 'nuclear') {
          const strike = this.chooseNuclearStrike(unit);
          if (!strike || !this.gameEngine.detonateNuclear(unit.id, strike.col, strike.row)) {
            this.gameEngine.skipUnit(unit.id);
          }
          break;
        }

        // Settlers are never used for garrison duty. A settler standing in a
        // city may only remain there when the city or the settler itself is
        // directly threatened by an enemy; otherwise it must leave and resume
        // settlement or improvement work.
        if (unit.type === 'settler') {
          const cityHere = this.gameEngine.getCityAt?.(unit.col, unit.row);
          if (cityHere && cityHere.civilizationId === unit.civilizationId) {
            const threatened = this.isSettlerDirectlyThreatened(unit);
            if (!threatened) {
              debugLog(`[AI-SETTLER] Settler ${unit.id} leaves city ${cityHere.name} — not threatened`);
              this.gameEngine.log('ai', `Settler leaves city — ${civ.name} settler ${unit.id} departs ${cityHere.name}`, {
                civilizationId, action: 'settler_leaves_city', unitId: unit.id, cityId: cityHere.id,
              });
              unit._aiSettlement = null;
              unit._aiWorksTarget = null;
              unit._aiCommittedTarget = null;
              const stepOut = this.findAffordableStep(unit, {
                col: cityHere.col + (unit.col <= cityHere.col ? 1 : -1),
                row: cityHere.row,
              });
              if (stepOut) {
                const r = this.gameEngine.moveUnit(unit.id, stepOut.col, stepOut.row);
                if (r?.success) {
                  debugLog(`[AI-SETTLER] Settler ${unit.id} moved out of city to (${stepOut.col},${stepOut.row})`);
                  break;
                }
              }
            }
          }
        }

        // Civ1: an AI settler founds a city, improves its tile, or explores.
        // The settlement search runs here (cached for chooseAITarget below) so
        // founding takes priority; without a settlement spot the settler builds
        // a road/irrigation/mine/railroad on its current tile instead of
        // wandering. Multi-turn construction continues automatically each turn
        // (advanceUnitWork), so starting is enough.
        //
        // A settler RESERVED for a colony mission is exempt. It must walk to
        // the coast and wait for the ferry, and this block runs the founding /
        // join / improve search first — so without the exemption the reserved
        // settler either founded a city on its home island or joined one, and
        // the colony rendezvous in chooseAITarget (which only runs when none of
        // those fired) was never reached. A 330-civ-turn naval run planned 28
        // colony missions and completed 0: every mission sat at stage 'gather'
        // with its settler frozen on the capital tile.
        const colonyMission = unit.type === 'settler'
          ? this.getColonyMission(storage)
          : null;
        const reservedForColony = !!colonyMission
          && colonyMission.settlerId === unit.id
          && !unit.embarkedOn;

        // ── Forgive stale blocked targets ─────────────────────────────────
        // A settler writes a site off when it cannot path to it once. Nothing
        // ever took it back off, so one unlucky blockage — a unit in the way, a
        // road, a city founded on the spot — cost it that piece of ground
        // permanently. Measured on a pinned 4-civ game this was 93 idle settler
        // turns on its own.
        if (unit.type === 'settler' && unit._blockedSettlementTargets?.size) {
          const patience = (unit._blockedSettlementPatience ?? 0) + 1;
          if (patience >= BLOCKED_TARGET_PATIENCE) {
            debugLog(`[AI-SETTLER] Clearing ${unit._blockedSettlementTargets.size} stale blocked target(s) after ${patience} turns`);
            unit._blockedSettlementTargets = new Set<string>();
            unit._blockedSettlementPatience = 0;
            delete unit._lastSettlementTarget;
            if (unit._positionHistory) unit._positionHistory.length = 0;
          } else {
            unit._blockedSettlementPatience = patience;
          }
        }
        if (unit.type === 'settler' && !unit.workTarget && !reservedForColony) {
          const civStrategy = resolveAICivStrategy(civ, aiState);
          let worksTarget: { col: number; row: number } | null = null;

          // From city size 6+, irrigation of surrounding tiles is the top
          // priority for settlers — unless the city is under direct threat
          // or being attacked. This runs BEFORE any other work.
          const irrigationTarget = this.findIrrigationTargetForMatureCity(unit);
          if (irrigationTarget) {
            worksTarget = irrigationTarget;
          } else if (this.prefersInfrastructureOverExpansion(civ.id, civStrategy)
            // Size 6 and up: the city's own fields come first, whatever the
            // civ's strategy or city count says. This is the irrigation
            // mandate — see findInfrastructureWorksTarget for the two threat
            // conditions that override it.
            || this.hasMatureCity(civ.id)
            // …and ANY city whose workable area is still less than half
            // improved: raw tiles cannot pay for the citizens standing on
            // them, so build-out beats founding. Without this branch a settler
            // founded a city roughly every time one was produced (10 cities
            // founded vs 4 improvements in a 200-round test game), and the
            // empire grew wider than it ever grew up.
            || this.citiesNeedBuildOut(civ.id)) {
            // Late-game infrastructure mode (see LATE_INFRA_PROFILES): a civ that
            // already sprawled past LATE_INFRA_CITY_THRESHOLD cities stops
            // treating "found another city" as the default answer. Its settler
            // first works the fields of the cities it already owns — roads and
            // irrigation are permanent income and growth, while a 7th city only
            // adds upkeep — and is released to settle again once every own
            // city's area is half improved. This runs BEFORE the settlement
            // search, so founding genuinely takes second place.
            worksTarget = this.findInfrastructureWorksTarget(unit);
          }

          if (worksTarget) {
            // Standing on the tile it was sent to: build here rather than walk.
            if (worksTarget.col === unit.col && worksTarget.row === unit.row) {
              const improvement = this.chooseImprovementForSettler(unit, true);
              if (improvement && this.gameEngine.buildImprovement(unit.id, improvement)) {
                debugLog(`[AI-INFRA] ${civ.name} settler ${unit.id} builds ${improvement} at (${unit.col},${unit.row})`);
                this.gameEngine.log('ai', `Settler improves — ${civ.name} builds ${improvement} at (${unit.col},${unit.row})`, {
                  civilizationId, action: 'improve', unitId: unit.id, unitType: 'settler', improvement,
                });
                break; // the settler worked its turn
              }
              // Standing on the tile it was sent to and unable to start work:
              // without this line the settler just sat there and the reason was
              // invisible in every log we have.
              this.gameEngine.log('ai', `Settler cannot work tile — ${civ.name} settler ${unit.id} at (${unit.col},${unit.row})`, {
                civilizationId, action: 'works_fail', unitId: unit.id, unitType: 'settler',
                reason: improvement ? 'build_failed' : ('no_improvement|wt=' + (unit.workTarget ?? '-') + '|imp=' + ((tile) => tile?.improvement ?? '-')(this.gameEngine.getTileAt(unit.col, unit.row))),
              });
            }
            unit._aiWorksTarget = worksTarget;
            // A settlement target from an earlier turn must not outrank the
            // works tile this turn — chooseAITarget reads it first.
            unit._aiSettlement = null;
            // Otherwise fall through to chooseAITarget, which walks it there.
          } else {
            // No works target this turn: drop yesterday's. Leaving a stale
            // `_aiWorksTarget` pointing at a tile the SAME settler had just
            // finished irrigating made `worksArrival` fire on an already
            // improved tile, where nothing can be built — the settler skipped
            // its turn, kept the stale target, and repeated it (the bulk of the
            // `works_fail` / `no_improvement` pile in the test logs).
            unit._aiWorksTarget = null;
            // Civ1: expansion FIRST — a settler founds a new city whenever a
            // valid spot exists, so empires actually grow. Previously the join
            // check ran first and every produced settler (spawned on the capital
            // tile) merged back into the capital, leaving civs at 1 city forever.
            let settlement: { col: number; row: number; score: number } | null = null;
            try {
              settlement = this.findBestSettlementForSettler(unit, civStrategy);
            } catch (error) {
              console.error('[AI-SETTLER] Error in settlement search:', error);
            }
            if (!this.gameEngine.units.includes(unit)) break; // consumed by founding
            unit._aiSettlement = settlement;

            if (!settlement) {
              // No founding spot worth walking to. Late game that means public
              // works, not fusion: while the civ still has improvements to build
              // on its worked tiles (roads/irrigation/railroads), keep the
              // settler working and only join a city as a last resort. Joining
              // first used to consume every late-game settler for +1 population
              // the moment it spawned on a city tile, so empires never paved or
              // irrigated their land.
              const wantsWorks = this.wantsPublicWorks(civ.id);
              const improvement = this.chooseImprovementForSettler(unit);
              if (improvement) {
                const started = this.gameEngine.buildImprovement(unit.id, improvement);
                if (started) {
                  debugLog(`[AI-SETTLER] ${civ.name} settler ${unit.id} builds ${improvement} at (${unit.col},${unit.row})`);
                  this.gameEngine.log('ai', `Settler improves — ${civ.name} builds ${improvement} at (${unit.col},${unit.row})`, {
                  civilizationId, action: 'improve', unitId: unit.id, unitType: 'settler', improvement,
                });
                  break; // the settler worked its turn
                }
              }
              worksTarget = wantsWorks ? this.findTradeRoadTarget(unit) : null;
              if (!worksTarget && this.gameEngine.canJoinCity?.(unit.id)) {
                const joined = this.gameEngine.foundCityWithSettler(unit.id);
                if (joined) {
                  this.gameEngine.log('ai', `Settler joins city — ${civ.name} at (${unit.col},${unit.row})`, {
                    civilizationId, action: 'join_city', unitId: unit.id, unitType: unit.type,
                  });
                  break;
                }
              }
              // Otherwise fall through to chooseAITarget, which walks the settler
              // to the works target it just found.
              unit._aiWorksTarget = worksTarget;

              if (!worksTarget) {
                // ── The bottom of the ladder ──────────────────────────────
                // Nothing to found, nothing to build, nowhere to join. Before
                // this the settler simply skipped the turn — and the next, and
                // the next. Measured on a pinned 4-civ game, 94 % of settler
                // turns ended in exactly that state and no settler alive at
                // turn 120 had founded anything.
                //
                // A settler with no future is worth nothing, so each step below
                // is strictly worse than the one above it, down to marching at
                // the map for no reason at all — which is still movement, still
                // a settler off the capital, and still a chance that the map
                // changes underneath it.
                const lastResort = this.settlerLastResort(unit, civ);
                if (lastResort === 'acted') break;
                if (lastResort) {
                  // Shaped like a settlement candidate so the existing
                  // "walk to it, found on arrival" path picks it up unchanged.
                  unit._aiSettlement = { ...lastResort, score: 0 };
                }
              }
            }
          }
        }

        // Civ1: a unit stacked on the same tile as an enemy attacks it directly.
        // The engine's moveUnit handles same-tile combat, but AI target selection
        // only scans neighbouring tiles — detect the stacked enemy here.
        const stackedEnemy = this.gameEngine.units.find(u => u.col === unit.col && u.row === unit.row
          && u.id !== unit.id && u.civilizationId !== unit.civilizationId && !u.isDefeated);
        if (stackedEnemy) {
          debugLog(`[AI] Unit ${unit.id} attacks stacked enemy ${stackedEnemy.type} on the same tile`);
          this.gameEngine.log('ai', `Attack — ${civ.name} ${unit.type}(${unit.id}) attacks enemy ${stackedEnemy.type} at (${unit.col},${unit.row})`, { civilizationId, action: 'attack', unitId: unit.id, unitType: unit.type, targetType: stackedEnemy.type, targetCol: unit.col, targetRow: unit.row });
          this.gameEngine.combatUnit(unit, stackedEnemy);
          if (!this.gameEngine.units.includes(unit)) break; // attacker fell
          break; // combatUnit zeroes the attacker's moves
        }

        // Colony mission: a ferry alongside its settler boards it; a loaded
        // ferry puts the settler ashore on the target island.
        if (unit.type === 'ferry' && colonyMission?.ferryId === unit.id) {
          if (this.tryColonyFerryAction(unit, colonyMission, storage)) break;
        }

        // Invasion mission: the ferry boards the troop, or lands it on the far
        // shore. Both are one-shot actions; anything else is plain sailing.
        const invasionMission = this.getInvasionMission(storage);
        if (unit.type === 'ferry' && invasionMission?.ferryId === unit.id) {
          if (this.tryInvasionFerryAction(unit, invasionMission, storage)) break;
        }

        // Fisher Boat: deploy the net the moment it reaches a fish tile; with
        // an active route the engine's state machine owns its movement.
        if (unit.type === 'fisher_boat') {
          if (unit.fishingRoute) {
            // The boat is a stationary generator from here on: its route is
            // advanced by advanceFishing() at turn start and GoTo execution
            // ignores the sleep flag. Sleeping it once keeps it out of the
            // active queue — `skipUnit` here re-queued it every single turn
            // (537 consecutive skips for one boat in a profiled session).
            this.gameEngine.unitSleep(unit.id);
            break;
          }
          if (this.gameEngine.canDeployFishingNet?.(unit.id)) {
            const deployed = this.gameEngine.deployFishingNet(unit.id);
            if (deployed) {
              debugLog(`[AI-FISHER] ${civ.name} fisher ${unit.id} deploys net at (${unit.col},${unit.row})`);
              this.gameEngine.log('ai', `Fishing net — ${civ.name} deploys at (${unit.col},${unit.row})`, { civilizationId, action: 'fishing_net', unitId: unit.id, unitType: unit.type, targetCol: unit.col, targetRow: unit.row });
              break;
            }
          }
        }

        const target = this.chooseAITarget(unit);
        if (!target) {
          // No valid target. A combat unit parked at/next to a friendly city is
          // defending it — entrench (fortify) for the +50% defense bonus
          // (Civ1: garrisons fortify instead of standing idle).
          if (this.shouldFortifyForDefense(unit as Unit)) {
            debugLog(`[AI] No target — ${unit.type} fortifies to defend the city`);
            this.gameEngine.log('ai', `Fortify — ${civ.name} ${unit.type}(${unit.id}) defends city`, { civilizationId, action: 'fortify', unitId: unit.id, unitType: unit.type });
            this.gameEngine.unitFortify(unit.id);
            break;
          }
          debugLog(`[AI] No target found for unit ${unit.id}, skipping`);
          this.gameEngine.log('ai', `No target — ${civ.name} ${unit.type}(${unit.id}) skipped at (${unit.col},${unit.row})`, { civilizationId, action: 'no_target', unitId: unit.id, unitType: unit.type, reason: 'no_target' });
          this.gameEngine.skipUnit(unit.id);
          break;
        }

        // Highlight chosen target
        this.highlightAITarget(target.col, target.row);

        // Special handling for settlers: found city when at target location.
        // MUST run before the generic "already at target" skip below — that
        // block (identical condition) used to shadow this one, turning a
        // settler that reached its spot into a skipped, never-founding unit.
        //
        // A settler that walked here to IMPROVE a tile must not found on it.
        // That target is a field one of its own cities already works (or, for
        // margin irrigation, one it feeds), so founding there drops a city on
        // top of the empire's farmland — the exact overlap the settlement rule
        // forbids. It starts the improvement instead.
        //
        // A settler waiting for a colony ferry is NOT at a settlement site:
        // chooseAITarget returns its rendezvous (its own tile when already on
        // the coast), and treating that as "settle here" made it attempt to
        // found on the capital every turn, fail, skip, and retry — 86 times
        // for one unit in a profiled naval session, with 93 attempts and 2
        // founded cities across 200 rounds. The colony settler only founds
        // after the ferry has landed it and the mission has been cleared.
        // TRUE only when the settler is STANDING ON its works tile. Comparing
        // `_aiWorksTarget` to `target` looked equivalent — for a settler,
        // `chooseAITarget` returns `_aiWorksTarget` verbatim — but it tested
        // "do I have a works target?" rather than "have I arrived?". The
        // branch therefore fired on the very turn the target was assigned,
        // evaluated `chooseImprovementForSettler` at the settler's CURRENT
        // (mid-walk) position, found nothing there, cleared the target and
        // skipped the turn. The settler never walked to its field at all: that
        // is why settlers "sat idle" and the empire built 4–6 tile
        // improvements a game instead of dozens.
        const worksArrival = !!unit._aiWorksTarget
          && unit._aiWorksTarget.col === unit.col
          && unit._aiWorksTarget.row === unit.row
          // Already carrying an improvement → nothing to start here.
          && !this.gameEngine.getTileAt(unit.col, unit.row)?.improvement;
        if (unit.type === 'settler' && !worksArrival && !reservedForColony
            && unit.col === target.col && unit.row === target.row) {
          debugLog(`[AI-SETTLER] Settler ${unit.id} has reached settlement location (${target.col}, ${target.row}), founding city`);
          this.gameEngine.log('ai', `Settler settles — ${civ.name} founds city at (${target.col},${target.row})`, { civilizationId, action: 'settle', unitId: unit.id, unitType: unit.type, targetCol: target.col, targetRow: target.row });
          const result = this.gameEngine.foundCityWithSettler(unit.id);
          if (result) {
            debugLog(`[AI-SETTLER] City founded successfully`);
            break; // Settler consumed, end this unit's processing
          } else {
            debugLog(`[AI-SETTLER] Failed to found city, skipping settler`);
            this.gameEngine.skipUnit(unit.id);
            break;
          }
        }
        if (worksArrival) {
          const improvement = this.chooseImprovementForSettler(unit, true);
          if (improvement && this.gameEngine.buildImprovement(unit.id, improvement)) {
            debugLog(`[AI-INFRA] ${civ.name} settler ${unit.id} builds ${improvement} at (${unit.col},${unit.row})`);
            this.gameEngine.log('ai', `Settler improves — ${civ.name} builds ${improvement} at (${unit.col},${unit.row})`, {
              civilizationId, action: 'improve', unitId: unit.id, unitType: 'settler', improvement,
            });
            break; // the settler worked its turn
          }
          this.gameEngine.log('ai', `Settler cannot work tile — ${civ.name} settler ${unit.id} at (${unit.col},${unit.row})`, {
            civilizationId, action: 'works_fail', unitId: unit.id, unitType: 'settler',
            reason: improvement ? 'build_failed' : ('no_improvement|wt=' + (unit.workTarget ?? '-') + '|imp=' + ((tile) => tile?.improvement ?? '-')(this.gameEngine.getTileAt(unit.col, unit.row))),
          });
          unit._aiWorksTarget = null;
          this.gameEngine.skipUnit(unit.id);
          break;
        }

        // Target is the unit's own tile — it's already where it wants to be
        // (e.g. a scout garrisoning a threatened city via findScoutDefenseTarget).
        // Trying to "move" there makes the AI loop pathfind-to-self forever and
        // trip the stuck detector. A combat unit garrisoned at its city
        // fortifies for the +50% defense (Civ1: garrisons entrench).
        // HOWEVER: if an enemy is adjacent, always attack first — a unit
        // should never skip its turn while a hostile stands next to it.
        if (target.col === unit.col && target.row === unit.row) {
          // Always check for adjacent enemies before skipping — two adjacent
          // enemy scouts must be able to fight rather than freeze forever.
          const adjacentEnemy = AIUtility.findNearbyEnemy(
            unit.col, unit.row, unit.civilizationId,
            (c, r) => this.gameEngine.squareGrid!.getNeighbors(c, r),
            (c, r) => this.gameEngine.getUnitAt(c, r)
          );
          if (adjacentEnemy && adjacentEnemy.civilizationId !== unit.civilizationId) {
            // Look up the full Unit object (findNearbyEnemy returns a lightweight UnitData)
            const fullEnemy = this.gameEngine.units.find(
              (u: Unit) => u.id === adjacentEnemy.id && u.civilizationId === adjacentEnemy.civilizationId,
            );
            if (!fullEnemy) break;
            const tt = this.gameEngine.getTileAt(fullEnemy.col, fullEnemy.row);
            const attackCost = Math.max(1, TERRAIN_PROPS[tt?.type ?? '']?.movement ?? 1);
            if (this.gameEngine.canUnitAffordMove(unit, attackCost)) {
              debugLog(`[AI] Unit ${unit.id} attacks adjacent enemy ${fullEnemy.type} at (${fullEnemy.col},${fullEnemy.row})`);
              this.gameEngine.log('ai', `Attack — ${civ.name} ${unit.type}(${unit.id}) attacks adjacent ${fullEnemy.type} at (${fullEnemy.col},${fullEnemy.row})`, { civilizationId, action: 'attack', unitId: unit.id, unitType: unit.type, targetType: fullEnemy.type, targetCol: fullEnemy.col, targetRow: fullEnemy.row });
              this.gameEngine.combatUnit(unit, fullEnemy);
              if (!this.gameEngine.units.includes(unit)) break; // unit defeated
              break; // combatUnit zeroes moves
            } else {
              debugLog(`[AI] Unit ${unit.id} adjacent enemy but not enough moves, skipping`);
              this.gameEngine.skipUnit(unit.id);
              break;
            }
          }

          if (this.shouldFortifyForDefense(unit as Unit)) {
            debugLog(`[AI] Unit ${unit.id} fortifies to defend the city`);
            this.gameEngine.log('ai', `Fortify — ${civ.name} ${unit.type}(${unit.id}) defends city`, { civilizationId, action: 'fortify', unitId: unit.id, unitType: unit.type });
            this.gameEngine.unitFortify(unit.id);
            break;
          }
          debugLog(`[AI] Unit ${unit.id} already at target (${target.col},${target.row}), skipping`);
          this.gameEngine.log('ai', `Already at target — ${civ.name} ${unit.type}(${unit.id}) holds (${target.col},${target.row})`, { civilizationId, action: 'hold', unitId: unit.id, unitType: unit.type, reason: 'already_at_target', targetCol: target.col, targetRow: target.row });
          this.gameEngine.skipUnit(unit.id);
          break;
        }

        // If target is adjacent, try to move or attack
        const dist = this.gameEngine.squareGrid.squareDistance(unit.col, unit.row, target.col, target.row);
        debugLog(`[AI] Target distance: ${dist} for unit ${unit.id} to (${target.col},${target.row})`);
        if (dist === 1) {
          const targetUnit = this.gameEngine.getUnitAt(target.col, target.row);
          if (targetUnit && targetUnit.civilizationId !== unit.civilizationId) {
            // Attack
            debugLog(`[AI] Unit ${unit.id} attacking unit at (${target.col},${target.row})`);
            this.gameEngine.log('ai', `Attack — ${civ.name} ${unit.type}(${unit.id}) attacks enemy ${targetUnit.type} at (${target.col},${target.row})`, { civilizationId, action: 'attack', unitId: unit.id, unitType: unit.type, targetType: targetUnit.type, targetCol: target.col, targetRow: target.row });
            // Check move cost before attempting attack
            const tt = this.gameEngine.getTileAt(target.col, target.row);
            const attackCost = Math.max(1, TERRAIN_PROPS[tt?.type ?? '']?.movement ?? 1);
            // Civ1 Minimum-1-Move: a fresh unit may always make its first move,
            // even into heavy terrain (cost > remaining points).
            if (this.gameEngine.canUnitAffordMove(unit, attackCost)) {
              this.gameEngine.combatUnit(unit, targetUnit);
            } else {
             debugLog(`[AI] Not enough moves for attack (${unit.movesRemaining} < ${attackCost}), skipping`);
              this.gameEngine.log('ai', `Attack blocked — ${civ.name} ${unit.type}(${unit.id})`, { civilizationId, action: 'skip', unitId: unit.id, unitType: unit.type, reason: 'insufficient_moves' });
             this.gameEngine.skipUnit(unit.id);
              break;
            }
          } else {
            // Move into the tile
            const tt = this.gameEngine.getTileAt(target.col, target.row);
            const moveCost = Math.max(1, TERRAIN_PROPS[tt?.type ?? '']?.movement ?? 1);
            if (this.gameEngine.canUnitAffordMove(unit, moveCost)) {
              const r = this.gameEngine.moveUnit(unit.id, target.col, target.row);
              if (!r || !r.success) {
                // A scout that cannot enter this tile should stop re-targeting
                // it forever (stuck-target guard).
                this.blacklistScoutTarget(unit, target.col, target.row);
                debugLog(`[AI] Move failed, skipping unit`);
                this.gameEngine.log('ai', `Move failed — ${civ.name} ${unit.type}(${unit.id}) to (${target.col},${target.row})`, { civilizationId, action: 'move_failed', unitId: unit.id, unitType: unit.type, reason: 'move_failed', targetCol: target.col, targetRow: target.row });
                // Settler fallback: block unreachable target and re-evaluate.
                if (unit.type === 'settler') {
                  if (this.settlerReevaluateSettlement(unit, civ.name, civilizationId, target, aiState)) break;
                }
                this.gameEngine.skipUnit(unit.id);
                break;
              }
              this.gameEngine.log('ai', `Move — ${civ.name} ${unit.type}(${unit.id}) → (${target.col},${target.row})`, { civilizationId, action: 'move', unitId: unit.id, unitType: unit.type, targetCol: target.col, targetRow: target.row });
            } else {
             debugLog(`[AI] Not enough moves for move (${unit.movesRemaining} < ${moveCost}), skipping`);
              this.gameEngine.log('ai', `Move blocked — ${civ.name} ${unit.type}(${unit.id})`, { civilizationId, action: 'skip', unitId: unit.id, unitType: unit.type, reason: 'insufficient_moves' });
              // Blacklist adjacent tile so scout doesn't retry it next turn
              this.blacklistScoutTarget(unit, target.col, target.row);
             this.gameEngine.skipUnit(unit.id);
              break;
            }
          }
        } else {
          // Pathfind towards target and take next step
          debugLog(`[AI] Pathfinding to non-adjacent target (${target.col},${target.row})`);
          const obstacles = unit.type === 'settler'
            ? this.getSettlerPathObstacles(unit.id, target)
            // Route around tiles that were previously blocked (an enemy/allied
            // unit or impassable spot that made moveUnit fail), so findPath does
            // not keep routing through the same blocker every turn.
            : (unit._blockedScoutTargets instanceof Set
                ? new Set<string>(unit._blockedScoutTargets)
                : new Set<string>());
          const path = this.pathForUnit(unit, target, obstacles);
          if (path.length > 1) {
            let next = path[1];
            debugLog(`[AI] Path found, next step to (${next.col},${next.row}), path length: ${path.length}`);
            const tt = this.gameEngine.getTileAt(next.col, next.row);
            const moveCost = Math.max(1, TERRAIN_PROPS[tt?.type ?? '']?.movement ?? 1);
            if (!this.gameEngine.canUnitAffordMove(unit, moveCost)) {
              // A* routed the first step through a tile this unit cannot afford
              // (Civ1: a unit must pay the full movement cost of the tile it
              // enters). Fall back to the best affordable neighbor instead of
              // getting permanently stuck on the first step.
              const affordable = this.findAffordableStep(unit, target);
              if (!affordable) {
               debugLog(`[AI] No affordable step for unit ${unit.id}, skipping`);
                this.gameEngine.log('ai', `No affordable step — ${civ.name} ${unit.type}(${unit.id})`, { civilizationId, action: 'skip', unitId: unit.id, unitType: unit.type, reason: 'no_affordable_step' });
                // Blacklist the target so the scout picks a different
                // destination next turn instead of retrying the same
                // unreachable one (which was the cause of the
                // "insufficient_moves" loop in late-game AI-vs-AI).
                this.blacklistScoutTarget(unit, target.col, target.row);
                // Settler fallback: block unreachable target and re-evaluate.
                if (unit.type === 'settler') {
                  if (this.settlerReevaluateSettlement(unit, civ.name, civilizationId, target, aiState)) break;
                }
               this.gameEngine.skipUnit(unit.id);
                break;
              }
              // Deviating from the A* path — the stored GoTo is no longer valid.
              this.gameEngine.roundManager?.clearUnitPath(unit.id);
              next = affordable;
            }
            const r = this.gameEngine.moveUnit(unit.id, next.col, next.row);
            if (!r || !r.success) {
              // A scout blocked on this step should not repeat it next turn.
              this.blacklistScoutTarget(unit, next.col, next.row);
              // Clear any stale GoTo path so processAutomatedMovements
              // doesn't try to walk the unit backward next turn.
              this.gameEngine.roundManager?.clearUnitPath(unit.id);

              // A blocked path step must not freeze the unit (e.g. two units
              // facing off, or a step pinned by an allied unit / impassable
              // tile). Step onto the best affordable adjacent tile toward the
              // target so it keeps moving and can route around the blocker.
              const fallbackStep = this.findAffordableStep(unit, target);
              if (fallbackStep) {
                const fb = this.gameEngine.moveUnit(unit.id, fallbackStep.col, fallbackStep.row);
                if (fb && fb.success) {
                  debugLog(`[AI] Path step blocked — fallback move to (${fallbackStep.col},${fallbackStep.row})`);
                  this.gameEngine.log('ai', `Fallback move — ${civ.name} ${unit.type}(${unit.id}) → (${fallbackStep.col},${fallbackStep.row})`, { civilizationId, action: 'move', unitId: unit.id, unitType: unit.type, targetCol: fallbackStep.col, targetRow: fallbackStep.row, reason: 'path_step_fallback' });
                  break; // made progress; re-evaluate fresh next turn
                }
              }

             debugLog(`[AI] Path step failed, skipping unit`);
              this.gameEngine.log('ai', `Path step failed — ${civ.name} ${unit.type}(${unit.id})`, { civilizationId, action: 'move_failed', unitId: unit.id, unitType: unit.type, reason: 'path_move_failed' });
              // Settler fallback: block unreachable target and re-evaluate.
              if (unit.type === 'settler') {
                if (this.settlerReevaluateSettlement(unit, civ.name, civilizationId, target, aiState)) break;
              }
             this.gameEngine.skipUnit(unit.id);
              break;
            }
            // Store the remaining GoTo path (skip start pos + just-taken step)
            // and remember the destination, so processAutomatedMovements
            // continues forward next turn instead of walking the unit back to
            // its old position. If the AI picks a NEW target next turn,
            // syncAIPath drops this stale route before registering the new one.
            this.syncAIPath(unit, target, path);
            this.gameEngine.log('ai', `Move — ${civ.name} ${unit.type}(${unit.id}) → (${next.col},${next.row}) toward (${target.col},${target.row})`, { civilizationId, action: 'move', unitId: unit.id, unitType: unit.type, targetCol: target.col, targetRow: target.row });
          } else {
            // Unreachable target — a scout should drop it and pick another.
            this.blacklistScoutTarget(unit, target.col, target.row);
            // A target with no path must not freeze the unit — step onto the
            // best affordable adjacent tile toward it so it keeps moving.
            const fallbackStep = this.findAffordableStep(unit, target);
            if (fallbackStep) {
              const fb = this.gameEngine.moveUnit(unit.id, fallbackStep.col, fallbackStep.row);
              if (fb && fb.success) {
                debugLog(`[AI] No path — fallback move to (${fallbackStep.col},${fallbackStep.row})`);
                this.gameEngine.log('ai', `Fallback move — ${civ.name} ${unit.type}(${unit.id}) → (${fallbackStep.col},${fallbackStep.row})`, { civilizationId, action: 'move', unitId: unit.id, unitType: unit.type, targetCol: fallbackStep.col, targetRow: fallbackStep.row, reason: 'no_path_fallback' });
                break;
              }
            }
           debugLog(`[AI] No path found to target, skipping unit`);
            this.gameEngine.log('ai', `No path — ${civ.name} ${unit.type}(${unit.id})`, { civilizationId, action: 'skip', unitId: unit.id, unitType: unit.type, reason: 'no_path' });
            // Settler fallback: block unreachable target and re-evaluate.
            if (unit.type === 'settler') {
              if (this.settlerReevaluateSettlement(unit, civ.name, civilizationId, target, aiState)) break;
            }
           this.gameEngine.skipUnit(unit.id);
            break;
          }
        }

        // Wait a little so moves are visible. At full speed a self-playing
        // scenario waits not at all; stepping the speed down adds one uniform
        // increment per move, which is what makes a duel watchable instead of
        // an instant blur.
        const moveDelay = this.gameEngine.getAIMoveDelay?.() ?? 0;
        if (moveDelay > 0) {
          await this.gameEngine.sleep(moveDelay);
        }
      }
      debugLog(`[AI] Finished processing unit ${unit.id}, final moves remaining: ${unit.movesRemaining}`);
    }

    debugLog(`[AI] Finished all units for civilization ${civilizationId}`);
    // Emit event to clear highlights (UI decides how to handle)
    if (this.gameEngine.onStateChange) {
      this.gameEngine.onStateChange('AI_CLEAR_HIGHLIGHTS', { civilizationId });
    }

    // Process auto-production for AI cities
    debugLog(`[AI] Processing auto-production for civilization ${civilizationId}`);
    this.gameEngine.autoProduction.processAutoProductionForCivilization(civilizationId);

    // Signal AI finished (for UI updates)
    debugLog(`[AI] AI turn completed for civilization ${civilizationId}`);
    if (this.gameEngine.onStateChange) {
      this.gameEngine.onStateChange('AI_FINISHED', { civilizationId });
    }

    // Auto scenarios skip every pacing sleep, which left the whole turn chain
    // running as promise microtasks: the phase/turn handoff resolves
    // immediately, so timers, canvas rendering and the game-log fetch starved
    // and the browser locked up at 100% CPU (tens of thousands of rounds, no
    // repaint, CDP unresponsive). Yield one macrotask per AI turn so the event
    // loop — and with it the UI — keeps running. The timeout is real but
    // tiny; the browser clamps it to a few ms, which still plays hundreds of
    // turns per second in spectator mode.
    if (isAutoScenario(this.gameEngine.gameSettings?.mapType)) {
      await this.gameEngine.sleep(0);
    }

    // RoundManager now responsible for evaluating end-of-turn and timeouts
  }

  /**
   * The AI's building phase: score every building, then sell what has stopped
   * earning its keep — including, if the treasury is short, buildings sold to
   * raise money for a specific plan (public works, an army, a bribe).
   *
   * Two different pressures produce a sale here:
   *
   *  1. **Passive.** The cost/usage equation says a building does nothing for
   *     this city (an SDI Defense with no rival atomic capability; a Factory,
   *     whose declared `production` the engine never reads) or costs more than
   *     it earns at the civ's current tax rate. It is dead weight.
   *
   *  2. **Forced.** The civ has a plan it wants to pay for — settlers for a
   *     city's roads and irrigation, units for an army, gold to bribe an enemy
   *     unit — and cannot afford it. `AICoordinator.planBuildingFunding` turns
   *     that shortfall into a list of buildings to liquidate, cheapest loss
   *     first. The hard rule is that only a building that is not paying its own
   *     way may be sold: raising money by giving up income is a loss on both
   *     sides of the trade.
   *
   * The analyzer owns the scoring and the one-sale-per-city-per-turn rule; this
   * gathers the situation, executes the plan and reports it.
   */
  private runBuildingAnalysis(civ: Civilization, armyGroups: ArmyGroup[] = []): void {
    if (civ.isHuman) return;
    const engine = this.gameEngine;
    const cities = engine.cities ?? [];
    const units = engine.units ?? [];
    const map = engine.map;
    if (!map) return;
    if (cities.every(c => c.civilizationId !== civ.id)) return;

    const ownCities = cities.filter(c => c.civilizationId === civ.id);
    if (ownCities.length === 0) return;

    const reports = new Map<string, ReturnType<typeof analyzeCityBuildings>>();
    for (const city of ownCities) {
      reports.set(
        city.id,
        analyzeCityBuildings(city, civ, units, cities, map, armyGroups, engine.civilizations ?? []),
      );
    }

    const soldThisTurn = new Set<string>();
    const executeSale = (cityId: string, buildingType: string, why: string, detail: Record<string, unknown>) => {
      const city = ownCities.find(c => c.id === cityId);
      if (!city) return false;
      if (soldThisTurn.has(cityId)) return false;
      const refund = Math.floor((BUILDING_PROPERTIES[buildingType]?.cost ?? 0) / 2);
      // `force` is required: sellBuilding refuses any civ that is not human, and
      // the AI never is. Without it every sale fails with "Not a human player"
      // and the audit silently does nothing.
      const result = engine.sellBuilding(cityId, buildingType, { force: true });
      if (!result.success) return false;

      soldThisTurn.add(cityId);
      // Keep the sale on record so production does not immediately rebuild it —
      // otherwise the audit becomes build → sell → build every turn.
      rememberBuildingSale(engine, civ.id, buildingType);
      debugLog(`[AI] Sold ${buildingType} in ${city.name} — ${why}`);
      engine.log('ai', `Building sold — ${civ.name} sells ${buildingType} in ${city.name}`, {
        civilizationId: civ.id,
        action: 'building_sold',
        cityId,
        buildingType,
        reason: why,
        refund,
        ...detail,
      });
      return true;
    };

    // ── 1. Passive audit: buildings that are simply not earning their upkeep ──
    // When maintenance costs are draining the treasury, sell ALL unprofitable
    // buildings, not just the worst one per city.
    const totalUpkeep = ownCities.reduce((sum, c) => {
      let upkeep = 0;
      for (const b of c.buildings ?? []) {
        const id = typeof b === 'string'
          ? b
          : (b as { id?: string; type?: string })?.id ?? (b as { type?: string })?.type ?? '';
        upkeep += BUILDING_PROPERTIES[id]?.maintenance ?? 0;
      }
      return sum + upkeep;
    }, 0);
    const maintenanceCrisis = totalUpkeep > 0
      && (civ.resources?.gold ?? 0) < totalUpkeep * 3;

    for (const city of ownCities) {
      const report = reports.get(city.id);
      const sellCandidates = maintenanceCrisis
        ? (report?.sellCandidates ?? [])
        : (report?.sellCandidates ? [report.sellCandidates[0]] : []);
      for (const worst of sellCandidates) {
        if (!worst) continue;
        const economics = report?.economics.find(e => e.buildingType === worst.buildingType);
        executeSale(city.id, worst.buildingType, worst.reasons.join(' ') || 'unprofitable', {
          score: worst.score,
          verdict: economics?.verdict,
          netPerTurn: economics?.netPerTurn,
          mode: maintenanceCrisis ? 'maintenance_crisis' : 'passive',
        });
      }
    }

    // ── 2. Forced liquidation to fund a plan ────────────────────────────────
    const funding = this.planFundingForCiv(civ, ownCities, reports, armyGroups, soldThisTurn);
    if (funding) {
      debugLog(
        `[AI] Funding plan for civ ${civ.id}: need ${Math.round(funding.totalNeeded)} gold, `
        + `have ${Math.round(funding.available)}, short ${Math.round(funding.shortfall)} — `
        + funding.reasons.join('; '),
      );
      for (const sale of funding.sales) {
        executeSale(sale.cityId, sale.buildingType, `funding: ${sale.reason}`, {
          netPerTurn: sale.netPerTurn,
          verdict: sale.verdict,
          mode: 'forced',
        });
      }
    }
  }

  /**
   * Cities this civ's army is currently relying on, and so must not be
   * stripped to pay a bill: any city actually under threat, and any city an
   * army group is staging from.
   */
  private citiesHoldingTheArmy(
    civilizationId: number,
    armyGroups: ArmyGroup[],
    atWar: boolean,
  ): Set<string> {
    const staging: string[] = [];
    const garrisons: string[] = [];
    const grid = this.gameEngine.squareGrid;
    if (!grid) return new Set<string>();

    // A group's rally point IS its staging base: the city it marches from is
    // the one holding the army.
    for (const group of armyGroups) {
      const rally = group.rallyPoint;
      for (const city of this.gameEngine.cities ?? []) {
        if (city.civilizationId !== civilizationId) continue;
        if (grid.squareDistance(city.col, city.row, rally.col, rally.row) <= ARMY_BASE_RADIUS) {
          staging.push(city.id);
        }
      }
    }

    // Troops in or beside a city mean that city is being held, so its defences
    // are the army's defences.
    if (atWar) {
      for (const unit of this.gameEngine.units ?? []) {
        if (unit.civilizationId !== civilizationId || unit.isDefeated) continue;
        for (const city of this.gameEngine.cities ?? []) {
          if (city.civilizationId !== civilizationId) continue;
          if (grid.squareDistance(unit.col, unit.row, city.col, city.row) <= ARMY_BASE_RADIUS) {
            garrisons.push(city.id);
          }
        }
      }
    }

    const storage = this.gameEngine.getPlayerStorage?.(civilizationId);
    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    const underThreat = storage
      ? this.identifyThreatenedCities(civilizationId, storage, roundNumber).map(c => c.city.id)
      : [];

    return AICoordinator.armyDependentCities({
      cityIds: [],
      stagingCityIds: staging,
      garrisonCityIds: garrisons,
      underThreatCityIds: underThreat,
    });
  }

  /**
   * Work out what this civ wants to spend money on and, when it cannot afford
   * it, what it should sell. Returns null when there is nothing to fund, so the
   * caller can stay quiet in the common case.
   *
   * Public works are priced through settlers: improvements cost worker-turns,
   * and only a settler can spend them, so the gold a city needs is the settler
   * that will do the digging.
   */
  private planFundingForCiv(
    civ: Civilization,
    ownCities: City[],
    reports: Map<string, ReturnType<typeof analyzeCityBuildings>>,
    armyGroups: ArmyGroup[],
    alreadySold: Set<string>,
  ): BuildingFundingPlan | null {
    const demands: FundingDemand[] = [];

    // ── Infrastructure: settlers to work a city's tiles ─────────────────────
    const techs = new Set<string>(civ.technologies ?? []);
    const atWar = this.gameEngine.isCivAtWar?.(civ.id) === true;
    let infrastructureGold = 0;
    for (const city of ownCities) {
      const plan = this.planInfrastructureForCity(city, civ, techs, atWar);
      if (!plan?.wantsInfrastructure) continue;
      infrastructureGold += plan.goldNeeded;
      debugLog(`[AI] Public works in ${city.name}: ${plan.deficit} tiles to improve, needs ${plan.settlersNeeded} settlers (${plan.reasons.join('; ')})`);
    }
    if (infrastructureGold > 0) {
      demands.push({
        kind: 'infrastructure',
        label: 'settlers for public works',
        goldNeeded: infrastructureGold,
        urgency: 0.6,
      });
    }

    // ── Army: the gold to keep one more unit alive this turn ───────────────
    // AIEconomicManager owns the sustainable-army policy; ask it rather than
    // re-deriving the number here.
    const sustainable = this.gameEngine.aiEconomicManager?.sustainableUnits?.(civ) ?? 0;
    const ownMilitary = (this.gameEngine.units ?? [])
      .filter(u => u.civilizationId === civ.id && this.isCombatUnit(u)).length;
    const shortfallUnits = Math.max(0, sustainable - ownMilitary);
    if (shortfallUnits > 0) {
      const unitGold = shortfallUnits * (UNIT_MAINTENANCE * 4);
      demands.push({
        kind: 'army',
        label: `${shortfallUnits} more combat unit(s) up to its sustainable army`,
        goldNeeded: unitGold,
        urgency: atWar ? 0.9 : 0.4,
      });
    }

    // What the empire spends on buildings every turn, and what it actually has
    // to spend after keeping the disband reserve out of reach. Both are needed
    // before the demand list can be closed, because they decide whether the civ
    // is living hand to mouth.
    const spendableGold = Math.max(0, (civ.resources?.gold ?? 0) - ABSOLUTE_MIN_GOLD);
    const upkeepPerTurn = ownCities.reduce((sum, c) => {
      let upkeep = 0;
      for (const b of c.buildings ?? []) {
        const id = typeof b === 'string'
          ? b
          : (b as { id?: string; type?: string })?.id ?? (b as { type?: string })?.type ?? '';
        upkeep += BUILDING_PROPERTIES[id]?.maintenance ?? 0;
      }
      return sum + upkeep;
    }, 0);
    const starvedTreasury = spendableGold < LIQUIDATION_BUDGET_GOLD
      && ownCities.length > LIQUIDATION_CITY_THRESHOLD;
    const maintenanceHeavy = upkeepPerTurn > 0 && spendableGold < upkeepPerTurn * 4;

    // ── Reserve: rebuild a treasury the upkeep bill can be paid from ────────
    // Without a purchase to fund, the demands above are empty and this civ
    // liquidates nothing however close to empty it is — yet a handful of cities
    // with a few dozen gold is an empire that cannot pay its own building upkeep
    // for the month. The shortfall here is the size of the bill it is trying to
    // get ahead of, which is exactly what the sales below are sized against.
    if (starvedTreasury && upkeepPerTurn > 0) {
      demands.push({
        kind: 'reserve',
        label: `a reserve to cover ${upkeepPerTurn} gold/turn of building upkeep`,
        goldNeeded: LIQUIDATION_RESERVE_TURNS * upkeepPerTurn,
        urgency: 0.5,
      });
    }

    // ── Maintenance crisis: upkeep is draining the treasury ────────────────
    // When building maintenance exceeds what the treasury can sustain, the AI
    // must shed buildings aggressively — not just the unprofitable ones, but
    // any building whose upkeep is bleeding the civ dry. This fires when the
    // upkeep bill alone would consume the entire spendable treasury within a
    // few turns, regardless of city count.
    if (maintenanceHeavy) {
      demands.push({
        kind: 'maintenance_crisis',
        label: `maintenance costs ${upkeepPerTurn} gold/turn exceed sustainable budget`,
        goldNeeded: upkeepPerTurn * LIQUIDATION_RESERVE_TURNS,
        urgency: 0.85,
      });
    }

    if (demands.length === 0) return null;

    // ── Candidates: buildings that are not paying for themselves ────────────
    const economicCandidates: BuildingFundingCandidate[] = [];
    for (const city of ownCities) {
      if (alreadySold.has(city.id)) continue;
      const report = reports.get(city.id);
      const economics = report?.economics ?? [];
      for (const e of economics) {
        if (!isSellableForBudget(e)) continue;
        economicCandidates.push({
          cityId: city.id,
          cityName: city.name,
          buildingType: e.buildingType,
          refund: Math.floor((BUILDING_PROPERTIES[e.buildingType]?.cost ?? 0) / 2),
          economics: e,
        });
      }
    }
    // …minus the ones the army cannot afford to lose. A liquidation that strips
    // a besieged city of its walls, or a staging base of its barracks, is how a
    // treasury shortage turns into a lost war: the refund is trivial, the
    // captured city is not.
    const candidates = AICoordinator.filterArmySafeCandidates({
      candidates: economicCandidates,
      protectedCityIds: this.citiesHoldingTheArmy(civ.id, armyGroups, atWar),
      atWar,
    });

    // How hard to liquidate. A civ at war, in deficit, or already broke is
    // raising money to settle a specific bill, and there is a whole tier of
    // buildings it has been ignoring: the ones that merely break even. Selling
    // one of those costs no income at all and still refunds half its cost, so it
    // is the cheapest gold in the game — strictly better than tearing down
    // something that is actually earning.
    //
    // `starvedTreasury` (computed above) joins them: a thin treasury over a
    // real-sized empire is the same signal even when the civ is not at war and
    // not formally in the red. `isUnderEconomicPressure` scales its reserve with
    // upkeep, so a civ whose buildings are cheap to run never trips it no matter
    // how little it holds; and a civ sitting on 40 gold is not "broke", yet
    // cannot fund a settler, a unit or a single purchase before next month's tax.
    const broke = (civ.resources?.gold ?? 0) <= 0;
    const underPressure = this.gameEngine.aiEconomicManager?.isUnderEconomicPressure?.(civ) === true;
    const aggression: BudgetAggression = (atWar || underPressure || broke || starvedTreasury || maintenanceHeavy)
      ? 'aggressive'
      : 'normal';

    return AICoordinator.planBuildingFunding({
      demands,
      // Keep the absolute reserve out of reach: a civ that funds its plans down
      // to zero is a civ that gets its units disbanded next turn.
      budget: spendableGold,
      candidates,
      aggression,
      upkeepPerTurn,
      reserveTurns: starvedTreasury ? LIQUIDATION_RESERVE_TURNS : 1,
    });
  }

  /**
   * How much public work this city still wants, or null when it needs none.
   * Threat is measured from the same army-group picture the building audit
   * uses: a settler walking into a raider is not a build programme.
   */
  private planInfrastructureForCity(
    city: City,
    civ: Civilization,
    techs: ReadonlySet<string>,
    atWar: boolean,
  ): InfrastructureDemand | null {
    const engine = this.gameEngine;
    const grid = engine.squareGrid;
    const map = engine.map;
    if (!grid || !map) return null;

    const storage = engine.getPlayerStorage?.(civ.id);
    const aiState = storage?.turnData?.aiState as AIState | undefined;
    const strategy = resolveAICivStrategy(civ, aiState);
    const balance = engine.economicManager?.cityFoodBalance?.(city, civ);

    let raidersNearby = 0;
    for (const unit of engine.units ?? []) {
      if (unit.civilizationId === civ.id || unit.isDefeated) continue;
      if (grid.squareDistance(unit.col, unit.row, city.col, city.row) <= 3) raidersNearby++;
    }
    // The groups are written to `turnData.aiState.armyGroups`, not to
    // `turnData.armyGroups`; reading the latter found nothing and left every
    // city looking unassailed while it was being attacked.
    const underAssault = (aiState?.armyGroups as ArmyGroup[] | undefined)?.some(group => {
      const target = group.targetLocation;
      return grid.squareDistance(target.col, target.row, city.col, city.row) <= 1;
    }) ?? false;

    return planCityInfrastructure(city, map.tiles as unknown as InfrastructureTile[], {
      civilizationId: civ.id,
      technologies: techs,
      isFoodConstrained: (balance?.surplus ?? 0) < 1
        || strategy === 'early_expansion'
        || strategy === 'balanced_growth',
      isAtWar: atWar,
      raidersNearby,
      underAssault,
      hasIrrigationSupply: typeof engine.canSupplyIrrigation === 'function'
        ? (col, row) => engine.canSupplyIrrigation(col, row)
        : undefined,
    });
  }

  /**
   * Find the best affordable next step toward a target for a unit whose
   * remaining movement cannot cover the A* path's first step. Civ1 units can
   * only enter tiles whose movement cost they can pay, so the AI picks the
   * cheapest affordable neighbor that reduces (or best limits) the distance to
   * the target. Returns null when the unit is genuinely boxed in.
   */
  /**
   * The bottom of the settler's ladder: what to do when there is nothing worth
   * founding on, nothing worth building, and nowhere to join.
   *
   * Each step is worse than the one above, and the point is that the chain never
   * runs out — a settler turn must never end in a bare `skipUnit`. In order:
   *
   *  1. **found anyway, on a lower bar.** A mediocre site still beats a settler
   *     that stands still for the rest of the game, so the score threshold is
   *     relaxed before giving up on founding entirely.
   *  2. **join the nearest own city.** Deliberately ignoring `canJoinCity`: that
   *     check is about the join being *legal*, and a settler that cannot legally
   *     join should not therefore do nothing. If it arrives and still cannot
   *     join, the next rung catches it, so this cannot loop.
   *  3. **pave the tile it is standing on.** Cheap, always legal on land, and it
   *     turns a wasted settler into trade.
   *  4. **march at the frontier.** Movement towards unexplored ground: still a
   *     settler in hand, and new land tends to show up there.
   *
   * Returns `'acted'` when it already did the thing this turn (the caller then
   * ends the unit's turn), a tile to walk to, or null if even the frontier is
   * unreachable.
   */
  private settlerLastResort(
    unit: Unit,
    civ: Civilization,
  ): 'acted' | { col: number; row: number } | null {
    const strategy = resolveAICivStrategy(civ);

    // 1. Found on a lower bar rather than not at all.
    for (const threshold of [SETTLE_SCORE_THRESHOLD * 0.6, 1]) {
      let site: { col: number; row: number; score: number } | null = null;
      try {
        site = this.findBestSettlementForSettler(unit, strategy, 0, threshold);
      } catch (error) {
        console.error('[AI-SETTLER] Relaxed settlement search failed:', error);
      }
      if (site) {
        delete unit._lastSettlementTarget;
        unit._lastSettlementTarget = site;
        debugLog(`[AI-SETTLER] Last resort: accepting a site worth ${site.score} at (${site.col},${site.row})`);
        return { col: site.col, row: site.row };
      }
    }

    // 2. Walk to the nearest own city and join it, legal or not.
    const home = this.nearestOwnCityTile(unit);
    if (home) {
      const grid = this.gameEngine.squareGrid;
      const onTopOfIt = grid
        ? grid.squareDistance(unit.col, unit.row, home.col, home.row) <= 1
        : unit.col === home.col && unit.row === home.row;
      if (onTopOfIt) {
        // Standing on it and still not legally joinable: stop trying, or this
        // becomes a two-tile loop that never resolves.
        if (this.gameEngine.canJoinCity?.(unit.id)) {
          const joined = this.gameEngine.foundCityWithSettler(unit.id);
          if (joined) {
            this.gameEngine.log('ai', `Settler joins city — ${civ.name} at (${unit.col},${unit.row})`, {
              civilizationId: civ.id, action: 'join_city', unitId: unit.id, unitType: unit.type,
              reason: 'last_resort',
            });
            return 'acted';
          }
        }
      } else {
        debugLog(`[AI-SETTLER] Last resort: walking to own city at (${home.col},${home.row}) to join`);
        return { col: home.col, row: home.row };
      }
    }

    // 3. Pave where it stands.
    if (this.gameEngine.canBuildImprovement?.(unit.id, 'road')) {
      const started = this.gameEngine.buildImprovement(unit.id, 'road');
      if (started) {
        this.gameEngine.log('ai', `Settler improves — ${civ.name} paves (${unit.col},${unit.row})`, {
          civilizationId: civ.id, action: 'settler_improve', unitId: unit.id, improvement: 'road', reason: 'last_resort',
        });
        return 'acted';
      }
    }

    // 4. March at the frontier.
    return this.findFrontierTile(unit);
  }

  /** The own city tile closest to this unit, or null when it owns none. */
  private nearestOwnCityTile(unit: Unit): { col: number; row: number } | null {
    const grid = this.gameEngine.squareGrid;
    let best: { col: number; row: number } | null = null;
    let bestDist = Infinity;
    for (const city of this.gameEngine.cities ?? []) {
      if (city.civilizationId !== unit.civilizationId) continue;
      const d = grid
        ? grid.squareDistance(unit.col, unit.row, city.col, city.row)
        : Math.abs(unit.col - city.col) + Math.abs(unit.row - city.row);
      if (d < bestDist) {
        bestDist = d;
        best = { col: city.col, row: city.row };
      }
    }
    return best;
  }

  /**
   * The nearest piece of unexplored ground this unit can be pointed at.
   *
   * Scans outward from the settler for a land tile its civ has never seen. Used
   * as the very last rung: walking a settler towards the unknown is worth more
   * than leaving it parked, and unexplored ground is where a settler that was
   * boxed in by its own empire can still find somewhere to go.
   */
  private findFrontierTile(unit: Unit): { col: number; row: number } | null {
    const grid = this.gameEngine.squareGrid;
    if (!grid) return null;
    const explored = this.gameEngine.getPlayerStorage?.(unit.civilizationId)?.explored;
    const width = this.gameEngine.map?.width;

    for (let radius = 3; radius <= 30; radius++) {
      for (let dc = -radius; dc <= radius; dc++) {
        for (let dr = -radius; dr <= radius; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
          const col = unit.col + dc;
          const row = unit.row + dr;
          if (!grid.isValidSquare(col, row)) continue;
          const tile = this.gameEngine.getTileAt(col, row);
          const terrain = String(tile?.type ?? tile?.terrain ?? '');
          if (terrain === 'ocean' || terrain === 'sea') continue;
          if (width && explored && explored[row * width + col] === true) continue; // already known
          return { col, row };
        }
      }
    }
    return null;
  }

  /**
   * Settler fallback: when a settler cannot reach its settlement target, block
   * that target and re-evaluate the best reachable location.  If the search
   * finds a new walkable spot the settler heads there next turn; if nothing
   * better exists, it founds at the current tile (the settlement evaluator's
   * own "good enough" logic decides).  Returns true if the settler was
   * consumed (city founded), false otherwise (new target cached or no action).
   */
  private settlerReevaluateSettlement(
    unit: Unit,
    _civName: string,
    _civilizationId: number,
    unreachableTarget: { col: number; row: number },
    aiState: AIState,
  ): boolean {
    // Block the unreachable target so we don't chase it again.
    const blocked = unit._blockedSettlementTargets instanceof Set
      ? unit._blockedSettlementTargets
      : new Set<string>();
    blocked.add(`${unreachableTarget.col},${unreachableTarget.row}`);
    unit._blockedSettlementTargets = blocked;
    delete unit._lastSettlementTarget;

    debugLog(`[AI-SETTLER] Settler ${unit.id} blocked target (${unreachableTarget.col},${unreachableTarget.row}), re-evaluating`);

    // Re-run the settlement search — it will find the next best reachable
    // spot (or found at current tile if nothing is better).
    let settlement: { col: number; row: number; score: number } | null = null;
    try {
      settlement = this.findBestSettlementForSettler(
        unit,
        resolveAICivStrategy(this.gameEngine.civilizations?.[_civilizationId], aiState),
      );
    } catch (error) {
      console.error('[AI-SETTLER] Error re-evaluating settlement:', error);
    }
    if (!this.gameEngine.units.includes(unit)) return true; // consumed by founding
    unit._aiSettlement = settlement;

    // If findBestSettlementForSettler already founded at the current tile, the
    // settler is gone — signal the caller to break.
    if (!settlement && this.canFoundCityHere(unit)) {
      debugLog(`[AI-SETTLER] Settler ${unit.id} re-evaluation found no better spot — founding at current (${unit.col},${unit.row})`);
      this.gameEngine.foundCityWithSettler(unit.id);
      return true;
    }

    // If a new settlement target was picked, the main loop will move the
    // settler toward it on the next iteration.
    return false;
  }

  private findAffordableStep(
    unit: { col: number; row: number; movesRemaining?: number; civilizationId?: number; type?: string },
    target: { col: number; row: number },
  ): { col: number; row: number } | null {
    const grid = this.gameEngine.squareGrid;
    const movesLeft = unit.movesRemaining ?? 0;
    if (!grid || !grid.getNeighbors) return null;
    const isNaval = this.isNavalUnitType(String(unit.type ?? ''));
    const neighbors = grid.getNeighbors(unit.col, unit.row);
    let best: { col: number; row: number } | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const n of neighbors) {
      const tile = this.gameEngine.getTileAt(n.col, n.row);
      if (!tile) continue;
      const key = String(tile.type ?? tile.terrain ?? '').trim().toLowerCase();
      const isWater = key === 'ocean' || key === 'river';
      // `isTilePassable` is a LAND test: it rejects every ocean neighbour, so a
      // ship standing on water was offered no step at all, and a ship near a
      // shore was offered a land tile moveUnit then rejects. Judge the tile the
      // way Pathfinding does — a ship wants water, a land unit wants land.
      if (isNaval) {
        // Ships navigate any river (a wide river only blocks LAND units), so
        // the land-only `isTilePassable` gate must not be applied here.
        if (!isWater) continue;
      } else {
        if (typeof this.gameEngine.isTilePassable === 'function' && !this.gameEngine.isTilePassable(n.col, n.row)) continue;
      }
      const moveCost = Math.max(1, TERRAIN_PROPS[key]?.movement ?? 1);
      if (moveCost > movesLeft) continue;
      // Avoid stepping onto an allied unit.
      const occupant = this.gameEngine.getUnitAt(n.col, n.row);
      if (occupant && occupant.civilizationId === unit.civilizationId) continue;
      // Prefer tiles that move closer to the target; tie-break by cost.
      const dist = grid.squareDistance(n.col, n.row, target.col, target.row);
      const score = dist * 10 + moveCost;
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return best;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Naval AI
  // ──────────────────────────────────────────────────────────────────────

  /** Whether a unit type is a ship (naval). */
  private isNavalUnitType(type: string): boolean {
    return UNIT_PROPS[String(type ?? '').trim().toLowerCase()]?.naval === true;
  }

  /**
   * Safe wrappers around the engine's connectivity helpers. Lightweight test
   * doubles do not implement them; they fall back to the pre-lake behavior
   * (everything reachable / no fleet) instead of crashing.
   */
  private areLandConnected(c1: number, r1: number, c2: number, r2: number): boolean {
    const fn = this.gameEngine.areLandConnected;
    return typeof fn === 'function' ? fn.call(this.gameEngine, c1, r1, c2, r2) : true;
  }

  private engineCanBuildShips(civilizationId: number): boolean {
    const fn = this.gameEngine.civCanBuildShips;
    return typeof fn === 'function' ? fn.call(this.gameEngine, civilizationId) : false;
  }

  private engineTileReachableByLand(civilizationId: number, col: number, row: number): boolean {
    const fn = this.gameEngine.isTileReachableByLandFromCiv;
    return typeof fn === 'function' ? fn.call(this.gameEngine, civilizationId, col, row) : true;
  }

  buildLandReachableLookup(civilizationId: number): (col: number, row: number) => boolean {
    const fn = this.gameEngine.isTileReachableByLandFromCiv;
    if (typeof fn !== 'function') return () => true;
    return (col, row) => fn.call(this.gameEngine, civilizationId, col, row);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Colony missions: ferry a settler to a small empty island
  // ──────────────────────────────────────────────────────────────────────

  private getColonyMission(storage?: PlayerTurnStorage): ColonyMission | null {
    const raw = storage?.turnData?.colonyMission as ColonyMission | undefined;
    return raw ?? null;
  }

  private setColonyMission(storage: PlayerTurnStorage | undefined, mission: ColonyMission): void {
    if (!storage) return;
    storage.turnData.colonyMission = mission;
  }

  private clearColonyMission(storage?: PlayerTurnStorage): void {
    if (storage) delete storage.turnData.colonyMission;
  }

  // ── Naval invasion ──────────────────────────────────────────────────────

  private getInvasionMission(storage?: PlayerTurnStorage): InvasionMission | null {
    const raw = storage?.turnData?.invasionMission as InvasionMission | undefined;
    return raw ?? null;
  }

  private setInvasionMission(storage: PlayerTurnStorage | undefined, mission: InvasionMission): void {
    if (!storage) return;
    storage.turnData.invasionMission = mission;
  }

  private clearInvasionMission(storage?: PlayerTurnStorage): void {
    if (storage) delete storage.turnData.invasionMission;
  }

  /**
   * Keep the civ's invasion mission valid and (re)assign a ferry, and plan a
   * new one when there is a worthwhile push: at war with a civ that owns a city
   * on a landmass we cannot walk to, combat units that can reach our coast,
   * and either an idle ferry or the tech to build one.
   *
   * The mission is abandoned as soon as it cannot work — the whole force died,
   * the target city was captured, the landing beach was taken, or the war ended.
   */
  private updateInvasionMission(civ: Civilization, storage?: PlayerTurnStorage): void {
    if (!storage) return;

    let mission = this.getInvasionMission(storage);
    if (mission) {
      // Drop troops that died; the mission only needs a live force to be worth
      // keeping (a hull with nobody aboard is just a ferry).
      mission.troopIds = (mission.troopIds ?? []).filter((id) =>
        this.gameEngine.units.some((u: Unit) => u.id === id && !u.isDefeated));
      mission.landedIds = (mission.landedIds ?? []).filter((id) =>
        this.gameEngine.units.some((u: Unit) => u.id === id && !u.isDefeated));
      const ferry = mission.ferryId
        ? this.gameEngine.units.find((u: Unit) => u.id === mission!.ferryId && !u.isDefeated)
        : null;
      const targetCity = this.gameEngine.cities.find((c) => c.id === mission!.targetCityId);
      const beachTaken =
        mission.stage !== 'siege' &&
        (this.gameEngine.getUnitAt(mission.landTile.col, mission.landTile.row) != null ||
          this.gameEngine.getCityAt(mission.landTile.col, mission.landTile.row) != null);

      if (mission.troopIds.length === 0 || !targetCity || targetCity.civilizationId === civ.id || beachTaken) {
        this.clearInvasionMission(storage);
        mission = null;
      } else {
        if (mission.ferryId && !ferry) mission.ferryId = null; // hull sunk: re-plan
        if (mission.stage !== 'siege' && !mission.ferryId) {
          const idle = this.findIdleFerry(civ.id);
          if (idle) mission.ferryId = idle.id;
        }
        this.setInvasionMission(storage, mission);
      }
    }
    if (mission) return;

    this.planInvasionMission(civ, storage);
  }

  /** Look for an enemy city across water worth landing a force for. */
  private planInvasionMission(civ: Civilization, storage: PlayerTurnStorage): void {
    const enemies = new Set(
      (this.gameEngine.diplomacyManager?.getEnemies?.(civ.id) ?? []).map(Number),
    );
    const canBuildShips = this.engineCanBuildShips(civ.id);
    const idleFerry = this.findIdleFerry(civ.id);
    // Nothing to row with and nothing to build a hull with: no mission.
    if (!idleFerry && !canBuildShips) return;

    // Our own landmass: everything the troops can walk to before boarding.
    const ownCities = this.gameEngine.cities.filter((c: City) => c.civilizationId === civ.id);
    if (ownCities.length === 0) return;
    const homeLandmass = this.gameEngine.getLandmassId?.(ownCities[0].col, ownCities[0].row) ?? -1;
    if (homeLandmass < 0) return;

    // A landing FORCE, not a single spear: take the strongest `capacity`
    // troops that can make it to a coastal rendezvous on our own landmass. One
    // hull now lifts a whole beach-assault group, so a ship is not spent
    // ferrying one unit at a time.
    const capacity = idleFerry ? this.engineTransportCapacity(idleFerry.type) : this.engineBestTransportCapacity(civ.id);
    const candidates = this.gameEngine.units
      .filter((u: Unit) => {
        if (u.civilizationId !== civ.id || u.isDefeated || u.embarkedOn) return false;
        if (!this.isCombatUnit(u)) return false;
        if (this.gameEngine.getLandmassId?.(u.col, u.row) !== homeLandmass) return false;
        return this.findColonyRendezvous(u) != null;
      })
      // Strongest first, so a three-slot hull takes the three best troops it can.
      .sort((a: Unit, b: Unit) => this.combatPowerOf(b) - this.combatPowerOf(a));
    if (candidates.length === 0) return;
    const force = candidates.slice(0, Math.max(1, capacity));
    const rendezvous = this.findColonyRendezvous(force[0]);
    if (!rendezvous) return;

    // Target: the least-defended enemy city on another landmass that has a
    // beach we can put a ferry next to.
    const seaDistance = (a: { col: number; row: number }, b: { col: number; row: number }) => {
      const grid = this.gameEngine.squareGrid;
      return grid ? grid.squareDistance(a.col, a.row, b.col, b.row) : 0;
    };

    let best:
      | {
          city: City;
          landmassId: number;
          landTile: { col: number; row: number };
          waterTile: { col: number; row: number };
          score: number;
        }
      | null = null;

    const landingPower = force.reduce((sum: number, u: Unit) => sum + this.combatPowerOf(u), 0);

    // Built lazily on the first cross-water target: one O(units × 9) sweep so
    // each beach on every enemy landmass is a O(1) lookup instead of an
    // O(units) scan (the old shape was O(beaches × units) per planning pass).
    let defenceGrid: number[][] | null = null;

    for (const enemyCity of this.gameEngine.cities) {
      if (enemyCity.civilizationId === civ.id) continue;
      if (!enemies.has(enemyCity.civilizationId)) continue;
      const landmassId = this.gameEngine.getLandmassId?.(enemyCity.col, enemyCity.row) ?? -1;
      if (landmassId < 0 || landmassId === homeLandmass) continue; // already walkable

      defenceGrid ??= this.buildDefenceGrid(1);
      const beach = this.findInvasionBeach(landmassId, enemyCity, rendezvous, landingPower, defenceGrid);
      if (!beach) continue;

      const defenders = this.gameEngine.units.filter(
        (u: Unit) =>
          u.civilizationId === enemyCity.civilizationId &&
          !u.isDefeated &&
          this.areLandConnected(enemyCity.col, enemyCity.row, u.col, u.row),
      );
      // Prefer a soft target close to home over a fortress on the far side.
      const score = seaDistance(rendezvous, beach.waterTile) + defenders.length * 6;
      if (!best || score < best.score) {
        best = { city: enemyCity, landmassId, landTile: beach.landTile, waterTile: beach.waterTile, score };
      }
    }
    if (!best) return;

    const mission: InvasionMission = {
      troopIds: force.map((u: Unit) => u.id),
      landedIds: [],
      ferryId: idleFerry?.id ?? null,
      targetCityId: best.city.id,
      targetLandmassId: best.landmassId,
      landTile: best.landTile,
      waterTile: best.waterTile,
      rendezvous,
      stage: 'gather',
    };
    this.setInvasionMission(storage, mission);
    this.gameEngine.log?.('ai', `Invasion — ${civ.name} sails against ${best.city.name}`, {
      civilizationId: civ.id,
      action: 'invasion_planned',
      unitIds: mission.troopIds,
      troopId: force[0].id,
      forceSize: mission.troopIds.length,
      ferryId: mission.ferryId,
      targetCityId: best.city.id,
      targetCol: best.city.col,
      targetRow: best.city.row,
      landCol: best.landTile.col,
      landRow: best.landTile.row,
    });
    debugLog(
      `[AI] ${civ.name} plans an invasion of ${best.city.name} (${best.city.civilizationId}) `
      + `with ${force.length} unit(s) — landing at (${best.landTile.col},${best.landTile.row})`,
    );
  }

  /**
   * The best beach on `landmassId` to put a landing force ashore, or null when
   * the enemy city cannot be assaulted from the sea at all.
   *
   * "Best" is decided by `scoreLandingSite`, not by "first tile found next to
   * the city": a hull that beaches next to a walled city and two tiles from its
   * garrison throws the whole landing force away, so defence and distance from
   * the hull both feed the score, and a beach the force cannot beat is rejected
   * outright (`hopeless`).
   */
  private findInvasionBeach(
    landmassId: number,
    enemyCity: City,
    rendezvous: { col: number; row: number } | undefined,
    landingPower: number,
    defenceGrid: number[][],
  ): { landTile: { col: number; row: number }; waterTile: { col: number; row: number } } | null {
    const grid = this.gameEngine.squareGrid;
    const map = this.gameEngine.map;
    if (!grid || !map) return null;

    // What the landing would have to beat: the city itself plus everything that
    // can reach the beach to defend it.
    const cityDefence = this.defenceAt(defenceGrid, enemyCity);
    let best: {
      landTile: { col: number; row: number };
      waterTile: { col: number; row: number };
      score: number;
    } | null = null;

    for (let row = 0; row < (map.height ?? 0); row++) {
      for (let col = 0; col < (map.width ?? 0); col++) {
        if (this.gameEngine.getLandmassId?.(col, row) !== landmassId) continue;
        // Never land on the city we are coming for (or on anything sitting there).
        if (this.gameEngine.getCityAt(col, row) || this.gameEngine.getUnitAt(col, row)) continue;
        const water = this.gameEngine.findAdjacentOcean?.(col, row);
        if (!water) continue; // no ferry can reach this tile
        // `findAdjacentOcean` returns the first ocean tile in its scan order,
        // which can be TWO steps away when the tiles between are land — a hull
        // parked there could not unload onto this beach, so the whole mission
        // would stall on the landing turn.
        if (grid.chebyshevDistance(water.col, water.row, col, row) > 1) continue;

        const adjacentToTarget = grid.squareDistance(col, row, enemyCity.col, enemyCity.row) <= 1;
        const { score, hopeless } = scoreLandingSite({
          ferryDistance: rendezvous
            ? grid.chebyshevDistance(rendezvous.col, rendezvous.row, water.col, water.row)
            : 0,
          landingForce: landingPower,
          beachDefence: this.defenceAt(defenceGrid, { col, row }),
          targetCityDefence: cityDefence,
          tileYield: this.tileYieldAt(col, row),
          adjacentToTarget,
        });
        // When the force cannot take the city, a beach away from it is still
        // worth landing on (somewhere to land and wait); only a beach next to a
        // hopeless target is pointless.
        if (hopeless && adjacentToTarget) continue;
        if (!best || score > best.score) {
          best = { landTile: { col, row }, waterTile: water, score };
        }
      }
    }
    return best;
  }

  /** Combined attack+defense of whatever defends a tile within `radius`. */
  private defenceOf(anchor: { col: number; row: number }, radius: number): number {
    let total = 0;
    for (const u of this.gameEngine.units) {
      if (u.isDefeated) continue;
      const d = this.gameEngine.squareGrid?.chebyshevDistance(anchor.col, anchor.row, u.col, u.row);
      if (d === undefined || d > radius) continue;
      total += Math.max(0, (u.attack ?? 0) + (u.defense ?? 0));
    }
    return total;
  }

  /**
   * `defenceOf` for every tile of the map, precomputed in one pass: each unit
   * adds its weight to the tiles within Chebyshev `radius` of it. Callers that
   * score many tiles in a row (`findInvasionBeach` walks every coastal tile on
   * a landmass) go from O(beaches × units) to O(units × radius² + beaches).
   *
   * Unit positions must not change between building and use; the grid is built
   * for the duration of a single synchronous planning pass.
   */
  private buildDefenceGrid(radius: number): number[][] {
    const map = this.gameEngine.map;
    const height = map?.height ?? 0;
    const width = map?.width ?? 0;
    const grid: number[][] = Array.from({ length: height }, () => new Array<number>(width).fill(0));
    for (const u of this.gameEngine.units) {
      if (u.isDefeated) continue;
      const power = Math.max(0, (u.attack ?? 0) + (u.defense ?? 0));
      if (power === 0) continue;
      const rowStart = Math.max(0, u.row - radius);
      const rowEnd = Math.min(height - 1, u.row + radius);
      const colStart = Math.max(0, u.col - radius);
      const colEnd = Math.min(width - 1, u.col + radius);
      for (let r = rowStart; r <= rowEnd; r++) {
        const rowValues = grid[r];
        for (let c = colStart; c <= colEnd; c++) {
          rowValues[c] += power;
        }
      }
    }
    return grid;
  }

  /** Defence of a tile from a grid produced by {@link buildDefenceGrid}. */
  private defenceAt(grid: number[][], anchor: { col: number; row: number }): number {
    return grid[anchor.row]?.[anchor.col] ?? 0;
  }

  /** food + production + trade of a tile, for weighing colonisable land. */
  private tileYieldAt(col: number, row: number): number {
    const tile = this.gameEngine.getTileAt(col, row) as {
      computedYields?: { food?: number; production?: number; trade?: number };
      terrainInfo?: { baseFood?: number; baseProduction?: number; baseTrade?: number };
    } | null;
    const computed = tile?.computedYields;
    if (computed) {
      return (computed.food ?? 0) + (computed.production ?? 0) + (computed.trade ?? 0);
    }
    const base = tile?.terrainInfo;
    if (!base) return 0;
    return (base.baseFood ?? 0) + (base.baseProduction ?? 0) + (base.baseTrade ?? 0);
  }

  /** A unit's combat weight, used to pick the strongest landing force. */
  private combatPowerOf(unit: Unit): number {
    return Math.max(0, (unit.attack ?? 0) * 2 + (unit.defense ?? 0));
  }

  /** How many land units a hull of this type can carry. */
  private engineTransportCapacity(type: string): number {
    return Math.max(1, UNIT_PROPS[String(type ?? '').trim().toLowerCase()]?.transportCapacity ?? 1);
  }

  /** The largest transport the civ has the technology to build. */
  private engineBestTransportCapacity(civId: number): number {
    const civ = this.gameEngine.civilizations?.[civId];
    if (!civ) return 1;
    let best = 1;
    for (const type of Object.keys(UNIT_PROPS)) {
      const props = UNIT_PROPS[type];
      if (!props?.naval || !props.transportCapacity) continue;
      if (canBuildUnit(civ as never, type)) best = Math.max(best, props.transportCapacity);
    }
    return best;
  }

  /**
   * Board the landing force (as many units as the hull has room for) when the
   * ferry is alongside, then put the force ashore on the beach.
   *
   * One boarding per turn, one landing per turn: the hull has to sit next to
   * the beach, and `canUnloadFerry` only lets a unit off onto a tile it is
   * within one step of. A three-unit force therefore crosses in one trip and
   * walks off the beach over three turns, all onto the SAME tile — an amphibious
   * force has to be able to pile onto one beach.
   */
  private tryInvasionFerryAction(
    unit: Unit,
    mission: InvasionMission,
    storage?: PlayerTurnStorage,
  ): boolean {
    if (!mission.ferryId || unit.id !== mission.ferryId) return false;
    // The force is already ashore and marching on the city: this ferry has no
    // job left. Re-boarding it here shipped the invasion force back to sea.
    if (mission.stage === 'siege') return false;

    const cargoIds = this.ferryCargoIds(unit);
    // Bound to the engine: these are methods, so detaching them loses `this`.
    const canLoad = typeof this.gameEngine.canLoadFerry === 'function'
      ? (id: string) => this.gameEngine.canLoadFerry(unit.id, id)
      : null;
    const doLoad = typeof this.gameEngine.loadFerry === 'function'
      ? (id: string) => this.gameEngine.loadFerry(unit.id, id)
      : null;
    const canUnload = typeof this.gameEngine.canUnloadFerry === 'function'
      ? (col: number, row: number, id?: string) => this.gameEngine.canUnloadFerry(unit.id, col, row, id)
      : null;
    const doUnload = typeof this.gameEngine.unloadFerry === 'function'
      ? (col: number, row: number, id?: string) => this.gameEngine.unloadFerry(unit.id, col, row, id)
      : null;

    // Load the force — but only while still gathering it. Once the hull has
    // started unloading, re-running the boarding branch would pick the troops
    // back up off the beach it had just landed them on, and the cargo count
    // would oscillate for the rest of the mission.
    const gathering = mission.stage === 'gather';
    if (gathering && canLoad && doLoad && cargoIds.length < this.engineTransportCapacity(unit.type)) {
      // Board the next waiting troop that is standing next to the hull.
      for (const troopId of mission.troopIds) {
        const troop = this.gameEngine.units.find((u: Unit) => u.id === troopId && !u.isDefeated);
        if (!troop || troop.embarkedOn) continue;
        if (!canLoad(troop.id)) continue;
        doLoad(troop.id);
        // Cross once the hull is full OR once there is nobody left to collect —
        // otherwise a force smaller than the hull's capacity would sit at the
        // coast forever waiting for troops that will never come.
        const aboardNow = this.ferryCargoIds(unit);
        const anyoneLeft = mission.troopIds.some((id) => {
          if (aboardNow.includes(id)) return false;
          return this.gameEngine.units.some((u: Unit) => u.id === id && !u.isDefeated);
        });
        if (!anyoneLeft || aboardNow.length >= this.engineTransportCapacity(unit.type)) {
          mission.stage = 'sail';
        }
        this.setInvasionMission(storage, mission);
        this.gameEngine.log?.('ai', `Invasion — ${unit.type} boards with ${troop.type}`, {
          civilizationId: unit.civilizationId,
          action: 'invasion_load',
          unitId: unit.id,
          troopId: troop.id,
          aboard: this.ferryCargoIds(unit).length,
        });
        return true;
      }
      // Nothing more can board here. If at least one unit is aboard, cross with
      // what we have rather than sitting alongside forever.
      if (cargoIds.length === 0) return false;
      if (mission.stage !== 'sail') {
        mission.stage = 'sail';
        this.setInvasionMission(storage, mission);
      }
    }

    // Loaded: put a unit ashore on the beach.
    if (!canUnload || !doUnload) return false;
    if (!canUnload(mission.landTile.col, mission.landTile.row)) return false;
    const landedId = this.ferryCargoIds(unit).find((id) => canUnload(mission.landTile.col, mission.landTile.row, id))
      ?? this.ferryCargoIds(unit)[0];
    if (!landedId) return false;
    doUnload(mission.landTile.col, mission.landTile.row, landedId);
    // This unit is ashore for good: move it out of the waiting list so nothing
    // tries to board it again.
    mission.troopIds = mission.troopIds.filter((id) => id !== landedId);
    mission.landedIds.push(landedId);
    const cargoType = this.gameEngine.units.find((u: Unit) => u.id === landedId)?.type ?? 'unit';
    // The hull is empty and the force is ashore: the beach is taken.
    if (this.ferryCargoIds(unit).length === 0) {
      mission.stage = 'siege';
      mission.ferryId = null; // released, so the hull can be used for something else
    }
    this.setInvasionMission(storage, mission);
    this.gameEngine.log?.('ai', `Invasion — ${unit.type} lands the ${cargoType} at (${mission.landTile.col},${mission.landTile.row})`, {
      civilizationId: unit.civilizationId,
      action: 'invasion_unload',
      unitId: unit.id,
      troopId: landedId,
      remaining: this.ferryCargoIds(unit).length,
      targetCol: mission.landTile.col,
      targetRow: mission.landTile.row,
    });
    return true;
  }

  /** The land units aboard a hull, tolerating a stub engine without the API. */
  private ferryCargoIds(ferry: Unit): string[] {
    const get = (this.gameEngine as { getFerryCargo?: (f: Unit) => string[] }).getFerryCargo;
    if (typeof get === 'function') return get.call(this.gameEngine, ferry);
    if (Array.isArray(ferry.cargoUnitIds)) return ferry.cargoUnitIds.filter(Boolean);
    return ferry.cargoUnitId ? [ferry.cargoUnitId] : [];
  }

  /**
   * Keep the civ's colony mission valid and (re)assign a ferry. A mission is
   * created when the civ has seen a small city-free island, owns an idle
   * settler that can reach a coast, and can either field a ferry or build one.
   */
  private updateColonyMission(civ: Civilization, storage?: PlayerTurnStorage): void {
    if (!storage || typeof this.gameEngine.getColonizableIslands !== 'function') return;

    const islands = this.gameEngine.getColonizableIslands(civ.id);
    let mission = this.getColonyMission(storage);

    if (mission) {
      const settler = this.gameEngine.units.find(
        (u: Unit) => u.id === mission.settlerId && !u.isDefeated,
      );
      const ferry = mission.ferryId
        ? this.gameEngine.units.find((u: Unit) => u.id === mission.ferryId && !u.isDefeated)
        : null;
      const island = islands.find((i) => i.landmassId === mission.targetLandmassId);
      const rendezvous = settler && !settler.embarkedOn
        ? this.findColonyRendezvous(settler)
        : null;
      if (!settler || !island || (mission.ferryId && !ferry) || (!settler.embarkedOn && !rendezvous)) {
        // The settler/ferry died, the island got settled, or the settler is
        // landlocked — abandon the mission.
        this.clearColonyMission(storage);
        mission = null;
      } else {
        mission.landTile = island.landTile;
        mission.waterTile = island.waterTile;
        if (!mission.ferryId) {
          const idle = this.findIdleFerry(civ.id);
          if (idle) mission.ferryId = idle.id;
        }
        this.setColonyMission(storage, mission);
      }
    }
    if (mission) return;

    const idleFerry = this.findIdleFerry(civ.id);
    const canBuildShips = typeof this.gameEngine.civCanBuildShips === 'function'
      && this.gameEngine.civCanBuildShips(civ.id);
    if (!idleFerry && !canBuildShips) return;

    const settler = this.findColonySettler(civ.id);
    if (!settler || !this.findColonyRendezvous(settler)) return;
    const island = islands[0];
    if (!island) return;

    const newMission: ColonyMission = {
      settlerId: settler.id,
      ferryId: idleFerry?.id ?? null,
      targetLandmassId: island.landmassId,
      landTile: island.landTile,
      waterTile: island.waterTile,
      stage: 'gather',
    };
    this.setColonyMission(storage, newMission);
    this.gameEngine.log?.('ai', `Colony mission — ${civ.name} targets a ${island.size}-tile island`, {
      civilizationId: civ.id,
      action: 'colony_mission',
      settlerId: settler.id,
      landmassId: island.landmassId,
      targetCol: island.landTile.col,
      targetRow: island.landTile.row,
    });
  }

  /**
   * An own ferry with room aboard and nothing to carry. Capacity, not "any
   * cargo": a hull with 2 of 3 slots filled is still in use, but one holding a
   * single settler can take a second passenger if a mission wants one.
   */
  private findIdleFerry(civId: number): Unit | null {
    return this.gameEngine.units.find((u: Unit) => {
      if (u.civilizationId !== civId || u.type !== 'ferry' || u.isDefeated) return false;
      if (u.embarkedOn) return false;
      return this.ferryCargoIds(u).length < this.engineTransportCapacity(u.type);
    }) ?? null;
  }

  /** An own settler available to be shipped to a new island. */
  private findColonySettler(civId: number): Unit | null {
    return this.gameEngine.units.find(
      (u: Unit) => u.civilizationId === civId
        && u.type === 'settler'
        && !u.isDefeated
        && !u.embarkedOn
        && !u.workTarget,
    ) ?? null;
  }

  /**
   * Where the mission settler waits for the ferry: its own tile when it is
   * already on the coast, otherwise the nearest coastal land tile on the SAME
   * landmass (a settler can only walk there).
   */
  private findColonyRendezvous(unit: Unit): { col: number; row: number } | null {
    if (this.gameEngine.findAdjacentOcean?.(unit.col, unit.row)) {
      return { col: unit.col, row: unit.row };
    }
    const map = this.gameEngine.map;
    const grid = this.gameEngine.squareGrid;
    if (!map || !grid) return null;
    const radius = 20;
    let best: { col: number; row: number } | null = null;
    let bestDist = Infinity;
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        const col = unit.col + dc;
        const row = unit.row + dr;
        if (!grid.isValidSquare(col, row)) continue;
        const tile = this.gameEngine.getTileAt(col, row);
        if (!tile) continue;
        const key = String(tile.type ?? tile.terrain ?? '').trim().toLowerCase();
        if (key === 'ocean' || key === 'lake') continue;
        if (!this.areLandConnected(unit.col, unit.row, col, row)) continue;
        if (!this.gameEngine.findAdjacentOcean?.(col, row)) continue;
        const dist = grid.squareDistance(unit.col, unit.row, col, row);
        if (dist < bestDist) {
          bestDist = dist;
          best = { col, row };
        }
      }
    }
    return best;
  }

  /** Board/unload the mission settler when the ferry is in position. */
  private tryColonyFerryAction(
    unit: Unit,
    mission: ColonyMission,
    storage?: PlayerTurnStorage,
  ): boolean {
    if (!mission.ferryId || unit.id !== mission.ferryId) return false;
    const aboard = this.ferryCargoIds(unit);
    const settler = this.gameEngine.units.find(
      (u: Unit) => u.id === mission.settlerId && !u.isDefeated,
    );
    if (!settler) return false;
    if (!aboard.includes(settler.id)) {
      if (aboard.length >= this.engineTransportCapacity(unit.type)) return false;
      if (typeof this.gameEngine.canLoadFerry === 'function'
          && this.gameEngine.canLoadFerry(unit.id, settler.id)) {
        this.gameEngine.loadFerry(unit.id, settler.id);
        mission.stage = 'sail';
        this.setColonyMission(storage, mission);
        this.gameEngine.log?.('ai', `Colony ferry loaded ${settler.type}`, {
          civilizationId: unit.civilizationId, action: 'colony_load', unitId: unit.id,
        });
        return true;
      }
      return false;
    }
    if (typeof this.gameEngine.canUnloadFerry === 'function'
        && this.gameEngine.canUnloadFerry(unit.id, mission.landTile.col, mission.landTile.row, settler.id)) {
      this.gameEngine.unloadFerry(unit.id, mission.landTile.col, mission.landTile.row, settler.id);
      this.clearColonyMission(storage);
      this.gameEngine.log?.('ai', `Colony ferry landed a settler on the island`, {
        civilizationId: unit.civilizationId, action: 'colony_unload', unitId: unit.id,
        targetCol: mission.landTile.col, targetRow: mission.landTile.row,
      });
      return true;
    }
    return false;
  }

  /** Nearest deep-ocean tile to a position (ferry staging when no coast yet). */
  private findNearestOceanTo(col: number, row: number, radius = 12): { col: number; row: number } | null {
    const grid = this.gameEngine.squareGrid;
    if (!grid) return null;
    let best: { col: number; row: number } | null = null;
    let bestDist = Infinity;
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        const c = col + dc;
        const r = row + dr;
        if (!grid.isValidSquare(c, r)) continue;
        const tile = this.gameEngine.getTileAt(c, r);
        if (!tile) continue;
        if (String(tile.type ?? tile.terrain ?? '').trim().toLowerCase() !== 'ocean') continue;
        const dist = grid.squareDistance(col, row, c, r);
        if (dist < bestDist) {
          bestDist = dist;
          best = { col: c, row: r };
        }
      }
    }
    return best;
  }

  /**
   * Fishing ground for a Fisher Boat without a route: the ground the
   * FisherEconomics equation picks for its home city. A net on a tile the city
   * cannot work, or a ground whose round trip eats the catch, is not worth the
   * upkeep — but a rich ground further out can be, and the equation compares
   * exactly that. Falls back to the nearest known fish when the boat has no
   * home city (it will acquire one at the next unload).
   */
  private findFishingGround(unit: Unit): { col: number; row: number } | null {
    const home = this.resolveFishingHomeCity(unit);
    if (home) {
      const ground = bestFishingGround(this.gameEngine, home);
      if (ground) return { col: ground.col, row: ground.row };
    }

    const grid = this.gameEngine.squareGrid;
    if (!grid) return null;
    // Same restrictions the deploy gate enforces: never head for a ground a
    // city works or another boat already owns.
    const workedTiles = typeof this.gameEngine.getWorkedTileKeys === 'function'
      ? this.gameEngine.getWorkedTileKeys()
      : null;
    const takenGrounds = typeof this.gameEngine.getFishingGroundKeys === 'function'
      ? this.gameEngine.getFishingGroundKeys()
      : null;
    let best: { col: number; row: number } | null = null;
    let bestDist = Infinity;
    const width = grid.width ?? 0;
    const height = grid.height ?? 0;
    for (let col = 0; col < width; col++) {
      for (let row = 0; row < height; row++) {
        const tile = this.gameEngine.getTileAt(col, row);
        const resource = String((tile as { resource?: string } | null)?.resource ?? '').toLowerCase();
        if (resource !== 'fish') continue;
        const key = `${col},${row}`;
        if (workedTiles?.has(key) || takenGrounds?.has(key)) continue;
        if (typeof this.gameEngine.isExploredByPlayer === 'function'
            && !this.gameEngine.isExploredByPlayer(unit.civilizationId, col, row)) {
          continue;
        }
        const dist = grid.chebyshevDistance(unit.col, unit.row, col, row);
        if (dist < bestDist) {
          bestDist = dist;
          best = { col, row };
        }
      }
    }
    return best;
  }

  /**
   * The city a Fisher Boat unloads into: its registered home port, or the
   * nearest own city when it has none yet (matches GameEngine.getFishingHomeCity).
   */
  private resolveFishingHomeCity(unit: Unit): City | null {
    if (unit.homeCityId) {
      const home = this.gameEngine.cities.find(
        (c: City) => c.id === unit.homeCityId && c.civilizationId === unit.civilizationId,
      );
      if (home) return home;
    }
    let best: City | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const city of this.gameEngine.cities) {
      if (city.civilizationId !== unit.civilizationId) continue;
      const distance = this.gameEngine.squareGrid?.squareDistance(
        city.col, city.row, unit.col, unit.row,
      ) ?? Number.POSITIVE_INFINITY;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = city;
      }
    }
    return best;
  }

  /**
   * Whether `otherCivId` may be attacked by `unit`'s civ: a civ we are at war
   * with, or the barbarian faction (always hostile). A missing
   * `diplomacyManager` means the engine cannot declare war either, so nothing
   * is hostile — naval units then stay home instead of picking fights that
   * would kill them (a Ferry has 0 attack and always loses a sea fight).
   */
  private isHostileTo(unitCivId: number, otherCivId: number | null | undefined): boolean {
    if (otherCivId == null || otherCivId === unitCivId) return false;
    if (otherCivId === BARBARIAN_CIV_ID) return true;
    return this.gameEngine.diplomacyManager?.isAtWar(unitCivId, otherCivId) === true;
  }

  /**
   * A water tile a naval unit can actually sail to, at (col,row) or right
   * next to it. A ship can never path onto a land city square
   * (Pathfinding.getMovementCost returns Infinity), so handing it a city tile
   * made it stall on `no_path` every turn. A tile that is already water is
   * returned as-is so a hunt aims at the hull, not at a neighbouring square.
   */
  private navigableWaterAt(col: number, row: number): { col: number; row: number } | null {
    const key = String(this.gameEngine.getTileAt(col, row)?.type ?? '').trim().toLowerCase();
    if (key === 'ocean' || key === 'river') return { col, row };
    // A river-only shore (or a hull parked inside a coastal city) has no
    // deep-ocean neighbour; fall back to the closest navigable water.
    const adjacent = typeof this.gameEngine.findAdjacentOcean === 'function'
      ? this.gameEngine.findAdjacentOcean(col, row)
      : null;
    if (adjacent) return adjacent;
    return this.findNearestOceanTo(col, row);
  }

  /**
   * A naval unit's target, in priority order:
   *   1. the nearest enemy ship of a civ we are at war with (sea control),
   *   2. a water tile next to a known enemy city we are at war with
   *      (blockade / escort the invasion),
   *   3. unexplored open water, then any nearby water (patrol/exploration).
   *
   * Every branch is gated on `isHostileTo`: without that gate a Ferry sailed
   * to the nearest foreign hull and attacked it, and `combatUnit` auto-declares
   * war — so the fleet started wars nobody planned and died doing it (a 417
   * round naval game: 62 ship-on-ship attacks, 58 ships lost of 86 built, 10
   * of 129 wars started by a transport ramming a transport at peace).
   */
  /**
   * Where a hull should sail this turn.
   *
   * The objective comes from `chooseNavalDestination`; this wrapper watches
   * whether the hull is actually getting there. A hull that stops closing on
   * its destination is not going to arrive — the beach is walled off, the
   * anchorage is full of other hulls, the settler will never reach a boardable
   * tile — and re-issuing the same unreachable tile every turn is what made
   * transports sit in a circle off one island forever. When that happens the
   * hull gives the objective up and sails somewhere else.
   */
  private chooseNavalTarget(unit: Unit): { col: number; row: number } | null {
    const target = this.chooseNavalDestination(unit);
    if (!target) return null;
    return this.hullIsClosing(unit, target)
      ? target
      : this.retargetStalledHull(unit, target);
  }

  /**
   * Whether this hull reduced its distance to its destination since last turn,
   * tolerating a single blocked turn (a hull routinely cannot move on the turn
   * it finishes loading or unloading).
   */
  private hullIsClosing(unit: Unit, target: { col: number; row: number }): boolean {
    const grid = this.gameEngine.squareGrid;
    if (!grid) return true;
    const dist = grid.squareDistance(unit.col, unit.row, target.col, target.row);
    const previous = unit._navalIntent;
    let stalled = 0;
    if (previous && previous.col === target.col && previous.row === target.row) {
      stalled = dist < previous.dist ? 0 : previous.stalled + 1;
    }
    unit._navalIntent = { col: target.col, row: target.row, dist, stalled };
    return stalled < NAVAL_STALL_TURNS;
  }

  /**
   * A hull that cannot reach its objective: release the claim that was pinning
   * it there, and send it to water a real distance away.
   *
   * Releasing the claim matters as much as moving. A colony mission reserves a
   * settler AND an island; keeping either after the hull has proved it cannot
   * deliver means the settler stands on a coast forever while the island stays
   * off-limits to every other civ — one unreachable rock quietly sterilising a
   * whole archipelago.
   */
  private retargetStalledHull(
    unit: Unit,
    stuck: { col: number; row: number },
  ): { col: number; row: number } | null {
    const storage = this.gameEngine.getPlayerStorage?.(unit.civilizationId);
    const colony = this.getColonyMission(storage);
    if (colony?.ferryId === unit.id) {
      this.clearColonyMission(storage);
      this.gameEngine.log?.('ai', `Colony abandoned — ${unit.type} cannot reach the island`, {
        civilizationId: unit.civilizationId, action: 'colony_abandon',
        unitId: unit.id, targetCol: stuck.col, targetRow: stuck.row,
      });
    }
    const invasion = this.getInvasionMission(storage);
    if (invasion?.ferryId === unit.id) this.clearInvasionMission(storage);
    unit._navalIntent = undefined;

    const elsewhere = this.findDistantNavalWater(unit, stuck, NAVAL_RETARGET_MIN_DISTANCE);
    if (elsewhere) {
      debugLog(`[AI] Hull ${unit.id} stalled on (${stuck.col},${stuck.row}) — sailing elsewhere to (${elsewhere.col},${elsewhere.row})`);
      return elsewhere;
    }
    return this.findNavalPatrolTarget(unit);
  }

  /** Navigable water at least `minDistance` from `avoid`, unknown water first. */
  private findDistantNavalWater(
    unit: Unit,
    avoid: { col: number; row: number },
    minDistance: number,
  ): { col: number; row: number } | null {
    const grid = this.gameEngine.squareGrid;
    const map = this.gameEngine.map;
    if (!grid || !map) return null;
    const explored = this.gameEngine.getPlayerStorage?.(unit.civilizationId)?.explored;

    const unknown: Array<{ col: number; row: number }> = [];
    const known: Array<{ col: number; row: number }> = [];
    for (let radius = minDistance; radius <= minDistance + 16; radius++) {
      for (let dc = -radius; dc <= radius; dc++) {
        for (let dr = -radius; dr <= radius; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
          const col = unit.col + dc;
          const row = unit.row + dr;
          if (!grid.isValidSquare(col, row)) continue;
          if (grid.squareDistance(col, row, avoid.col, avoid.row) < minDistance) continue;
          const key = String(this.gameEngine.getTileAt(col, row)?.type ?? '').trim().toLowerCase();
          if (key !== 'ocean' && key !== 'river') continue;
          if (this.gameEngine.getUnitAt(col, row)) continue;
          if (this.isAdjacentToHostileCity(unit, { col, row })) continue;
          if (!explored || explored[row * map.width + col] !== true) unknown.push({ col, row });
          else known.push({ col, row });
        }
      }
      if (unknown.length >= 4 || known.length >= 4) break;
    }

    const pool = unknown.length > 0 ? unknown : known;
    if (pool.length === 0) return null;
    return pool[this.hullChoiceIndex(unit.id, pool.length)];
  }

  private chooseNavalDestination(unit: Unit): { col: number; row: number } | null {
    if (!this.gameEngine.squareGrid) return null;

    const storage = this.gameEngine.getPlayerStorage?.(unit.civilizationId);

    // A ferry on an invasion runs its invasion route, not its patrol: sit next
    // to the waiting troop, then cross to the landing beach with it aboard.
    // Once the troop is ashore (`siege`) the ferry is free again — without this
    // stage check it kept steering to `findAdjacentOcean(ownTroop)` and then
    // held that water tile forever.
    const invasion = this.getInvasionMission(storage);
    if (invasion?.ferryId === unit.id && invasion.stage !== 'siege') {
      if (this.ferryCargoIds(unit).length > 0) return invasion.waterTile;
      // Empty hull: come alongside the rendezvous to collect the force.
      const troops = invasion.troopIds
        .map((id) => this.gameEngine.units.find((u: Unit) => u.id === id && !u.isDefeated && !u.embarkedOn))
        .filter((u): u is Unit => !!u);
      const gatheringPoint = troops[0] ?? { col: invasion.rendezvous.col, row: invasion.rendezvous.row };
      const alongside = this.gameEngine.findAdjacentOcean?.(gatheringPoint.col, gatheringPoint.row)
        ?? this.gameEngine.findAdjacentOcean?.(invasion.rendezvous.col, invasion.rendezvous.row);
      if (alongside) return alongside;
      const nearestWater = this.findNearestOceanTo(gatheringPoint.col, gatheringPoint.row);
      if (nearestWater) return nearestWater;
      return invasion.waterTile;
    }

    // A ferry on a colony mission ignores the war and runs its route.
    const mission = this.getColonyMission(storage);
    if (mission?.ferryId === unit.id) {
      if (this.ferryCargoIds(unit).length > 0) {
        return mission.waterTile; // sail the settler to the island
      }
      const settler = this.gameEngine.units.find(
        (u: Unit) => u.id === mission.settlerId && !u.isDefeated,
      );
      if (settler) {
        const alongside = this.navigableWaterAt(settler.col, settler.row);
        if (alongside) return alongside;
      }
      return mission.waterTile;
    }

    // 1 + 2. Offensive naval doctrine for a hull that can actually fight.
    //    Ranked by `scoreNavalTarget` rather than by "nearest enemy hull":
    //    transports first (a loaded hull is a landing force the enemy cannot
    //    easily replace), then the enemy fleet, then coastal cities, then the
    //    small civilian hulls that pay for it. A 0-attack Ferry never hunts —
    //    it would only ever lose, and `combatUnit` would declare war over it.
    if ((unit.attack ?? 0) > 0) {
      const best = this.chooseWarshipTarget(unit, storage);
      if (best) return best;
    }

    return this.findNavalPatrolTarget(unit);
  }

  /**
   * The best thing for a warship to shoot at, per `scoreNavalTarget`, plus the
   * "sail adjacent and move into it" rule for coastal cities: a ship cannot
   * path onto a land city square, so it is sent to the water beside the city
   * and only aims at the city itself once it is close enough to step in.
   */
  private chooseWarshipTarget(
    unit: Unit,
    storage?: PlayerTurnStorage,
  ): { col: number; row: number } | null {
    const grid = this.gameEngine.squareGrid;
    if (!grid) return null;
    const ownCivId = unit.civilizationId;
    let best: { col: number; row: number } | null = null;
    let bestScore = -Infinity;

    const consider = (targetClass: NavalTargetClass, aim: { col: number; row: number }, dist: number, valueMultiplier = 1) => {
      if (dist < 0) return;
      const { score } = scoreNavalTarget({ targetClass, distance: dist, valueMultiplier, isFresh: true });
      if (score > bestScore) {
        bestScore = score;
        best = aim;
      }
    };

    // Enemy hulls: transports outrank warships, then fisher boats and scouts.
    for (const ship of this.gameEngine.units) {
      if (ship.isDefeated) continue;
      if (!this.isHostileTo(ownCivId, ship.civilizationId)) continue;
      const dist = grid.chebyshevDistance(unit.col, unit.row, ship.col, ship.row);
      const targetClass = classifyNavalTarget({
        type: ship.type,
        transportCapacity: UNIT_PROPS[ship.type]?.transportCapacity,
        cargoCount: ship.civilizationId !== ownCivId ? this.ferryCargoIds(ship).length : 0,
        attack: ship.attack,
      });
      // A loaded transport is worth double: it is a whole landing force.
      const aboard = this.ferryCargoIds(ship).length;
      const capacity = UNIT_PROPS[ship.type]?.transportCapacity ?? 0;
      const valueMultiplier = capacity > 0 ? 0.6 + 0.4 * Math.min(1, aboard / Math.max(1, capacity)) : 1;
      // A land unit (a scout raiding the shore) is only reachable from the
      // water next to it, which is what `navigableWaterAt` gives us.
      const aim = this.isNavalUnitType(ship.type)
        ? this.navigableWaterAt(ship.col, ship.row)
        : this.navigableWaterAt(ship.col, ship.row);
      if (!aim) continue;
      consider(targetClass, aim, dist, valueMultiplier);
    }

    // Enemy coastal cities. Sailing to a city's land square is impossible, so
    // the aim point is the water beside it — and when the hull is ALREADY
    // within one step, aim at the city itself so the unit loop's
    // adjacent-move branch calls moveUnit and the city is actually assaulted.
    for (const city of this.gameEngine.cities) {
      if (!this.isHostileTo(ownCivId, city.civilizationId)) continue;
      const hasNavalAccess = typeof this.gameEngine.tileHasNavalAccess === 'function'
        ? this.gameEngine.tileHasNavalAccess(city.col, city.row)
        : this.gameEngine.tileHasOceanAccess?.(city.col, city.row) === true;
      if (!hasNavalAccess) continue;
      const dist = grid.chebyshevDistance(unit.col, unit.row, city.col, city.row);
      const adjacent = dist <= 1;
      const aim = adjacent ? { col: city.col, row: city.row } : this.navigableWaterAt(city.col, city.row);
      if (!aim) continue;
      // An undefended city is a far better prize than a walled one, and a walled
      // city is no prize at all for a lone ship.
      const defended = this.defenceOf(city, 1);
      const walled = (city.buildings ?? []).includes('city_walls');
      consider('coastal_city', aim, dist, walled ? 0.4 : (defended > 0 ? 0.8 : 1.2));
    }

    // Remembered enemy positions we have lost sight of, as a last resort so a
    // warship with nothing in sight still has somewhere to be useful.
    if (bestScore === -Infinity && storage?.enemyLocations) {
      for (const [ownerCivId, locations] of storage.enemyLocations) {
        if (!this.isHostileTo(ownCivId, ownerCivId)) continue;
        for (const loc of locations) {
          if (loc.type !== 'city') continue;
          const water = this.navigableWaterAt(loc.col, loc.row);
          if (!water) continue;
          const dist = grid.chebyshevDistance(unit.col, unit.row, water.col, water.row);
          consider('coastal_city', water, dist, 0.5);
        }
      }
    }
    return best;
  }

  /**
   * A patrol destination for an idle ship: unexplored water first (so the fleet
   * still reveals the map), then the nearest already-mapped water. The second
   * pass is what matters: the old version only ever accepted UNEXPLORED ocean,
   * so the moment the local water was revealed every ship returned null and
   * spent its turn in the `no_target` stall branch. The mapped fallback is
   * deliberately the NEAREST such tile — a ship is standing in water, so the
   * closest water is always one legal step away. Aiming further out would look
   * more like a patrol but risks handing A* a tile it cannot reach, which is
   * the `no_path` stall this is meant to remove.
   */
  private findNavalPatrolTarget(unit: Unit): { col: number; row: number } | null {
    const map = this.gameEngine.map;
    const grid = this.gameEngine.squareGrid;
    if (!map || !grid) return null;
    const explored = this.gameEngine.getPlayerStorage?.(unit.civilizationId)?.explored;

    // Gather candidates ring by ring, then CHOOSE among them. Returning the
    // first one found was the bug: the scan starts at the top-left diagonal, so
    // "the nearest water" meant "two tiles up and to the left" for every hull in
    // the game. Idle ships therefore all migrated into the same map corner, and
    // on arriving there (with nothing up-left left to pick) they milled about
    // each other. The pick below is offset by the hull's own identity, so two
    // ships standing on the same tile still steer apart.
    const unknown: Array<{ col: number; row: number }> = [];
    const known: Array<{ col: number; row: number }> = [];
    for (let radius = 2; radius <= 20; radius++) {
      for (let dc = -radius; dc <= radius; dc++) {
        for (let dr = -radius; dr <= radius; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
          const col = unit.col + dc;
          const row = unit.row + dr;
          if (!grid.isValidSquare(col, row)) continue;
          const tile = this.gameEngine.getTileAt(col, row);
          const key = String(tile?.type ?? tile?.terrain ?? '').trim().toLowerCase();
          // Rivers are navigable too, so a river navy can patrol them.
          if (key !== 'ocean' && key !== 'river') continue;
          if (this.gameEngine.getUnitAt(col, row)) continue;
          if (this.isAdjacentToHostileCity(unit, { col, row })) continue;
          if (!explored || explored[row * map.width + col] !== true) {
            unknown.push({ col, row });
            // One ring of unexplored water is plenty to choose from.
            if (unknown.length >= 8) break;
          } else {
            known.push({ col, row });
          }
        }
      }
      if (unknown.length >= 8) break;
    }

    const pool = unknown.length > 0 ? unknown : known;
    if (pool.length === 0) return this.findAnyNavalWater(unit);
    return pool[this.hullChoiceIndex(unit.id, pool.length)];
  }

  /**
   * A stable per-hull index into a list of candidate destinations.
   *
   * Two hulls that share a tile must not also share a destination, or they
   * arrive together and then fight over the same water. Deriving the index from
   * the unit id keeps it deterministic (a replayed turn picks the same tile) and
   * spreads it across hulls for free.
   */
  private hullChoiceIndex(unitId: string, length: number): number {
    if (length <= 1) return 0;
    let hash = 0;
    for (let i = 0; i < unitId.length; i++) {
      hash = (hash * 31 + unitId.charCodeAt(i)) >>> 0;
    }
    return hash % length;
  }

  /** The first water tile we can reach, used when patrol water is exhausted. */
  private findAnyNavalWater(unit: Unit): { col: number; row: number } | null {
    const grid = this.gameEngine.squareGrid;
    if (!grid) return null;
    for (let radius = 1; radius <= 24; radius++) {
      for (let dc = -radius; dc <= radius; dc++) {
        for (let dr = -radius; dr <= radius; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
          const col = unit.col + dc;
          const row = unit.row + dr;
          if (!grid.isValidSquare(col, row)) continue;
          const key = String(this.gameEngine.getTileAt(col, row)?.type ?? '').trim().toLowerCase();
          if (key !== 'ocean' && key !== 'river') continue;
          if (this.gameEngine.getUnitAt(col, row)) continue;
          if (this.isAdjacentToHostileCity(unit, { col, row })) continue;
          return { col, row };
        }
      }
    }
    return null;
  }

  /** Whether a candidate water tile touches a city we are at war with. */
  private isAdjacentToHostileCity(unit: Unit, tile: { col: number; row: number }): boolean {
    const grid = this.gameEngine.squareGrid;
    if (!grid) return false;
    return this.gameEngine.cities.some((city: City) =>
      this.isHostileTo(unit.civilizationId, city.civilizationId)
      && grid.squareDistance(tile.col, tile.row, city.col, city.row) <= 1);
  }

  /**
   * Unit-aware route computation through the terrain-aware `Pathfinding`, so
   * the AI route obeys exactly what `moveUnit` enforces: terrain costs,
   * roads, naval/lake rules and the wide-river crossing block.
   */
  private pathForUnit(
    unit: Unit,
    target: { col: number; row: number },
    obstacles: Set<string>,
  ): { col: number; row: number }[] {
    const map = this.gameEngine.map;
    const grid = this.gameEngine.squareGrid;
    if (!map || !grid) return [];

    // Both land and naval units use the terrain-aware Pathfinding so the AI
    // route obeys the same rules as moveUnit — including the wide-river
    // crossing block (a 2–3 tile river is impassable to land units, which
    // `squareGrid.findPath`'s terrain-only filter never modelled).
    const result = Pathfinding.findPath(
      unit.col, unit.row, target.col, target.row,
      (c, r) => this.gameEngine.getTileAt(c, r),
      unit.type,
      map.width, map.height,
      (c, r) => this.gameEngine.getUnitAt(c, r),
      unit.civilizationId,
      (c, r) => this.gameEngine.getCityAt(c, r),
      obstacles,
    );
    return result.path;
  }

  /**
   * Keep the engine's GoTo path aligned with the AI's current destination.
   * When the destination changed, the stale path is dropped and the freshly
   * computed route is registered, so TurnManager can continue walking it next
   * turn and processAutomatedMovements never walks the unit backward.
   */
  private syncAIPath(
    unit: Unit,
    target: { col: number; row: number },
    path: { col: number; row: number }[],
  ): void {
    const roundManager = this.gameEngine.roundManager;
    if (!roundManager) return;
    const previous = unit._aiMoveTarget;
    const changed = !previous || previous.col !== target.col || previous.row !== target.row;
    if (changed) roundManager.clearUnitPath(unit.id);
    unit._aiMoveTarget = { col: target.col, row: target.row };
    if (path.length > 2) {
      roundManager.setUnitPath(unit.id, path.slice(2));
    }
  }

  /**
   * The best tile a warhead this civ owns should be detonated over, or null
   * when nothing justifies spending 160 shields and a 5-gold-per-turn upkeep.
   *
   * "Target key enemy cities and key enemy military units" — so a city scores
   * on population (capitals first), a unit stack scores on summed combat
   * strength, and a lone weak unit is never worth a warhead. The blast is two
   * tiles, so anything we have standing next to the target would die with it:
   * a strike that would touch our own troops is never chosen.
   *
   * Only civs we are actually at war with (plus the barbarian faction) are
   * targets, so a peacetime AI holds its arsenal until the war it is fighting
   * says otherwise.
   */
  private chooseNuclearStrike(
    unit: Unit,
  ): { col: number; row: number; score: number; reason: string } | null {
    const grid = this.gameEngine.squareGrid;
    const dm = this.gameEngine.diplomacyManager;
    if (!grid || !dm) return null;

    const civId = unit.civilizationId;
    const enemies = new Set((dm.getEnemies?.(civId) ?? []).map(Number));
    enemies.add(BARBARIAN_CIV_ID);
    if (enemies.size === 0) return null;

    const hostile = (other: { civilizationId: number }) =>
      enemies.has(Number(other.civilizationId));
    const inBlast = (col: number, row: number, at: { col: number; row: number }) =>
      grid.chebyshevDistance(at.col, at.row, col, row) <= NUCLEAR_BLAST_RADIUS;
    // Friendly fire is a hard veto: our own troops in the blast make the
    // target unusable, however juicy it is.
    const ownInBlast = (at: { col: number; row: number }) =>
      this.gameEngine.units.some(
        (u) =>
          !u.isDefeated &&
          u.civilizationId === civId &&
          inBlast(u.col, u.row, at),
      );

    let best: { col: number; row: number; score: number; reason: string } | null = null;
    const consider = (at: { col: number; row: number }, score: number, reason: string) => {
      if (ownInBlast(at)) return;
      if (!best || score > best.score) best = { col: at.col, row: at.row, score, reason };
    };

    // 1. Key enemy cities. Population is what makes a city worth a nuke, and
    //    a capital is worth extra because it carries the government.
    for (const city of this.gameEngine.cities) {
      if (city.civilizationId === civId || !hostile(city)) continue;
      const garrison = this.gameEngine.units.filter(
        (u) => !u.isDefeated && hostile(u) && inBlast(u.col, u.row, city),
      ).length;
      const score = (city.population ?? 1) * 10 + garrison * 6 + (city.isCapital === true ? 25 : 0);
      consider(city, score, `enemy city ${city.name}`);
    }

    // 2. Key enemy military units: a stack we can wipe in one blast. A single
    //    weak unit is never worth the warhead.
    for (const enemy of this.gameEngine.units) {
      if (enemy.isDefeated || enemy.civilizationId === civId || !hostile(enemy)) continue;
      if ((enemy.attack ?? 0) <= 0) continue;
      const stack = this.gameEngine.units.filter(
        (u) => !u.isDefeated && hostile(u) && inBlast(u.col, u.row, enemy),
      );
      const strength = stack.reduce(
        (sum, u) => sum + Math.max(1, u.attack ?? 0) + (u.defense ?? 0) * 0.5,
        0,
      );
      if (stack.length < 2 && strength < 12) continue;
      consider(enemy, strength, `enemy stack of ${stack.length}`);
    }

    return best;
  }

  /**
   * Choose a target for AI unit
   */
  private chooseAITarget(unit: Unit): { col: number; row: number } | null {
    if (!this.gameEngine.map || !this.gameEngine.squareGrid) return null;

    // A unit reserved for a naval invasion ignores everything else: walk to
    // the boarding beach, and once it is ashore, march on the enemy city. It
    // is usually the only way to reach that city at all. Every unit in the
    // landing force is reserved, not just the one that happened to be picked
    // first — a hull that could only ever lift a single spear could not take a
    // city at all.
    const invasionStorage = this.gameEngine.getPlayerStorage?.(unit.civilizationId);
    const invasion = this.getInvasionMission(invasionStorage);
    if (invasion && (invasion.troopIds.includes(unit.id) || invasion.landedIds.includes(unit.id))) {
      if (invasion.stage === 'gather') return invasion.rendezvous;
      if (invasion.stage === 'siege' || invasion.landedIds.includes(unit.id)) {
        const targetCity = this.gameEngine.cities.find((c) => c.id === invasion.targetCityId);
        if (targetCity) return { col: targetCity.col, row: targetCity.row };
        // The city is gone (captured or razed): the job is done.
        this.clearInvasionMission(invasionStorage);
        return null;
      }
      // stage 'sail' — the unit is aboard the ferry and the ferry is driving.
      return null;
    }

    // Fisher Boats: a routed boat is driven by the engine's automatic fishing
    // state machine (advanceFishing); an unrouted one heads for the nearest
    // known fish tile, where it deploys its net.
    if (unit.type === 'fisher_boat') {
      if (unit.fishingRoute) return null;
      return this.findFishingGround(unit);
    }

    // Naval units never use the land targeting logic — they hunt enemy ships,
    // blockade known enemy coastal cities, or patrol/explore open water.
    if (this.isNavalUnitType(unit.type)) {
      return this.chooseNavalTarget(unit);
    }

    const storage = this.gameEngine.getPlayerStorage?.(unit.civilizationId);
    const aiState: AIState = (storage?.turnData?.aiState as AIState) ?? createDefaultAIState();

    // ── Army group targeting for combat units ──
    // A committed group (marching/attacking) overrides the retreat check: a
    // unit that breaks formation mid-assault leaves the group too weak to
    // fight and the assault never happens.
    if (this.isCombatUnit(unit)) {
      const groupTarget = AICoordinator.getGroupTarget(unit.id, aiState.armyGroups);
      const groupCommitted = groupTarget?.groupStatus === 'marching' || groupTarget?.groupStatus === 'attacking';

      if (!groupCommitted) {
        // ── Retreat check for uncommitted combat units ──
        const localEnemyStrength = this.estimateLocalEnemyStrength(unit);
        const unitStrength = Math.max(1, unit.attack || 0) + (unit.defense || 0) * 0.5;
        const isInGroup = aiState.armyGroups.some(g => g.unitIds.includes(unit.id));

        if (AICoordinator.shouldRetreat(unitStrength, localEnemyStrength, isInGroup)) {
          debugLog(`[AI] Unit ${unit.id} retreating (own: ${unitStrength.toFixed(1)}, enemy: ${localEnemyStrength.toFixed(1)})`);
          const friendlyCities = this.gameEngine.cities.filter((c: City) => c.civilizationId === unit.civilizationId);
          const distFn = (c1: number, r1: number, c2: number, r2: number) =>
            this.gameEngine.squareGrid?.squareDistance(c1, r1, c2, r2) ?? Infinity;
          const retreat = AICoordinator.getRetreatTarget(
            unit.col, unit.row, friendlyCities, aiState.armyGroups, distFn
          );
          if (retreat) return retreat;
        }
      }

      if (groupTarget) {
        debugLog(`[AI] Army group target for ${unit.id}: (${groupTarget.col},${groupTarget.row}) [${groupTarget.groupStatus}]`);
        return { col: groupTarget.col, row: groupTarget.row };
      }

      // ── Wide-area enemy scan (5-tile radius, respects diplomacy) ──
      const distFn = (c1: number, r1: number, c2: number, r2: number) =>
        this.gameEngine.squareGrid?.squareDistance(c1, r1, c2, r2) ?? Infinity;
      const dm = this.gameEngine.diplomacyManager;
      // Scan everything in radius and RECORD it into global intelligence — the
      // offensive planner can only plan against enemies it knows about, and
      // scouts alone proved too unreliable (stuck scouts starved the whole
      // war-planning pipeline, so no war was ever declared). Any unit that sees
      // the enemy feeds the planner.
      const scannedEnemies = scanAreaForEnemies(
        unit.col, unit.row, unit.civilizationId, 5,
        () => this.gameEngine.units,
        () => this.gameEngine.cities,
        distFn
      );
      for (const e of scannedEnemies) {
        if (typeof this.gameEngine.recordEnemyLocation === 'function') {
          this.gameEngine.recordEnemyLocation(unit.civilizationId, {
            col: e.col, row: e.row,
            targetType: e.type, targetId: e.id, distance: e.distance, priority: e.type === 'city' ? 2 : 1,
          });
        }
      }
      // Respond only to civs we are at war with — plus the barbarian faction,
      // which has no diplomacy relation entries but is always hostile. The AI
      // must attack/capture barbarian cities exactly like any other enemy's.
      const nearbyEnemies = scannedEnemies.filter(e => {
        const targetCivId = this.getOwnerCivId(e);
        if (targetCivId === BARBARIAN_CIV_ID) return true;
        // Only target civs we are at war with
        return targetCivId !== undefined && (!dm || dm.isAtWar(unit.civilizationId, targetCivId));
      }).filter(e =>
        // Land units can only act on enemies on their own landmass. Targets on
        // another continent are excluded until the civ can build ships and
        // invade — a unit must never march to the coast and freeze there.
        this.areLandConnected(unit.col, unit.row, e.col, e.row),
      );

      if (nearbyEnemies.length > 0) {
        const closest = nearbyEnemies[0];
        debugLog(`[AI] Area scan found ${nearbyEnemies.length} enemies near ${unit.id}, closest: ${closest.type} at (${closest.col},${closest.row}) dist=${closest.distance}`);

        // Broadcast threat alert so other nearby units rally
        this.broadcastThreatAlert(unit.civilizationId, closest.col, closest.row, closest.strength, storage);

        // If enemy is adjacent, attack directly
        if (closest.distance === 1) {
          return { col: closest.col, row: closest.row };
        }

        // Move toward enemy using terrain-aware intercept
        const intercept = findInterceptPosition(
          unit.col, unit.row, closest.col, closest.row,
          (c, r) => this.gameEngine.squareGrid!.getNeighbors(c, r),
          (c, r) => {
            const tile = this.gameEngine.getTileAt(c, r);
            if (!tile) return null;
            // Enrich the raw tile with the engine's position-aware land
            // passability (includes the wide-river rule) — without this the
            // intercept helper saw `passable === undefined` everywhere.
            return {
              ...tile,
              type: String(tile.type ?? tile.terrain ?? ''),
              passable: this.gameEngine.isTilePassable?.(c, r) ?? true,
            };
          },
          (c, r) => this.gameEngine.getUnitAt(c, r),
          distFn
        );
        if (intercept) {
          debugLog(`[AI] Intercepting enemy via defensive terrain at (${intercept.col},${intercept.row})`);
          return intercept;
        }

        // Direct move toward enemy
        return { col: closest.col, row: closest.row };
      }

      // ── Sticky commitment: keep the previous target for a few rounds so the
      // unit does not flip between target sources every single turn (defend
      // home ↔ attack enemy ↔ probe), which is the "walk up and down" pattern.
      // Combat (enemy within scan radius, handled above) and retreat still
      // preempt the sticky target.
      const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
      const committed = unit._aiCommittedTarget;
      if (committed) {
        if (committed.target.col === unit.col && committed.target.row === unit.row) {
          delete unit._aiCommittedTarget; // reached — pick something new
        } else if (roundNumber - committed.round < 4 && this.isCommittedTargetValid(unit, committed.target)) {
          return committed.target;
        } else {
          delete unit._aiCommittedTarget; // stale or invalid — re-evaluate
        }
      }
      const remember = (target: { col: number; row: number } | null): { col: number; row: number } | null => {
        if (target) unit._aiCommittedTarget = { target, round: roundNumber };
        return target;
      };

      // ── Respond to threat alerts from allied units ──
      const alertTarget = this.getActiveAlertTarget(unit, storage);
      if (alertTarget) {
        debugLog(`[AI] Unit ${unit.id} responding to threat alert at (${alertTarget.col},${alertTarget.row})`);
        return remember(alertTarget);
      }

      // ── Defend threatened cities ──
      const strategicTarget = this.selectStrategicTarget(unit as Unit);
      if (strategicTarget) {
        debugLog(`[AI] Strategic target chosen for ${unit.type} ${unit.id} -> (${strategicTarget.col}, ${strategicTarget.row})`);
        return remember(strategicTarget);
      }

      // ── Collect villages (goody huts) before probing outward ──
      // Villages are one-time free rewards (tech/gold/units/city) sitting in
      // territory the civ has already scouted. The old ordering checked
      // villages LAST (after the probe and forward picket), so idle units
      // always chased unexplored tiles or enemy leads first and villages were
      // only ever collected by accident — the 167-round log shows a single
      // village-granted mercenary in 167 rounds.
      const villageTarget = this.findNearestVillage(unit);
      if (villageTarget) {
        debugLog(`[AI] Unit ${unit.id} (${unit.type}) heading to village at (${villageTarget.col},${villageTarget.row})`);
        return remember(villageTarget);
      }

      // ── Probe outward when idle: idle military units expand the frontier ──
      // Without this the army sat in its capital forever and never made
      // contact with the enemy, so no intel → no war → no planned play.
      const probeTarget = this.findCombatProbeTarget(unit, storage, distFn);
      if (probeTarget) {
        debugLog(`[AI] Probe target for ${unit.id}: (${probeTarget.col},${probeTarget.row})`);
        return remember(probeTarget);
      }

      // ── Forward picket: idle units push toward the frontier ──
      // After the walk-up-and-down fix removed the patrol, an idle unit whose
      // local area was fully explored had nothing left to do and froze at
      // home. With both sides parked apart, no contact was made: no intel →
      // no war plan → no aggression (the 205-round log shows 0-3 attacks).
      // A forward picket marches toward the nearest KNOWN enemy (even stale
      // intel — re-contacting refreshes it) or, with no intel at all, toward
      // the nearest unexplored tile, keeping the front line moving.
      const picketTarget = this.findForwardPicketTarget(unit, distFn);
      if (picketTarget) {
        debugLog(`[AI] Forward picket for ${unit.id}: (${picketTarget.col},${picketTarget.row})`);
        return remember(picketTarget);
      }

      // ── Patrol between cities when idle ──
      const patrolTarget = findPatrolWaypoint(
        unit, unit.col, unit.row,
        this.gameEngine.cities,
        unit.civilizationId,
        distFn
      );
      if (patrolTarget) {
        debugLog(`[AI] Patrol waypoint for ${unit.id}: (${patrolTarget.col},${patrolTarget.row})`);
        return remember(patrolTarget);
      }
    }

      // ── Garrison duty: after every task, before idle wandering ─────────
      // The ordering is the whole design. Above the army group it turned the AI
      // into a garrison that never attacked; above the defence task a soldier
      // walked onto the city tile instead of standing beside it. It sits last,
      // after the march, the fight, the sticky target, the threat alert, the
      // defence order and the frontier work, and and after patrol/probing — so a garrison is what a unit
      // does with a turn it had nothing else to spend on, never a way to avoid a
      // task it was given. Units already committed to a group are left alone;
      // taking them back would undo the planner.
      // Recomputed here rather than reusing the combat branch's local: this
      // block sits below it, after patrol and probing.
      const post2 = AICoordinator.getGroupTarget(unit.id, aiState.armyGroups);
      const committedNow = post2?.groupStatus === 'marching' || post2?.groupStatus === 'attacking';

      if (!committedNow) {
        const post = this.findGarrisonPost(unit, aiState.armyGroups);
        if (post) {
          debugLog(`[AI] Unit ${unit.id} takes garrison duty at (${post.col},${post.row})`);
          return post;
        }
      } else {
        // Second pass, and only this one: a committed soldier is normally
        // untouchable, but not while a city it could be defending stands empty.
        const lastResort = this.findGarrisonPost(unit, aiState.armyGroups, true);
        if (lastResort) {
          debugLog(`[AI] Unit ${unit.id} breaks from its group to cover an empty city at (${lastResort.col},${lastResort.row})`);
          return lastResort;
        }
      }

    // ── Caravan delivery: send to a friendly city to establish a trade route ──
    // Civ1: Caravans are consumed when they deliver to a city, establishing a
    // permanent trade route. The AI sends them to the nearest friendly city
    // with fewer than 3 trade routes. This is a peacetime economy boost.
    if (unit.type === 'caravan') {
      const target = this.chooseCaravanDeliveryTarget(unit);
      if (target) {
        debugLog(`[AI-CARAVAN] Caravan ${unit.id} heading to city at (${target.col},${target.row}) for trade route`);
        return target;
      }
      // No suitable city — skip the Caravan (it sits and waits).
      this.gameEngine.skipUnit(unit.id);
      return null;
    }

    // Diplomats head to a known foreign city to open negotiations (Civ I).
    if (unit.type === 'diplomat') {
      const diplomatTarget = this.chooseDiplomatTarget(unit);
      if (diplomatTarget) {
        debugLog(`[AI-DIPLOMAT] Diplomat ${unit.id} heading to foreign city (${diplomatTarget.col},${diplomatTarget.row})`);
        return diplomatTarget;
      }
      // No known foreign city — fall through and explore like other civilians.
    }

    // Special handling for settlers: the movement loop's settler interception
    // already ran the settlement search this turn and cached the result here,
    // so founding a city takes priority over everything else. When no spot was
    // found (and no improvement to build) the settler falls through and
    // explores like any other civilian.
    if (unit.type === 'settler') {
      // Colony mission: this settler is reserved for a small island. Walk to
      // the coast and wait for the ferry instead of founding at home.
      const mission = this.getColonyMission(storage);
      if (mission && mission.settlerId === unit.id && mission.stage === 'gather') {
        const rendezvous = this.findColonyRendezvous(unit);
        if (rendezvous) {
          return rendezvous;
        }
      }

      const cached = unit._aiSettlement;
      if (cached) {
        debugLog(`[AI-SETTLER] Settler ${unit.id} heading to settlement (${cached.col},${cached.row})`);
        return { col: cached.col, row: cached.row };
      }
      // Late-game infrastructure mode: the settler was assigned a field of one
      // of its own cities to work and walks there instead of founding.
      const worksTile = unit._aiWorksTarget;
      if (worksTile) {
        debugLog(`[AI-INFRA] Settler ${unit.id} heading to works tile (${worksTile.col},${worksTile.row})`);
        return { col: worksTile.col, row: worksTile.row };
      }
      // Civ1 income strategy: no settlement worth founding — walk to the
      // nearest friendly worked tile (grassland/plains/desert) lacking a road
      // and build a road there to boost the city's commerce → tax + science.
      if (!unit.workTarget) {
        const tradeRoad = this.findTradeRoadTarget(unit);
        if (tradeRoad) {
          debugLog(`[AI-SETTLER] Settler ${unit.id} heading to worked tile (${tradeRoad.col},${tradeRoad.row}) to build a trade road`);
          // Record it. The movement loop's "did I arrive?" test is keyed on
          // `_aiWorksTarget`, so returning a works tile WITHOUT recording it
          // sent the settler there and then let it hold at the target with
          // nothing to do — a whole turn spent standing on the field it had
          // been sent to improve.
          unit._aiWorksTarget = tradeRoad;
          unit._aiSettlement = null;
          return tradeRoad;
        }
      }
      unit._aiWorksTarget = null;
    }

    // Special handling for scouts: use EnemySearcher to find enemies
    if (unit.type === 'scout') {
      debugLog(`[AI-SCOUT] Scout detected at (${unit.col}, ${unit.row}), checking for enemies`);

      // Defense override: exploration is less important than garrisoning an
      // undefended friendly city while an enemy is close. When the threat
      // clears (enemy gone or other troops arrive) this returns null and the
      // scout resumes exploring.
      try {
        const defenseTarget = this.findScoutDefenseTarget(unit);
        if (defenseTarget) {
          debugLog(`[AI-SCOUT] Defending undefended city at (${defenseTarget.col},${defenseTarget.row}) — enemy close`);
          return defenseTarget;
        }
      } catch (error) {
        console.error(`[AI-SCOUT] Error in scout defense check:`, error);
      }

      // Scouts collect scouted villages before resuming zone exploration —
      // the one-time rewards (free tech, units, gold, even a city) are worth
      // a short detour, and the village is consumed so the scout returns to
      // reconnaissance immediately after.
      {
        const scoutVillage = this.findNearestVillage(unit);
        if (scoutVillage) {
          debugLog(`[AI-SCOUT] Scout ${unit.id} heading to village at (${scoutVillage.col},${scoutVillage.row})`);
          return scoutVillage;
        }
      }

      try {
        // Check if scout already found an enemy (stored in unit state)
        if (unit.enemyFound) {
          debugLog(`[AI-SCOUT] Scout ${unit.id} has found enemy, returning to nearest city`);
          const nearestCity = AIUtility.findNearestOwnCity(
            unit.col,
            unit.row,
            unit.civilizationId,
            this.gameEngine.cities,
            (col1, row1, col2, row2) => this.gameEngine.squareGrid!.squareDistance(col1, row1, col2, row2)
          );
          if (nearestCity) {
            // Once home, clear the return order so this scout can resume
            // reconnaissance next turn. Leaving enemyFound set made it
            // select its own city forever and starved the army's intelligence.
            if (nearestCity.col === unit.col && nearestCity.row === unit.row) {
              unit.enemyFound = false;
              unit.enemyLocation = undefined;
            } else {
              debugLog(`[AI-SCOUT] Scout returning to nearest city at (${nearestCity.col}, ${nearestCity.row})`);
              return { col: nearestCity.col, row: nearestCity.row };
            }
          }
        }

        // Phase 1: Initialize scout zones for this civilization
        this.gameEngine.assignScoutZones(unit.civilizationId);

        // Find this scout's zone index
        const scouts = this.gameEngine.units.filter((u: Unit) => u.civilizationId === unit.civilizationId && u.type === 'scout');
        const scoutIndex = scouts.findIndex(s => s.id === unit.id);
        debugLog(`[AI-SCOUT] Scout ${scoutIndex + 1}/${scouts.length} searching zone ${scoutIndex}`);

        // Get visibility check function - use per-player visibility storage
        const playerStorage = this.gameEngine.getPlayerStorage(unit.civilizationId);
        const isVisible = (col: number, row: number) => {
          if (playerStorage) {
            const idx = row * this.gameEngine.map!.width + col;
            return playerStorage.visibility[idx] || playerStorage.explored[idx] || false;
          }
          // Fallback to tile visibility if storage not available
          const tile = this.gameEngine.getTileAt(col, row);
          return tile && (tile.visible || tile.explored);
        };

        // Phase 1 & 4: Search only within scout's assigned zone with performance monitoring
        const enemyResult = this.gameEngine.measurePerformance('Scout enemy search', () =>
          EnemySearcher.findNearestEnemy(
            unit.col,
            unit.row,
            this.gameEngine.map.width,
            this.gameEngine.map.height,
            (col, row) => {
              // Filter getUnitAt results to zone boundary
              if (scoutIndex >= 0 && !this.gameEngine.isInScoutZone(unit.civilizationId, scoutIndex, col, row)) return null;
              return this.gameEngine.getUnitAt(col, row);
            },
            (col, row) => {
              // Filter getCityAt results to zone boundary
              if (scoutIndex >= 0 && !this.gameEngine.isInScoutZone(unit.civilizationId, scoutIndex, col, row)) return null;
              return this.gameEngine.getCityAt(col, row);
            },
            isVisible,
            unit.civilizationId
          )
        );

        if (enemyResult) {
          debugLog(`[AI-SCOUT] Enemy ${enemyResult.targetType} found at (${enemyResult.col}, ${enemyResult.row}), distance: ${enemyResult.distance}`);

          // Phase 3.3: Check if this enemy was already discovered by another scout
          const storage = this.gameEngine.getPlayerStorage(unit.civilizationId);
          let alreadyKnown = false;
          if (storage) {
            // Get enemy civilization ID
            let enemyCivId = -1;
            if (enemyResult.targetType === 'unit') {
              const unit = this.gameEngine.getUnitAt(enemyResult.col, enemyResult.row);
              if (unit) enemyCivId = unit.civilizationId;
            } else if (enemyResult.targetType === 'city') {
              const city = this.gameEngine.getCityAt(enemyResult.col, enemyResult.row);
              if (city) enemyCivId = city.civilizationId;
            }

            if (enemyCivId >= 0 && storage.enemyLocations.has(enemyCivId)) {
              const existing = storage.enemyLocations.get(enemyCivId)!.find(e => e.id === enemyResult.targetId);
              if (existing) {
                alreadyKnown = true;
                debugLog(`[AI-SCOUT] Enemy ${enemyResult.targetType} at (${enemyResult.col}, ${enemyResult.row}) already known, updating last seen`);
                existing.lastSeenRound = this.gameEngine.roundManager.getRoundNumber();
              }
            }
          }

          if (!alreadyKnown) {
            // Store enemy location in player storage for civilization-wide decision making
            this.gameEngine.recordEnemyLocation(unit.civilizationId, enemyResult);

            // Civ1: a scout that spots a lone enemy UNIT keeps exploring — the
            // army handles units. Only an enemy CITY is valuable enough to
            // report home (it feeds the offensive plan so the army can
            // besiege it). Previously the scout returned home on ANY enemy
            // contact, so enemy cities were never recorded and the AI never
            // laid siege (its armies only ever chased dead unit locations).
            if (enemyResult.targetType === 'city') {
              const targetCity = this.gameEngine.getCityAt(enemyResult.col, enemyResult.row);

              // Scout rush: if the enemy city is undefended, the AI scout
              // attempts a 30% rush capture instead of running home.
              if (targetCity && targetCity.civilizationId !== unit.civilizationId) {
                const cityDefenders = this.gameEngine.units.filter(
                  (u: Unit) => u.civilizationId === targetCity.civilizationId
                    && u.col === targetCity.col
                    && u.row === targetCity.row
                    && u.isDefeated !== true
                    && u.id !== unit.id,
                );
                if (cityDefenders.length === 0) {
                  // Move the scout onto the city tile — moveUnit will
                  // evaluate the 30% rush chance automatically.
                  debugLog(`[AI-SCOUT] Rush opportunity: undefended city ${targetCity.name} at (${enemyResult.col},${enemyResult.row})`);
                  return { col: enemyResult.col, row: enemyResult.row };
                }
              }

              // Mark that scout found enemy
              unit.enemyFound = true;
              unit.enemyLocation = { col: enemyResult.col, row: enemyResult.row };

              // Start returning to nearest city
              const nearestCity = AIUtility.findNearestOwnCity(
                unit.col,
                unit.row,
                unit.civilizationId,
                this.gameEngine.cities,
                (col1, row1, col2, row2) => this.gameEngine.squareGrid!.squareDistance(col1, row1, col2, row2)
              );
              if (nearestCity) {
                debugLog(`[AI-SCOUT] Scout returning to nearest city at (${nearestCity.col}, ${nearestCity.row})`);
                return { col: nearestCity.col, row: nearestCity.row };
              }
            }
            // Enemy unit spotted: record it for the army, then keep exploring
            // (fall through to the zone search below) to find their cities.
          }
        } else {
          debugLog(`[AI-SCOUT] No enemy found near (${unit.col}, ${unit.row}), continuing exploration`);
        }
      } catch (error) {
        console.error(`[AI-SCOUT] Error using EnemySearcher:`, error);
      }
    }

    // 1) Nearby enemy unit (check before exploration for combat awareness)
    const enemy = AIUtility.findNearbyEnemy(
      unit.col,
      unit.row,
      unit.civilizationId,
      (col, row) => this.gameEngine.squareGrid!.getNeighbors(col, row),
      (col, row) => this.gameEngine.getUnitAt(col, row)
    );
    if (enemy) {
      // Scouts are intelligence units, not disposable melee units.  When a
      // hostile unit blocks the direct route, choose a passable waypoint on
      // either side of it.  This creates a real flanking/scouting flow: the
      // scout keeps looking for a route around the enemy and can reach the
      // unexplored territory behind it instead of repeating contact/retreat.
      if (unit.type === 'scout') {
        const flank = this.findScoutRouteAroundEnemy(unit, enemy as { col: number; row: number });
        if (flank) {
          debugLog(`[AI-SCOUT] Routing around enemy at (${enemy.col},${enemy.row}) via (${flank.col},${flank.row})`);
          return flank;
        }
      }
      debugLog(`[AI] Chose enemy unit at (${enemy.col},${enemy.row})`);
      return { col: enemy.col, row: enemy.row };
    }

    // 2) Nearby unexplored tile
    const unexplored = AIUtility.findNearbyUnexplored(
      unit.col,
      unit.row,
      (col, row) => this.gameEngine.squareGrid!.getNeighbors(col, row),
      (col, row) => this.gameEngine.getTileAt(col, row) as { type: string; explored?: boolean; resource?: string | null; fortress?: boolean; river?: boolean; passable?: boolean } | null | undefined,
      // Island movement + reachability filter:
      //  - only unexplored tiles on the unit's own landmass are reachable by
      //    land (across the water needs a ship),
      //  - tiles the scout already failed to enter (blocked-target guard) are
      //    skipped so it stops re-picking the same occupied/blocked tile,
      //  - tiles held by a friendly unit are skipped (no stacking).
      (col, row) => {
        if (!(this.gameEngine.isTilePassable?.(col, row) ?? true)) return false;
        if (!this.areLandConnected(unit.col, unit.row, col, row)) return false;
        if (unit._blockedScoutTargets instanceof Set && unit._blockedScoutTargets.has(`${col},${row}`)) return false;
        const occupant = this.gameEngine.getUnitAt?.(col, row);
        if (occupant && occupant.civilizationId === unit.civilizationId) return false;
        return true;
      },
      (col, row) => typeof this.gameEngine.isExploredByPlayer === 'function'
        ? this.gameEngine.isExploredByPlayer(unit.civilizationId, col, row)
        : !!this.gameEngine.getTileAt(col, row)?.explored
    );
    if (unexplored) {
      debugLog(`[AI] Chose unexplored tile at (${unexplored.col},${unexplored.row})`);
      return { col: unexplored.col, row: unexplored.row };
    }

    // ScoutMemory: re-scout stale enemy positions if no immediate exploration targets.
    // Scans discoveries of ALL enemy civs (previously it searched the scout's OWN
    // civ id, which never matched anything).
    if (unit.type === 'scout' && this.gameEngine.scoutMemory) {
      const staleTarget = this.gameEngine.scoutMemory.getNearestStaleTarget?.(
        unit.col, unit.row, unit.civilizationId
      );
      if (staleTarget && (staleTarget.col !== unit.col || staleTarget.row !== unit.row)) {
        debugLog(`[AI-SCOUT] ScoutMemory target at (${staleTarget.col},${staleTarget.row})`);
        return { col: staleTarget.col, row: staleTarget.row };
      }
    }

    // Special exploration logic for scouts when no immediate unexplored tiles
    if (unit.type === 'scout') {
      const scoutExplorationTarget = this.findScoutExplorationTarget(unit);
      if (scoutExplorationTarget) {
        debugLog(`[AI-SCOUT] Chose exploration target at (${scoutExplorationTarget.col},${scoutExplorationTarget.row})`);
        return { col: scoutExplorationTarget.col, row: scoutExplorationTarget.row };
      }
    }

    // 3) Choose best neighbor based on terrain cost
    debugLog(`[AI] No unexplored or enemy targets found, choosing best neighbor`);

    const neighbors = this.gameEngine.squareGrid.getNeighbors(unit.col, unit.row);
    const terrainAnalysis = AIUtility.analyzeSurroundingTerrain(
      unit.col,
      unit.row,
      neighbors,
      (col, row) => this.gameEngine.getTileAt(col, row) as { type: string; explored?: boolean; resource?: string | null; fortress?: boolean; river?: boolean; passable?: boolean } | null | undefined,
      (col, row) => this.gameEngine.getUnitAt(col, row),
      (col, row) => this.gameEngine.squareGrid!.isValidSquare(col, row)
    );
    if (terrainAnalysis.passableMoves.length > 0) {
      debugLog(`[AI] Terrain analysis: ${terrainAnalysis.passableMoves.length} passable tiles, min cost: ${terrainAnalysis.minCost}, avg cost: ${terrainAnalysis.averageCost.toFixed(1)}`);

      const bestMove = AIUtility.chooseBestMove(terrainAnalysis);
      if (bestMove) {
        const terrainName = AIUtility.getTerrainName(bestMove.terrainType);
        debugLog(`[AI] Chose best neighbor at (${bestMove.col},${bestMove.row}) - ${terrainName} (cost: ${bestMove.moveCost})`);
        return { col: bestMove.col, row: bestMove.row };
      }
    }

    debugLog(`[AI] No valid target found for unit ${unit.id}`);
    return null;
  }

  /** Pick a safe waypoint that moves a scout around a nearby blocking enemy. */
  public findScoutRouteAroundEnemy(
    scout: Pick<Unit, 'col' | 'row' | 'civilizationId'>,
    enemy: Pick<Unit, 'col' | 'row'>
  ): { col: number; row: number } | null {
    const grid = this.gameEngine.squareGrid;
    if (!grid) return null;

    const dx = scout.col - enemy.col;
    const dy = scout.row - enemy.row;
    const side = Math.abs(dx) >= Math.abs(dy) ? { col: 0, row: 1 } : { col: 1, row: 0 };
    const candidates = [
      { col: enemy.col + side.col * 2, row: enemy.row + side.row * 2 },
      { col: enemy.col - side.col * 2, row: enemy.row - side.row * 2 },
      { col: enemy.col + side.col * 3, row: enemy.row + side.row * 3 },
      { col: enemy.col - side.col * 3, row: enemy.row - side.row * 3 },
    ];

    return candidates
      .filter((candidate) => grid.isValidSquare(candidate.col, candidate.row))
      .filter((candidate) => this.gameEngine.isTilePassable?.(candidate.col, candidate.row) ?? true)
      .filter((candidate) => !this.gameEngine.getUnitAt?.(candidate.col, candidate.row))
      .map((candidate) => ({
        ...candidate,
        distance: grid.squareDistance(scout.col, scout.row, candidate.col, candidate.row),
      }))
      .sort((a, b) => a.distance - b.distance)[0] ?? null;
  }

  // ─── AI diplomat units (Civ I: diplomats move to an enemy city/unit to
  //      initiate diplomacy) ───────────────────────────────────────────

  /**
   * Pick a destination for an AI Caravan: the nearest friendly city with fewer
   * than 3 trade routes. When the Caravan arrives and moves onto that city's
   * tile, GameEngine.moveUnit automatically calls establishTradeRoute (the
   * existing Civ1 delivery mechanic), consuming the Caravan and creating a
   * permanent trade route.
   */
  private chooseCaravanDeliveryTarget(unit: Unit): { col: number; row: number } | null {
    const civId = unit.civilizationId;
    const squareDistance = (c1: number, r1: number, c2: number, r2: number) =>
      this.gameEngine.squareGrid?.squareDistance(c1, r1, c2, r2) ?? Infinity;
    const home = this.gameEngine.getCaravanHomeCity?.(unit) ?? null;
    const homePop = home?.population ?? 1;
    const dm = this.gameEngine.diplomacyManager;

    // Route value, not proximity: payout/route-trade scale with population and
    // distance (foreign ×2), so a farther high-population city is worth walking
    // to. Land caravans cannot cross water, so only land-connected cities are
    // candidates.
    let best: { col: number; row: number; value: number } | null = null;
    const consider = (city: City, foreign: boolean): void => {
      if (city.civilizationId === civId && city.col === unit.col && city.row === unit.row) return;
      if ((city.tradeRoutes?.length ?? 0) >= MAX_CARAVAN_TRADE_ROUTES) return;
      if (!this.areLandConnected(unit.col, unit.row, city.col, city.row)) return;
      const dist = Math.max(1, squareDistance(unit.col, unit.row, city.col, city.row));
      const value = (homePop + (city.population ?? 1)) * (1 + dist / 4) * (foreign ? 2 : 1);
      if (!best || value > best.value) {
        best = { col: city.col, row: city.row, value };
      }
    };

    // Domestic routes first — always legal, even at war.
    for (const city of this.gameEngine.cities) {
      if (city.civilizationId === civId) consider(city, false);
    }

    // Known foreign cities we are at peace with are worth double.
    const storage = this.gameEngine.getPlayerStorage?.(civId);
    if (storage?.enemyLocations instanceof Map) {
      for (const [enemyCivId, locations] of storage.enemyLocations.entries()) {
        if (enemyCivId === civId) continue;
        if (dm?.isAtWar?.(civId, enemyCivId)) continue;
        for (const loc of locations) {
          if (loc.type !== 'city') continue;
          const city = this.gameEngine.cities.find(
            (c: City) => c.col === loc.col && c.row === loc.row && c.civilizationId === enemyCivId,
          );
          if (city) consider(city, true);
        }
      }
    }

    return best ? { col: best.col, row: best.row } : null;
  }

  /**
   * Pick a destination for an AI diplomat: the nearest foreign city the civ
   * knows about. Civs we are NOT at war with are preferred (a diplomat walking
   * into a war zone is wasted); among those, pick the nearest.
   */
  private chooseDiplomatTarget(unit: Unit): { col: number; row: number } | null {
    const civId = unit.civilizationId;
    const storage = this.gameEngine.getPlayerStorage?.(civId);
    const dm = this.gameEngine.diplomacyManager;
    const squareDistance = (c1: number, r1: number, c2: number, r2: number) =>
      this.gameEngine.squareGrid?.squareDistance(c1, r1, c2, r2) ?? Infinity;

    const candidates: Array<{ col: number; row: number; civId: number; distance: number }> = [];

    // 1) Known enemy cities recorded by scouts.
    if (storage?.enemyLocations instanceof Map) {
      for (const [enemyCivId, locations] of storage.enemyLocations.entries()) {
        if (enemyCivId === civId) continue;
        for (const loc of locations) {
          if (loc.type !== 'city') continue;
          candidates.push({
            col: loc.col,
            row: loc.row,
            civId: enemyCivId,
            distance: squareDistance(unit.col, unit.row, loc.col, loc.row),
          });
        }
      }
    }

    // 2) Foreign cities this civ has already explored (belt & braces — scouts
    //    may not have recorded every one).
    if (this.gameEngine.cities) {
      for (const city of this.gameEngine.cities) {
        if (city.civilizationId === civId) continue;
        if (typeof this.gameEngine.isExploredByPlayer === 'function' &&
            !this.gameEngine.isExploredByPlayer(civId, city.col, city.row)) continue;
        if (candidates.some(c => c.col === city.col && c.row === city.row)) continue;
        candidates.push({
          col: city.col,
          row: city.row,
          civId: city.civilizationId,
          distance: squareDistance(unit.col, unit.row, city.col, city.row),
        });
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => a.distance - b.distance);
    const atPeace = candidates.filter(c => !dm?.isAtWar(civId, c.civId));
    return (atPeace.length > 0 ? atPeace : candidates)[0];
  }

  /**
   * Choose which diplomatic action an AI diplomat performs on contact with a
   * foreign civ — mirrors `processAIDiplomacy`'s decision logic (peace when
   * outmatched, alliance when friendly, tribute when dominant, else intel).
   */
  private chooseDiplomatAction(unit: Unit, targetCivId: number, available: string[]): string {
    const civId = unit.civilizationId;
    const dm = this.gameEngine.diplomacyManager;
    const ownStrength = dm?.estimateMilitaryStrength?.(civId) ?? 0;
    const theirStrength = dm?.estimateMilitaryStrength?.(targetCivId) ?? 0;
    const attitude = dm?.getAttitude?.(civId, targetCivId) ?? 'neutral';
    const status = dm?.getStatus?.(civId, targetCivId) ?? 'peace';
    const personality = this.gameEngine.civilizations?.[civId]?.personality
      ?? { aggression: 5, diplomacy: 5, military: 5 };
    const has = (a: string) => available.includes(a);

    // A bribe buys an enemy UNIT outright, mid-war, for gold — the fastest way
    // to swing a fight that is going badly, and the one action here that costs
    // money rather than asking for it. Worth it only for a target expensive
    // enough to matter and only when the treasury can survive the fee.
    if (has('bribe_unit') && this.wouldPayToBribe(civId, targetCivId)) {
      return 'bribe_unit';
    }

    if (status === 'war') {
      // Outmatched → sue for peace outright; otherwise a ceasefire.
      if (theirStrength > ownStrength * 1.3 && has('propose_peace')) return 'propose_peace';
      if (has('propose_ceasefire')) return 'propose_ceasefire';
      if (has('propose_peace')) return 'propose_peace';
    } else if (status === 'ceasefire') {
      if (has('propose_peace')) return 'propose_peace';
    } else if (status === 'peace') {
      // Alliance if friendly + comparable strength + a diplomatic leader.
      const ratio = Math.min(ownStrength, theirStrength) / Math.max(ownStrength, theirStrength, 1);
      if (attitude === 'friendly' && ratio > 0.5 && personality.diplomacy >= 6 && has('propose_alliance')) return 'propose_alliance';
      // Otherwise demand tribute when clearly stronger.
      if (personality.aggression >= 6 && ownStrength > theirStrength * 2 && has('demand_tribute')) return 'demand_tribute';
    }

    return 'gather_intelligence';
  }

  /**
   * Whether a bribe is worth attempting right now.
   *
   * `DiplomacyManager.bribeUnit` charges 25 gold × (attack + defense) and only
   * debits on success, so a failed attempt costs nothing but the diplomat — but
   * a successful one is a real transfer. Three things have to line up:
   *
   *  - we are actually at war with them (bribing declares war, so doing it in
   *    peacetime would start a war over it);
   *  - there is a worthwhile unit adjacent to the diplomat, measured in
   *    strength rather than in count — turning a Phalanx is worth more than
   *    three Warriors because its price and its value scale the same way;
   *  - the treasury can pay without dropping below the reserve, since the
   *    money is spent the instant the bribe lands.
   */
  private wouldPayToBribe(civId: number, targetCivId: number): boolean {
    const dm = this.gameEngine.diplomacyManager;
    if (!dm?.isAtWar?.(civId, targetCivId)) return false;

    const diplomat = (this.gameEngine.units ?? []).find(
      u => u.civilizationId === civId && String(u.type ?? '') === 'diplomat' && !u.isDefeated,
    );
    if (!diplomat) return false;

    const gold = this.gameEngine.civilizations?.[civId]?.resources?.gold ?? 0;
    const available = gold - ABSOLUTE_MIN_GOLD;
    if (available <= 0) return false;

    // Best adjacent enemy unit the diplomat could actually reach.
    const grid = this.gameEngine.squareGrid;
    if (!grid) return false;
    let bestValue = 0;
    let bestCost = Infinity;
    for (const other of this.gameEngine.units ?? []) {
      if (other.civilizationId !== targetCivId || other.isDefeated) continue;
      if (grid.squareDistance(diplomat.col, diplomat.row, other.col, other.row) > 1) continue;
      const cost = Math.floor(bribeUnitCost(other));
      if (cost > available) continue;
      const value = (other.attack || 0) + (other.defense || 0);
      if (value > bestValue || (value === bestValue && cost < bestCost)) {
        bestValue = value;
        bestCost = cost;
      }
    }
    if (bestValue <= 0) return false;

    // Only spend on something that meaningfully dents their force: a bribe that
    // buys a single scout is not worth touching the reserve for.
    const theirStrength = dm.estimateMilitaryStrength?.(targetCivId) ?? 0;
    return bestValue >= 3 && bestValue >= theirStrength * 0.1;
  }

  /**
   * The tribute an AI diplomat demands (same formula as processAIDiplomacy).
   */
  private diplomatTributeDemand(unit: Unit, targetCivId: number): number {
    const dm = this.gameEngine.diplomacyManager;
    const ownStrength = dm?.estimateMilitaryStrength?.(unit.civilizationId) ?? 0;
    const theirStrength = dm?.estimateMilitaryStrength?.(targetCivId) ?? 0;
    return Math.max(25, Math.floor((ownStrength / Math.max(theirStrength, 1)) * 20));
  }

  /**
   * Execute an AI diplomat's action when adjacent to a foreign city/unit.
   * Human targets get an interactive offer (negotiation screen); AI targets
   * resolve through the normal proposal path.
   */
  private executeAIDiplomatAction(unit: Unit, info: { targetCivId: number; actions: string[] }): void {
    const civId = unit.civilizationId;
    const targetCivId = info.targetCivId;
    const civ = this.gameEngine.civilizations?.[civId];
    const targetCiv = this.gameEngine.civilizations?.[targetCivId];
    const civName = civ?.name ?? `Civ ${civId}`;
    const action = this.chooseDiplomatAction(unit, targetCivId, info.actions);

    debugLog(`[AI-DIPLOMAT] ${civName} diplomat at (${unit.col},${unit.row}) contacting ${targetCiv?.name ?? targetCivId} → ${action}`);

    if (targetCiv?.isHuman === true) {
      // The human decides — surface an interactive offer, consume the move.
      if (action === 'gather_intelligence') {
        this.gameEngine.executeDiplomatAction?.(unit.id, 'gather_intelligence', targetCivId);
      } else {
        const gold = action === 'demand_tribute' ? this.diplomatTributeDemand(unit, targetCivId) : undefined;
        this.gameEngine.diplomacyManager?.presentOffer?.(
          civId, targetCivId, action as unknown as DiplomatAction, gold,
          `${civName}'s diplomat proposes ${action.replace(/_/g, ' ')}.`,
        );
        unit.movesRemaining = 0;
      }
    } else {
      this.gameEngine.executeDiplomatAction?.(unit.id, action, targetCivId);
    }

    this.gameEngine.log?.('ai', `Diplomat — ${civName} ${action.replace(/_/g, ' ')} with ${targetCiv?.name ?? targetCivId}`);
  }

  /**
   * Improvement budget: at most ~2 improvements per city, so a big civ does
   * not funnel every spare settler into endless road building. In the MID
   * game (several techs researched) the budget grows so the AI invests
   * properly in roads/mines/irrigation. Shared by `chooseImprovementForSettler`
   * and `findTradeRoadTarget` so both use the same allowance.
   */
  improvementBudget(civId: number): number {
    const civ = this.gameEngine.civilizations?.[civId];
    const friendlyCities = this.gameEngine.cities.filter((c: City) => c.civilizationId === civId).length;
    const techs = Array.isArray(civ?.technologies) ? (civ.technologies ?? []) : [];
    // Later eras field a real public-works programme: rail and irrigation on
    // every worked tile is a bigger permanent income/growth lever than another
    // corps of units, so the ceiling scales with the era, not just early techs.
    const eraBoost = techs.length >= 30 ? 6 : techs.length >= 20 ? 5 : techs.length >= 14 ? 3 : techs.length >= 6 ? 2 : 1;
    // Floor of 8 on the FINAL number, not on the multiplier: a one-city civ
    // used to be allowed TWO improvements in its whole empire (the budget
    // counts improvements within 4 tiles of a city), so its fields stayed raw
    // — no roads, no commerce, no luxury, and the city hit civil unrest at
    // size 4 and stayed there. The floor only lifts the early/small case; from
    // six techs on the era term dominates and the ceiling scales as before.
    return Math.max(friendlyCities * 2 * eraBoost, 8);
  }

  /**
   * Whether the civ still has improvements to build on its land (its owned
   * improvements are below the era's budget). AutoProduction keeps a settler
   * corps for it and the settler logic prefers works over joining a city.
   */
  wantsPublicWorks(civId: number): boolean {
    return this.countOwnImprovements(civId) < this.improvementBudget(civId);
  }

  /**
   * Whether some own city's workable area is still less than half improved.
   *
   * Raw tiles cannot pay for the citizens standing on them: no roads means no
   * trade, no trade means no luxury, and no luxury means civil unrest at a
   * size the empire cannot afford. Build-out is therefore NOT subject to the
   * civ-wide improvement budget — a young empire with eight improvements to
   * its name stops building roads at exactly the moment it needs them most.
   */
  citiesNeedBuildOut(civId: number): boolean {
    return this.ownCities(civId).some(
      (c: City) => this.improvedFractionOfCityArea(c) < CITY_AREA_IMPROVED_TARGET,
    );
  }

  /** How many tile improvements the civ already owns near its cities. */
  countOwnImprovements(civId: number): number {
    return (this.gameEngine.map?.tiles ?? []).filter((t: MapTile) =>
      !!t.improvement && ['road', 'railroad', 'mines', 'irrigation', 'fortress'].includes(t.improvement) &&
      this.gameEngine.cities.some((c: City) =>
        c.civilizationId === civId &&
        this.gameEngine.squareGrid.squareDistance(t.col, t.row, c.col, c.row) <= 4
      )
    ).length;
  }

  /**
   * Whether this civ's settlers should work its fields rather than found a new
   * city. Two independent reasons:
   *
   *  - **Late and sprawling**: past {@link LATE_INFRA_CITY_THRESHOLD} cities
   *    running one of {@link LATE_INFRA_PROFILES}.
   *  - **Broke**: at or above the {@link ABSOLUTE_MIN_GOLD} reserve but unable
   *    to net a positive gold. Such a civ has money and no income, so a 7th city
   *    would only add upkeep it cannot pay. The road a settler lays is bought
   *    with shields instead of gold and pays +trade back every turn after. This
   *    is the settler half of the same spiral
   *    {@link AutoProduction.economyBeforeArmy} decides production for, so the
   *    two agree on which civs are in it.
   */
  prefersInfrastructureOverExpansion(civId: number, strategy: StrategyProfile): boolean {
    if (this.brokeButSolvent(civId) && this.wantsPublicWorks(civId)) return true;
    if (!LATE_INFRA_PROFILES.has(strategy)) return false;
    return this.ownCities(civId).length > LATE_INFRA_CITY_THRESHOLD;
  }

  /**
   * Whether this civ owns a city from size 6 on — the size at which the AI is
   * required to start irrigating and paving the tiles around it.
   */
  hasMatureCity(civId: number): boolean {
    return this.ownCities(civId).some(
      (c: City) => (c.population ?? 1) >= MATURE_CITY_POPULATION,
    );
  }

  /**
   * Public: `AutoProduction` uses this to keep a public-works corps of
   * settlers on the payroll while a size-6+ city still has fields to improve.
   */
  hasSettlerWorksMandate(civId: number): boolean {
    return this.hasMatureCity(civId);
  }

  /**
   * Whether a settler may safely work this city's fields right now.
   *
   * The ONLY two reasons the works mission is refused are the two the design
   * calls for: a direct threat to the city, and attacks still going on there.
   *  - **ongoing attack** — the city was assaulted within the last
   *    {@link ONGOING_ATTACK_WINDOW} rounds (`lastAttackedRound` is written by
   *    `GameEngine.resolveCityCombat`);
   *  - **direct threat** — an enemy unit within {@link DIRECT_THREAT_RADIUS},
   *    or the civ's own threat assessment saying this city needs defence.
   */
  private cityIsUnderDirectThreat(city: City, roundNumber: number): boolean {
    const attackedAt = city.lastAttackedRound;
    if (typeof attackedAt === 'number' && roundNumber - attackedAt <= ONGOING_ATTACK_WINDOW) {
      return true;
    }

    const grid = this.gameEngine.squareGrid;
    if (grid) {
      const enemyNear = this.gameEngine.units.some(
        (u: Unit) =>
          !u.isDefeated &&
          u.civilizationId !== city.civilizationId &&
          grid.chebyshevDistance(u.col, u.row, city.col, city.row) <= DIRECT_THREAT_RADIUS,
      );
      if (enemyNear) return true;
    }
    // Deliberately NOT the 8-tile `identifyThreatenedCities` assessment: that
    // is a defence signal ("does this city need an army?") and on a map with
    // barbarians it is true most of the time, which silenced the works
    // programme completely — a city a raider had walked past eight tiles ago
    // never got its roads. The design asks for exactly two blockers: a direct
    // threat (an enemy standing IN the fields) and attacks still going on.
    return false;
  }

  /**
   * A civ that has climbed back to the minimum reserve and still cannot fund
   * another unit: money in hand, no income. Mirrors
   * `AutoProduction.canAffordAnotherUnit`'s test (a projected per-turn surplus of
   * at least 1) rather than reusing it, so neither subsystem has to reach into
   * the other's private state.
   */
  private brokeButSolvent(civId: number): boolean {
    const civ = this.gameEngine.civilizations?.[civId];
    if (!civ) return false;
    if ((civ.resources?.gold ?? 0) < ABSOLUTE_MIN_GOLD) return false;
    const preview = this.gameEngine.economicManager?.previewEconomy?.(civ, {
      tax: civ.taxRate ?? 50,
      science: civ.scienceRate ?? 50,
      luxury: civ.luxuryRate ?? 50,
    });
    return !!preview && preview.net < 1;
  }

  private ownCities(civId: number): City[] {
    return (this.gameEngine.cities ?? []).filter((c: City) => c.civilizationId === civId);
  }

  /**
   * The tiles a city actually works: the `CITY_RADIUS` box with the four far
   * corners dropped, exactly as `EconomicManager.cityTerritory` builds it. Kept
   * in step with that shape on purpose — "how much of my city is improved" is
   * meaningless if it is measured over a different set of tiles than the city
   * gets its food from.
   */
  private cityAreaTiles(city: City): Array<{ col: number; row: number }> {
    const out: Array<{ col: number; row: number }> = [];
    const isValid = (col: number, row: number): boolean =>
      typeof this.gameEngine.squareGrid?.isValidSquare === 'function'
        ? this.gameEngine.squareGrid.isValidSquare(col, row)
        : true;
    for (let dCol = -CITY_RADIUS; dCol <= CITY_RADIUS; dCol++) {
      for (let dRow = -CITY_RADIUS; dRow <= CITY_RADIUS; dRow++) {
        if (dCol === 0 && dRow === 0) continue;
        if (Math.abs(dCol) === CITY_RADIUS && Math.abs(dRow) === CITY_RADIUS) continue;
        const col = city.col + dCol;
        const row = city.row + dRow;
        if (isValid(col, row)) out.push({ col, row });
      }
    }
    return out;
  }

  /** How much of a city's workable area carries an improvement, 0..1. */
  private improvedFractionOfCityArea(city: City): number {
    const tiles = this.cityAreaTiles(city);
    if (tiles.length === 0) return 1;
    let improved = 0;
    for (const { col, row } of tiles) {
      const tile = this.gameEngine.getTileAt(col, row);
      if (tile?.improvement) improved++;
    }
    return improved / tiles.length;
  }

  /**
   * Whether a city needs food: a negative surplus, or one about to run out.
   * Uses the engine's own `cityFoodBalance`, which already charges this
   * settler's own upkeep, so a settler standing in the city counts itself.
   */
  private cityNeedsFood(city: City, civRef: Civilization | undefined): boolean {
    const balance = this.gameEngine.economicManager?.cityFoodBalance?.(city, civRef);
    if (!balance) return false;
    return balance.surplus < 1
      || (balance.turnsUntilStarvation >= 0 && balance.turnsUntilStarvation <= 3);
  }

  /** Whether a tile could carry irrigation at all — the engine's own rule, which
   * looks up to IRRIGATION_WATER_REACH orthogonal steps for fresh water rather
   * than only immediate neighbours. Delegating keeps the AI from walking to
   * tiles the engine would then refuse. */
  private canTileBeIrrigated(col: number, row: number): boolean {
    return typeof this.gameEngine.canSupplyIrrigation === 'function'
      ? this.gameEngine.canSupplyIrrigation(col, row)
      : ORTHOGONAL.some(([dCol, dRow]) => {
        const neighbour = this.gameEngine.getTileAt(col + dCol, row + dRow);
        if (!neighbour) return false;
        const terrain = neighbour.terrain || neighbour.type || '';
        return terrain === 'river' || terrain === 'lake' || neighbour.improvement === IMPROVEMENT_TYPES.IRRIGATION;
      });
  }

  /**
   * The tile this settler should work on the way to serving `city`, or null.
   *
   * Preference order: when the city needs COMMERCE (unhappy and its trade
   * cannot cover its unhappiness) a road on a trade terrain wins, because only
   * trade converts into happiness. Otherwise a field inside the city's own
   * area that can be irrigated — whether the city is short of food OR the
   * settler is there on the size-6 irrigation mandate — then any unimproved
   * field inside the area, then — food-short cities only — an irrigable tile
   * in the margin up to {@link OUTSIDE_IRRIGATION_FIELDS} outside, which
   * chains a ditch back onto the fields it feeds.
   */
  private pickWorksTileForCity(
    unit: Unit,
    city: City,
    needsFood: boolean,
    preferIrrigation = false,
    preferTrade = false,
  ): { col: number; row: number } | null {
    const roadDef = IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.ROAD];
    const roadTerrains = roadDef?.tradeBonusTerrains ?? [];
    const marginRadius = CITY_RADIUS + OUTSIDE_IRRIGATION_FIELDS;

    const workable = (terrain: string): boolean =>
      roadTerrains.includes(terrain)
      || IRRIGABLE_TERRAINS.includes(terrain)
      || MINABLE_TERRAINS.includes(terrain);

    let bestInArea: { col: number; row: number } | null = null;
    let bestInAreaDist = Infinity;
    let bestIrrigation: { col: number; row: number } | null = null;
    let bestIrrigationDist = Infinity;
    let bestOutside: { col: number; row: number } | null = null;
    let bestOutsideDist = Infinity;
    let bestRoad: { col: number; row: number } | null = null;
    let bestRoadScore = -Infinity;

    for (let dCol = -marginRadius; dCol <= marginRadius; dCol++) {
      for (let dRow = -marginRadius; dRow <= marginRadius; dRow++) {
        // BOTH axes. This used to bound only `dCol`, so the whole vertical
        // strip of |dRow| up to marginRadius qualified as "in the city's
        // area" — a works target five rows above the city, which the arrival
        // side (correctly) refused as outside the radius: 62 of the idle
        // settler turns in a pinned 120-round game.
        const inArea = Math.abs(dCol) <= CITY_RADIUS && Math.abs(dRow) <= CITY_RADIUS
          && !(Math.abs(dCol) === CITY_RADIUS && Math.abs(dRow) === CITY_RADIUS);
        const chebyshev = Math.max(Math.abs(dCol), Math.abs(dRow));
        if (!inArea && !needsFood) continue;

        const col = city.col + dCol;
        const row = city.row + dRow;
        if (this.gameEngine.squareGrid?.isValidSquare?.(col, row) === false) continue;
        const tile = this.gameEngine.getTileAt(col, row);
        if (!tile) continue;
        // Skip anything already improved, and skip the centre tile itself.
        if (tile.improvement) continue;
        const terrain = tile.terrain || tile.type || '';
        if (terrain === 'ocean' || terrain === 'arctic' || !workable(terrain)) continue;

        const dist = this.gameEngine.squareGrid?.squareDistance(unit.col, unit.row, col, row) ?? Infinity;
        const irrigable = IRRIGABLE_TERRAINS.includes(terrain) && this.canTileBeIrrigated(col, row);

        if (!inArea) {
          // Outside the area only irrigation is worth the trip: fresh water
          // spreads one tile at a time, so a food-short city chains a ditch
          // out to the next river and back onto its own fields.
          if (irrigable && chebyshev <= marginRadius && dist < bestOutsideDist) {
            bestOutsideDist = dist;
            bestOutside = { col, row };
          }
          continue;
        }
        if ((needsFood || preferIrrigation) && irrigable && dist < bestIrrigationDist) {
          bestIrrigationDist = dist;
          bestIrrigation = { col, row };
        }
        if (roadTerrains.includes(terrain)) {
          // A tile the city already works is worth twice one it does not: the
          // road's trade turns into happiness (or tax) on the very next turn.
          const worked = city.workingTiles?.has(`${col},${row}`) ?? false;
          const score = (worked ? 100 : 0) - dist;
          if (score > bestRoadScore) {
            bestRoadScore = score;
            bestRoad = { col, row };
          }
        }
        if (dist < bestInAreaDist) {
          bestInAreaDist = dist;
          bestInArea = { col, row };
        }
      }
    }

    if (preferTrade && bestRoad) return bestRoad;
    // No margin tiles. The ±(CITY_RADIUS + OUTSIDE_IRRIGATION_FIELDS) ring was
    // returned for food-short cities so a ditch could be chained outward, but
    // the settler that walked out there is judged by a DIFFERENT rule on
    // arrival (`!inMargin && !(prioritizeFood && canIrrigate)`) and rejects the
    // tile: 62 of the idle settler turns in a pinned 120-round game were a
    // settler standing on a margin tile it had been told to improve and being
    // told it could not. Candidates stay inside the city's radius, so both ends
    // of the hand-off agree.
    return bestIrrigation ?? bestInArea ?? bestOutside;
  }

  /**
   * Late-game infrastructure mode: the tile this settler should work before it
   * is allowed to found another city, or null when every own city's area has
   * reached {@link CITY_AREA_IMPROVED_TARGET} and settlement may resume.
   *
   * Cities are visited nearest-first, so a settler finishes the city it is
   * standing next to before travelling across the map for a better one, and a
   * city with almost nothing improved is preferred over one that is nearly
   * finished. Cities whose food is short get their irrigation first, including
   * the margin tiles outside the area.
   */
  private findInfrastructureWorksTarget(unit: Unit): { col: number; row: number } | null {
    const civId = unit.civilizationId;
    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;

    // Two independent reasons to work instead of found: a city whose area is
    // still raw (build-out, NOT subject to the civ-wide budget — see
    // `citiesNeedBuildOut`), and the size-6 mandate. When neither holds there
    // is nothing worth doing here and the settler goes back to settlement.
    if (!this.citiesNeedBuildOut(civId) && !this.hasMatureCity(civId)) return null;

    const civRef = this.gameEngine.civilizations?.[civId];
    const grid = this.gameEngine.squareGrid;
    const candidates = this.ownCities(civId)
      .map((city: City) => ({
        city,
        mature: (city.population ?? 1) >= MATURE_CITY_POPULATION,
        improved: this.improvedFractionOfCityArea(city),
        dist: grid?.squareDistance(unit.col, unit.row, city.col, city.row) ?? Infinity,
      }))
      // The ONLY thing that removes a city from the works programme is a direct
      // threat or an attack still going on there.
      .filter((entry) => !this.cityIsUnderDirectThreat(entry.city, roundNumber))
      .filter((entry) => (entry.mature
        // A mature city keeps its settler until its fields are actually built
        // out — roads AND irrigation — not merely until half the area carries
        // something. Raw tiles cannot pay for the citizens standing on them,
        // which is exactly how a big city ends up in civil unrest.
        ? entry.improved < CITY_AREA_BUILT_UP_TARGET
          || this.hasUnimprovedIrrigableTile(entry.city)
          || this.hasUnimprovedRoadTile(entry.city)
        : entry.improved < CITY_AREA_IMPROVED_TARGET))
      .sort((a, b) => a.dist - b.dist || a.improved - b.improved);

    for (const { city, improved, mature } of candidates) {
      const target = this.pickWorksTileForCity(
        unit,
        city,
        this.cityNeedsFood(city, civRef),
        mature,
        this.cityNeedsCommerce(city, civRef),
      );
      if (target) {
        debugLog(
          `[AI-INFRA] ${civId} settler ${unit.id} works tile (${target.col},${target.row}) for city (${city.col},${city.row}) at ${(improved * 100).toFixed(0)}% improved`,
        );
        return target;
      }
    }
    return null;
  }

  /**
   * Whether a city's workable area still holds a tile that could carry
   * irrigation and does not have an improvement yet. This is the stopping
   * condition for the size-6 mandate: once every irrigable field around the
   * city is watered, the settler is free to found again.
   */
  private hasUnimprovedIrrigableTile(city: City): boolean {
    for (const { col, row } of this.cityAreaTiles(city)) {
      const tile = this.gameEngine.getTileAt(col, row);
      if (!tile || tile.improvement) continue;
      const terrain = tile.terrain || tile.type || '';
      if (IRRIGABLE_TERRAINS.includes(terrain) && this.canTileBeIrrigated(col, row)) return true;
    }
    return false;
  }

  /**
   * Whether a city's workable area still holds an unimproved tile that a road
   * would turn into commerce. Roads are the ONLY thing that raises trade, and
   * trade is what the luxury rate converts into happiness — so a city without
   * roads around it cannot pay for its own citizens, however much food it has.
   */
  private hasUnimprovedRoadTile(city: City): boolean {
    const roadDef = IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.ROAD];
    const roadTerrains = roadDef?.tradeBonusTerrains ?? [];
    for (const { col, row } of this.cityAreaTiles(city)) {
      const tile = this.gameEngine.getTileAt(col, row);
      if (!tile || tile.improvement) continue;
      const terrain = tile.terrain || tile.type || '';
      if (roadTerrains.includes(terrain)) return true;
    }
    return false;
  }

  /**
   * Whether a city needs COMMERCE more than it needs food: it is unhappy and
   * its trade cannot cover its unhappiness even at a 100 % luxury rate. While
   * that is true a road is worth more than irrigation, because only trade
   * converts into happiness — and the moment trade catches up the city goes
   * back to farming. Self-limiting: road until trade ≥ unhappiness, irrigate
   * after.
   */
  private cityNeedsCommerce(city: City, civ: Civilization | undefined): boolean {
    if (!civ) return false;
    const happy = this.gameEngine.economicManager?.cityHappiness?.(city, civ);
    if (!happy) return false;
    if (!happy.disorder && happy.unhappiness < happy.happiness) return false;
    return (city.yields?.trade ?? 0) < happy.unhappiness;
  }

  /**
   * Decide whether an AI settler should improve the tile it stands on (Civ1),
   * returning the improvement type or null. Only tiles near a friendly city
   * are improved (so the effort feeds the economy instead of decorating the
   * wilderness), and the civ keeps an improvement budget so settlers don't
   * spend forever re-rolling the same tiles.
   *
   * Food/growth is now part of the decision, not an afterthought:
   *  - the nearest friendly city's REAL food balance is consulted (it includes
   *    the food this settler itself eats), and
   *  - a growth/expansion strategy (or a food-constrained city) makes
   *    irrigation the first choice; otherwise production (mine) comes first.
   *  - `canBuildImprovement` is the single source of truth for fresh water, so
   *    lakes and already-irrigated neighbours count too.
   */
  private chooseImprovementForSettler(unit: Unit, targetIsGated = false): string | null {
    const civId = unit.civilizationId;
    // Every refusal is logged when the tile came from the works programme —
    // "the settler stood on its field and did nothing" is invisible otherwise.
    const reject = (why: string): null => {
      if (targetIsGated) {
        this.gameEngine.log('ai', `Settler improvement rejected — ${why}`, {
          civilizationId: civId, action: 'improve_reject', unitId: unit.id,
          unitType: 'settler', reason: why,
        });
      }
      return null;
    };
    const tile = this.gameEngine.getTileAt(unit.col, unit.row);
    if (!tile) return reject('no_tile');
    const terrain = tile.terrain || tile.type || '';
    if (terrain === 'ocean' || terrain === 'arctic') return reject('bad_terrain');

    // Inside the working radius the settler improves the tile freely; outside it,
    // only a food-short city's chained irrigation is worth the trip (see
    // OUTSIDE_IRRIGATION_FIELDS). Anything further out is wilderness.
    // Chebyshev, not `squareDistance`: the works programme scans a Chebyshev
    // ±(CITY_RADIUS + OUTSIDE_IRRIGATION_FIELDS) box, while `squareDistance`
    // is Manhattan. A tile it happily picked out there measured 6–10 on the
    // Manhattan scale and was rejected here as "not near any city" — the
    // settler had walked to its field and been told the field was wilderness.
    const chebyshev = (c: City) =>
      Math.max(Math.abs(unit.col - c.col), Math.abs(unit.row - c.row));
    const inMargin = this.gameEngine.cities.some(
      (c: City) => c.civilizationId === civId && chebyshev(c) <= CITY_RADIUS,
    );
    const nearCity = inMargin || this.gameEngine.cities.some(
      (c: City) => c.civilizationId === civId
        && chebyshev(c) <= CITY_RADIUS + OUTSIDE_IRRIGATION_FIELDS,
    );
    if (!nearCity) return reject('not_near_city');

    // The improvement budget exists so settlers don't pave the wilderness for
    // ever. It does NOT apply while a city still has to be built out or the
    // size-6 mandate is live — those are the improvements the city's own
    // happiness depends on, and the counter was never meant to starve them.
    if (!this.citiesNeedBuildOut(civId) && !this.hasMatureCity(civId)
      && this.countOwnImprovements(civId) >= this.improvementBudget(civId)) return reject('budget');

    const civ = this.gameEngine.civilizations?.[civId];
    const strategy = resolveAICivStrategy(
      civ,
      this.gameEngine.getPlayerStorage?.(civId)?.turnData?.aiState as AIState | undefined,
    );

    // Nearest friendly city — its food balance decides whether the settler
    // should farm first. `cityFoodBalance` already subtracts this settler's
    // own food support, so the settler's cost is part of the equation.
    const nearestCity = this.gameEngine.cities
      .filter((c: City) => c.civilizationId === civId)
      .sort((a: City, b: City) =>
        this.gameEngine.squareGrid.squareDistance(unit.col, unit.row, a.col, a.row) -
        this.gameEngine.squareGrid.squareDistance(unit.col, unit.row, b.col, b.row),
      )[0];
    // The city this settler serves has to be safe to work — but only when it
    // chose the tile ITSELF. A tile handed over by the works programme already
    // passed the threat test for the city it belongs to; re-testing it here
    // against the NEAREST city (which may be a different, embattled one, or
    // merely one that was hit within the last six rounds) vetoed 117 work
    // attempts per game and left settlers standing on their field doing
    // nothing turn after turn.
    if (
      !targetIsGated &&
      nearestCity &&
      this.cityIsUnderDirectThreat(
        nearestCity,
        this.gameEngine.roundManager?.getRoundNumber?.() ?? 0,
      )
    ) {
      return reject('threat');
    }
    const balance = nearestCity
      ? this.gameEngine.economicManager?.cityFoodBalance?.(nearestCity, civ)
      : null;
    const foodConstrained = !!balance && (
      balance.surplus < 1 ||
      (balance.turnsUntilStarvation >= 0 && balance.turnsUntilStarvation <= 3)
    );
    const growthStrategy = strategy === 'early_expansion' || strategy === 'balanced_growth';
    const prioritizeFood = foodConstrained || growthStrategy;

    const terrainIrrigable = IRRIGABLE_TERRAINS.includes(terrain);
    // The engine enforces fresh water (river/lake/irrigated neighbour).
    const canIrrigate = terrainIrrigable && this.gameEngine.canBuildImprovement(unit.id, 'irrigation');
    const canMine = MINABLE_TERRAINS.includes(terrain) &&
      this.gameEngine.canBuildImprovement(unit.id, 'mine');

    // COMMERCE before food when the city cannot pay for its own citizens: an
    // unhappy city whose trade is below its unhappiness gains nothing from
    // another +1 food, because food does not convert into happiness. A road on
    // a trade terrain does — and the moment trade catches up with unhappiness
    // `cityNeedsCommerce` turns itself off and farming resumes.
    const roadProps = IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.ROAD];
    const roadable =
      (roadProps?.tradeBonusTerrains ?? []).includes(terrain) && !tile.improvement;
    if (
      nearestCity &&
      this.cityNeedsCommerce(nearestCity, civ) &&
      roadable &&
      this.gameEngine.canBuildImprovement(unit.id, 'road')
    ) {
      return 'road';
    }

    // Outside every own city's workable area, the ONLY worthwhile improvement is
    // irrigation for a city that is short of food: fresh water spreads one tile
    // at a time, so a fully-watered city gains food by chaining a ditch out to
    // the next river and back onto its own fields. A mine or a road out there
    // feeds nothing, so it is refused.
    // Outside a city's radius ONLY irrigation makes sense — but "the city is
    // short of food" is not a precondition. The food test here is made against
    // the NEAREST city while the works target belongs to whichever city was
    // picked, so the two disagreed and the settler was told the tile it had
    // been sent to was worthless (62 refusals, 47 of them idle turns, in a
    // pinned 120-round game). What actually decides it is whether the ditch
    // can be dug.
    if (!inMargin && !canIrrigate) return reject('outside_no_irrigation');

    // Food first when the city needs to grow; production first otherwise.
    if (prioritizeFood && canIrrigate) return 'irrigation';
    if (canMine) return 'mine';
    if (canIrrigate) return 'irrigation';

    // Civ1 income strategy: a road on a tile a city WORKS grants +1 trade on
    // grassland/plains/desert (IMPROVEMENT_PROPERTIES.road.tradeBonusTerrains).
    // More trade → more tax + science, so building roads on worked tiles is a
    // direct income boost.
    const roadDef = IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.ROAD];
    const workedByCity = this.gameEngine.cities.some((c: City) =>
      c.civilizationId === civId && c.workingTiles?.has(`${unit.col},${unit.row}`)
    );
    // Skip tiles that already carry a road (canonical `tile.improvement` or
    // legacy `tile.road`/`tile.hasRoad` flags from older saves).
    const hasRoad = tile.improvement === IMPROVEMENT_TYPES.ROAD
      || (tile as { road?: boolean; hasRoad?: boolean }).road === true
      || (tile as { road?: boolean; hasRoad?: boolean }).hasRoad === true;
    if (workedByCity && !hasRoad && roadDef?.tradeBonusTerrains?.includes(terrain) &&
        !tile.improvement && this.gameEngine.canBuildImprovement(unit.id, 'road')) {
      return 'road';
    }
    if (this.gameEngine.canBuildImprovement(unit.id, 'railroad')) return 'railroad';
    if (this.gameEngine.canBuildImprovement(unit.id, 'road')) return 'road';
    return reject(`no_candidate:${terrain}:${tile.improvement ?? '-'}`);
  }

  /**
   * From city size 6+, the AI should prioritize irrigating the surrounding
   * tiles of that city with settlers. This is the most impactful use of a
   * settler in the mid-to-late game: irrigation permanently boosts food, which
   * drives population growth and ultimately more production and gold.
   *
   * Returns the best irrigation target tile, or null if:
   * - No city of size 6+ exists
   * - The city is under direct threat or being attacked
   * - No irrigable tile is available near the city
   */
  private findIrrigationTargetForMatureCity(unit: Unit): { col: number; row: number } | null {
    const civId = unit.civilizationId;
    const friendlyCities = this.gameEngine.cities.filter(
      (c: City) => c.civilizationId === civId && (c.population ?? 0) >= 6,
    );
    if (friendlyCities.length === 0) return null;

    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    const storage = this.gameEngine.getPlayerStorage?.(civId);

    const sortedCities = friendlyCities
      .map((city: City) => ({
        city,
        dist: this.gameEngine.squareGrid?.squareDistance(unit.col, unit.row, city.col, city.row) ?? Infinity,
      }))
      .sort((a, b) => a.dist - b.dist);

    const civRef = this.gameEngine.civilizations?.[civId];
    for (const { city } of sortedCities) {
      if (this.cityIsUnderDirectThreat(city, roundNumber)) continue;
      // A city whose trade cannot cover its unhappiness needs ROADS, not
      // another +1 food: food never converts into happiness, trade does (via
      // the luxury rate). This shortcut ran first and won unconditionally, so
      // a size-6+ city irrigated every field it owned, sat at trade 2 with
      // luxury 0 % and stayed in disorder — 2 of 4 cities in a pinned
      // 150-round run.
      if (this.cityNeedsCommerce(city, civRef)) continue;

      const underAttack = (storage as { turnData?: { lastCityAssaultRound?: number } })?.turnData?.lastCityAssaultRound;
      if (typeof underAttack === 'number' && roundNumber - underAttack <= ONGOING_ATTACK_WINDOW) continue;

      if (!city.workingTiles || city.workingTiles.size === 0) continue;

      let bestTile: { col: number; row: number; score: number } | null = null;

      for (const key of city.workingTiles) {
        const parts = key.split(',');
        const col = Number(parts[0]);
        const row = Number(parts[1]);
        if (!Number.isFinite(col) || !Number.isFinite(row)) continue;

        const tile = this.gameEngine.getTileAt(col, row);
        if (!tile) continue;
        if (tile.improvement) continue;

        const terrain = tile.terrain || tile.type || '';
        if (!IRRIGABLE_TERRAINS.includes(terrain)) continue;
        if (!this.canTileBeIrrigated(col, row)) continue;
        if (!this.gameEngine.canBuildImprovement(unit.id, 'irrigation')) continue;

        const dist = this.gameEngine.squareGrid?.squareDistance(unit.col, unit.row, col, row) ?? Infinity;
        const score = -dist;
        if (!bestTile || score > bestTile.score) {
          bestTile = { col, row, score };
        }
      }

      if (bestTile) {
        debugLog(`[AI-IRRIGATE] Settler ${unit.id} irrigating tile (${bestTile.col}, ${bestTile.row}) for city ${city.name}`);
        return { col: bestTile.col, row: bestTile.row };
      }
    }

    return null;
  }

  /**
   * Civ1 income strategy: find the nearest tile a friendly city WORKS that has
   * no improvement yet and where a road grants +1 trade (grassland/plains/
   * desert — see IMPROVEMENT_PROPERTIES.road.tradeBonusTerrains). Roads on
   * worked tiles raise the city's commerce → more tax + science, so an idle
   * settler walks there to build the road instead of wandering. Respects the
   * civ's improvement budget so settlers don't over-improve.
   */
  private findTradeRoadTarget(unit: Unit): { col: number; row: number } | null {
    const civId = unit.civilizationId;
    const roadDef = IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.ROAD];
    if (!roadDef?.tradeBonusTerrains) return null;

    // Same improvement budget as chooseImprovementForSettler (and the same
    // build-out / size-6 exemption).
    const friendlyCities = this.gameEngine.cities.filter((c: City) => c.civilizationId === civId);
    if (friendlyCities.length === 0) return null;
    if (!this.citiesNeedBuildOut(civId) && !this.hasMatureCity(civId)
      && this.countOwnImprovements(civId) >= this.improvementBudget(civId)) return null;

    // Terrains where SOME improvement is useful: roads/irrigation on the
    // worked plain/grass/desert belt, mines on hills and mountains. The
    // on-arrival chooser (`chooseImprovementForSettler`) decides which one
    // and validates fresh water, so the walk target only has to be workable.
    const isWorkable = (terrain: string): boolean =>
      roadDef.tradeBonusTerrains.includes(terrain) ||
      IRRIGABLE_TERRAINS.includes(terrain) ||
      MINABLE_TERRAINS.includes(terrain);

    // Food/growth civs should walk to tiles that can actually be irrigated
    // (orthogonal fresh water or an already-irrigated neighbour) instead of
    // the nearest worked tile, or irrigation never chains outward from the
    // first river tile.
    const civRef = this.gameEngine.civilizations?.[civId];
    const strategy = resolveAICivStrategy(
      civRef,
      this.gameEngine.getPlayerStorage?.(civId)?.turnData?.aiState as AIState | undefined,
    );
    const growthCiv = strategy === 'early_expansion' || strategy === 'balanced_growth';
    const foodNeeded = growthCiv || friendlyCities.some((c: City) => {
      const balance = this.gameEngine.economicManager?.cityFoodBalance?.(c, civRef);
      return !!balance && balance.surplus < 1;
    });
    const isIrrigationEligible = (col: number, row: number, terrain: string): boolean =>
      IRRIGABLE_TERRAINS.includes(terrain) && this.canTileBeIrrigated(col, row);

    let best: { col: number; row: number } | null = null;
    let bestDist = Infinity;
    let bestFood: { col: number; row: number } | null = null;
    let bestFoodDist = Infinity;
    for (const city of friendlyCities) {
      if (!city.workingTiles || city.workingTiles.size === 0) continue;
      for (const key of city.workingTiles) {
        const parts = key.split(',');
        const col = Number(parts[0]);
        const row = Number(parts[1]);
        if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
        const tile = this.gameEngine.getTileAt(col, row);
        if (!tile) continue;
        const terrain = tile.terrain || tile.type || '';
        if (!isWorkable(terrain)) continue;
        // Skip tiles that already have a road (canonical `tile.improvement` or
        // legacy `tile.road`/`tile.hasRoad` flags) or any other improvement.
        if (tile.improvement) continue;
        if ((tile as { road?: boolean; hasRoad?: boolean }).road === true
            || (tile as { road?: boolean; hasRoad?: boolean }).hasRoad === true) continue;
        const dist = this.gameEngine.squareGrid.squareDistance(unit.col, unit.row, col, row);
        if (dist < bestDist) {
          bestDist = dist;
          best = { col, row };
        }
        if (foodNeeded && dist < bestFoodDist && isIrrigationEligible(col, row, terrain)) {
          bestFoodDist = dist;
          bestFood = { col, row };
        }
      }
    }
    return bestFood ?? best;
  }

  /**
   * Whether the settler may found a city on the tile it is standing on.
   *
   * Buildable terrain with no city on it is not enough: a city also may not
   * overlap the workable area of one of its OWN cities. The settlement search
   * rejects such sites, but every "just found it here instead of wandering"
   * fallback has to ask too, or the AI quietly drops a city on top of its own
   * farmland and both starve.
   */
  private canFoundCityHere(unit: Unit): boolean {
    const tile = this.gameEngine.getTileAt(unit.col, unit.row);
    if (!tile) return false;
    if (tile.type === 'ocean' || tile.type === 'lake' || tile.type === 'mountains') return false;
    if (this.gameEngine.getCityAt(unit.col, unit.row)) return false;
    if (this.overlapsOwnCityArea(unit.col, unit.row, unit.civilizationId)) return false;
    return true;
  }

  /** The general no-overlap rule, delegated to the evaluator that owns it. */
  private overlapsOwnCityArea(col: number, row: number, civilizationId: number): boolean {
    return SettlementEvaluator.overlapsOwnCityArea(
      col, row,
      (c, r) => this.gameEngine.getCityAt(c, r),
      civilizationId,
    );
  }

  /**
   * Find best settlement location for a settler
   */
  private findBestSettlementForSettler(
    unit: Unit,
    strategy: StrategyProfile = 'balanced_growth',
    replanDepth = 0,
    /**
     * Overrides the score a site must beat. The last rung of the settler's
     * ladder passes a low bar rather than none: a mediocre site is still worth
     * more than a settler that spends the rest of the game standing still.
     */
    thresholdOverride?: number,
  ): { col: number; row: number; score: number } | null {
    debugLog(`[AI-SETTLER] Evaluating settlement locations for settler at (${unit.col}, ${unit.row})`);
    // A settler that has just finished working its own cities' fields faces a
    // higher bar than one that has just been produced: it may found where it
    // stands unless the best site is clearly, clearly better.
    const settleThreshold = thresholdOverride ?? (this.prefersInfrastructureOverExpansion(unit.civilizationId, strategy)
      ? LATE_SETTLE_SCORE_THRESHOLD
      : SETTLE_SCORE_THRESHOLD);

    // Track position history to detect oscillation
    if (!unit._positionHistory) {
      unit._positionHistory = [];
    }
    const history = unit._positionHistory;
    const currentPos = `${unit.col},${unit.row}`;

    // Add current position to history
    history.push(currentPos);

    // Keep only last 6 positions
    if (history.length > 6) {
      history.shift();
    }

    // Detect oscillation: if we've visited the same position 3+ times in last 6 moves, we're oscillating
    const positionCounts = history.reduce((acc: Record<string, number>, pos: string) => {
      acc[pos] = (acc[pos] || 0) + 1;
      return acc;
    }, {});

    const isOscillating = Object.values(positionCounts).some((count: number) => count >= 3);
    // Moving at all counts as progress, so a settler merely walking around a
    // blockage does not have its target list wiped mid-journey.
    if (unit._blockedSettlementTargets?.size && !isOscillating) {
      unit._blockedSettlementPatience = 0;
    }

    // Keep a settlement destination stable across turns. The search window is
    // centred on the moving settler, so recomputing the maximum every turn can
    // make the destination drift and cause a produced settler to wander.
    const lockedTarget = unit._lastSettlementTarget;
    const blockedTargets = this.getBlockedSettlementTargets(unit);

    // A target that repeatedly sends the settler back and forth is no longer
    // useful. Mark it unavailable and immediately choose another reachable
    // site instead of allowing the settler to spend the rest of the game in a
    // two-tile loop.
    if (lockedTarget && isOscillating) {
      const lastPosition = history[history.length - 1];
      const previousPosition = history[history.length - 2];
      if (lastPosition !== previousPosition) {
        blockedTargets.add(this.settlementTargetKey(lockedTarget));
        unit._blockedSettlementTargets = blockedTargets;
        delete unit._lastSettlementTarget;
        // Clear history so the next evaluation starts fresh and doesn't
        // immediately re-trigger oscillation with stale position data.
        history.length = 0;
        console.warn(`[AI-SETTLER] Abandoning oscillating settlement target (${lockedTarget.col},${lockedTarget.row})`);
        if (replanDepth === 0) {
          return this.findBestSettlementForSettler(unit, strategy, 1, thresholdOverride);
        }
        // Already retried once — force settle at current tile to break loop.
        if (this.canFoundCityHere(unit)) {
          debugLog(`[AI-SETTLER] 🔄 Replan exhausted, founding at current tile (${unit.col},${unit.row})`);
          this.gameEngine.foundCityWithSettler(unit.id);
        }
        return null;
      }
    }

    // ── A locked target that is not getting any closer ────────────────────
    // 194 of 353 measured idle settler turns had a locked target: the settler
    // had somewhere to be and never arrived. `isSettlementTargetValid` only
    // checks that the site is still *legal* — a legal site on the far side of
    // an ocean passes every turn, so the lock is re-issued for ever and the
    // settler walks in place. Unlocking after a fixed number of turns lets the
    // search pick a different site, which is what "blocked" was supposed to do
    // but only ever did once the settler had already given up on it.
    if (lockedTarget && unit._lockedTargetAge !== undefined) {
      unit._lockedTargetAge++;
      if (unit._lockedTargetAge >= LOCKED_TARGET_PATIENCE) {
        debugLog(`[AI-SETTLER] Unlocking settlement target (${lockedTarget.col},${lockedTarget.row}) after ${unit._lockedTargetAge} turns`);
        unit._lockedTargetAge = 0;
        delete unit._lastSettlementTarget;
      }
    }

    if (lockedTarget && this.isSettlementTargetValid(unit, lockedTarget)) {
      if (lockedTarget.col === unit.col && lockedTarget.row === unit.row) {
        debugLog(`[AI-SETTLER] Reached locked settlement target (${lockedTarget.col},${lockedTarget.row}), founding city`);
        this.gameEngine.foundCityWithSettler(unit.id);
        return null;
      }
      debugLog(`[AI-SETTLER] Continuing to locked settlement target (${lockedTarget.col},${lockedTarget.row})`);
      return { ...lockedTarget, score: 0 };
    }
    if (lockedTarget) {
      // A city, unit, visibility, or terrain change invalidated the old site.
      delete unit._lastSettlementTarget;
    }

    // First, check if current location is a good settlement spot
    const currentPosValid = this.canFoundCityHere(unit);

    if (currentPosValid && isOscillating) {
      debugLog(`[AI-SETTLER] 🔄 Oscillation detected! Position history: ${history.join(' -> ')}`);
      debugLog(`[AI-SETTLER] Founding city at current location to break oscillation`);
      // Directly found city here instead of returning target
      this.gameEngine.foundCityWithSettler(unit.id);
      return null;
    }

    // Choose appropriate weights based on strategy
    const weights = this.getSettlementWeightsForStrategy(strategy);
    debugLog(`[AI-SETTLER] Using strategy: ${strategy} with weights:`, weights);

    // If the civ has no coastal city yet, strongly prefer founding on connected
    // water: naval units can only ever be built from a coastal city, so a
    // landlocked empire must deliberately claim a coast before it can project
    // power (or defend against ships) on the sea.
    const hasWaterCity = typeof this.gameEngine.civHasNavalCity === 'function'
      ? this.gameEngine.civHasNavalCity(unit.civilizationId)
      : (typeof this.gameEngine.civHasCoastalCity === 'function'
        && this.gameEngine.civHasCoastalCity(unit.civilizationId));
    const wantsCoast = !hasWaterCity;
    const extraCoastalBonus = wantsCoast ? 8 : 0;
    if (wantsCoast) {
      debugLog('[AI-SETTLER] Civ has no coastal city — favouring a coastal settlement site');
    }

    // Use SettlementEvaluator to find best location
    const bestLocation = SettlementEvaluator.findBestSettlementLocation(
      unit.col,
      unit.row,
      (col, row) => this.gameEngine.getTileAt(col, row),
      (col, row) => this.gameEngine.getCityAt(col, row)
        || (blockedTargets.has(`${col},${row}`) ? { id: `${col},${row}`, civilizationId: -1, col, row } : null),
      (col, row) => this.gameEngine.getUnitAt(col, row),
      weights,
      MIN_CITY_CENTER_DISTANCE, // keep complete workable areas separate
      unit.civilizationId,
      (col, row) => {
        // Check visibility - AI can only settle on visible tiles
        const tile = this.gameEngine.getTileAt(col, row);
        return tile && (tile.visible || tile.explored);
      },
      (fromCol, fromRow, toCol, toRow) => {
        // Check if settler can reach the location with the SAME rules the
        // movement code enforces (wide rivers block land units). Without this
        // the evaluator kept proposing a site across a 2–3 tile river.
        const map = this.gameEngine.map;
        if (!map || !this.gameEngine.squareGrid) return false;
        const result = Pathfinding.findPath(
          fromCol, fromRow, toCol, toRow,
          (c, r) => this.gameEngine.getTileAt(c, r),
          unit.type,
          map.width, map.height,
          (c, r) => this.gameEngine.getUnitAt(c, r),
          unit.civilizationId,
          (c, r) => this.gameEngine.getCityAt(c, r),
          this.getSettlerPathObstacles(unit.id, { col: toCol, row: toRow }),
        );
        return result.path.length > 0;
      },
      extraCoastalBonus,
    );

    if (bestLocation) {
      debugLog(`[AI-SETTLER] Best settlement location found: (${bestLocation.col}, ${bestLocation.row})`);
      debugLog(`[AI-SETTLER] Score: ${bestLocation.score}, Yields:`, bestLocation.yields);
      debugLog(`[AI-SETTLER] Water access: ${bestLocation.hasWaterAccess}`);

      // ── "Good enough" settling ────────────────────────────────────────────
      // The 10x10 search re-centers on the settler every turn, so the best
      // tile keeps moving ahead as the settler walks toward it — the old code
      // chased that moving maximum forever and only founded via the 3-visit
      // oscillation breaker (cities appeared after 100+ rounds, if at all).
      // Instead: found at the current tile unless the best location is clearly
      // better AND close enough to bother walking to.
      if (currentPosValid) {
        const currentScore = SettlementEvaluator.scoreLocation(
          unit.col,
          unit.row,
          (col, row) => this.gameEngine.getTileAt(col, row),
          (col, row) => this.gameEngine.getCityAt(col, row),
          (col, row) => this.gameEngine.getUnitAt(col, row),
          weights,
          unit.civilizationId,
          unit.col,
          unit.row,
          extraCoastalBonus
        );
        const bestDist = Math.max(
          Math.abs(bestLocation.col - unit.col),
          Math.abs(bestLocation.row - unit.row)
        );
        const bestClearlyBetter = currentScore !== null &&
          bestLocation.score - currentScore > settleThreshold;
        const bestIsFar = bestDist > MAX_SETTLE_WALK_DISTANCE;

        if (currentScore !== null && (!bestClearlyBetter || bestIsFar)) {
          debugLog(`[AI-SETTLER] 🏙 Current tile good enough (current=${currentScore.toFixed(1)}, best=${bestLocation.score.toFixed(1)}, bestDist=${bestDist}) — founding city here`);
          this.gameEngine.foundCityWithSettler(unit.id);
          return null;
        }
        debugLog(`[AI-SETTLER] Best location clearly better (current=${currentScore?.toFixed(1)}, best=${bestLocation.score.toFixed(1)}, bestDist=${bestDist}) — walking there`);
      }

      // If we have a pathfinding grid available, precompute and store a path.
      // Uses the centralized Pathfinding so wide rivers (RiverRules) are
      // avoided exactly like `moveUnit` would enforce.
      try {
        const map = this.gameEngine.map;
        if (map && this.gameEngine.squareGrid && this.gameEngine.roundManager) {
          const result = Pathfinding.findPath(
            unit.col, unit.row, bestLocation.col, bestLocation.row,
            (c, r) => this.gameEngine.getTileAt(c, r),
            unit.type,
            map.width, map.height,
            (c, r) => this.gameEngine.getUnitAt(c, r),
            unit.civilizationId,
            (c, r) => this.gameEngine.getCityAt(c, r),
            this.getSettlerPathObstacles(unit.id, bestLocation),
          );
          if (result.path.length > 0) {
            debugLog(`[AI-SETTLER] Precomputed path for settler ${unit.id} with ${result.path.length} steps`);
            this.gameEngine.roundManager.setUnitPath(unit.id, result.path);
          } else {
            debugLog(`[AI-SETTLER] No path found to best location for settler ${unit.id}`);
          }
        }
      } catch (e) {
        console.error('[AI-SETTLER] Error while precomputing path for settler:', e);
      }

      // Check if settler is already at the best location
      if (bestLocation.col === unit.col && bestLocation.row === unit.row) {
        debugLog(`[AI-SETTLER] Settler is already at best location, will found city`);
        // Found city immediately
        this.gameEngine.foundCityWithSettler(unit.id);
        return null; // No need to move
      }

      // Store target to detect oscillation on next evaluation
      unit._lastSettlementTarget = { col: bestLocation.col, row: bestLocation.row };

      return bestLocation;
    }

    // No suitable location found in the window — if the settler is standing on
    // a valid tile (the window search can fail due to the reachability check,
    // e.g. findPath to the settler's own tile returning empty), just found the
    // city here instead of wandering forever.
    if (currentPosValid) {
      debugLog(`[AI-SETTLER] No better location found, founding city at current tile (${unit.col}, ${unit.row})`);
      this.gameEngine.foundCityWithSettler(unit.id);
      return null;
    }

    debugLog(`[AI-SETTLER] No suitable settlement location found`);
    return null;
  }

  /** Validate a cached destination without allowing the settler to chase it. */
  private isSettlementTargetValid(
    unit: Unit,
    target: { col: number; row: number },
  ): boolean {
    const tile = this.gameEngine.getTileAt?.(target.col, target.row);
    if (!tile || tile.type === 'ocean' || tile.type === 'lake' || tile.type === 'mountains') return false;
    if (this.gameEngine.getCityAt?.(target.col, target.row)) return false;

    const occupant = this.gameEngine.getUnitAt?.(target.col, target.row);
    // Settlers cannot enter an occupied tile, regardless of ownership. The
    // old check only rejected enemy units, so a cached target behind a friendly
    // unit could still produce an impossible route.
    if (occupant) return false;

    // Keep the whole 20-tile workable area separate from friendly cities —
    // the general no-overlap rule, from the evaluator that owns it.
    if (this.overlapsOwnCityArea(target.col, target.row, unit.civilizationId)) return false;

    // SettlementEvaluator uses the tile's visible/explored state. Keep the
    // cached-target check consistent with it; some headless/test engines do
    // not mirror those flags through isExploredByPlayer yet.
    const tileKnown = !!tile.visible || !!tile.explored ||
      (typeof this.gameEngine.isExploredByPlayer === 'function' &&
        this.gameEngine.isExploredByPlayer(unit.civilizationId, target.col, target.row));
    if (!tileKnown) {
      return false;
    }

    const map = this.gameEngine.map;
    const grid = this.gameEngine.squareGrid;
    if (!map || !grid) return false;
    // Use the engine-consistent Pathfinding so a wide river (impassable to
    // land units) invalidates the cached target instead of producing a route
    // the settler can never walk.
    const result = Pathfinding.findPath(
      unit.col, unit.row, target.col, target.row,
      (c, r) => this.gameEngine.getTileAt(c, r),
      unit.type,
      map.width, map.height,
      (c, r) => this.gameEngine.getUnitAt(c, r),
      unit.civilizationId,
      (c, r) => this.gameEngine.getCityAt(c, r),
      this.getSettlerPathObstacles(unit.id, target),
    );
    return result.path.length > 0;
  }

  private settlementTargetKey(target: { col: number; row: number }): string {
    return `${target.col},${target.row}`;
  }

  private getBlockedSettlementTargets(unit: Unit): Set<string> {
    const existing = unit._blockedSettlementTargets;
    if (existing instanceof Set) return new Set(existing);
    if (Array.isArray(existing)) return new Set(existing);
    return new Set<string>();
  }

  /**
   * Build obstacles using the rules settlers actually obey when moving.
   * SquareGrid's terrain-only pathfinder otherwise routes through units and
   * cities, after which moveUnit rejects the next step and the settler can
   * oscillate around the blocker.
   */
  private getSettlerPathObstacles(
    unitId: string,
    target?: { col: number; row: number },
  ): Set<string> {
    const obstacles = new Set<string>();
    for (const otherUnit of this.gameEngine.units ?? []) {
      if (otherUnit.id !== unitId) {
        obstacles.add(`${otherUnit.col},${otherUnit.row}`);
      }
    }
    for (const city of this.gameEngine.cities ?? []) {
      const key = `${city.col},${city.row}`;
      if (!target || key !== this.settlementTargetKey(target)) {
        obstacles.add(key);
      }
    }
    return obstacles;
  }

  /**
   * Scout defense override: if a friendly city within response range has no
   * other defender and an enemy is close, garrison the city tile. Exploration
   * is lower priority than defending an exposed city. Returns null (so the
   * scout keeps exploring) when the city is defended, no enemy is near, or
   * the scout is too far away. Re-evaluated every turn, so the scout resumes
   * exploring automatically once the enemy leaves or other troops arrive.
   */
  public findScoutDefenseTarget(unit: Unit): { col: number; row: number } | null {
    if (!this.gameEngine.squareGrid || !this.gameEngine.map) return null;

    const civId = unit.civilizationId;
    const storage = this.gameEngine.getPlayerStorage?.(civId);
    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    const distFn = (c1: number, r1: number, c2: number, r2: number) =>
      this.gameEngine.squareGrid.squareDistance(c1, r1, c2, r2);

    const SCOUT_DEFENSE_RESPONSE_RADIUS = 8;
    const SCOUT_DEFENSE_ENEMY_RADIUS = 3;

    const friendlyCities = this.gameEngine.cities.filter((c: City) => c.civilizationId === civId);
    let bestTarget: { col: number; row: number } | null = null;
    let bestThreat = -Infinity;

    for (const city of friendlyCities) {
      // The scout must be reasonably close to respond (no cross-map teleport).
      const scoutDist = distFn(unit.col, unit.row, city.col, city.row);
      if (scoutDist > SCOUT_DEFENSE_RESPONSE_RADIUS) continue;

      // City already has another defender (non-scout) in/near it.
      const hasOtherDefender = this.gameEngine.units.some((u: Unit) =>
        u.civilizationId === civId &&
        u.id !== unit.id &&
        u.type !== 'scout' &&
        this.isDefensiveUnit(u) &&
        distFn(u.col, u.row, city.col, city.row) <= 1
      );
      if (hasOtherDefender) continue;

      // Is an enemy close to the city? (visible units + recent known locations)
      const samples = collectCityThreatSamples(this.gameEngine, city, civId, storage, roundNumber);
      const closeEnemy = samples.find(s => s.distance <= SCOUT_DEFENSE_ENEMY_RADIUS);
      if (!closeEnemy) continue;

      // Prefer the most threatened city we can respond to.
      const threat = Math.max(0, SCOUT_DEFENSE_ENEMY_RADIUS - closeEnemy.distance);
      if (threat <= bestThreat) continue;
      bestThreat = threat;

      // Garrison the city tile when free; otherwise the nearest passable neighbor.
      const cityUnit = this.gameEngine.getUnitAt?.(city.col, city.row);
      const cityOccupied = !!cityUnit && cityUnit.civilizationId !== civId;
      if (!cityOccupied) {
        bestTarget = { col: city.col, row: city.row };
      } else {
        const neighbors = this.gameEngine.squareGrid.getNeighbors(city.col, city.row);
        const passable = neighbors.find((n: { col: number; row: number }) => {
          return this.gameEngine.isTilePassable?.(n.col, n.row) !== false && !this.gameEngine.getUnitAt?.(n.col, n.row);
        });
        if (passable) bestTarget = { col: passable.col, row: passable.row };
      }
    }

    return bestTarget;
  }

  /** A unit that can actually defend a city (non-civilian, non-scout, has defense). */
  private isDefensiveUnit(u: Unit): boolean {
    const civilian = new Set(['settler', 'worker', 'caravan', 'diplomat', 'scout', 'ferry', 'fisher_boat']);
    if (civilian.has(u.type)) return false;
    const props = UNIT_PROPS[u.type];
    return !!props && (props.defense || 0) > 0;
  }

  /**
   * Find the nearest visible/known village (goody hut) from a unit's position.
   * Uses BFS up to 15 tiles to avoid long detours. Only considers tiles the
   * AI has explored so we don't leak map information.
   */
  private findNearestVillage(
    unit: { col: number; row: number; civilizationId: number }
  ): { col: number; row: number } | null {
    const map = this.gameEngine.map;
    const grid = this.gameEngine.squareGrid;
    if (!map || !grid) return null;

    const maxRadius = 15;
    const startCol = Math.max(0, unit.col - maxRadius);
    const endCol = Math.min(map.width - 1, unit.col + maxRadius);
    const startRow = Math.max(0, unit.row - maxRadius);
    const endRow = Math.min(map.height - 1, unit.row + maxRadius);

    let nearest: { col: number; row: number; dist: number } | null = null;
    const ownCities = this.gameEngine.cities.filter(
      (c: City) => c.civilizationId === unit.civilizationId,
    );

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const tileIndex = row * map.width + col;
        const tile = map.tiles?.[tileIndex];
        if (!tile || !tile.village) continue;

        // Only target villages the AI has explored
        const storage = this.gameEngine.getPlayerStorage?.(unit.civilizationId);
        const explored = storage?.explored?.[tileIndex] ?? tile.explored ?? false;
        if (!explored) continue;

        const dist = grid.squareDistance(unit.col, unit.row, col, row);
        if (dist === 0) continue;

        // A land unit can only walk to a hut on its own landmass; a hut across
        // the water is unreachable until ships can ferry it.
        if (!this.areLandConnected(unit.col, unit.row, col, row)) continue;

        // Risk model: popping a hut can spawn Barbarians, so a hut next to a
        // town is dangerous while a far hut in a big empire is worth taking.
        // The decision is deterministic per (civ, village) so the AI does not
        // oscillate between taking and ignoring the same hut every turn.
        if (!this.shouldTakeVillage(unit.civilizationId, col, row, ownCities)) continue;

        if (!nearest || dist < nearest.dist) {
          nearest = { col, row, dist };
        }
      }
    }

    return nearest ? { col: nearest.col, row: nearest.row } : null;
  }

  /**
   * Whether the AI accepts the barbarian risk of a village. The farther the
   * village from the nearest own city and the more cities the civ owns, the
   * higher the chance (`calculateVillageTakeChance`). A stable hash makes the
   * roll deterministic per village so a unit does not flip-flop each turn.
   *
   * Early in the game the AI is less eager to take villages — the barbarian
   * risk is not worth it when the civ is still small. A village next to an
   * enemy city is always taken regardless (strategic value).
   */
  private shouldTakeVillage(
    civId: number,
    col: number,
    row: number,
    ownCities: City[],
  ): boolean {
    let nearestCityDistance = Infinity;
    for (const city of ownCities) {
      nearestCityDistance = Math.min(
        nearestCityDistance,
        this.gameEngine.squareGrid.squareDistance(city.col, city.row, col, row),
      );
    }

    // Always take villages next to an enemy city — they have strategic value
    // (denying the enemy a free city / units, and clearing the front yard).
    const enemyCities = this.gameEngine.cities.filter(
      (c: City) => c.civilizationId !== civId && c.civilizationId >= 0,
    );
    for (const enemyCity of enemyCities) {
      const dist = this.gameEngine.squareGrid.squareDistance(enemyCity.col, enemyCity.row, col, row);
      if (dist <= AI_VILLAGE_ENEMY_CITY_OVERRIDE_RADIUS) return true;
    }

    // Early game: be much less eager. A young empire has few defenders, and a
    // barbarian ambush next to a size-1 capital costs more than a free tech is
    // worth; the multiplier ramps back to full eagerness over the first 120
    // rounds. The enemy-city exception above still applies.
    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    const earlyGameFactor = villageEarlyGameFactor(roundNumber);
    const chance = calculateVillageTakeChance(nearestCityDistance, ownCities.length) * earlyGameFactor;
    return villageDecisionRoll(civId, col, row) <= chance;
  }

  /**
   * Idle combat-unit probe: push the frontier toward a weighted-random
   * unexplored, passable tile (within a bounded radius). Without this the army
   * sits in its capital forever, never contacts the enemy, and the whole
   * war-planning pipeline stays starved of intelligence. Returns null when
   * nothing is left to explore nearby (falls back to city patrol).
   */
  private findCombatProbeTarget(
    unit: Unit,
    _storage: PlayerTurnStorage,
    distFn: (c1: number, r1: number, c2: number, r2: number) => number,
  ): { col: number; row: number } | null {
    const map = this.gameEngine.map;
    const grid = this.gameEngine.squareGrid;
    if (!map || !grid) return null;

    // Commit to a locked probe target so the unit walks a stable line instead
    // of re-picking an exploration tile every turn — recomputing made units
    // zig-zag (and even double back) as the tiles they passed became explored
    // and the nearest frontier jumped sideways.
    const locked = unit._probeTarget;
    if (locked) {
      if (locked.col === unit.col && locked.row === unit.row) {
        delete unit._probeTarget; // reached the frontier tile
      } else if (this.isProbeTargetValid(unit, locked)) {
        const lockedDist = distFn(unit.col, unit.row, locked.col, locked.row);
        if (lockedDist <= 24) {
          return { col: locked.col, row: locked.row };
        }
        delete unit._probeTarget; // went stale (unit was diverted far away)
      } else {
        delete unit._probeTarget; // became impassable / occupied
      }
    }

    const searchRadius = 12;
    const startCol = Math.max(0, unit.col - searchRadius);
    const endCol = Math.min(map.width - 1, unit.col + searchRadius);
    const startRow = Math.max(0, unit.row - searchRadius);
    const endRow = Math.min(map.height - 1, unit.row + searchRadius);

    const candidates: Array<{ col: number; row: number; dist: number }> = [];

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        if (col === unit.col && row === unit.row) continue;
        // Never send a unit onto impassable terrain (ocean etc.).
        if (typeof this.gameEngine.isTilePassable === 'function' && !this.gameEngine.isTilePassable(col, row)) continue;
        // Island movement: a land unit can only reach its own landmass.
        if (!this.areLandConnected(unit.col, unit.row, col, row)) continue;

        const isExplored = typeof this.gameEngine.isExploredByPlayer === 'function'
          ? this.gameEngine.isExploredByPlayer(unit.civilizationId, col, row)
          : !!this.gameEngine.getTileAt?.(col, row)?.explored;
        if (isExplored) continue;

        // Never target a tile occupied by our own city or unit.
        const occUnit = this.gameEngine.getUnitAt?.(col, row);
        if (occUnit && occUnit.civilizationId === unit.civilizationId) continue;
        const occCity = this.gameEngine.getCityAt?.(col, row);
        if (occCity && occCity.civilizationId === unit.civilizationId) continue;

        candidates.push({ col, row, dist: distFn(unit.col, unit.row, col, row) });
      }
    }

    if (candidates.length > 0) {
      // Weighted-random pick from the nearest frontier band, biased by the
      // unit's random exploration bearing — different units push out in
      // different, random directions instead of all streaming to one edge.
      const bearing = this.getExplorationBearing(unit);
      const pick = AIUtility.pickRandomExplorationTarget(unit, candidates, bearing);
      if (pick) {
        unit._probeTarget = { col: pick.col, row: pick.row };
        unit._exploreTarget = { col: pick.col, row: pick.row };
        return { col: pick.col, row: pick.row };
      }
    }
    return null;
  }

  /** Roll a random 8-direction exploration bearing (never the zero vector). */
  private rollExplorationBearing(): { dx: number; dy: number } {
    const dirs = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
    const d = dirs[Math.floor(Math.random() * dirs.length)];
    return { dx: d[0], dy: d[1] };
  }

  /**
   * The unit's exploration bearing: a random START direction, re-rolled
   * whenever the unit reaches its previous exploration target so every new
   * leg of the exploration heads out in a fresh random direction.
   */
  private getExplorationBearing(unit: { col: number; row: number }): { dx: number; dy: number } {
    const u = unit as Unit;
    const prev = u._exploreTarget;
    if (!u._exploreBearing || (prev && u.col === prev.col && u.row === prev.row)) {
      u._exploreBearing = this.rollExplorationBearing();
    }
    return u._exploreBearing as { dx: number; dy: number };
  }

  /** A locked probe tile is usable when still passable and unoccupied by us. */
  private isProbeTargetValid(unit: Unit, target: { col: number; row: number }): boolean {
    if (typeof this.gameEngine.isTilePassable === 'function' && !this.gameEngine.isTilePassable(target.col, target.row)) return false;
    if (!this.areLandConnected(unit.col, unit.row, target.col, target.row)) return false;
    const occupant = this.gameEngine.getUnitAt?.(target.col, target.row);
    if (occupant && occupant.civilizationId === unit.civilizationId) return false;
    const city = this.gameEngine.getCityAt?.(target.col, target.row);
    if (city && city.civilizationId === unit.civilizationId) return false;
    return true;
  }

  /** A committed target is still usable when passable and not our own city/unit. */
  private isCommittedTargetValid(unit: Unit, target: { col: number; row: number }): boolean {
    if (typeof this.gameEngine.isTilePassable === 'function' && !this.gameEngine.isTilePassable(target.col, target.row)) return false;
    // A land unit must not stay committed to a target on another landmass.
    if (!this.areLandConnected(unit.col, unit.row, target.col, target.row)) return false;
    // …nor to a tile it already failed to enter (stuck-target guard).
    if (unit._blockedScoutTargets instanceof Set
        && unit._blockedScoutTargets.has(`${target.col},${target.row}`)) {
      return false;
    }
    const occupant = this.gameEngine.getUnitAt?.(target.col, target.row);
    if (occupant && occupant.civilizationId === unit.civilizationId) return false;
    const city = this.gameEngine.getCityAt?.(target.col, target.row);
    if (city && city.civilizationId === unit.civilizationId) return false;
    return true;
  }

  /**
   * Forward picket for an idle combat unit: push toward the frontier so the
   * civ keeps contact with the enemy. Sources, best first:
   *   1. nearest known enemy location (ANY age — stale intel is still a
   *      direction to march; arriving refreshes the sighting and triggers
   *      combat, feeding the war-planning pipeline);
   *   2. nearest unexplored, passable tile within a far radius.
   * Returns null only when the unit genuinely has nowhere better to be.
   */
  private findForwardPicketTarget(
    unit: { col: number; row: number; civilizationId: number },
    distFn: (c1: number, r1: number, c2: number, r2: number) => number,
  ): { col: number; row: number } | null {
    const storage = this.gameEngine.getPlayerStorage?.(unit.civilizationId);

    // 1. Nearest known enemy, regardless of staleness.
    if (storage?.enemyLocations) {
      let best: { col: number; row: number; dist: number } | null = null;
      for (const enemyList of storage.enemyLocations.values()) {
        for (const loc of enemyList) {
          if (!loc || typeof loc.col !== 'number' || typeof loc.row !== 'number') continue;
          const dist = distFn(unit.col, unit.row, loc.col, loc.row);
          if (dist === 0) continue;
          if (!best || dist < best.dist) {
            best = { col: loc.col, row: loc.row, dist };
          }
        }
      }
      if (best) return { col: best.col, row: best.row };
    }

    const map = this.gameEngine.map;
    const grid = this.gameEngine.squareGrid;
    if (!map || !grid) return null;

    // 2. Weighted-random unexplored tile within a far radius (the probe covers
    //    12; the picket reaches 24 so a unit whose local area is explored still
    //    pushes toward genuinely unknown territory).
    const candidates: Array<{ col: number; row: number; dist: number }> = [];
    const radius = 24;
    const startCol = Math.max(0, unit.col - radius);
    const endCol = Math.min(map.width - 1, unit.col + radius);
    const startRow = Math.max(0, unit.row - radius);
    const endRow = Math.min(map.height - 1, unit.row + radius);
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const dist = grid.squareDistance(unit.col, unit.row, col, row);
        if (dist === 0 || dist > radius) continue;
        const explored = typeof this.gameEngine.isExploredByPlayer === 'function'
          ? this.gameEngine.isExploredByPlayer(unit.civilizationId, col, row)
          : !!this.gameEngine.getTileAt(col, row)?.explored;
        if (explored) continue;
        if (typeof this.gameEngine.isTilePassable === 'function' && !this.gameEngine.isTilePassable(col, row)) continue;
        // Island movement: never picket toward a tile on another landmass.
        if (!this.areLandConnected(unit.col, unit.row, col, row)) continue;
        // Never target a tile occupied by our own city or unit.
        const occUnit = this.gameEngine.getUnitAt?.(col, row);
        if (occUnit && occUnit.civilizationId === unit.civilizationId) continue;
        const occCity = this.gameEngine.getCityAt?.(col, row);
        if (occCity && occCity.civilizationId === unit.civilizationId) continue;
        candidates.push({ col, row, dist });
      }
    }
    if (candidates.length > 0) {
      const bearing = this.getExplorationBearing(unit);
      const pick = AIUtility.pickRandomExplorationTarget(unit, candidates, bearing);
      if (pick) {
        (unit as Unit)._exploreTarget = { col: pick.col, row: pick.row };
        return { col: pick.col, row: pick.row };
      }
    }
    return null;
  }

  /**
   * Remember a tile a unit could not enter so it stops re-targeting the same
   * unreachable square every turn (the old behavior produced 10+ consecutive
   * `move_failed` rounds). Used for scouts AND military units: the blacklist
   * is fed to pathfinding as obstacles, so routes go around the blocker
   * instead of repeating the failed step.
   */
  private blacklistScoutTarget(unit: Unit, col: number, row: number): void {
    const key = `${col},${row}`;
    const blocked = unit._blockedScoutTargets instanceof Set
      ? unit._blockedScoutTargets
      : new Set<string>();
    blocked.add(key);
    // Keep the blacklist bounded so it can never grow without limit.
    if (blocked.size > 12) {
      const toDrop = Array.from(blocked as Set<string>).slice(0, blocked.size - 12);
      toDrop.forEach(k => blocked.delete(k));
    }
    unit._blockedScoutTargets = blocked;
  }

  /**
   * Find exploration target for scouts within their zone
   */
  private findScoutExplorationTarget(unit: Unit): { col: number; row: number } | null {
    if (!this.gameEngine.map || !this.gameEngine.squareGrid) return null;

    // Get scout's zone
    const scouts = this.gameEngine.units.filter((u: Unit) => u.civilizationId === unit.civilizationId && u.type === 'scout');
    const scoutIndex = scouts.findIndex(s => s.id === unit.id);

    if (scoutIndex < 0) return null;

    const storage = this.gameEngine.getPlayerStorage(unit.civilizationId);
    if (!storage || !storage.scoutZones[scoutIndex]) return null;

    const zone = storage.scoutZones[scoutIndex];

    // Find the nearest unexplored, passable tiles within the scout's zone and
    // pick a weighted-random one from the nearest frontier band, biased by the
    // scout's random exploration bearing. Ties (and near-ties) resolve
    // RANDOMLY: the original code kept the first (smallest row) — a systematic
    // bias that made every scout drift toward the TOP map edge, where it then
    // got stuck trying to reach impassable row-0 tiles. A tight radius first,
    // then a wide one — a scout parked in a fully explored patch must keep
    // pushing into far territory instead of freezing (the log shows a scout
    // stuck at one tile for 100+ rounds).
    const searchRadii = [10, 25];
    for (const searchRadius of searchRadii) {
      const candidates: Array<{ col: number; row: number; dist: number }> = [];

      // Search within zone boundaries (limit search to avoid performance issues)
      const startCol = Math.max(zone.minCol, unit.col - searchRadius);
      const endCol = Math.min(zone.maxCol, unit.col + searchRadius);
      const startRow = Math.max(zone.minRow, unit.row - searchRadius);
      const endRow = Math.min(zone.maxRow, unit.row + searchRadius);

      for (let col = startCol; col < endCol; col++) {
        for (let row = startRow; row < endRow; row++) {
          // Check if tile is in zone
          if (!this.gameEngine.isInScoutZone(unit.civilizationId, scoutIndex, col, row)) continue;

          // Skip tiles that previously failed to move into (stuck-target guard).
          const blockedKey = `${col},${row}`;
          if (unit._blockedScoutTargets instanceof Set && unit._blockedScoutTargets.has(blockedKey)) continue;

          const tile = this.gameEngine.getTileAt(col, row);
          if (!tile) continue;

          // Prefer per-player explored state so each scout targets ITS OWN
          // unexplored areas. (AI reveals are stored per-player; the global
          // `tile.explored` is never set for AI moves, so we must not fall back
          // to it — that made every tile look unexplored and the scout oscillate
          // between two tiles at the map edge.)
          const isExplored = typeof this.gameEngine.isExploredByPlayer === 'function'
            ? this.gameEngine.isExploredByPlayer(unit.civilizationId, col, row)
            : !!tile.explored;
          if (isExplored) continue;

          // Skip impassable targets (e.g. ocean) — sending scouts after them only
          // wastes turns on failed moves (the old "move failed to row 0" spam).
          if (typeof this.gameEngine.isTilePassable === 'function' && !this.gameEngine.isTilePassable(col, row)) continue;

          // Island movement: a scout must explore its OWN landmass. Without
          // this it kept targeting the far shore across water and froze at the
          // coast once the local island was explored.
          if (!this.areLandConnected(unit.col, unit.row, col, row)) continue;

          // Never target a tile occupied by our own city or unit.
          const occUnit = this.gameEngine.getUnitAt?.(col, row);
          if (occUnit && occUnit.civilizationId === unit.civilizationId) continue;
          const occCity = this.gameEngine.getCityAt?.(col, row);
          if (occCity && occCity.civilizationId === unit.civilizationId) continue;

          candidates.push({ col, row, dist: Math.max(Math.abs(col - unit.col), Math.abs(row - unit.row)) });
        }
      }

      if (candidates.length > 0) {
        // Weighted-random pick from the nearest frontier band, biased by the
        // scout's random exploration bearing — scouts fan out in different,
        // random directions instead of all drifting the same way.
        const bearing = this.getExplorationBearing(unit);
        const pick = AIUtility.pickRandomExplorationTarget(unit, candidates, bearing);
        if (pick) {
          unit._exploreTarget = { col: pick.col, row: pick.row };
          debugLog(`[AI-SCOUT] Found unexplored tile at (${pick.col},${pick.row}) in zone (of ${candidates.length})`);
          return pick;
        }
      }
    }

    // The zone is fully explored as far as we can see, but the blocked-target
    // list may itself be what cripples the scout (a long chain of failed
    // moves). Reset it once it has grown large so exploration can retry.
    if (unit._blockedScoutTargets instanceof Set && unit._blockedScoutTargets.size >= 12) {
      const wasBlocked = unit._blockedScoutTargets.size;
      unit._blockedScoutTargets = new Set<string>();
      debugLog(`[AI-SCOUT] Scout ${unit.id} reset ${wasBlocked} blocked targets to unstick`);
    }

    // If no unexplored tiles found in zone, move toward zone center to explore systematically
    const zoneCenterCol = Math.floor((zone.minCol + zone.maxCol) / 2);
    const zoneCenterRow = Math.floor((zone.minRow + zone.maxRow) / 2);

    // If scout is not at zone center, move toward it
    if (unit.col !== zoneCenterCol || unit.row !== zoneCenterRow) {
      // Find path toward zone center, preferring unexplored directions
      const neighbors = this.gameEngine.squareGrid.getNeighbors(unit.col, unit.row);
      const currentDistanceToCenter = Math.max(Math.abs(unit.col - zoneCenterCol), Math.abs(unit.row - zoneCenterRow));
      let bestNeighbor: { col: number; row: number } | null = null;
      let bestDistanceToCenter = currentDistanceToCenter;
      // Closest passable in-zone neighbor in ANY direction — the escape hatch
      // that lets a scout work its way around a terrain block instead of
      // parking on the spot forever.
      let anyPassableNeighbor: { col: number; row: number; dist: number } | null = null;

      for (const neighbor of neighbors) {
        if (!this.gameEngine.isInScoutZone(unit.civilizationId, scoutIndex, neighbor.col, neighbor.row)) continue;

        // NOTE: MapTile has no `passable` field; use the engine's terrain check
        // (the old `tile.passable` was always undefined, so this fallback never
        // found a valid neighbor).
        if (typeof this.gameEngine.isTilePassable !== 'function' || !this.gameEngine.isTilePassable(neighbor.col, neighbor.row)) continue;

        const distanceToCenter = Math.max(Math.abs(neighbor.col - zoneCenterCol), Math.abs(neighbor.row - zoneCenterRow));
        if (distanceToCenter < bestDistanceToCenter) {
          bestDistanceToCenter = distanceToCenter;
          bestNeighbor = neighbor;
        }
        if (!anyPassableNeighbor || distanceToCenter < anyPassableNeighbor.dist) {
          anyPassableNeighbor = { col: neighbor.col, row: neighbor.row, dist: distanceToCenter };
        }
      }

      if (bestNeighbor) {
        debugLog(`[AI-SCOUT] Moving toward zone center at (${zoneCenterCol},${zoneCenterRow}) via (${bestNeighbor.col},${bestNeighbor.row})`);
        return bestNeighbor;
      }

      // No direction reduces the distance to the zone center (boxed in by
      // terrain) — step to the closest passable tile anyway so the scout
      // navigates around the obstacle instead of freezing.
      if (anyPassableNeighbor) {
        debugLog(`[AI-SCOUT] Boxed in, stepping to (${anyPassableNeighbor.col},${anyPassableNeighbor.row}) around terrain`);
        return { col: anyPassableNeighbor.col, row: anyPassableNeighbor.row };
      }
    }

    debugLog(`[AI-SCOUT] No exploration targets found in zone ${scoutIndex}`);
    return null;
  }

  private isCombatUnit(unit: Unit): boolean {
    const nonCombatTypes = new Set(['settler', 'caravan', 'diplomat', 'worker', 'nuclear']);
    if (nonCombatTypes.has(unit.type)) {
      return false;
    }
    return (unit.attack || 0) > 0.5;
  }

  private isSettlerDirectlyThreatened(unit: Unit): boolean {
    if (!this.gameEngine.squareGrid) return false;
    const dm = this.gameEngine.diplomacyManager;
    const enemies = dm ? new Set((dm.getEnemies?.(unit.civilizationId) ?? []).map(Number)) : new Set<number>();
    if (enemies.size === 0) return false;

    for (const other of this.gameEngine.units) {
      if (other.civilizationId === unit.civilizationId || other.isDefeated) continue;
      const isHostile = other.civilizationId === BARBARIAN_CIV_ID
        || (dm?.isAtWar?.(unit.civilizationId, other.civilizationId) ?? false);
      if (!isHostile) continue;
      const dist = this.gameEngine.squareGrid.squareDistance(unit.col, unit.row, other.col, other.row);
      if (dist <= 2) return true;
    }

    for (const city of this.gameEngine.cities) {
      if (city.civilizationId === unit.civilizationId) continue;
      const isHostile = city.civilizationId === BARBARIAN_CIV_ID
        || (dm?.isAtWar?.(unit.civilizationId, city.civilizationId) ?? false);
      if (!isHostile) continue;
      const dist = this.gameEngine.squareGrid.squareDistance(unit.col, unit.row, city.col, city.row);
      if (dist <= 2) return true;
    }

    return false;
  }

  /** Whether the unit is standing on or immediately adjacent to one of its own cities. */
  private isAtOrAdjacentToFriendlyCity(unit: Unit): boolean {
    if (!this.gameEngine.squareGrid) return false;
    const cities = this.gameEngine.cities ?? [];
    for (const city of cities) {
      if (city.civilizationId !== unit.civilizationId) continue;
      const d = this.gameEngine.squareGrid.squareDistance(unit.col, unit.row, city.col, city.row);
      if (d <= 1) return true;
    }
    return false;
  }

  /**
   * Whether an AI combat unit should entrench: it is defending — a combat unit
   * holding on/next to one of its own cities and not already fortified. Used
   * when the unit has no other order (no target / already at its garrison spot).
   */
  /**
   * Where this unit should stand to keep a city garrisoned, if anywhere.
   *
   * Counts garrisons the same way the happiness rule does — on the tile, or
   * fortified beside it — so the deficit this fills is the deficit the city
   * actually feels. A unit already holding a city that is still below its floor
   * is left where it is instead of being sent to a different city, which is what
   * stops two garrisons shuffling between neighbours every turn.
   */
  private findGarrisonPost(
    unit: Unit,
    armyGroups: ArmyGroup[],
    allowCommitted = false,
  ): { col: number; row: number } | null {
    if (!this.isCombatUnit(unit) || unit.isFortified) return null;

    const cities = (this.gameEngine.cities ?? []).filter(
      (c: City) => c.civilizationId === unit.civilizationId,
    );
    if (cities.length === 0) return null;

    const attacking = armyGroups.some(
      (g) => g.status === 'marching' || g.status === 'attacking',
    );
    // The raised floor during an offensive is a preference, not a licence to
    // leave a city empty: with a small army the whole force can be marching and
    // the walls would end up with nobody. `allowCommitted` is the second pass,
    // taken only when the first found nothing, and it drops back to the absolute
    // floor of one so a campaign can never strip a city bare.
    const floor = allowCommitted
      ? MIN_GARRISON_PER_CITY
      : attacking ? MIN_GARRISON_WHILE_ATTACKING : MIN_GARRISON_PER_CITY;

    const econ = this.gameEngine.economicManager;
    const held = (c: City): number => {
      if (typeof econ?.garrisonOnCityTile !== 'function') return 0;
      return econ.garrisonOnCityTile(this.gameEngine.civilizations?.find(
        (civ: Civilization) => civ.id === unit.civilizationId,
      ), c);
    };

    // Worst-served city first: the emptiest walls are the ones worth a soldier.
    const needy = cities
      .map((c: City) => ({ city: c, count: held(c) }))
      .filter((n) => n.count < floor)
      .sort((a, b) => a.count - b.count);

    for (const { city } of needy) {
      // Already this city's garrison? Stay put rather than drift.
      if (unit.col === city.col && unit.row === city.row) {
        return null;
      }
      return { col: city.col, row: city.row };
    }
    return null;
  }

  private shouldFortifyForDefense(unit: Unit): boolean {
    return this.isCombatUnit(unit) && !unit.isFortified && this.isAtOrAdjacentToFriendlyCity(unit);
  }

  /**
   * Should a fortified garrison stay entrenched for another turn?
   *
   * "Adjacent to a friendly city" is only a POSITION, not a need. Treating it
   * as a need froze the AI's army permanently: once units garrisonsed a city
   * they were never offered to the turn queue again, so an AI-vs-AI run ended
   * with 9 units sitting fortified while its civ was at war — 1,916 hold
   * actions and no attack. A garrison now only holds when the city actually
   * needs defending; at war with a reachable enemy the unit is released.
   */
  private shouldKeepGarrisonFortified(unit: Unit, storage: PlayerTurnStorage): boolean {
    const civId = unit.civilizationId;
    if (!this.gameEngine.isCivAtWar?.(civId)) return true; // peace: entrench

    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;

    // The city this unit guards is under attack — stay, whatever else happens.
    const threatened = this.identifyThreatenedCities(civId, storage, roundNumber);
    if (threatened.some((t) => t.city.col === unit.col && t.city.row === unit.row)) return true;

    // An offensive plan explicitly wants this unit.
    if (this.getOffensivePlanTarget(unit, storage)) return false;

    // At war with an enemy we can actually march to: mobilise, even from a city.
    if (this.hasReachableEnemyTarget(civId, unit)) return false;

    return true;
  }

  /** Midpoint of a civ's cities, used as "where this civ is" for reachability. */
  private civCentroid(civilizationId: number): { col: number; row: number } {
    const owned = this.gameEngine.cities.filter((c) => c.civilizationId === civilizationId);
    if (owned.length === 0) {
      const unit = this.gameEngine.units.find((u) => u.civilizationId === civilizationId);
      return { col: unit?.col ?? 0, row: unit?.row ?? 0 };
    }
    const sum = owned.reduce((acc, c) => ({ col: acc.col + c.col, row: acc.row + c.row }), { col: 0, row: 0 });
    return { col: Math.round(sum.col / owned.length), row: Math.round(sum.row / owned.length) };
  }

  /**
   * True if a reachable enemy city or combat unit exists for this civ.
   * `onlyEnemyCivId` narrows the check to one opponent (used before declaring a
   * war on a specific civ).
   *
   * Land connectivity is the usual answer, but an enemy across a strait counts
   * too once the civ can put a hull in the water: the invasion mission ferries
   * a unit over and marches on the city. Without that the two sides simply
   * never meet (a 465-round AI-vs-AI run: 17 declarations, 3 attacks).
   */
  private hasReachableEnemyTarget(civilizationId: number, unit: Unit, onlyEnemyCivId?: number): boolean {
    const enemies = new Set(
      (this.gameEngine.diplomacyManager?.getEnemies?.(civilizationId) ?? []).map(Number),
    );
    if (onlyEnemyCivId !== undefined) {
      enemies.clear();
      enemies.add(onlyEnemyCivId);
    }
    if (enemies.size === 0) return false;
    const hostile = (civId: unknown) => enemies.has(Number(civId));
    if (
      this.gameEngine.cities.some(
        (c) => hostile(c.civilizationId) && this.areLandConnected(unit.col, unit.row, c.col, c.row),
      ) ||
      this.gameEngine.units.some(
        (u) =>
          hostile(u.civilizationId) &&
          !u.isDefeated &&
          this.areLandConnected(unit.col, unit.row, u.col, u.row),
      )
    ) {
      return true;
    }
    return this.hasSeaInvasionTarget(civilizationId, onlyEnemyCivId);
  }

  /**
   * The civ-wide preconditions for any sea invasion: it can put a hull in the
   * water, owns a coastal city to sail from, and that city has a landmass.
   * Returns null when those fail. Everything here is independent of the target,
   * so callers test many targets against one context instead of recomputing it.
   */
  private buildSeaInvasionContext(civilizationId: number): SeaInvasionContext | null {
    if (!this.engineCanBuildShips(civilizationId)) return null;
    const ownCities = this.gameEngine.cities.filter((c: City) => c.civilizationId === civilizationId);
    if (ownCities.length === 0) return null;
    if (!ownCities.some((c) => this.gameEngine.findAdjacentOcean?.(c.col, c.row))) return null;
    const homeLandmass = this.gameEngine.getLandmassId?.(ownCities[0].col, ownCities[0].row) ?? -1;
    if (homeLandmass < 0) return null;
    return { homeLandmass };
  }

  /**
   * True if this particular known enemy position could be attacked from the
   * sea: it sits on another landmass and has a beach a ferry can reach. Land
   * positions are never 'sea' reachable — a walker is always better.
   */
  private isSeaInvasionTarget(
    loc: { col: number; row: number },
    context: SeaInvasionContext | null,
  ): boolean {
    if (!context) return false;
    const targetLandmass = this.gameEngine.getLandmassId?.(loc.col, loc.row) ?? -1;
    if (targetLandmass < 0 || targetLandmass === context.homeLandmass) return false;
    // A ferry can only put troops ashore where a land tile touches water.
    return this.gameEngine.findAdjacentOcean?.(loc.col, loc.row) != null;
  }

  /**
   * True if a hostile city sits on another landmass that a ferry could reach.
   * Public: `AutoProduction` asks it for the naval doctrine's
   * `seaInvasionTargets` input (it is the only place that knows which
   * landmasses actually have a beach).
   *
   * With no explicit target the question is "could we land on ANYbody we are
   * at war with" — a peaceful neighbour's island is not an invasion, and the
   * old unfiltered version answered yes to exactly that.
   */
  hasSeaInvasionTarget(civilizationId: number, onlyEnemyCivId?: number): boolean {
    const context = this.buildSeaInvasionContext(civilizationId);
    if (!context) return false;
    const targets = onlyEnemyCivId !== undefined
      ? new Set([onlyEnemyCivId])
      : new Set(
        (this.gameEngine.diplomacyManager?.getEnemies?.(civilizationId) ?? []).map(Number),
      );
    if (targets.size === 0) return false;
    return this.gameEngine.cities.some((c: City) => {
      if (c.civilizationId === civilizationId) return false;
      if (!targets.has(c.civilizationId)) return false;
      return this.isSeaInvasionTarget(c, context);
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Final war: "when no enemy is left on the map anymore"
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Declare active war on the next civilisation once every war this civ was
   * fighting is over, and set the war record that keeps the rest of the turn
   * (offensive plan, invasion mission, naval production) pointed at it.
   *
   * The trigger is deliberately narrow — see `shouldDeclareFinalWar`:
   *  - nobody is at war with us right now, i.e. all previous enemies are gone;
   *  - this civ HAS fought before, so a game that starts at peace does not
   *    become a world war the first time two scouts meet;
   *  - there is a living, met, non-allied civ we can reach on foot or by sea.
   *
   * Reachability is what splits the TODO in two: a land target is marched on by
   * the normal army pipeline, an overseas target makes the civ build a navy
   * (transport + warships) and sail an invasion mission at it.
   */
  private maybeDeclareFinalWar(
    civ: Civilization,
    storage: PlayerTurnStorage | undefined,
    roundNumber: number,
  ): void {
    const dm = this.gameEngine.diplomacyManager;
    if (!dm || !storage) return;
    storage.turnData = storage.turnData || {};

    if ((dm.getEnemies?.(civ.id) ?? []).length > 0) {
      // Enemies are still on the map — but remember that this civ fights, so
      // the trigger can fire once they are gone "anymore".
      storage.turnData.everAtWar = true;
      return;
    }

    // Any previous war record is stale now (peace, or the target was
    // annihilated). Drop it so production and the aggression override stop
    // reporting a war that no longer exists.
    if (storage.turnData.finalWar) delete storage.turnData.finalWar;
    if (!this.hasFoughtBefore(dm, civ.id, storage)) return;

    const ownCities = this.gameEngine.cities.filter((c: City) => c.civilizationId === civ.id);
    if (ownCities.length === 0) return;
    const ownLandmasses = new Set(
      ownCities.map((c) => this.gameEngine.getLandmassId?.(c.col, c.row) ?? -1),
    );

    // Beaches are scanned at most once per declaration attempt, and only if
    // some candidate is not walkable — an all-land map never pays for it.
    let beachLandmasses: Set<number> | null = null;
    const candidates: FinalWarCandidate[] = [];
    for (const other of this.gameEngine.civilizations ?? []) {
      if (other.id === civ.id || other.id === BARBARIAN_CIV_ID) continue;
      if (other.isAlive === false) continue;
      if (!dm.hasContacted?.(civ.id, other.id)) continue;
      if ((dm.getAllies?.(civ.id) ?? []).includes(other.id)) continue;
      if (!this.isCivStillInGame(other.id)) continue;
      // Same 8-round cooldown the diplomacy policy applies to its own
      // declarations — otherwise this hook re-declares the war the AI just
      // agreed to end, on the very next turn.
      if (this.peaceTooYoungToBreak(dm, civ.id, other.id, roundNumber)) continue;
      const reachableBy = this.classifyFinalWarReach(civ.id, other.id, ownLandmasses, () => {
        beachLandmasses ??= this.computeBeachLandmasses();
        return beachLandmasses;
      });
      if (!reachableBy) continue;
      candidates.push({
        civId: other.id,
        strength: dm.estimateMilitaryStrength?.(other.id) ?? 0,
        reachableBy,
      });
    }

    if (!shouldDeclareFinalWar({
      enemyCount: 0,
      candidateCount: candidates.length,
      everFought: this.hasFoughtBefore(dm, civ.id, storage),
    })) return;

    const decision = chooseFinalWarTarget(candidates);
    if (!decision) return;

    const targetName =
      this.gameEngine.civilizations?.[decision.targetCivId]?.name ?? String(decision.targetCivId);

    dm.declareWar(civ.id, decision.targetCivId);
    storage.turnData.finalWar = {
      targetCivId: decision.targetCivId,
      reachableBy: decision.reachableBy,
      declaredRound: roundNumber,
    } satisfies FinalWarRecord;
    storage.turnData.everAtWar = true;
    this.seedFinalWarIntel(storage, decision.targetCivId, roundNumber);

    debugLog(
      `[AI] ${civ.name} has no enemy left — turns on ${targetName} (${decision.reachableBy}-reachable)`,
    );
    this.gameEngine.log?.(
      'ai',
      `War declaration — ${civ.name} turns on ${targetName} (${decision.reachableBy})`,
      {
        civilizationId: civ.id,
        action: 'final_war',
        target: decision.targetCivId,
        reachableBy: decision.reachableBy,
        candidateCount: candidates.length,
      },
    );
  }

  /** True while the war started by the final-war trigger is still running. */
  private hasActiveFinalWar(storage: PlayerTurnStorage | undefined): boolean {
    const record = storage?.turnData?.finalWar as FinalWarRecord | undefined;
    if (!record) return false;
    return this.gameEngine.diplomacyManager?.isAtWar?.(
      storage?.civilizationId ?? -1,
      record.targetCivId,
    ) ?? false;
  }

  /**
   * Whether a signed peace with `otherId` is still too fresh to throw away.
   *
   * The diplomacy policy already applies an 8-round cooldown
   * (`mayDeclareWar` → "peace is too young to abandon"). The two MILITARY-side
   * declaration paths — the aggression rush and the final war — had none, so
   * an AI that had just agreed to end a war re-declared it on its very next
   * turn. A 56-round test game logged seven war/peace flips between two civs
   * that never took a city off each other.
   */
  private peaceTooYoungToBreak(
    dm: {
      getRelationsForCiv?: (
        civId: number,
      ) => Array<{ otherCivId: number; peaceSignedAt?: number }>;
    },
    civId: number,
    otherId: number,
    roundNumber: number,
    cooldown = 8,
  ): boolean {
    const rel = dm.getRelationsForCiv?.(civId)?.find((r) => r.otherCivId === otherId);
    if (!rel || rel.peaceSignedAt === undefined) return false;
    return roundNumber - rel.peaceSignedAt < cooldown;
  }

  /**
   * Has this civ ever been at war? Two independent sources, because either one
   * alone can miss a war:
   *  - `everAtWar` is observed on every AI turn, so it catches a war that ended
   *    by the enemy being annihilated (no peace treaty was ever signed);
   *  - `peaceSignedAt` on any relation is persisted with the save game and
   *    catches a war that was declared and settled between two of this civ's
   *    turns.
   */
  private hasFoughtBefore(
    dm: { getRelationsForCiv?: (civId: number) => Array<{ peaceSignedAt?: number }> },
    civId: number,
    storage: PlayerTurnStorage,
  ): boolean {
    if (storage.turnData?.everAtWar === true) return true;
    return (dm.getRelationsForCiv?.(civId) ?? []).some(
      (rel) => typeof rel.peaceSignedAt === 'number',
    );
  }

  /** Whether a civ still owns anything on the map. */
  private isCivStillInGame(civId: number): boolean {
    return this.gameEngine.cities.some((c: City) => c.civilizationId === civId)
      || this.gameEngine.units.some((u: Unit) => u.civilizationId === civId && !u.isDefeated);
  }

  /**
   * How a final war on `targetCivId` would be prosecuted, or null when it
   * could not be prosecuted at all (and therefore must not be declared).
   *
   * Land wins outright. Otherwise the target must sit on a landmass we can
   * land on — a different landmass from every city of ours that has a beach.
   * That is looser than `isSeaInvasionTarget`, which insists the city itself
   * touch the ocean: `planInvasionMission` puts the force down anywhere on the
   * enemy's continent and marches it inland from there.
   */
  private classifyFinalWarReach(
    ownCivId: number,
    targetCivId: number,
    ownLandmasses: Set<number>,
    beaches: () => Set<number>,
  ): FinalWarReach | null {
    const targets: Array<{ col: number; row: number }> = [
      ...this.gameEngine.cities.filter((c: City) => c.civilizationId === targetCivId),
      ...this.gameEngine.units.filter((u: Unit) => u.civilizationId === targetCivId && !u.isDefeated),
    ];
    if (targets.length === 0) return null;
    if (targets.some((t) => this.engineTileReachableByLand(ownCivId, t.col, t.row))) return 'land';

    // Sea: we can put a hull in the water at all…
    if (!this.buildSeaInvasionContext(ownCivId)) return null;
    // …and the target lives on a landmass with a beach we do not already own.
    const beachy = beaches();
    const landing = this.gameEngine.cities.some((c: City) => {
      if (c.civilizationId !== targetCivId) return false;
      const landmassId = this.gameEngine.getLandmassId?.(c.col, c.row) ?? -1;
      return landmassId >= 0 && !ownLandmasses.has(landmassId) && beachy.has(landmassId);
    });
    return landing ? 'sea' : null;
  }

  /**
   * Landmass ids that contain at least one tile a ferry can actually beach on
   * (land touching ocean within one step — the same rule `findInvasionBeach`
   * enforces, so a "reachable" landmass is one the invasion mission can use).
   */
  private computeBeachLandmasses(): Set<number> {
    const map = this.gameEngine.map;
    const grid = this.gameEngine.squareGrid;
    const out = new Set<number>();
    if (!map || !grid) return out;
    for (let row = 0; row < (map.height ?? 0); row++) {
      for (let col = 0; col < (map.width ?? 0); col++) {
        const landmassId = this.gameEngine.getLandmassId?.(col, row) ?? -1;
        if (landmassId < 0 || out.has(landmassId)) continue;
        const water = this.gameEngine.findAdjacentOcean?.(col, row);
        if (!water) continue;
        if (grid.chebyshevDistance(water.col, water.row, col, row) > 1) continue;
        out.add(landmassId);
      }
    }
    return out;
  }

  /**
   * A declared war of conquest needs something to march on. The AI only knows
   * where an opponent lives from accidental sightings, which `collectKnownTargets`
   * and `planBulkAttack` throw away after 40 rounds — a war declared because
   * everything else had been destroyed would start with an empty target list,
   * no offensive plan and no army group, i.e. the declaration would be pure
   * upkeep with no attacks. Cities do not move, so recording them is
   * remembered fact rather than clairvoyance.
   */
  private seedFinalWarIntel(
    storage: PlayerTurnStorage,
    targetCivId: number,
    roundNumber: number,
  ): void {
    const list = storage.enemyLocations.get(targetCivId) ?? [];
    for (const city of this.gameEngine.cities) {
      if (city.civilizationId !== targetCivId) continue;
      const existing = list.find(
        (loc) => loc.type === 'city' && loc.col === city.col && loc.row === city.row,
      );
      if (existing) {
        existing.lastSeenRound = roundNumber;
        continue;
      }
      list.push({
        col: city.col,
        row: city.row,
        type: 'city',
        id: city.id,
        discoveredRound: roundNumber,
        lastSeenRound: roundNumber,
      });
    }
    if (list.length > 30) {
      list.sort((a, b) => b.lastSeenRound - a.lastSeenRound);
      list.length = 30;
    }
    storage.enemyLocations.set(targetCivId, list);
  }

  private selectStrategicTarget(unit: Unit): { col: number; row: number } | null {
    if (!this.gameEngine.squareGrid) {
      return null;
    }

    const storage = this.gameEngine.getPlayerStorage(unit.civilizationId);
    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;

    // Keep one combat unit assigned to each city unless that city is under
    // immediate threat. Reserve units do not join offensive plans or patrol
    // away from the city network.
    const reserveTarget = this.getCityDefenseReserveTarget(unit, storage, roundNumber);
    if (reserveTarget) {
      return reserveTarget;
    }

    // The explicit offensive plan (a deliberate siege decision, already gated
    // on army strength and NOT when a city is critically threatened) takes
    // priority over generic defensive shuffling. Previously defense ran first,
    // so minor border pressure permanently pulled units away from the attack
    // and the AI sat in an AI-vs-AI stalemate, never besieging enemy cities.
    const offensivePlanTarget = this.getOffensivePlanTarget(unit, storage);
    if (offensivePlanTarget) {
      return offensivePlanTarget;
    }

    const defensiveTarget = this.findDefensiveAssignment(unit, storage, roundNumber);
    if (defensiveTarget) {
      return defensiveTarget;
    }

    // Blockade: starving a city beats marching at a remembered sighting, and
    // costs one unit instead of an assault the AI may not survive.
    const blockadeTarget = this.findBlockadeAssignment(unit);
    if (blockadeTarget) {
      return blockadeTarget;
    }

    const offensiveTarget = this.findOffensiveAssignment(unit, storage, roundNumber);
    if (offensiveTarget) {
      return offensiveTarget;
    }

    return null;
  }

  private updateOffensivePlan(civilizationId: number, storage: PlayerTurnStorage, roundNumber: number): void {
    if (!storage) {
      return;
    }

    storage.turnData = storage.turnData || {};

    const threatenedCities = this.identifyThreatenedCities(civilizationId, storage, roundNumber);
    // A genuinely besieged city (garrison clearly overwhelmed) takes priority
    // over any offense — the civ must hold before it can push. Minor border
    // pressure alone must NOT permanently cancel the offensive plan (that left
    // AI-vs-AI stuck in a defensive stalemate where neither side attacked).
    const criticalThreats = threatenedCities.filter((t) => (t.assessment?.netThreat ?? 0) >= 2.5);
    if (criticalThreats.length > 0) {
      if (storage.turnData.offensivePlan) {
        debugLog(`[AI] Bulk attack withdrawn — civ ${civilizationId} has ${criticalThreats.length} critical threat(s)`);
      }
      storage.turnData.offensivePlan = null;
      return;
    }

    // Keep a committed, still-valid plan instead of re-planning (and wiping
    // the unit assignments) every single turn. The old churn cleared the
    // assault mid-march, so the bulk attack never reached the target.
    const existingPlan = storage.turnData.offensivePlan as AIState['offensivePlan'] | undefined;
    if (
      existingPlan?.target &&
      this.isOffensivePlanTargetValid(existingPlan) &&
      roundNumber - (existingPlan.roundPrepared ?? roundNumber) < OFFENSIVE_PLAN_MAX_AGE_ROUNDS
    ) {
      return;
    }

    // Situational aggression: how much this civ should push right now. Without
    // an aggression read the AI only ever defended, so it never started wars.
    const aggression = this.getAggressionState(civilizationId, storage, roundNumber);
    // A final war is a war of conquest the civ chose the moment it had nothing
    // left to fight: it is on the attack by definition, whatever a cautious
    // personality says about the last war. Without this a turtle runs out of
    // enemies, declares the war, and then never plans an assault on it.
    const aggressive = aggression.posture === 'aggressive' || this.hasActiveFinalWar(storage);

    const combatUnits = this.gameEngine.units.filter(
      (unit: Unit) => unit.civilizationId === civilizationId && this.isCombatUnit(unit),
    );
    const reserveIds = this.getCityDefenseReserveIds(civilizationId, combatUnits);
    const offensiveUnits = combatUnits.filter((unit: Unit) => !reserveIds.has(unit.id));
    const availableStrength = this.calculateAvailableArmyStrength(civilizationId);

    // Bulk attack: a coordinated assault on a single city (or, failing that,
    // an enemy unit). Gated on the aggression posture AND on target strength —
    // the AI must not trigger an assault it cannot win, and it withdraws an
    // existing one when the target grows too strong.
    const knownTargets = this.collectKnownTargets(civilizationId, storage, roundNumber);
    // Retaliation: within the window, prefer the civ that took our city.
    const lostRound = storage.turnData.lastCityLostRound as number | undefined;
    const lostTo = storage.turnData.lastCityLostTo as number | undefined;
    const preferredCivId = typeof lostRound === 'number'
      && typeof lostTo === 'number'
      && roundNumber - lostRound <= RETALIATION_WINDOW_ROUNDS
      ? lostTo
      : undefined;
    const bulkPlan = planBulkAttack(
      this.gameEngine,
      civilizationId,
      knownTargets,
      availableStrength,
      offensiveUnits.length,
      roundNumber,
      aggressive,
      preferredCivId,
    );

    if (!bulkPlan) {
      if (storage.turnData.offensivePlan) {
        debugLog(`[AI] Bulk attack withdrawn — civ ${civilizationId} (${aggression.posture}, score ${aggression.score})`);
        this.gameEngine.log?.('ai', `Bulk attack withdrawn — civ ${civilizationId}`, {
          civilizationId, action: 'withdraw', score: aggression.score, posture: aggression.posture,
        });
      }
      storage.turnData.offensivePlan = null;
      return;
    }

    const personality = this.gameEngine.civilizations?.[civilizationId]?.personality;
    const personalityAggression = personality?.aggression ?? 5;
    // Aggressive civilizations commit earlier, cautious ones keep forming up.
    const requiredStrength = this.estimateRequiredStrength(bulkPlan.targetType) *
      (personalityAggression >= 8 ? 0.8 : personalityAggression <= 3 ? 1.15 : 1);

    if (availableStrength < requiredStrength) {
      storage.turnData.offensivePlan = null;
      return;
    }

    storage.turnData.offensivePlan = {
      target: { col: bulkPlan.target.col, row: bulkPlan.target.row },
      targetType: bulkPlan.targetType,
      score: bulkPlan.targetDefense,
      requiredUnits: bulkPlan.requiredUnits,
      assignedUnitIds: [] as string[],
      roundPrepared: roundNumber,
      targetDefense: bulkPlan.targetDefense,
      targetCivId: bulkPlan.targetCivId,
      reachableBy: bulkPlan.reachableBy ?? 'land',
    };

    this.gameEngine.log?.('ai', `Bulk attack — ${this.gameEngine.civilizations?.[civilizationId]?.name ?? civilizationId} assaults (${bulkPlan.target.col},${bulkPlan.target.row})`, {
      civilizationId, action: 'bulk_attack', targetCol: bulkPlan.target.col, targetRow: bulkPlan.target.row,
      targetType: bulkPlan.targetType, targetDefense: bulkPlan.targetDefense, requiredUnits: bulkPlan.requiredUnits,
      score: aggression.score, reasons: aggression.reasons,
    });
  }

  /** Refresh (and cache) the civ's situational aggression posture. */
  private getAggressionState(civilizationId: number, storage: PlayerTurnStorage, roundNumber: number): AggressionState {
    const aiState: AIState = (storage?.turnData?.aiState as AIState) ?? createDefaultAIState();
    const cached = aiState.aggression;
    // Re-evaluate a few times per turn so captures/threats flip the posture
    // reasonably quickly without per-unit overhead.
    if (cached && roundNumber - (cached.lastEvaluation ?? 0) < 3) {
      return cached;
    }
    const gameState = this.buildGameState(civilizationId);
    const assessment = this.evaluateAggression(civilizationId, gameState);
    const state: AggressionState = {
      score: assessment.score,
      posture: assessment.aggressive ? 'aggressive' : 'defensive',
      reasons: assessment.reasons,
      lastEvaluation: roundNumber,
    };
    if (storage?.turnData) {
      aiState.aggression = state;
      storage.turnData.aiState = aiState;
    }
    return state;
  }

  /** Situational aggression score from the current game snapshot. */
  private evaluateAggression(civilizationId: number, gameState: { ownMilitaryStrength: number; averageEnemyStrength: number; criticalThreatsCount: number; threatenedCitiesCount: number; numOwnCities: number; isAtWar: boolean; currentYear: number }): AggressionAssessment {
    const personality = this.gameEngine.civilizations?.[civilizationId]?.personality;
    const storage = this.gameEngine.getPlayerStorage?.(civilizationId);
    // Retaliation window: a city lost recently makes the civ fight back.
    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    const lostRound = storage?.turnData?.lastCityLostRound as number | undefined;
    const recentlyLostCity = typeof lostRound === 'number' && roundNumber - lostRound <= RETALIATION_WINDOW_ROUNDS;

    let knownEnemyCities = 0;
    if (storage?.enemyLocations) {
      for (const enemies of storage.enemyLocations.values()) {
        for (const e of enemies) {
          if (e.type === 'city') knownEnemyCities++;
        }
      }
    }

    return computeAggression({
      personalityAggression: personality?.aggression ?? 5,
      ownArmyStrength: gameState.ownMilitaryStrength,
      enemyArmyStrength: gameState.averageEnemyStrength,
      criticalThreats: gameState.criticalThreatsCount,
      threatenedCities: gameState.threatenedCitiesCount,
      knownEnemyCities,
      numOwnCities: gameState.numOwnCities,
      numEnemyCities: knownEnemyCities,
      isAtWar: gameState.isAtWar,
      currentYear: gameState.currentYear,
      recentlyLostCity,
    });
  }

  /** Flatten stored enemy intelligence into the known-target list for bulk planning. */
  private collectKnownTargets(civilizationId: number, storage: PlayerTurnStorage, roundNumber: number): KnownTarget[] {
    const targets: KnownTarget[] = [];
    if (!storage?.enemyLocations) return targets;
    // Land targets feed the land army plan. Sea targets are kept, but marked:
    // an enemy city across the water is a perfectly good reason to go to WAR
    // (the invasion mission ferries troops over), and dropping it here is why
    // an archipelago game never saw a single declaration — the plan had no
    // target, so there was no `targetCivId` to declare against.
    //
    // The sea-invasion preconditions are target-independent, so they are built
    // once on the first unreachable location and reused for the whole list.
    let seaContext: SeaInvasionContext | null | undefined;
    for (const [enemyCivId, enemyList] of storage.enemyLocations) {
      for (const loc of enemyList) {
        const age = roundNumber - (loc.lastSeenRound ?? loc.discoveredRound ?? roundNumber);
        // Same 40-round window as planBulkAttack: intel that is not ancient
        // still feeds the war plan even if the two fronts are apart.
        if (age > 40) continue;
        const reachableByLand = this.engineTileReachableByLand(civilizationId, loc.col, loc.row);
        let reachableBySea = false;
        if (!reachableByLand) {
          seaContext ??= this.buildSeaInvasionContext(civilizationId);
          reachableBySea = this.isSeaInvasionTarget(loc, seaContext);
        }
        if (!reachableByLand && !reachableBySea) continue;
        targets.push({
          col: loc.col,
          row: loc.row,
          type: loc.type,
          id: loc.id,
          lastSeenRound: loc.lastSeenRound,
          discoveredRound: loc.discoveredRound,
          civId: enemyCivId,
          reachableBy: reachableByLand ? 'land' : 'sea',
        });
      }
    }
    return targets;
  }

  /**
   * Whether a committed offensive plan's target still exists and belongs to
   * the enemy it was planned against (a captured city / killed unit makes the
   * plan stale).
   */
  private isOffensivePlanTargetValid(plan: NonNullable<AIState['offensivePlan']>): boolean {
    if (!plan.target) return false;
    if (plan.targetType === 'city') {
      const city = this.gameEngine.getCityAt(plan.target.col, plan.target.row);
      if (!city) return false;
      return plan.targetCivId == null || city.civilizationId === plan.targetCivId;
    }
    const enemy = this.gameEngine.getUnitAt(plan.target.col, plan.target.row);
    if (!enemy) return false;
    return plan.targetCivId == null || enemy.civilizationId === plan.targetCivId;
  }

  private getOffensivePlanTarget(unit: Unit, storage: PlayerTurnStorage): { col: number; row: number } | null {
    const plan = storage?.turnData?.offensivePlan as AIState['offensivePlan'] | undefined;
    if (!plan || !plan.target) {
      return null;
    }

    if (this.getCityDefenseReserveIds(unit.civilizationId).has(unit.id)) {
      return null;
    }

    // A plan aimed at an enemy island is a REASON TO GO TO WAR, not a marching
    // order: the invasion mission ferries one unit at a time across. A land
    // unit sent at it would walk to the shoreline and hold there every turn
    // (the "Already at target" treadmill), so it gets no target from this plan
    // and falls through to its normal assignment.
    if (plan.reachableBy === 'sea') {
      return null;
    }

    // Prune dead/removed units from the assignment list — stale ids used to
    // occupy the required-unit slots forever, so the plan silently stopped
    // assigning attackers.
    plan.assignedUnitIds = (plan.assignedUnitIds ?? []).filter((id) => {
      const assigned = this.gameEngine.units.find((u: Unit) => u.id === id);
      return !!assigned && !assigned.isDefeated;
    });

    // The target may have been captured or killed since the plan was made —
    // drop the plan instead of marching at an empty tile.
    if (plan.targetType === 'city') {
      const targetCity = this.gameEngine.getCityAt(plan.target.col, plan.target.row);
      if (!targetCity || targetCity.civilizationId === unit.civilizationId) {
        storage.turnData.offensivePlan = null;
        return null;
      }
    }

    // Withdraw: if the target has become too strong since the plan was made,
    // units fall back to defensive/other assignments instead of suiciding into
    // the assault. (The plan itself is cleared on the next re-plan.)
    if (typeof plan.targetDefense === 'number') {
      const availableStrength = this.calculateAvailableArmyStrength(unit.civilizationId);
      if (availableStrength < plan.targetDefense * BULK_ATTACK_STRENGTH_RATIO) {
        return null;
      }
    }

    if (plan.assignedUnitIds.includes(unit.id)) {
      return plan.target;
    }

    // The plan is a COMMITTED assault: every non-reserve combat unit supports
    // it. `requiredUnits` is the minimum force needed to win, not a cap — the
    // old cap left most of a big army with no offensive assignment, so those
    // units fell through to picket/patrol and idled at home while three units
    // besieged. The army now moves as one fist.
    plan.assignedUnitIds.push(unit.id);
    return plan.target;
  }

  /** Choose one strong/nearby combat unit to remain with each own city. */
  private getCityDefenseReserveIds(civilizationId: number, combatUnits?: Unit[]): Set<string> {
    const units = combatUnits ?? this.gameEngine.units.filter(
      (unit: Unit) => unit.civilizationId === civilizationId && this.isCombatUnit(unit)
    );
    const cities = this.gameEngine.cities
      .filter((city: City) => city.civilizationId === civilizationId);
    const reserves = new Set<string>();

    // Keep at least a MIN_GROUP_SIZE (3) force free for offense. A full
    // one-unit-per-city garrison is only affordable when the army is larger
    // than cities + 3; otherwise reserving every unit left the AI with no
    // offensive units at all, so army groups never formed ("groups never
    // attack"). Once the army reaches 4 units, every city gets at least 1
    // defender regardless. Past the very early game (year >= -2000), every
    // city always gets at least 1 defender regardless of army size.
    const currentYear = this.gameEngine.currentYear ?? -4000;
    const isEarlyGame = currentYear < -2000;
    const maxReserves = units.length >= cities.length + 3
      ? cities.length
      : units.length >= 4
        ? cities.length
        : !isEarlyGame
          ? cities.length
          : Math.max(0, units.length - 3);

    for (const city of cities) {
      if (reserves.size >= maxReserves) break;
      const candidates = units
        .filter((unit: Unit) => !reserves.has(unit.id))
        .map((unit: Unit) => ({
          unit,
          distance: this.gameEngine.squareGrid?.squareDistance(unit.col, unit.row, city.col, city.row) ?? Infinity,
        }))
        .sort((a, b) => {
          const aInGarrisonRange = a.distance <= 2 ? 0 : 1;
          const bInGarrisonRange = b.distance <= 2 ? 0 : 1;
          if (aInGarrisonRange !== bInGarrisonRange) return aInGarrisonRange - bInGarrisonRange;
          if (a.distance !== b.distance) return a.distance - b.distance;
          const aDefense = a.unit.defense ?? 0;
          const bDefense = b.unit.defense ?? 0;
          return bDefense - aDefense;
        });

      if (candidates[0]) {
        reserves.add(candidates[0].unit.id);
      }
    }
    return reserves;
  }

  /**
   * Keep one reserve unit in/near a city when it is answering a threat.
   * The reserve comes home ONLY when its city is actually threatened — it is
   * never recalled for distance alone. A distance-based recall ("come back if
   * you're more than 2 tiles away") combined with outward probing made units
   * oscillate: recalled home, then sent back out by the probe, then recalled
   * again — walking up and down every turn. With a single defender that also
   * trapped the civ at home forever, never exploring or finding the enemy.
   */
  private getCityDefenseReserveTarget(
    unit: Unit,
    storage: PlayerTurnStorage,
    roundNumber: number,
  ): { col: number; row: number } | null {
    if (!this.getCityDefenseReserveIds(unit.civilizationId).has(unit.id)) {
      return null;
    }

    const cities = this.gameEngine.cities
      .filter((city: City) => city.civilizationId === unit.civilizationId)
      .sort((a: City, b: City) => {
        const da = this.gameEngine.squareGrid.squareDistance(unit.col, unit.row, a.col, a.row);
        const db = this.gameEngine.squareGrid.squareDistance(unit.col, unit.row, b.col, b.row);
        return da - db;
      });
    const city = cities[0];
    if (!city) return null;

    // A real threat is handled by the normal defensive assignment below.
    const threatened = this.findDefensiveAssignment(unit, storage, roundNumber);
    if (threatened) return threatened;

    // A spare defender guards its home city while the rest of the force pushes.
    // Only park a reserve at home when a real offensive force exists (>=3 other
    // combat units) — a lone defender must stay mobile (probe/picket) or the
    // civ is trapped at home and never makes contact (see oscillation notes).
    const ownCombat = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId === unit.civilizationId && this.isCombatUnit(u),
    );
    const reserveIds = this.getCityDefenseReserveIds(unit.civilizationId, ownCombat);
    const nonReserveCount = ownCombat.filter((u: Unit) => !reserveIds.has(u.id)).length;
    if (nonReserveCount >= 3) {
      return { col: city.col, row: city.row };
    }

    return null;
  }

  private calculateAvailableArmyStrength(civilizationId: number): number {
    const combatUnits = this.gameEngine.units
      .filter((unit: Unit) => unit.civilizationId === civilizationId && this.isCombatUnit(unit));
    const reserveIds = this.getCityDefenseReserveIds(civilizationId, combatUnits);
    return combatUnits
      .filter((unit: Unit) => !reserveIds.has(unit.id))
      .reduce((total: number, unit: Unit) => {
        const attackStrength = Math.max(1, unit.attack || 0);
        const defenseSupport = Math.max(0, (unit.defense || 0) * 0.5); // count half of defensive stat for offensive push
        return total + attackStrength + defenseSupport;
      }, 0);
  }

  private estimateRequiredStrength(targetType: 'city' | 'unit' | undefined): number {
    // A sizeable but not overwhelming force: ~3 units can mount a siege.
    // (The old base of 10 needed ~4+ units AND a completely calm border, so
    // the AI almost never attacked — it sat in a defensive stalemate.)
    const base = targetType === 'city' ? 7 : 5;
    const difficulty = this.gameEngine.gameSettings?.difficulty ?? 'PRINCE';
    const modifiers: Record<string, number> = {
      CHIEFTAIN: 1.1,
      WARLORD: 1.05,
      PRINCE: 1,
      KING: 0.9,
      EMPEROR: 0.85
    };
    const modifier = modifiers[difficulty.toUpperCase()] ?? 1;
    return base * modifier;
  }

  private findOffensiveAssignment(unit: Unit, storage: PlayerTurnStorage, roundNumber: number): { col: number; row: number } | null {
    if (!storage || !storage.enemyLocations || storage.enemyLocations.size === 0) {
      return null;
    }

    // Before a coordinated force exists, keep combat units defensive instead
    // of sending isolated attackers toward a known enemy position.
    const combatUnits = this.gameEngine.units
      .filter((candidate: Unit) => candidate.civilizationId === unit.civilizationId && this.isCombatUnit(candidate));
    const reserveIds = this.getCityDefenseReserveIds(unit.civilizationId, combatUnits);
    if (combatUnits.filter((candidate: Unit) => !reserveIds.has(candidate.id)).length < 3) {
      return null;
    }

    let bestTarget: { col: number; row: number; score: number } | null = null;
    const canBuildShips = this.engineCanBuildShips(unit.civilizationId);

    for (const enemyList of storage.enemyLocations.values()) {
      for (const location of enemyList) {
        // Unreachable over land and no fleet yet → not a valid assignment.
        if (!canBuildShips && !this.engineTileReachableByLand(unit.civilizationId, location.col, location.row)) {
          continue;
        }
        const distance = this.gameEngine.squareGrid!.squareDistance(unit.col, unit.row, location.col, location.row);
        const isVisible = typeof this.gameEngine.isVisibleToPlayer === 'function'
          ? this.gameEngine.isVisibleToPlayer(unit.civilizationId, location.col, location.row)
          : false;

        // Count allied combat units near the target to favor convergence
        const nearbyAllied = this.gameEngine.units.filter(
          (u: Unit) => u.civilizationId === unit.civilizationId && u.id !== unit.id && this.isCombatUnit(u)
            && this.gameEngine.squareGrid!.squareDistance(u.col, u.row, location.col, location.row) <= 5
        ).length;

        const personality = this.gameEngine.civilizations?.[unit.civilizationId]?.personality;
        const { score } = scoreEnemyTarget({
          location,
          distance,
          currentRound: roundNumber,
          isCurrentlyVisible: isVisible,
          nearbyAlliedUnits: nearbyAllied,
          strategicValue: Math.max(0, (personality?.aggression ?? 5) - 5) * 3,
        });

        if (score < 10) {
          continue;
        }

        if (!bestTarget || score > bestTarget.score) {
          bestTarget = { col: location.col, row: location.row, score };
        }
      }
    }

    return bestTarget ? { col: bestTarget.col, row: bestTarget.row } : null;
  }

  /**
   * Starve an enemy city instead of storming it.
   *
   * A unit standing on one of a city's worked tiles takes that tile out of
   * production for as long as it stays there (`EconomicManager.
   * isTileOccupiedByForeignUnit`), so a single defender parked on a field cuts
   * the city's food every turn. The city eats `citizenFoodDemand(population)`
   * — which rises 0.2 per head per size above 5 — so the bigger the city, the
   * faster it bleeds. Blockading is also the cheap alternative to a siege: it
   * costs one unit and never risks losing it in an assault the AI cannot win.
   *
   * This runs after defence and after any committed offensive plan, but BEFORE
   * generic offensive scouting, because sitting on an enemy's food supply is a
   * surer way to hurt them than walking toward a remembered sighting.
   */
  private findBlockadeAssignment(unit: Unit): { col: number; row: number } | null {
    const grid = this.gameEngine.squareGrid;
    if (!grid || !this.gameEngine.isCivAtWar?.(unit.civilizationId)) return null;

    const dm = this.gameEngine.diplomacyManager;
    const atWarWith = (otherId: number): boolean =>
      dm?.isAtWar?.(unit.civilizationId, otherId)
      ?? ((this.gameEngine.civilizations?.[unit.civilizationId]?.warWith as Set<number> | undefined)
        ?.has(otherId) ?? false);

    const units = this.gameEngine.units ?? [];
    const enemyCities = (this.gameEngine.cities ?? []).filter(
      (c: City) => c.civilizationId !== unit.civilizationId
        && c.civilizationId >= 0
        && atWarWith(c.civilizationId),
    );
    if (enemyCities.length === 0) return null;

    let best: { col: number; row: number; score: number } | null = null;

    for (const city of enemyCities) {
      // How many of our units are already sitting on this city's tiles? One
      // blocker strips the tiles he stands on; piling a dozen onto the same
      // fields wastes the army, so only un-blockaded (or lightly blockaded)
      // cities are worth walking to.
      const blockers = units.filter(
        (u: Unit) => u.civilizationId === unit.civilizationId
          && !u.isDefeated
          && grid.squareDistance(u.col, u.row, city.col, city.row) <= 3,
      ).length;
      if (blockers >= BLOCKADE_UNITS_PER_CITY) continue;

      const food = city.yields?.food ?? 0;
      const distance = grid.squareDistance(unit.col, unit.row, city.col, city.row);
      // A distant, low-food city is not worth the march; a close, hungry one
      // is. Food dominates, distance only breaks ties.
      if (food < BLOCKADE_MIN_FOOD) continue;
      const score = food * 10 - distance;
      if (score <= 0) continue;
      if (best && score <= best.score) continue;

      const tile = this.findBlockadeTile(city, unit);
      if (!tile) continue;
      best = { col: tile.col, row: tile.row, score };
    }

    if (best) {
      debugLog(`[AI] Unit ${unit.id} blockades an enemy city to starve it (score ${best.score.toFixed(1)})`);
    }
    return best ? { col: best.col, row: best.row } : null;
  }

  /**
   * Which tile of this city to squat on: the richest field it works, so the
   * blockade takes away as much food as possible rather than a worthless one.
   */
  private findBlockadeTile(city: City, unit: Unit): { col: number; row: number } | null {
    const econ = this.gameEngine.economicManager;
    const center = `${city.col},${city.row}`;
    const fields = Array.from((city.workingTiles ?? new Set<string>()).values())
      .filter((key) => key !== center);
    if (fields.length === 0) return null;

    let best: { col: number; row: number; food: number } | null = null;
    for (const key of fields) {
      const sep = key.indexOf(',');
      if (sep === -1) continue;
      const col = Number(key.slice(0, sep));
      const row = Number(key.slice(sep + 1));
      if (Number.isNaN(col) || Number.isNaN(row)) continue;
      // Our own units already standing there are doing this city's blockade.
      const occupant = this.gameEngine.getUnitAt?.(col, row);
      if (occupant && occupant.civilizationId === unit.civilizationId && !occupant.isDefeated) continue;
      // Only land a unit can actually walk to.
      if (!this.engineTileReachableByLand(unit.civilizationId, col, row)) continue;

      const food = econ?.cityTileYields?.(this.gameEngine.getTileAt(col, row))?.food ?? 0;
      if (!best || food > best.food) best = { col, row, food };
    }
    return best;
  }

  private findDefensiveAssignment(unit: Unit, storage: PlayerTurnStorage, roundNumber: number): { col: number; row: number } | null {
    const threatenedCities = this.identifyThreatenedCities(unit.civilizationId, storage, roundNumber);
    if (threatenedCities.length === 0) {
      return null;
    }

    const ranked = threatenedCities
      .map(entry => ({
        ...entry,
        distance: this.gameEngine.squareGrid!.squareDistance(unit.col, unit.row, entry.city.col, entry.city.row)
      }))
      .sort((a, b) => {
        if (b.assessment.netThreat !== a.assessment.netThreat) {
          return b.assessment.netThreat - a.assessment.netThreat;
        }
        return a.distance - b.distance;
      });

    const best = ranked[0];
    if (!best) {
      return null;
    }

    if (best.assessment.closestSample && typeof best.assessment.closestSample.col === 'number' && typeof best.assessment.closestSample.row === 'number') {
      return { col: best.assessment.closestSample.col, row: best.assessment.closestSample.row };
    }

    return { col: best.city.col, row: best.city.row };
  }

  /**
   * How many of a civ's own cities are currently under threat. Used by the
   * naval doctrine as its "defend our coast" term: a civ with enemy ships in
   * its harbours has a reason to buy a warship even with no enemy cities in
   * sight.
   */
  countThreatenedCities(civilizationId: number): number {
    const storage = this.gameEngine.getPlayerStorage?.(civilizationId);
    if (!storage) return 0;
    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    return this.identifyThreatenedCities(civilizationId, storage, roundNumber).length;
  }

  private identifyThreatenedCities(civilizationId: number, storage: PlayerTurnStorage, roundNumber: number): Array<{ city: City; assessment: CityThreatAssessment }> {
    if (!this.gameEngine.squareGrid) {
      return [];
    }

    const threatened: Array<{ city: City; assessment: CityThreatAssessment }> = [];
    const friendlyCities = this.gameEngine.cities.filter(city => city.civilizationId === civilizationId);

    const currentYear = this.gameEngine.currentYear ?? -4000;
    const difficulty = this.gameEngine.gameSettings?.difficulty ?? 'PRINCE';
    const dynamicThreshold = calculateDangerThreshold(currentYear, difficulty);

    for (const city of friendlyCities) {
      const garrisonStrength = computeCityGarrisonStrength(this.gameEngine, city, civilizationId);
      const samples = collectCityThreatSamples(this.gameEngine, city, civilizationId, storage, roundNumber);
      if (samples.length === 0) {
        continue;
      }

      const assessment = assessCityThreat({
        city: { id: city.id, col: city.col, row: city.row },
        samples,
        garrisonStrength,
        defensiveBonus: 0,
        dangerThreshold: dynamicThreshold
      });

      if (assessment.needsDefense) {
        threatened.push({ city, assessment });
      }
    }

    return threatened;
  }
  /**
   * Emit event for AI target highlighting
   */
  private highlightAITarget(col: number, row: number, color: string = 'rgba(255,0,0,0.4)') {
    // Emit event for UI layer to handle highlighting
    if (this.gameEngine.onStateChange) {
      this.gameEngine.onStateChange('AI_TARGET_HIGHLIGHT', { col, row, color });
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // New integrated helpers
  // ──────────────────────────────────────────────────────────────────────

  /** Build a snapshot of game state for strategy/research evaluation */
  private buildGameState(civilizationId: number): {
    currentYear: number;
    roundNumber: number;
    numCities: number;
    numOwnCities: number;
    totalPopulation: number;
    numMilitaryUnits: number;
    numOwnMilitaryUnits: number;
    numOwnCivilianUnits: number;
    averageEnemyStrength: number;
    ownMilitaryStrength: number;
    numTechnologies: number;
    isAtWar: boolean;
    knownEnemyCities: number;
    numEnemyCitiesKnown: number;
    threatenedCitiesCount: number;
    criticalThreatsCount: number;
    hasLibrary: boolean;
    totalScience: number;
    hasWaterAccess: boolean;
    /**
     * 0 on a single-continent world; grows with the number of other
     * landmasses and jumps when a known enemy city sits on one of them.
     * AIResearch uses it to decide whether the naval branch is worth opening.
     */
    navalRelevance?: number;
    /** True when the civ's start tile was on an island (known from turn one). */
    startsOnIsland?: boolean;
    /** >0 when a coastal city has a fishing ground the FisherEconomics equation approves. */
    fishingRelevance?: number;
  } {
    const cities = this.gameEngine.cities?.filter((c: City) => c.civilizationId === civilizationId) || [];
    const civ = this.gameEngine.civilizations?.[civilizationId];
    const storage = this.gameEngine.getPlayerStorage?.(civilizationId);

    let knownEnemyCities = 0;
    if (storage?.enemyLocations) {
      for (const enemies of storage.enemyLocations.values()) {
        knownEnemyCities += enemies.filter((e) => e.type === 'city').length;
      }
    }

    const militaryUnits = this.gameEngine.units?.filter(
      (u: Unit) => u.civilizationId === civilizationId && this.isCombatUnit(u)
    ) ?? [];
    const civilianUnits = this.gameEngine.units?.filter(
      (u: Unit) => u.civilizationId === civilizationId && !this.isCombatUnit(u)
    ) ?? [];
    const ownStrength = militaryUnits.reduce(
      (sum: number, u: Unit) => sum + Math.max(1, u.attack || 0) + (u.defense || 0) * 0.5, 0
    );

    // Estimate average enemy military strength from known info
    const enemyUnits = this.gameEngine.units?.filter(
      (u: Unit) => u.civilizationId !== civilizationId && this.isCombatUnit(u)
    ) ?? [];
    const enemyCivIds = new Set(enemyUnits.map((u: Unit) => u.civilizationId));
    const avgEnemyStrength = enemyCivIds.size > 0
      ? enemyUnits.reduce((sum: number, u: Unit) => sum + Math.max(1, u.attack || 0) + (u.defense || 0) * 0.5, 0) / enemyCivIds.size
      : 0;

    // Count threatened cities
    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    const threatened = this.identifyThreatenedCities(civilizationId, storage, roundNumber);
    const criticalThreatsCount = threatened.filter(
      (t) => (t.assessment?.netThreat ?? 0) >= 2.5,
    ).length;

    // Check for library in any city
    const hasLibrary = cities.some((c: City) => c.buildings?.includes('library'));
    const totalScience = cities.reduce((sum: number, c: City) => sum + (c.science || 0), 0);
    const hasWaterAccess = cities.some((city: City) => this.cityHasDirectWaterAccess(city));

    // How naval is this world for us? More than one landmass plus a coastal
    // city means there is somewhere to sail to; a known enemy city on another
    // landmass means there is no other way to reach it. Zero on an ordinary
    // land map, so land games research exactly as before.
    const landmassCount = this.gameEngine.getLandmassCount?.() ?? 1;
    const homeLandmass =
      cities.length > 0 ? (this.gameEngine.getLandmassId?.(cities[0].col, cities[0].row) ?? -1) : -1;
    let enemyCitiesOffShore = 0;
    if (homeLandmass >= 0 && storage?.enemyLocations) {
      for (const enemies of storage.enemyLocations.values()) {
        enemyCitiesOffShore += enemies.filter(
          (e) =>
            e.type === 'city' &&
            (this.gameEngine.getLandmassId?.(e.col, e.row) ?? -1) !== homeLandmass,
        ).length;
      }
    }
    const startsOnIsland = civ?.startsOnIsland === true;
    const navalRelevance =
      ((hasWaterAccess || startsOnIsland) ? Math.min(2, Math.max(0, landmassCount - 1)) : 0) +
      (enemyCitiesOffShore > 0 ? 3 : 0);

    // How worthwhile is a Fisher Boat right now? A coastal city without a
    // Harbor whose best ground passes the FisherEconomics equation turns this
    // on; AIResearch then values the Harbor's prerequisite (Masonry) so the
    // civ actually unlocks the boat instead of never researching it.
    const fishingRelevance = fishingRelevanceForCiv(this.gameEngine, civilizationId);

    return {
      currentYear: this.gameEngine.currentYear ?? -4000,
      roundNumber,
      numCities: cities.length,
      numOwnCities: cities.length,
      totalPopulation: cities.reduce((sum: number, c: City) => sum + (c.population || 1), 0),
      numMilitaryUnits: militaryUnits.length,
      numOwnMilitaryUnits: militaryUnits.length,
      numOwnCivilianUnits: civilianUnits.length,
      averageEnemyStrength: avgEnemyStrength,
      ownMilitaryStrength: ownStrength,
      numTechnologies: civ?.technologies?.length ?? 0,
      // `isCivAtWar` is the source of truth; the fallback keeps partial
      // test doubles working.
      isAtWar: this.gameEngine.isCivAtWar?.(civ?.id ?? 0) ?? ((civ?.warWith?.size ?? 0) > 0),
      knownEnemyCities,
      numEnemyCitiesKnown: knownEnemyCities,
      threatenedCitiesCount: threatened.length,
      criticalThreatsCount,
      hasLibrary,
      totalScience,
      hasWaterAccess,
      navalRelevance,
      fishingRelevance,
      startsOnIsland,
    };
  }

  /** A city has direct water access only when an adjacent tile is ocean/sea. */
  private cityHasDirectWaterAccess(city: City): boolean {
    for (let dCol = -1; dCol <= 1; dCol++) {
      for (let dRow = -1; dRow <= 1; dRow++) {
        if (dCol === 0 && dRow === 0) continue;
        const tile = this.gameEngine.getTileAt?.(city.col + dCol, city.row + dRow);
        if (tile?.type === 'ocean' || tile?.type === 'sea' || tile?.type === 'river') return true;
      }
    }
    return false;
  }

  /** Estimate total enemy combat strength in 4-tile radius around a unit.
   *  Closer enemies contribute more to the threat estimate. */
  private estimateLocalEnemyStrength(unit: Unit): number {
    if (!this.gameEngine.squareGrid) return 0;

    const radius = 4;
    let enemyStrength = 0;
    const dm = this.gameEngine.diplomacyManager;

    for (const other of this.gameEngine.units) {
      if (other.civilizationId === unit.civilizationId) continue;
      // Only count units from civs we're at war with
      if (dm && !dm.isAtWar(unit.civilizationId, other.civilizationId)) continue;
      const dist = this.gameEngine.squareGrid.squareDistance(unit.col, unit.row, other.col, other.row);
      if (dist <= radius) {
        const raw = Math.max(1, other.attack || 0) + (other.defense || 0) * 0.5;
        // Weight by proximity: adjacent enemies count full, distant ones less
        const proximityWeight = 1 - (dist - 1) / (radius + 1);
        enemyStrength += raw * proximityWeight;
      }
    }

    return enemyStrength;
  }

  /** Resolve the owning civId from a scan result (unit or city) */
  private getOwnerCivId(scanResult: { type: 'unit' | 'city'; id: string }): number | undefined {
    if (scanResult.type === 'unit') {
      return this.gameEngine.units?.find((u: Unit) => u.id === scanResult.id)?.civilizationId;
    }
    return this.gameEngine.cities?.find((c: City) => c.id === scanResult.id)?.civilizationId;
  }

  /** Get known enemy targets from player storage for army group formation */
  private getKnownEnemyTargets(
    civilizationId: number,
    storage: PlayerTurnStorage
  ): Array<{ col: number; row: number; type: 'city' | 'unit'; estimatedStrength: number }> {
    const targets: Array<{ col: number; row: number; type: 'city' | 'unit'; estimatedStrength: number }> = [];
    if (!storage?.enemyLocations) return targets;
    // Army groups are land formations: only targets the army can actually
    // march to. Cross-water enemies are handled by the navy/colony pipeline.
    for (const enemyList of storage.enemyLocations.values()) {
      for (const loc of enemyList) {
        if (!this.engineTileReachableByLand(civilizationId, loc.col, loc.row)) {
          continue;
        }
        // Estimate strength: cities have higher estimated defense
        const estimatedStrength = loc.type === 'city' ? 8 : 3;
        targets.push({
          col: loc.col,
          row: loc.row,
          type: loc.type,
          estimatedStrength,
        });
      }
    }

    // Sort: prioritize cities over units
    return targets.sort((a, b) => {
      if (a.type === 'city' && b.type !== 'city') return -1;
      if (a.type !== 'city' && b.type === 'city') return 1;
      return b.estimatedStrength - a.estimatedStrength;
    });
  }

  /** Map strategy to settlement evaluation weights */
  private getSettlementWeightsForStrategy(strategy: StrategyProfile) {
    switch (strategy) {
      case 'military_expansion':
        return SettlementEvaluator.productionPowerhouseWeights();
      case 'science_focus':
      case 'wonder_rush':
        return SettlementEvaluator.tradeCommerceWeights();
      case 'early_expansion':
        return SettlementEvaluator.balancedGrowthWeights();
      case 'defensive_turtle':
        return SettlementEvaluator.productionPowerhouseWeights();
      case 'balanced_growth':
      default:
        return SettlementEvaluator.balancedGrowthWeights();
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Threat alert system — rally nearby combat units to detected threats
  // ──────────────────────────────────────────────────────────────────────

  /** Store a threat alert in player storage so other units can respond */
  private broadcastThreatAlert(_civilizationId: number, col: number, row: number, enemyStrength: number, storage: PlayerTurnStorage): void {
    if (!storage) return;
    storage.turnData = storage.turnData || {};
    if (!storage.turnData.threatAlerts) {
      storage.turnData.threatAlerts = [];
    }
    const alerts: ThreatAlert[] = storage.turnData.threatAlerts as ThreatAlert[];
    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;

    // Don't duplicate alerts at the same location this round
    const existing = alerts.find((a: ThreatAlert) => a.col === col && a.row === row && a.round === roundNumber);
    if (existing) {
      existing.enemyStrength = Math.max(existing.enemyStrength, enemyStrength);
      return;
    }

    alerts.push({ col, row, enemyStrength, round: roundNumber });

    // Keep only recent alerts (last 3 rounds)
    storage.turnData.threatAlerts = alerts.filter((a: ThreatAlert) => roundNumber - a.round <= 3);
    debugLog(`[AI] Threat alert broadcast at (${col},${row}), strength=${enemyStrength.toFixed(1)}`);
  }

  /** Find the closest active threat alert this unit should respond to */
  private getActiveAlertTarget(unit: Unit, storage: PlayerTurnStorage): { col: number; row: number } | null {
    if (!storage?.turnData?.threatAlerts || !this.gameEngine.squareGrid) return null;

    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    const alerts: ThreatAlert[] = storage.turnData.threatAlerts as ThreatAlert[];
    const ALERT_RESPONSE_RADIUS = 8;

    let bestAlert: ThreatAlert | null = null;
    let bestScore = -Infinity;

    for (const alert of alerts) {
      if (roundNumber - alert.round > 2) continue; // Skip stale alerts

      const dist = this.gameEngine.squareGrid.squareDistance(unit.col, unit.row, alert.col, alert.row);
      if (dist > ALERT_RESPONSE_RADIUS || dist === 0) continue;

      // Score = urgency (enemy strength) minus distance cost
      const score = alert.enemyStrength * 2 - dist;
      if (score > bestScore) {
        bestScore = score;
        bestAlert = alert;
      }
    }

    if (bestAlert) {
      return { col: bestAlert.col, row: bestAlert.row };
    }
    return null;
  }
}
