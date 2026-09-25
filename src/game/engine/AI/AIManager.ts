/**
 * AIManager - Manages AI behavior for civilizations
 * 
 * Coordinates all AI subsystems: strategy selection, technology research,
 * army coordination, building production, and unit targeting.
 */

import { AIUtility, scanAreaForEnemies, findInterceptPosition, findPatrolWaypoint, type ThreatAlert } from './AIUtility';
import { EnemySearcher } from '../EnemySearcher';
import { UNIT_PROPS, TERRAIN_PROPS, IMPROVEMENT_PROPERTIES, IMPROVEMENT_TYPES } from '@/utils/Constants';
import { BARBARIAN_CIV_ID, calculateVillageTakeChance, villageDecisionRoll } from '@/data/VillageConstants';
import { SettlementEvaluator, MIN_CITY_CENTER_DISTANCE } from '../SettlementEvaluator';
import { Pathfinding } from '../Pathfinding';
import { AIStrategySelector } from './AIStrategySelector';
import { AICoordinator } from './AICoordinator';
import { AIResearch } from './AIResearch';
import { computeAggression, planBulkAttack, BULK_ATTACK_STRENGTH_RATIO, type KnownTarget, type AggressionAssessment } from './AIAggression';
import { notify } from '@/utils/NotificationUtils';
import {
  createDefaultAIState,
  resolveAICivStrategy,
  type AIState,
  type AggressionState,
  type StrategyProfile,
} from './AITypes';
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
import GameEngine, { type PlayerTurnStorage, type MapTile } from '../GameEngine';
import { getShuffledAdjacentTiles } from '../MovementHelper';
import { awaitPendingAnimations } from '../../rendering/GlideAnimation';

// How much better (in settlement-score points) the best location must be for a
// settler to keep walking instead of founding at its current tile. Prevents
// settlers from chasing the 10x10 window maximum forever — as the settler
// moves, the window re-centers and the "best" spot keeps moving ahead.
const SETTLE_SCORE_THRESHOLD = 12;
// If the best settlement location is farther than this Chebyshev distance,
// found at the current tile instead of walking across the map.
const MAX_SETTLE_WALK_DISTANCE = 4;

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
          console.log(`[AI] Sleeping unit ${sleeping.id} (${sleeping.type}) woke — enemy ${enemy.id} (${enemy.type}) at (${enemy.col},${enemy.row})`);
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
      console.log(`[AI] processAITurn: Skipping civilization ${civilizationId} - is human player`);
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
      console.log(`[AI] runAITurn: Skipping civilization ${civilizationId} - not AI or is human`);
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
    console.log(`[AI] 🤖 Starting AI turn for civilization ${civilizationId} (${civ.name})`);
    this.gameEngine.log('ai', `🤖 AI turn start — ${civ.name} (civ ${civilizationId})`, { civilizationId, action: 'turn_start', strategy: civ.productionProfile ?? 'balanced_growth' });

    // Small delay before AI starts so player can observe
    await this.gameEngine.sleep(250);

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
      console.log(`[AI] Strategy changed: ${aiState.strategyProfile} -> ${newStrategy} for civ ${civilizationId}`);
      this.gameEngine.log('ai', `Strategy change — ${civ.name}: ${aiState.strategyProfile} → ${newStrategy}`, { civilizationId, action: 'strategy', from: aiState.strategyProfile, to: newStrategy });
      aiState.strategyProfile = newStrategy;
      aiState.lastStrategyEvaluation = roundNumber;
    }

    // ─── Phase 2: Technology research ──────────────────────────────────
    if (!civ.currentResearch) {
      // selectResearch returns the chosen techId (string) or null.
      const techChoice = AIResearch.selectResearch(civ, resolveAICivStrategy(civ, aiState), gameState);
      if (techChoice) {
        this.gameEngine.log('ai', `Research — ${civ.name} selects ${techChoice} (${aiState.strategyProfile})`, { civilizationId, action: 'research', tech: techChoice, strategy: aiState.strategyProfile });
        console.log(`[AI] Research selected: ${techChoice}`);
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
          console.log(`[AI] ${civ.name} adopts ${bestGov} government (revolution)`);
          this.gameEngine.startRevolution(civilizationId, bestGov);
        }
      }
    }

    // ─── Phase 2c: AI Diplomacy ─────────────────────────────────────
    if (this.gameEngine.diplomacyManager) {
      this.gameEngine.diplomacyManager.processAIDiplomacy(civilizationId);
    }

    // ─── Phase 3: Situational aggression + offensive plan ─────────────
    const aggressionState = this.getAggressionState(civilizationId, storage, roundNumber);
    if (aggressionState.posture === 'aggressive') {
      console.log(`[AI] ${civ.name} aggressive (score ${aggressionState.score}) — ${aggressionState.reasons.join(', ')}`);
      this.gameEngine.log?.('ai', `Aggression — ${civ.name} (score ${aggressionState.score})`, {
        civilizationId, action: 'aggression', score: aggressionState.score, reasons: aggressionState.reasons,
      });
    }

    this.updateOffensivePlan(civilizationId, storage, roundNumber);

    // Island colonization: keep the ferry-a-settler mission up to date.
    this.updateColonyMission(civ, storage);

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
          console.log(`[AI] ${civ.name} skips war on civ ${targetCivId} — no reachable target`);
          this.gameEngine.log?.('ai', `War declaration skipped — ${civ.name} cannot reach civ ${targetCivId}`, {
            civilizationId, action: 'declare_war_skipped', target: targetCivId, reason: 'no_reachable_target',
          });
        } else if (!dm.isAtWar(civilizationId, targetCivId)) {
          console.log(`[AI] ${civ.name} declares war (aggression ${aggressionState.score}) — rush against civ ${targetCivId}`);
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
    const combatUnits = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId === civilizationId && this.isCombatUnit(u)
    );
    const reserveIds = this.getCityDefenseReserveIds(civilizationId, combatUnits);
    const offensiveUnits = combatUnits.filter((unit: Unit) => !reserveIds.has(unit.id));
    const targets = this.getKnownEnemyTargets(civilizationId, storage)
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
    console.log(`[AI] Found ${aiUnits.length} units with moves remaining for civilization ${civilizationId}`);

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
        console.log(`[AI] Pausing AI turn — sleeping unit spotted enemy`);
        await this.gameEngine.sleep(1500); // Give player time to see the danger
        // Resume after brief pause — player can react on their turn
      }

      // Skip units that no longer exist (died in combat, disbanded for upkeep,
      // or consumed by founding a city) — prevents the "Skip: Unit not found"
      // warning spam and wasted processing on ghost units.
      if (!this.gameEngine.units.includes(unit)) {
        continue;
      }

      console.log(`[AI] Processing unit ${unit.id} (${unit.type}) at (${unit.col},${unit.row}) with ${unit.movesRemaining} moves remaining`);

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
          console.log(`[AI] Turn ${civilizationId} ended mid-processing — stopping unit ${unit.id}`);
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

        // Civ1: an AI settler founds a city, improves its tile, or explores.
        // The settlement search runs here (cached for chooseAITarget below) so
        // founding takes priority; without a settlement spot the settler builds
        // a road/irrigation/mine/railroad on its current tile instead of
        // wandering. Multi-turn construction continues automatically each turn
        // (advanceUnitWork), so starting is enough.
        if (unit.type === 'settler' && !unit.workTarget) {
          // Civ1: expansion FIRST — a settler founds a new city whenever a
          // valid spot exists, so empires actually grow. Previously the join
          // check ran first and every produced settler (spawned on the capital
          // tile) merged back into the capital, leaving civs at 1 city forever.
          let settlement: { col: number; row: number; score: number } | null = null;
          try {
            settlement = this.findBestSettlementForSettler(unit, resolveAICivStrategy(civ, aiState));
          } catch (error) {
            console.error('[AI-SETTLER] Error in settlement search:', error);
          }
          if (!this.gameEngine.units.includes(unit)) break; // consumed by founding
          unit._aiSettlement = settlement;

          if (!settlement) {
            // No founding spot worth walking to: join a friendly city rather
            // than waste the settler, otherwise improve the current tile.
            if (this.gameEngine.canJoinCity?.(unit.id)) {
              const joined = this.gameEngine.foundCityWithSettler(unit.id);
              if (joined) {
                this.gameEngine.log('ai', `Settler joins city — ${civ.name} at (${unit.col},${unit.row})`, {
                  civilizationId, action: 'join_city', unitId: unit.id, unitType: unit.type,
                });
                break;
              }
            }
            const improvement = this.chooseImprovementForSettler(unit);
            if (improvement) {
              const started = this.gameEngine.buildImprovement(unit.id, improvement);
              if (started) {
                console.log(`[AI-SETTLER] ${civ.name} settler ${unit.id} builds ${improvement} at (${unit.col},${unit.row})`);
                this.gameEngine.log('ai', `Settler improves — ${civ.name} builds ${improvement} at (${unit.col},${unit.row})`);
                break; // the settler worked its turn
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
          console.log(`[AI] Unit ${unit.id} attacks stacked enemy ${stackedEnemy.type} on the same tile`);
          this.gameEngine.log('ai', `Attack — ${civ.name} ${unit.type}(${unit.id}) attacks enemy ${stackedEnemy.type} at (${unit.col},${unit.row})`, { civilizationId, action: 'attack', unitId: unit.id, unitType: unit.type, targetType: stackedEnemy.type, targetCol: unit.col, targetRow: unit.row });
          this.gameEngine.combatUnit(unit, stackedEnemy);
          if (!this.gameEngine.units.includes(unit)) break; // attacker fell
          break; // combatUnit zeroes the attacker's moves
        }

        // Colony mission: a ferry alongside its settler boards it; a loaded
        // ferry puts the settler ashore on the target island.
        const colonyMission = this.getColonyMission(storage);
        if (unit.type === 'ferry' && colonyMission?.ferryId === unit.id) {
          if (this.tryColonyFerryAction(unit, colonyMission, storage)) break;
        }

        // Fisher Boat: deploy the net the moment it reaches a fish tile; with
        // an active route the engine's state machine owns its movement.
        if (unit.type === 'fisher_boat') {
          if (unit.fishingRoute) {
            this.gameEngine.skipUnit(unit.id);
            break;
          }
          if (this.gameEngine.canDeployFishingNet?.(unit.id)) {
            const deployed = this.gameEngine.deployFishingNet(unit.id);
            if (deployed) {
              console.log(`[AI-FISHER] ${civ.name} fisher ${unit.id} deploys net at (${unit.col},${unit.row})`);
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
            console.log(`[AI] No target — ${unit.type} fortifies to defend the city`);
            this.gameEngine.log('ai', `Fortify — ${civ.name} ${unit.type}(${unit.id}) defends city`, { civilizationId, action: 'fortify', unitId: unit.id, unitType: unit.type });
            this.gameEngine.unitFortify(unit.id);
            break;
          }
          console.log(`[AI] No target found for unit ${unit.id}, skipping`);
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
        if (unit.type === 'settler' && unit.col === target.col && unit.row === target.row) {
          console.log(`[AI-SETTLER] Settler ${unit.id} has reached settlement location (${target.col}, ${target.row}), founding city`);
          this.gameEngine.log('ai', `Settler settles — ${civ.name} founds city at (${target.col},${target.row})`, { civilizationId, action: 'settle', unitId: unit.id, unitType: unit.type, targetCol: target.col, targetRow: target.row });
          const result = this.gameEngine.foundCityWithSettler(unit.id);
          if (result) {
            console.log(`[AI-SETTLER] City founded successfully`);
            break; // Settler consumed, end this unit's processing
          } else {
            console.log(`[AI-SETTLER] Failed to found city, skipping settler`);
            this.gameEngine.skipUnit(unit.id);
            break;
          }
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
              console.log(`[AI] Unit ${unit.id} attacks adjacent enemy ${fullEnemy.type} at (${fullEnemy.col},${fullEnemy.row})`);
              this.gameEngine.log('ai', `Attack — ${civ.name} ${unit.type}(${unit.id}) attacks adjacent ${fullEnemy.type} at (${fullEnemy.col},${fullEnemy.row})`, { civilizationId, action: 'attack', unitId: unit.id, unitType: unit.type, targetType: fullEnemy.type, targetCol: fullEnemy.col, targetRow: fullEnemy.row });
              this.gameEngine.combatUnit(unit, fullEnemy);
              if (!this.gameEngine.units.includes(unit)) break; // unit defeated
              break; // combatUnit zeroes moves
            } else {
              console.log(`[AI] Unit ${unit.id} adjacent enemy but not enough moves, skipping`);
              this.gameEngine.skipUnit(unit.id);
              break;
            }
          }

          if (this.shouldFortifyForDefense(unit as Unit)) {
            console.log(`[AI] Unit ${unit.id} fortifies to defend the city`);
            this.gameEngine.log('ai', `Fortify — ${civ.name} ${unit.type}(${unit.id}) defends city`, { civilizationId, action: 'fortify', unitId: unit.id, unitType: unit.type });
            this.gameEngine.unitFortify(unit.id);
            break;
          }
          console.log(`[AI] Unit ${unit.id} already at target (${target.col},${target.row}), skipping`);
          this.gameEngine.log('ai', `Already at target — ${civ.name} ${unit.type}(${unit.id}) holds (${target.col},${target.row})`, { civilizationId, action: 'hold', unitId: unit.id, unitType: unit.type, reason: 'already_at_target', targetCol: target.col, targetRow: target.row });
          this.gameEngine.skipUnit(unit.id);
          break;
        }

        // If target is adjacent, try to move or attack
        const dist = this.gameEngine.squareGrid.squareDistance(unit.col, unit.row, target.col, target.row);
        console.log(`[AI] Target distance: ${dist} for unit ${unit.id} to (${target.col},${target.row})`);
        if (dist === 1) {
          const targetUnit = this.gameEngine.getUnitAt(target.col, target.row);
          if (targetUnit && targetUnit.civilizationId !== unit.civilizationId) {
            // Attack
            console.log(`[AI] Unit ${unit.id} attacking unit at (${target.col},${target.row})`);
            this.gameEngine.log('ai', `Attack — ${civ.name} ${unit.type}(${unit.id}) attacks enemy ${targetUnit.type} at (${target.col},${target.row})`, { civilizationId, action: 'attack', unitId: unit.id, unitType: unit.type, targetType: targetUnit.type, targetCol: target.col, targetRow: target.row });
            // Check move cost before attempting attack
            const tt = this.gameEngine.getTileAt(target.col, target.row);
            const attackCost = Math.max(1, TERRAIN_PROPS[tt?.type ?? '']?.movement ?? 1);
            // Civ1 Minimum-1-Move: a fresh unit may always make its first move,
            // even into heavy terrain (cost > remaining points).
            if (this.gameEngine.canUnitAffordMove(unit, attackCost)) {
              this.gameEngine.combatUnit(unit, targetUnit);
            } else {
             console.log(`[AI] Not enough moves for attack (${unit.movesRemaining} < ${attackCost}), skipping`);
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
                console.log(`[AI] Move failed, skipping unit`);
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
             console.log(`[AI] Not enough moves for move (${unit.movesRemaining} < ${moveCost}), skipping`);
              this.gameEngine.log('ai', `Move blocked — ${civ.name} ${unit.type}(${unit.id})`, { civilizationId, action: 'skip', unitId: unit.id, unitType: unit.type, reason: 'insufficient_moves' });
              // Blacklist adjacent tile so scout doesn't retry it next turn
              this.blacklistScoutTarget(unit, target.col, target.row);
             this.gameEngine.skipUnit(unit.id);
              break;
            }
          }
        } else {
          // Pathfind towards target and take next step
          console.log(`[AI] Pathfinding to non-adjacent target (${target.col},${target.row})`);
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
            console.log(`[AI] Path found, next step to (${next.col},${next.row}), path length: ${path.length}`);
            const tt = this.gameEngine.getTileAt(next.col, next.row);
            const moveCost = Math.max(1, TERRAIN_PROPS[tt?.type ?? '']?.movement ?? 1);
            if (!this.gameEngine.canUnitAffordMove(unit, moveCost)) {
              // A* routed the first step through a tile this unit cannot afford
              // (Civ1: a unit must pay the full movement cost of the tile it
              // enters). Fall back to the best affordable neighbor instead of
              // getting permanently stuck on the first step.
              const affordable = this.findAffordableStep(unit, target);
              if (!affordable) {
               console.log(`[AI] No affordable step for unit ${unit.id}, skipping`);
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
                  console.log(`[AI] Path step blocked — fallback move to (${fallbackStep.col},${fallbackStep.row})`);
                  this.gameEngine.log('ai', `Fallback move — ${civ.name} ${unit.type}(${unit.id}) → (${fallbackStep.col},${fallbackStep.row})`, { civilizationId, action: 'move', unitId: unit.id, unitType: unit.type, targetCol: fallbackStep.col, targetRow: fallbackStep.row, reason: 'path_step_fallback' });
                  break; // made progress; re-evaluate fresh next turn
                }
              }

             console.log(`[AI] Path step failed, skipping unit`);
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
                console.log(`[AI] No path — fallback move to (${fallbackStep.col},${fallbackStep.row})`);
                this.gameEngine.log('ai', `Fallback move — ${civ.name} ${unit.type}(${unit.id}) → (${fallbackStep.col},${fallbackStep.row})`, { civilizationId, action: 'move', unitId: unit.id, unitType: unit.type, targetCol: fallbackStep.col, targetRow: fallbackStep.row, reason: 'no_path_fallback' });
                break;
              }
            }
           console.log(`[AI] No path found to target, skipping unit`);
            this.gameEngine.log('ai', `No path — ${civ.name} ${unit.type}(${unit.id})`, { civilizationId, action: 'skip', unitId: unit.id, unitType: unit.type, reason: 'no_path' });
            // Settler fallback: block unreachable target and re-evaluate.
            if (unit.type === 'settler') {
              if (this.settlerReevaluateSettlement(unit, civ.name, civilizationId, target, aiState)) break;
            }
           this.gameEngine.skipUnit(unit.id);
            break;
          }
        }

        // Wait a little so moves are visible (skip in headless AI-vs-AI — the
        // 200ms per move adds up and trips the TurnManager AI timeout).
        const isAIVsAI = this.gameEngine.gameSettings?.mapType === 'AI_VS_AI'
          || this.gameEngine.gameSettings?.mapType === 'AI_VS_AI_SMALL';
        if (!isAIVsAI) {
          await this.gameEngine.sleep(200);
        }
      }
      console.log(`[AI] Finished processing unit ${unit.id}, final moves remaining: ${unit.movesRemaining}`);
    }

    console.log(`[AI] Finished all units for civilization ${civilizationId}`);
    // Emit event to clear highlights (UI decides how to handle)
    if (this.gameEngine.onStateChange) {
      this.gameEngine.onStateChange('AI_CLEAR_HIGHLIGHTS', { civilizationId });
    }

    // Process auto-production for AI cities
    console.log(`[AI] Processing auto-production for civilization ${civilizationId}`);
    this.gameEngine.autoProduction.processAutoProductionForCivilization(civilizationId);

    // Signal AI finished (for UI updates)
    console.log(`[AI] AI turn completed for civilization ${civilizationId}`);
    if (this.gameEngine.onStateChange) {
      this.gameEngine.onStateChange('AI_FINISHED', { civilizationId });
    }

    // RoundManager now responsible for evaluating end-of-turn and timeouts
  }

  /**
   * Find the best affordable next step toward a target for a unit whose
   * remaining movement cannot cover the A* path's first step. Civ1 units can
   * only enter tiles whose movement cost they can pay, so the AI picks the
   * cheapest affordable neighbor that reduces (or best limits) the distance to
   * the target. Returns null when the unit is genuinely boxed in.
   */
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

    console.log(`[AI-SETTLER] Settler ${unit.id} blocked target (${unreachableTarget.col},${unreachableTarget.row}), re-evaluating`);

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
    if (!settlement) {
      const tile = this.gameEngine.getTileAt(unit.col, unit.row);
      const city = this.gameEngine.getCityAt(unit.col, unit.row);
      if (tile && tile.type !== 'ocean' && tile.type !== 'mountains' && !city) {
        console.log(`[AI-SETTLER] Settler ${unit.id} re-evaluation found no better spot — founding at current (${unit.col},${unit.row})`);
        this.gameEngine.foundCityWithSettler(unit.id);
        return true;
      }
    }

    // If a new settlement target was picked, the main loop will move the
    // settler toward it on the next iteration.
    return false;
  }

  private findAffordableStep(
    unit: { col: number; row: number; movesRemaining?: number; civilizationId?: number },
    target: { col: number; row: number },
  ): { col: number; row: number } | null {
    const grid = this.gameEngine.squareGrid;
    const movesLeft = unit.movesRemaining ?? 0;
    if (!grid || !grid.getNeighbors) return null;
    const neighbors = grid.getNeighbors(unit.col, unit.row);
    let best: { col: number; row: number } | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const n of neighbors) {
      const tile = this.gameEngine.getTileAt(n.col, n.row);
      if (!tile) continue;
      // The tile must be passable — moveCost alone does not catch ocean /
      // mountains, and moveUnit would reject them anyway, silently defeating
      // the whole fallback (the scout would still freeze).
      if (typeof this.gameEngine.isTilePassable === 'function' && !this.gameEngine.isTilePassable(n.col, n.row)) continue;
      const moveCost = Math.max(1, TERRAIN_PROPS[tile.type ?? '']?.movement ?? 1);
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

  /** An own ferry that is alive and not carrying anyone. */
  private findIdleFerry(civId: number): Unit | null {
    return this.gameEngine.units.find(
      (u: Unit) => u.civilizationId === civId && u.type === 'ferry' && !u.isDefeated && !u.cargoUnitId,
    ) ?? null;
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
    if (!unit.cargoUnitId) {
      const settler = this.gameEngine.units.find(
        (u: Unit) => u.id === mission.settlerId && !u.isDefeated,
      );
      if (!settler) return false;
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
        && this.gameEngine.canUnloadFerry(unit.id, mission.landTile.col, mission.landTile.row)) {
      this.gameEngine.unloadFerry(unit.id, mission.landTile.col, mission.landTile.row);
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
   * Nearest explored fish tile (ocean or river) for a Fisher Boat without a
   * route. Returns null when the civ has not discovered any fish yet.
   */
  private findFishingGround(unit: Unit): { col: number; row: number } | null {
    const grid = this.gameEngine.squareGrid;
    if (!grid) return null;
    let best: { col: number; row: number } | null = null;
    let bestDist = Infinity;
    const width = grid.width ?? 0;
    const height = grid.height ?? 0;
    for (let col = 0; col < width; col++) {
      for (let row = 0; row < height; row++) {
        const tile = this.gameEngine.getTileAt(col, row);
        const resource = String((tile as { resource?: string } | null)?.resource ?? '').toLowerCase();
        if (resource !== 'fish') continue;
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
   * A naval unit's target, in priority order:
   *   1. the nearest enemy ship (sea control),
   *   2. a known enemy coastal city (blockade / escort the invasion),
   *   3. unexplored open water (patrol/exploration).
   */
  private chooseNavalTarget(unit: Unit): { col: number; row: number } | null {
    if (!this.gameEngine.squareGrid) return null;

    // A ferry on a colony mission ignores the war and runs its route.
    const storage = this.gameEngine.getPlayerStorage?.(unit.civilizationId);
    const mission = this.getColonyMission(storage);
    if (mission?.ferryId === unit.id) {
      if (unit.cargoUnitId) {
        return mission.waterTile; // sail the settler to the island
      }
      const settler = this.gameEngine.units.find(
        (u: Unit) => u.id === mission.settlerId && !u.isDefeated,
      );
      if (settler) {
        const alongside = typeof this.gameEngine.findAdjacentOcean === 'function'
          ? this.gameEngine.findAdjacentOcean(settler.col, settler.row)
          : null;
        if (alongside) return alongside;
        const nearestWater = this.findNearestOceanTo(settler.col, settler.row);
        if (nearestWater) return nearestWater;
      }
      return mission.waterTile;
    }

    const enemyShips = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId !== unit.civilizationId && !u.isDefeated && this.isNavalUnitType(u.type),
    );
    if (enemyShips.length > 0) {
      let best: Unit | null = null;
      let bestDist = Infinity;
      for (const ship of enemyShips) {
        const dist = this.gameEngine.squareGrid.squareDistance(unit.col, unit.row, ship.col, ship.row);
        if (dist < bestDist) {
          bestDist = dist;
          best = ship;
        }
      }
      if (best) return { col: best.col, row: best.row };
    }

    if (storage?.enemyLocations) {
      let best: { col: number; row: number } | null = null;
      let bestDist = Infinity;
      for (const locations of storage.enemyLocations.values()) {
        for (const loc of locations) {
          if (loc.type !== 'city') continue;
          // A ship can blockade/invade any city reachable by ocean OR river.
          const hasNavalAccess = typeof this.gameEngine.tileHasNavalAccess === 'function'
            ? this.gameEngine.tileHasNavalAccess(loc.col, loc.row)
            : this.gameEngine.tileHasOceanAccess?.(loc.col, loc.row) === true;
          if (!hasNavalAccess) continue;
          const dist = this.gameEngine.squareGrid.squareDistance(unit.col, unit.row, loc.col, loc.row);
          if (dist < bestDist) {
            bestDist = dist;
            best = { col: loc.col, row: loc.row };
          }
        }
      }
      if (best) return best;
    }

    return this.findNavalPatrolTarget(unit);
  }

  /** Nearest unexplored ocean tile — keeps idle ships moving and scouting. */
  private findNavalPatrolTarget(unit: Unit): { col: number; row: number } | null {
    const map = this.gameEngine.map;
    const grid = this.gameEngine.squareGrid;
    if (!map || !grid) return null;
    const explored = this.gameEngine.getPlayerStorage?.(unit.civilizationId)?.explored;

    for (let radius = 2; radius <= 14; radius++) {
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
          const index = row * map.width + col;
          if (explored && explored[index] === true) continue; // prefer the unknown
          if (this.gameEngine.getUnitAt(col, row)) continue;
          return { col, row };
        }
      }
    }
    return null;
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
   * Choose a target for AI unit
   */
  private chooseAITarget(unit: Unit): { col: number; row: number } | null {
    if (!this.gameEngine.map || !this.gameEngine.squareGrid) return null;

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
          console.log(`[AI] Unit ${unit.id} retreating (own: ${unitStrength.toFixed(1)}, enemy: ${localEnemyStrength.toFixed(1)})`);
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
        console.log(`[AI] Army group target for ${unit.id}: (${groupTarget.col},${groupTarget.row}) [${groupTarget.groupStatus}]`);
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
        console.log(`[AI] Area scan found ${nearbyEnemies.length} enemies near ${unit.id}, closest: ${closest.type} at (${closest.col},${closest.row}) dist=${closest.distance}`);

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
          console.log(`[AI] Intercepting enemy via defensive terrain at (${intercept.col},${intercept.row})`);
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
        console.log(`[AI] Unit ${unit.id} responding to threat alert at (${alertTarget.col},${alertTarget.row})`);
        return remember(alertTarget);
      }

      // ── Defend threatened cities ──
      const strategicTarget = this.selectStrategicTarget(unit as Unit);
      if (strategicTarget) {
        console.log(`[AI] Strategic target chosen for ${unit.type} ${unit.id} -> (${strategicTarget.col}, ${strategicTarget.row})`);
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
        console.log(`[AI] Unit ${unit.id} (${unit.type}) heading to village at (${villageTarget.col},${villageTarget.row})`);
        return remember(villageTarget);
      }

      // ── Probe outward when idle: idle military units expand the frontier ──
      // Without this the army sat in its capital forever and never made
      // contact with the enemy, so no intel → no war → no planned play.
      const probeTarget = this.findCombatProbeTarget(unit, storage, distFn);
      if (probeTarget) {
        console.log(`[AI] Probe target for ${unit.id}: (${probeTarget.col},${probeTarget.row})`);
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
        console.log(`[AI] Forward picket for ${unit.id}: (${picketTarget.col},${picketTarget.row})`);
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
        console.log(`[AI] Patrol waypoint for ${unit.id}: (${patrolTarget.col},${patrolTarget.row})`);
        return remember(patrolTarget);
      }
    }

    // ── Caravan delivery: send to a friendly city to establish a trade route ──
    // Civ1: Caravans are consumed when they deliver to a city, establishing a
    // permanent trade route. The AI sends them to the nearest friendly city
    // with fewer than 3 trade routes. This is a peacetime economy boost.
    if (unit.type === 'caravan') {
      const target = this.chooseCaravanDeliveryTarget(unit);
      if (target) {
        console.log(`[AI-CARAVAN] Caravan ${unit.id} heading to city at (${target.col},${target.row}) for trade route`);
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
        console.log(`[AI-DIPLOMAT] Diplomat ${unit.id} heading to foreign city (${diplomatTarget.col},${diplomatTarget.row})`);
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
        console.log(`[AI-SETTLER] Settler ${unit.id} heading to settlement (${cached.col},${cached.row})`);
        return { col: cached.col, row: cached.row };
      }
      // Civ1 income strategy: no settlement worth founding — walk to the
      // nearest friendly worked tile (grassland/plains/desert) lacking a road
      // and build a road there to boost the city's commerce → tax + science.
      if (!unit.workTarget) {
        const tradeRoad = this.findTradeRoadTarget(unit);
        if (tradeRoad) {
          console.log(`[AI-SETTLER] Settler ${unit.id} heading to worked tile (${tradeRoad.col},${tradeRoad.row}) to build a trade road`);
          return tradeRoad;
        }
      }
    }

    // Special handling for scouts: use EnemySearcher to find enemies
    if (unit.type === 'scout') {
      console.log(`[AI-SCOUT] Scout detected at (${unit.col}, ${unit.row}), checking for enemies`);

      // Defense override: exploration is less important than garrisoning an
      // undefended friendly city while an enemy is close. When the threat
      // clears (enemy gone or other troops arrive) this returns null and the
      // scout resumes exploring.
      try {
        const defenseTarget = this.findScoutDefenseTarget(unit);
        if (defenseTarget) {
          console.log(`[AI-SCOUT] Defending undefended city at (${defenseTarget.col},${defenseTarget.row}) — enemy close`);
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
          console.log(`[AI-SCOUT] Scout ${unit.id} heading to village at (${scoutVillage.col},${scoutVillage.row})`);
          return scoutVillage;
        }
      }

      try {
        // Check if scout already found an enemy (stored in unit state)
        if (unit.enemyFound) {
          console.log(`[AI-SCOUT] Scout ${unit.id} has found enemy, returning to nearest city`);
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
              console.log(`[AI-SCOUT] Scout returning to nearest city at (${nearestCity.col}, ${nearestCity.row})`);
              return { col: nearestCity.col, row: nearestCity.row };
            }
          }
        }

        // Phase 1: Initialize scout zones for this civilization
        this.gameEngine.assignScoutZones(unit.civilizationId);

        // Find this scout's zone index
        const scouts = this.gameEngine.units.filter((u: Unit) => u.civilizationId === unit.civilizationId && u.type === 'scout');
        const scoutIndex = scouts.findIndex(s => s.id === unit.id);
        console.log(`[AI-SCOUT] Scout ${scoutIndex + 1}/${scouts.length} searching zone ${scoutIndex}`);

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
          console.log(`[AI-SCOUT] Enemy ${enemyResult.targetType} found at (${enemyResult.col}, ${enemyResult.row}), distance: ${enemyResult.distance}`);

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
                console.log(`[AI-SCOUT] Enemy ${enemyResult.targetType} at (${enemyResult.col}, ${enemyResult.row}) already known, updating last seen`);
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
                  console.log(`[AI-SCOUT] Rush opportunity: undefended city ${targetCity.name} at (${enemyResult.col},${enemyResult.row})`);
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
                console.log(`[AI-SCOUT] Scout returning to nearest city at (${nearestCity.col}, ${nearestCity.row})`);
                return { col: nearestCity.col, row: nearestCity.row };
              }
            }
            // Enemy unit spotted: record it for the army, then keep exploring
            // (fall through to the zone search below) to find their cities.
          }
        } else {
          console.log(`[AI-SCOUT] No enemy found near (${unit.col}, ${unit.row}), continuing exploration`);
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
          console.log(`[AI-SCOUT] Routing around enemy at (${enemy.col},${enemy.row}) via (${flank.col},${flank.row})`);
          return flank;
        }
      }
      console.log(`[AI] Chose enemy unit at (${enemy.col},${enemy.row})`);
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
      console.log(`[AI] Chose unexplored tile at (${unexplored.col},${unexplored.row})`);
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
        console.log(`[AI-SCOUT] ScoutMemory target at (${staleTarget.col},${staleTarget.row})`);
        return { col: staleTarget.col, row: staleTarget.row };
      }
    }

    // Special exploration logic for scouts when no immediate unexplored tiles
    if (unit.type === 'scout') {
      const scoutExplorationTarget = this.findScoutExplorationTarget(unit);
      if (scoutExplorationTarget) {
        console.log(`[AI-SCOUT] Chose exploration target at (${scoutExplorationTarget.col},${scoutExplorationTarget.row})`);
        return { col: scoutExplorationTarget.col, row: scoutExplorationTarget.row };
      }
    }

    // 3) Choose best neighbor based on terrain cost
    console.log(`[AI] No unexplored or enemy targets found, choosing best neighbor`);

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
      console.log(`[AI] Terrain analysis: ${terrainAnalysis.passableMoves.length} passable tiles, min cost: ${terrainAnalysis.minCost}, avg cost: ${terrainAnalysis.averageCost.toFixed(1)}`);

      const bestMove = AIUtility.chooseBestMove(terrainAnalysis);
      if (bestMove) {
        const terrainName = AIUtility.getTerrainName(bestMove.terrainType);
        console.log(`[AI] Chose best neighbor at (${bestMove.col},${bestMove.row}) - ${terrainName} (cost: ${bestMove.moveCost})`);
        return { col: bestMove.col, row: bestMove.row };
      }
    }

    console.log(`[AI] No valid target found for unit ${unit.id}`);
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

    const friendlyCities = this.gameEngine.cities.filter(
      (c: City) => c.civilizationId === civId,
    );

    let bestCity: City | null = null;
    let bestDist = Infinity;
    for (const city of friendlyCities) {
      // Skip the city the Caravan is already standing on (can't deliver to self).
      if (city.col === unit.col && city.row === unit.row) continue;
      const routes = city.tradeRoutes?.length ?? 0;
      if (routes >= 3) continue; // max 3 routes per city
      const dist = squareDistance(unit.col, unit.row, city.col, city.row);
      if (dist < bestDist) {
        bestDist = dist;
        bestCity = city;
      }
    }

    if (bestCity) {
      return { col: bestCity.col, row: bestCity.row };
    }
    return null;
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

    console.log(`[AI-DIPLOMAT] ${civName} diplomat at (${unit.col},${unit.row}) contacting ${targetCiv?.name ?? targetCivId} → ${action}`);

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
  private improvementBudget(civId: number): number {
    const civ = this.gameEngine.civilizations?.[civId];
    const friendlyCities = this.gameEngine.cities.filter((c: City) => c.civilizationId === civId).length;
    const techs = Array.isArray(civ?.technologies) ? (civ.technologies ?? []) : [];
    const midGameBoost = techs.length >= 14 ? 3 : techs.length >= 6 ? 2 : 1;
    return Math.max(2, friendlyCities * 2) * midGameBoost;
  }

  /** How many tile improvements the civ already owns near its cities. */
  private countOwnImprovements(civId: number): number {
    return (this.gameEngine.map?.tiles ?? []).filter((t: MapTile) =>
      !!t.improvement && ['road', 'railroad', 'mines', 'irrigation', 'fortress'].includes(t.improvement) &&
      this.gameEngine.cities.some((c: City) =>
        c.civilizationId === civId &&
        this.gameEngine.squareGrid.squareDistance(t.col, t.row, c.col, c.row) <= 4
      )
    ).length;
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
  private chooseImprovementForSettler(unit: Unit): string | null {
    const civId = unit.civilizationId;
    const tile = this.gameEngine.getTileAt(unit.col, unit.row);
    if (!tile) return null;
    const terrain = tile.terrain || tile.type || '';
    if (terrain === 'ocean' || terrain === 'arctic') return null;

    // Only improve tiles within a few tiles of a friendly city (working radius
    // plus a small margin) — roads/farms/mines there actually feed the civ.
    const nearCity = this.gameEngine.cities.some((c: City) =>
      c.civilizationId === civId &&
      this.gameEngine.squareGrid.squareDistance(unit.col, unit.row, c.col, c.row) <= 4
    );
    if (!nearCity) return null;

    if (this.countOwnImprovements(civId) >= this.improvementBudget(civId)) return null;

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
    const balance = nearestCity
      ? this.gameEngine.economicManager?.cityFoodBalance?.(nearestCity, civ)
      : null;
    const foodConstrained = !!balance && (
      balance.surplus < 1 ||
      (balance.turnsUntilStarvation >= 0 && balance.turnsUntilStarvation <= 3)
    );
    const growthStrategy = strategy === 'early_expansion' || strategy === 'balanced_growth';
    const prioritizeFood = foodConstrained || growthStrategy;

    const terrainIrrigable = ['grassland', 'plains', 'desert', 'forest', 'jungle', 'swamp'].includes(terrain);
    // The engine enforces fresh water (river/lake/irrigated neighbour).
    const canIrrigate = terrainIrrigable && this.gameEngine.canBuildImprovement(unit.id, 'irrigation');
    const canMine = (terrain === 'hills' || terrain === 'mountains') &&
      this.gameEngine.canBuildImprovement(unit.id, 'mine');

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

    // Same improvement budget as chooseImprovementForSettler.
    const friendlyCities = this.gameEngine.cities.filter((c: City) => c.civilizationId === civId);
    if (friendlyCities.length === 0) return null;
    if (this.countOwnImprovements(civId) >= this.improvementBudget(civId)) return null;

    let best: { col: number; row: number } | null = null;
    let bestDist = Infinity;
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
        // Only grassland/plains/desert give the +1 trade from a road.
        if (!roadDef.tradeBonusTerrains.includes(terrain)) continue;
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
      }
    }
    return best;
  }

  /**
   * Find best settlement location for a settler
   */
  private findBestSettlementForSettler(
    unit: Unit,
    strategy: StrategyProfile = 'balanced_growth',
    replanDepth = 0,
  ): { col: number; row: number; score: number } | null {
    console.log(`[AI-SETTLER] Evaluating settlement locations for settler at (${unit.col}, ${unit.row})`);

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
          return this.findBestSettlementForSettler(unit, strategy, 1);
        }
        // Already retried once — force settle at current tile to break loop.
        const tile = this.gameEngine.getTileAt(unit.col, unit.row);
        const city = this.gameEngine.getCityAt(unit.col, unit.row);
        const valid = tile && tile.type !== 'ocean' && tile.type !== 'mountains' && !city;
        if (valid) {
          console.log(`[AI-SETTLER] 🔄 Replan exhausted, founding at current tile (${unit.col},${unit.row})`);
          this.gameEngine.foundCityWithSettler(unit.id);
        }
        return null;
      }
    }

    if (lockedTarget && this.isSettlementTargetValid(unit, lockedTarget)) {
      if (lockedTarget.col === unit.col && lockedTarget.row === unit.row) {
        console.log(`[AI-SETTLER] Reached locked settlement target (${lockedTarget.col},${lockedTarget.row}), founding city`);
        this.gameEngine.foundCityWithSettler(unit.id);
        return null;
      }
      console.log(`[AI-SETTLER] Continuing to locked settlement target (${lockedTarget.col},${lockedTarget.row})`);
      return { ...lockedTarget, score: 0 };
    }
    if (lockedTarget) {
      // A city, unit, visibility, or terrain change invalidated the old site.
      delete unit._lastSettlementTarget;
    }

    // First, check if current location is a good settlement spot
    const currentTile = this.gameEngine.getTileAt(unit.col, unit.row);
    const currentCity = this.gameEngine.getCityAt(unit.col, unit.row);

    // Check if current position is valid for settling
    const currentPosValid = currentTile &&
        currentTile.type !== 'ocean' &&
        currentTile.type !== 'mountains' &&
        !currentCity;

    if (currentPosValid && isOscillating) {
      console.log(`[AI-SETTLER] 🔄 Oscillation detected! Position history: ${history.join(' -> ')}`);
      console.log(`[AI-SETTLER] Founding city at current location to break oscillation`);
      // Directly found city here instead of returning target
      this.gameEngine.foundCityWithSettler(unit.id);
      return null;
    }

    // Choose appropriate weights based on strategy
    const weights = this.getSettlementWeightsForStrategy(strategy);
    console.log(`[AI-SETTLER] Using strategy: ${strategy} with weights:`, weights);

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
      console.log('[AI-SETTLER] Civ has no coastal city — favouring a coastal settlement site');
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
      console.log(`[AI-SETTLER] Best settlement location found: (${bestLocation.col}, ${bestLocation.row})`);
      console.log(`[AI-SETTLER] Score: ${bestLocation.score}, Yields:`, bestLocation.yields);
      console.log(`[AI-SETTLER] Water access: ${bestLocation.hasWaterAccess}`);

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
          bestLocation.score - currentScore > SETTLE_SCORE_THRESHOLD;
        const bestIsFar = bestDist > MAX_SETTLE_WALK_DISTANCE;

        if (currentScore !== null && (!bestClearlyBetter || bestIsFar)) {
          console.log(`[AI-SETTLER] 🏙 Current tile good enough (current=${currentScore.toFixed(1)}, best=${bestLocation.score.toFixed(1)}, bestDist=${bestDist}) — founding city here`);
          this.gameEngine.foundCityWithSettler(unit.id);
          return null;
        }
        console.log(`[AI-SETTLER] Best location clearly better (current=${currentScore?.toFixed(1)}, best=${bestLocation.score.toFixed(1)}, bestDist=${bestDist}) — walking there`);
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
            console.log(`[AI-SETTLER] Precomputed path for settler ${unit.id} with ${result.path.length} steps`);
            this.gameEngine.roundManager.setUnitPath(unit.id, result.path);
          } else {
            console.log(`[AI-SETTLER] No path found to best location for settler ${unit.id}`);
          }
        }
      } catch (e) {
        console.error('[AI-SETTLER] Error while precomputing path for settler:', e);
      }

      // Check if settler is already at the best location
      if (bestLocation.col === unit.col && bestLocation.row === unit.row) {
        console.log(`[AI-SETTLER] Settler is already at best location, will found city`);
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
      console.log(`[AI-SETTLER] No better location found, founding city at current tile (${unit.col}, ${unit.row})`);
      this.gameEngine.foundCityWithSettler(unit.id);
      return null;
    }

    console.log(`[AI-SETTLER] No suitable settlement location found`);
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

    // Keep the whole 20-tile workable area separate from friendly cities.
    const tooClose = this.gameEngine.cities?.some((city: City) =>
      city.civilizationId === unit.civilizationId &&
      Math.max(Math.abs(target.col - city.col), Math.abs(target.row - city.row)) < MIN_CITY_CENTER_DISTANCE
    );
    if (tooClose) return false;

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
    const chance = calculateVillageTakeChance(nearestCityDistance, ownCities.length);
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
          console.log(`[AI-SCOUT] Found unexplored tile at (${pick.col},${pick.row}) in zone (of ${candidates.length})`);
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
      console.log(`[AI-SCOUT] Scout ${unit.id} reset ${wasBlocked} blocked targets to unstick`);
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
        console.log(`[AI-SCOUT] Moving toward zone center at (${zoneCenterCol},${zoneCenterRow}) via (${bestNeighbor.col},${bestNeighbor.row})`);
        return bestNeighbor;
      }

      // No direction reduces the distance to the zone center (boxed in by
      // terrain) — step to the closest passable tile anyway so the scout
      // navigates around the obstacle instead of freezing.
      if (anyPassableNeighbor) {
        console.log(`[AI-SCOUT] Boxed in, stepping to (${anyPassableNeighbor.col},${anyPassableNeighbor.row}) around terrain`);
        return { col: anyPassableNeighbor.col, row: anyPassableNeighbor.row };
      }
    }

    console.log(`[AI-SCOUT] No exploration targets found in zone ${scoutIndex}`);
    return null;
  }

  private isCombatUnit(unit: Unit): boolean {
    const nonCombatTypes = new Set(['settler', 'caravan', 'diplomat', 'worker']);
    if (nonCombatTypes.has(unit.type)) {
      return false;
    }
    return (unit.attack || 0) > 0.5;
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
   * True if a land-connected enemy city or combat unit exists for this civ.
   * `onlyEnemyCivId` narrows the check to one opponent (used before declaring a
   * war on a specific civ).
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
    return (
      this.gameEngine.cities.some(
        (c) => hostile(c.civilizationId) && this.areLandConnected(unit.col, unit.row, c.col, c.row),
      ) ||
      this.gameEngine.units.some(
        (u) =>
          hostile(u.civilizationId) &&
          !u.isDefeated &&
          this.areLandConnected(unit.col, unit.row, u.col, u.row),
      )
    );
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
        console.log(`[AI] Bulk attack withdrawn — civ ${civilizationId} has ${criticalThreats.length} critical threat(s)`);
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
    const aggressive = aggression.posture === 'aggressive';

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
        console.log(`[AI] Bulk attack withdrawn — civ ${civilizationId} (${aggression.posture}, score ${aggression.score})`);
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
    // The bulk attack is a LAND army plan: targets on another landmass would
    // stall the army at the coast, so they are excluded here (the navy pivot
    // and colony missions handle cross-water enemies).
    for (const [enemyCivId, enemyList] of storage.enemyLocations) {
      for (const loc of enemyList) {
        const age = roundNumber - (loc.lastSeenRound ?? loc.discoveredRound ?? roundNumber);
        // Same 40-round window as planBulkAttack: intel that is not ancient
        // still feeds the war plan even if the two fronts are apart.
        if (age > 40) continue;
        if (!this.engineTileReachableByLand(civilizationId, loc.col, loc.row)) {
          continue;
        }
        targets.push({
          col: loc.col,
          row: loc.row,
          type: loc.type,
          id: loc.id,
          lastSeenRound: loc.lastSeenRound,
          discoveredRound: loc.discoveredRound,
          civId: enemyCivId,
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

    if (plan.assignedUnitIds.length < plan.requiredUnits) {
      plan.assignedUnitIds.push(unit.id);
      return plan.target;
    }

    return null;
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
    // attack").
    const maxReserves = units.length >= cities.length + 3
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
    console.log(`[AI] Threat alert broadcast at (${col},${row}), strength=${enemyStrength.toFixed(1)}`);
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
