/**
 * AutoProduction - Automatically manages production queues for cities
 * Uses tech-gated unit selection and integrates AIBuildingStrategy for
 * intelligent building/wonder production decisions.
 */

import { UNIT_PROPS, BUILDING_PROPS, MAX_CARAVAN_TRADE_ROUTES } from '@/utils/Constants';
import { BUILDING_PROPERTIES, WONDER_PROPERTIES } from '@/data/BuildingConstants';
import { getGovernment } from '@/data/GovernmentData';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import {
  assessCityThreat,
  calculateDangerThreshold,
  collectCityThreatSamples,
  computeCityGarrisonStrength,
  type CityThreatAssessment
} from './AIStrategy';
import { canBuildUnit, type StrategyProfile, type AIState, resolveAICivStrategy, type BuildingPlan } from './AITypes';
import { AIBuildingStrategy } from './AIBuildingStrategy';
import type { City, Civilization, Unit } from '../../../types/game';
import GameEngine from './GameEngine';

/** A production item pushed onto a city's build queue. */
interface ProductionItem {
  // Matches types/game.ProductionItem — built dynamically with string types.
  type: string;
  itemType: string;
  name: string;
  cost: number;
}

/** Minimal shape of a queued production entry. */
interface QueueItem {
  type?: string;
  itemType?: string;
  name?: string;
}

/** How many follow-up items auto-production keeps lined up in a city's queue. */
const AUTO_QUEUE_TARGET = 3;

/**
 * Per-profile expansion cadence. A civ always keeps a small settler corps so
 * expansion NEVER hard-stops; the corps size scales with the civ's city count
 * (`ceil(cities / settlersPerCities)`, clamped to [minSettlers, maxSettlers]).
 * `earlyBonus` adds one extra settler while the civ is still tiny (<3 cities).
 * Expansionist profiles keep more settlers (→ more cities); defensive civs
 * keep fewer. The economy unit-cap in `ensureProductionQueue` is the real
 * brake against settler/army spam.
 */
const EXPANSION_PARAMS: Record<StrategyProfile, { settlersPerCities: number; minSettlers: number; maxSettlers: number; earlyBonus: boolean }> = {
  early_expansion: { settlersPerCities: 2, minSettlers: 1, maxSettlers: 6, earlyBonus: true },
  military_expansion: { settlersPerCities: 3, minSettlers: 1, maxSettlers: 4, earlyBonus: false },
  balanced_growth: { settlersPerCities: 3, minSettlers: 1, maxSettlers: 4, earlyBonus: true },
  science_focus: { settlersPerCities: 4, minSettlers: 1, maxSettlers: 3, earlyBonus: false },
  wonder_rush: { settlersPerCities: 4, minSettlers: 1, maxSettlers: 3, earlyBonus: false },
  defensive_turtle: { settlersPerCities: 5, minSettlers: 1, maxSettlers: 3, earlyBonus: false },
};

export class AutoProduction {
  private gameEngine: GameEngine;

  constructor(gameEngine: GameEngine) {
    this.gameEngine = gameEngine;
  }

  /** Reset any per-game state when starting a new game. */
  reset(): void {
    // All production decisions are derived from the engine's current state.
  }

  /**
   * Set automatic production for a city based on its needs and current state
   */
  setAutoProduction(cityId: string): boolean {
    try {
      console.log('[AutoProduction] setAutoProduction called for city', cityId);
      
      const city = this.gameEngine.cities.find((c: City) => c.id === cityId);
      if (!city) {
        console.warn('[AutoProduction] City not found:', cityId);
        return false;
      }

      const threatAssessment = this.evaluateCityThreat(city);

      // Re-evaluate queued follow-ups when the strategic situation changes.
      // In particular, an aggressive civ must not keep a peaceful building
      // queue after war or an offensive plan has started.
      this.reconsiderAggressiveQueue(city);

      if (city.currentProduction) {
        if (threatAssessment?.needsDefense && !this.isDefensiveProduction(city.currentProduction)) {
          console.log('[AutoProduction] City under threat, overriding existing production');
          this.gameEngine.removeCurrentProduction(city.id);
        } else if (this.isHappinessCrisis(city) && !this.isHappinessBuilding(city.currentProduction)) {
          // A city in or approaching disorder produces (almost) nothing at all
          // (applyCityOutputs zeroes a disordered city's output), so the temple
          // that would fix it must preempt EVERYTHING else — otherwise the civ
          // is stuck forever producing 0 shields and can never recover.
          console.log('[AutoProduction] Happiness crisis, overriding existing production');
          this.gameEngine.removeCurrentProduction(city.id);
        } else if (
          city.currentProduction.type === 'building' &&
          (city.buildings ?? []).includes(city.currentProduction.itemType)
        ) {
          // Never keep producing a building the city already owns (the queue
          // item can outlive the building it produced). Re-pick a fresh item.
          console.log('[AutoProduction] City already has', city.currentProduction.itemType, '- re-picking production');
          this.gameEngine.removeCurrentProduction(city.id);
        } else {
          console.log('[AutoProduction] City already has production:', city.currentProduction);
          // Keep the current item and top up the queue with sensible follow-ups.
          this.ensureProductionQueue(city.id);
          return true;
        }
      }

      // Determine what the city should produce based on its state
      const productionItem = this.determineProductionItem(city, threatAssessment, []);
      
      if (productionItem) {
        console.log('[AutoProduction] Setting production item:', productionItem);
        
        // Use ProductionManager to set production
        if (this.gameEngine.productionManager) {
          const result = this.gameEngine.productionManager.setCityProduction(cityId, productionItem, false);
          this.ensureProductionQueue(city.id);
          return result.success || false;
        }
      }

      return false;
    } catch (e) {
      console.error('[AutoProduction] setAutoProduction error', e);
      return false;
    }
  }

  /**
   * Top up the city's production queue with follow-ups chosen by the same
   * strategy used for the current production item. Keeps the queue from
   * appearing empty while auto-production is enabled.
   */
  ensureProductionQueue(cityId: string): void {
    try {
      const city = this.gameEngine.cities.find((c: City) => c.id === cityId);
      if (!city || !city.autoProduction) return;
      if (!this.gameEngine.productionManager) return;

      const threatAssessment = this.evaluateCityThreat(city);
      const existingQueue: QueueItem[] = Array.isArray(city.buildQueue) ? city.buildQueue.slice() : [];
      const plannedTypes: string[] = existingQueue
        .map((q: QueueItem) => q.itemType || q.type)
        .filter((t: string) => !!t);

      const slots = AUTO_QUEUE_TARGET - existingQueue.length;
      if (slots <= 0) return;

      // ── Economy-aware unit cap ──
      // Upkeep = max(totalUnits, cityCount). A civ can only afford to maintain
      // as many units as its full-tax income pays for (beyond the free support
      // of one unit per city). When the civ is already at/over that cap, stop
      // queuing more units — it only produces an army it immediately disbands
      // for upkeep (the AI-vs-AI produce→disband churn). Buildings are still
      // allowed; only military/explorer/settler units are capped.
      const civ = this.gameEngine?.civilizations?.[city.civilizationId];
      const econ = this.gameEngine?.economicManager;
      let unitCapExhausted = false;
      if (civ && econ) {
        const civCities = this.gameEngine.cities.filter(
          (c: City) => c.civilizationId === city.civilizationId
        );
        const cityCount = civCities.length;
        const currentUnits = this.gameEngine.units.filter(
          (u: Unit) => u.civilizationId === city.civilizationId
        ).length;
        // Count units queued in EVERY city (not just this one) so the civ
        // doesn't overshoot the cap by queuing across multiple cities.
        const queuedUnits = civCities.reduce((n: number, c: City) => {
          const inQueue = Array.isArray(c.buildQueue)
            ? c.buildQueue.filter((q: QueueItem) => (q.type ?? q.itemType) === 'unit').length
            : 0;
          const inProgress = c.currentProduction?.type === 'unit' ? 1 : 0;
          return n + inQueue + inProgress;
        }, 0);
        // Max sustainable units ≈ full-tax income minus the luxury the civ
        // must keep for happiness (see EconomicManager.sustainableUnits).
        const sustainableUnits = Math.max(cityCount, econ.sustainableUnits(civ));
        unitCapExhausted = currentUnits + queuedUnits >= sustainableUnits;
      }

      let added = 0;
      let guard = 0;
      while (added < slots && guard++ < 10) {
        const item = this.determineProductionItem(city, threatAssessment, plannedTypes);
        if (!item) break;
        const itemType = item.itemType || item.type;
        if (!itemType) break;

        // Skip unit items when the civ can't afford to maintain more units.
        // (Fall back to a building so the city still has something to do.)
        if (unitCapExhausted && item.type === 'unit') {
          // Scouts and settlers are cheap and grow the economy — never block
          // them behind the army-upkeep cap. A scout is the civ's eyes on the
          // map; a settler founds a new city that adds free unit support and
          // tax income, so it pays for itself instead of straining the budget.
          // (Settler count is still limited by the expansion params.)
          if (item.itemType === 'scout' || item.itemType === 'settler') {
            const growthResult = this.gameEngine.productionManager.setCityProduction(cityId, item, true);
            if (!growthResult || growthResult.success === false) break;
            plannedTypes.push(item.itemType);
            added++;
            continue;
          }
          let followUp = this.determineFallbackBuilding(city, threatAssessment, plannedTypes);
          if (!followUp) {
            // No buildable building (very early game). Keep the queue from
            // appearing empty by queueing the already-chosen unit `item`
            // instead of leaving the city idle once its current item
            // completes. Only guarantee the FIRST follow-up this way — if the
            // queue already has something, a missing building just stops
            // topping up.
            if (added > 0) break;
            followUp = item;
          }
          const result = this.gameEngine.productionManager.setCityProduction(cityId, followUp, true);
          if (!result || result.success === false) break;
          plannedTypes.push(followUp.itemType || followUp.type);
          added++;
          continue;
        }

        const result = this.gameEngine.productionManager.setCityProduction(cityId, item, true);
        if (!result || result.success === false) break;

        plannedTypes.push(itemType);
        added++;
      }
    } catch (e) {
      console.error('[AutoProduction] ensureProductionQueue error', e);
    }
  }

  /**
   * Determine what production item a city should build
   */
  private determineProductionItem(city: City, threatAssessment?: CityThreatAssessment | null, plannedTypes: string[] = []): ProductionItem | null {    // Priority order:
    // 1. Urgent defender if city has none
    // 2. Emergency reinforcements for threatened cities
    // 3. High-priority building (from AIBuildingStrategy)
    // 4. Offensive campaign reinforcements
    // 5. Standard building or settler
    // 6. Wonder (if safe)
    // 7. Default military unit

    // The barbarian faction produces MILITARY UNITS ONLY — no buildings,
    // settlers, wonders, scouts, or diplomats. A threatened city builds a
    // defender; otherwise it builds a raider.
    if (city.civilizationId === BARBARIAN_CIV_ID) {
      return this.buildBarbarianMilitaryProduction(threatAssessment);
    }

    const civ = this.gameEngine.civilizations?.[city.civilizationId];
    const strategy: StrategyProfile = this.getStrategyForCiv(city.civilizationId);

    // Check for city defenders: any friendly unit with a defensive role
    // within 2 tiles of the city counts as garrison. Counting ONLY units ON
    // the city tile made a city build defenders forever — each produced unit
    // walked off to garrison the area, so the tile was never occupied and the
    // "no defender" branch never cleared (the 167-round log: Berlin produced
    // phalanxes all game while its units sat 1-4 tiles away).
    const squareGrid = this.gameEngine.squareGrid;
    const garrisonUnits = this.gameEngine.units.filter((u: Unit) => {
      if (u.civilizationId !== city.civilizationId) return false;
      const dist = squareGrid?.squareDistance
        ? squareGrid.squareDistance(u.col, u.row, city.col, city.row)
        : (u.col === city.col && u.row === city.row ? 0 : 99);
      return dist <= 2;
    });

    // A QUEUED unit with defense also counts toward the garrison.
    // A real defender must be a COMBAT unit: civilians (settlers/caravans) and
    // explorers (scouts) have a token defense value but cannot hold a city —
    // counting them as "defended" left AI cities empty and capturable by a
    // single enemy scout.
    const isDefenderType = (type: string): boolean => {
      const unitProps = UNIT_PROPS[type];
      return !!unitProps && (unitProps.defense || 0) > 0 && (unitProps.attack || 0) > 0.5;
    };
    const plannedHasDefender = plannedTypes.some((t: string) => isDefenderType(t));
    const hasDefender = plannedHasDefender || garrisonUnits.some((u: Unit) => isDefenderType(u.type));

    // 1. A city under direct threat must build a defender FIRST (survival
    //    beats comfort). Minor border pressure alone does not preempt it.
    if (threatAssessment?.needsDefense) {
      console.log('[AutoProduction] City needs defender (threat-triggered)');
      return this.buildDefenderProduction(city, threatAssessment);
    }

    const civCities = this.gameEngine.cities.filter((c: City) => c.civilizationId === city.civilizationId);
    const econ = this.gameEngine?.economicManager;

    // Happiness emergency: a city at (or near) disorder burns its whole
    // commerce on luxury — starving science and the treasury. Such a city
    // fixes its happiness first; a healthy city expands instead.
    // Also trigger when the city has Entertainers — a building is more
    // efficient long-term (one building replaces multiple Entertainers,
    // freeing worker slots for food/production).
    let needsHappiness = false;
    let entertainerCount = 0;
    if (civ && econ) {
      const happyState = econ.cityHappiness(city, civ);
      needsHappiness = happyState.disorder || happyState.unhappiness >= happyState.happiness;
      entertainerCount = (city.specialists ?? []).filter(s => s === 'entertainer').length;
    }

    // 1b. Happiness emergency BEFORE the plain "no defender" check. A city
    //     spending 40%+ of its commerce on luxury (or in disorder) must build
    //     a temple NOW. Otherwise the "no defender within 2 tiles" branch
    //     below keeps firing (defenders walk out to garrison the area, so the
    //     city rarely shows one on the tile) and the temple that would fix
    //     the economy is never built — the civ stays at 70% luxury / 0
    //     science for the whole game and never produces a real army.
    //     Also build when Entertainers are present — a building is more
    //     efficient (one temple replaces ~2 Entertainers, freeing workers).
    const luxuryRate = civ?.luxuryRate ?? 0;
    const hasEntertainers = entertainerCount > 0;
    if (needsHappiness || luxuryRate >= 40 || hasEntertainers) {
      const existingBuildings = new Set(city.buildings ?? []);
      const civTechs = new Set<string>();
      const techs = civ.technologies;
      if (Array.isArray(techs)) {
        for (const t of techs) civTechs.add(String(t));
      } else if (techs && typeof (techs as Iterable<string>)[Symbol.iterator] === 'function') {
        for (const t of techs as Iterable<string>) civTechs.add(String(t));
      }
      const happyBuilding = ['temple', 'colosseum', 'cathedral']
        .find((b) => {
          if (existingBuildings.has(b) || plannedTypes.includes(b)) return false;
          const props = BUILDING_PROPS[b] || BUILDING_PROPERTIES[b];
          if (!props) return false;
          // Only consider buildings the civ has the tech for
          if (props.requiredTechnology && !civTechs.has(props.requiredTechnology)) return false;
          console.log(`[AutoProduction] Happiness emergency: considering ${b} (luxury ${luxuryRate}%, disorder ${needsHappiness}, entertainers ${entertainerCount})`);
          return true;
        });
      const bProps = happyBuilding ? (BUILDING_PROPS[happyBuilding] || BUILDING_PROPERTIES[happyBuilding]) : null;
      if (bProps) {
        console.log(`[AutoProduction] Happiness emergency: building ${happyBuilding} (luxury ${luxuryRate}%, disorder ${needsHappiness})`);
        return {
          type: 'building',
          itemType: happyBuilding,
          name: bProps.name,
          cost: bProps.cost
        };
      }
    }

    // 2. Build a defender if none exists
    if (!hasDefender) {
      console.log('[AutoProduction] City needs defender');
      return this.buildDefenderProduction(city, threatAssessment);
    }

    if (threatAssessment && threatAssessment.netThreat > 0) {
      console.log('[AutoProduction] Elevated threat detected, reinforcing garrison');
      return this.buildDefenderProduction(city, threatAssessment);
    }

    // 3. Settler expansion FIRST (right after defense) so the civ actually
    //    grows. Previously buildings (and the happiness-emergency path) ran
    //    before this branch, so a civ with 1 city queued forge/colosseum/
    //    factory/… forever and never produced a second settler.
    //    Expansion never hard-stops: each profile keeps a settler corps that
    //    scales with the civ's city count (EXPANSION_PARAMS), so a big empire
    //    still replaces consumed settlers instead of freezing at a city cap.
    //    A city may start a settler at population 1 so a fresh capital builds
    //    a settler, not a hospital.
    const isSmallMap = this.gameEngine?.gameSettings?.mapType === 'AI_VS_AI_SMALL';
    const expansion = EXPANSION_PARAMS[strategy] ?? EXPANSION_PARAMS.balanced_growth;
    // On small maps (AI_VS_AI_SMALL, 16x26) a civ only needs one extra city
    // before the economy stalls — cap settlers there so the capital doesn't
    // churn settlers forever and never builds scouts or a real army.
    const desiredSettlers = isSmallMap
      ? Math.min(2, expansion.maxSettlers)
      : Math.min(
          expansion.maxSettlers,
          Math.max(expansion.minSettlers, Math.ceil(civCities.length / expansion.settlersPerCities)) +
            (civCities.length < 3 && expansion.earlyBonus ? 1 : 0),
        );
    if (!needsHappiness && city.population >= 1) {
      // Civ1: Settlers consume food from the home city (not gold), so they
      // don't drain the treasury. However, building a Settler diverts shields
      // from other production — only allow settlers when the economy is healthy
      // enough (gold non-negative or small deficit) to sustain the production
      // delay.
      const gold = this.gameEngine.civilizations?.[city.civilizationId]?.resources?.gold ?? 0;
      const upkeep = this.gameEngine.economicManager?.totalUpkeep?.(city.civilizationId) ?? 0;
      const goldCrisis = gold < -upkeep;

      // Count queued settlers across ALL cities so the cap is enforced
      // globally — without this, three cities each queueing a settler all
      // pass the per-city check and the civ overshoots the cap.
      const allCivCities = this.gameEngine.cities.filter(
        (c: City) => c.civilizationId === city.civilizationId,
      );
      const queuedSettlers = allCivCities.reduce((count: number, c: City) => {
        if (c.currentProduction?.type === 'unit' && c.currentProduction?.itemType === 'settler') return count + 1;
        if (Array.isArray(c.buildQueue)) {
          return count + c.buildQueue.filter((q: QueueItem) => q.type === 'unit' && (q.itemType === 'settler' || q.name?.toLowerCase() === 'settler')).length;
        }
        return count;
      }, 0);
      const settlerCount = this.gameEngine.units.filter(
        (u: Unit) => u.civilizationId === city.civilizationId && u.type === 'settler'
      ).length + queuedSettlers;

      // In a gold crisis, allow at most the minimum settler count (1);
      // otherwise the full desired count.
      const effectiveDesired = goldCrisis ? expansion.minSettlers : desiredSettlers;

      if (settlerCount < effectiveDesired) {
        console.log(`[AutoProduction] Civilization has ${settlerCount} settler(s) (unit list + queued across all cities), building another (target ${desiredSettlers}, profile ${strategy})`);
        return {
          type: 'unit',
          itemType: 'settler',
          name: UNIT_PROPS.settler?.name || 'Settler',
          cost: UNIT_PROPS.settler?.cost || 40
        };
      }
    }

    // 4. Evaluate buildings via AIBuildingStrategy
    const gameState = this.buildGameState(city.civilizationId);
    gameState.isUnderThreat = !!threatAssessment?.needsDefense;
    const buildingPlans = civ
      ? AIBuildingStrategy.evaluateBuildings(city, civ, strategy, gameState)
      : [];
    // Never queue the same building twice.
    const availableBuildingPlans = buildingPlans.filter(
      (p: BuildingPlan) => !plannedTypes.includes(p.buildingType)
    );

    // (The happiness emergency now runs before the defender check above — a
    //  crisis city gets its temple instead of yet another defender, so it is
    //  not stuck at 70% luxury / 0 science for the whole game.)
    const buildingPlan = availableBuildingPlans.length > 0 ? availableBuildingPlans[0] : null;
    const numMilitary = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId === city.civilizationId && this.isOffensiveUnitType(u.type)
    ).length;

    const aggressivePosture = this.isAggressivePosture(city.civilizationId);
    if (aggressivePosture &&
        (this.isCivAtWar(city.civilizationId) || this.shouldSupportOffensivePlan(city))) {
      console.log('[AutoProduction] Aggressive posture: prioritizing attacker over buildings');
      return this.buildOffensiveProduction(city);
    }

    // Check if building is high-priority enough to build over a unit
    if (buildingPlan && AIBuildingStrategy.shouldBuildOverUnit(
      buildingPlan, hasDefender, !!threatAssessment?.needsDefense, numMilitary, civCities.length
    )) {
      const bProps = BUILDING_PROPS[buildingPlan.buildingType] || BUILDING_PROPERTIES[buildingPlan.buildingType];
      if (bProps) {
        console.log(`[AutoProduction] Building strategy chose: ${buildingPlan.buildingType} (priority: ${buildingPlan.priority}, reason: ${buildingPlan.reason})`);
        return {
          type: 'building',
          itemType: buildingPlan.buildingType,
          name: bProps.name,
          cost: bProps.cost
        };
      }
    }

    // 5. Support offensive plan
    if (this.shouldSupportOffensivePlan(city)) {
      console.log('[AutoProduction] Supporting offensive plan with new attacker');
      return this.buildOffensiveProduction(city);
    }

    // 5b. Maintain a scout corps for map exploration (1–3 scouts depending on
    //     total troop count). Exploration ranks below defense (steps 1–2) and
    //     offensive reinforcement (step 5) but above buildings/wonders.
    const plannedScouts = plannedTypes.filter((t: string) => t === 'scout').length;
    // On small maps (AI_VS_AI_SMALL) cities may never reach pop 2 — require
    // only pop 1 there so scouts are still built. On larger maps keep pop 2
    // so the city grows a little before diverting shields to exploration.
    const scoutPopThreshold = isSmallMap ? 1 : 2;
    if (this.needsScout(city.civilizationId, plannedScouts) && city.population >= scoutPopThreshold) {
      const scoutProps = UNIT_PROPS.scout;
      console.log(`[AutoProduction] Building scout for map exploration (${this.countTotalTroops(city.civilizationId)} troops)`);
      return {
        type: 'unit',
        itemType: 'scout',
        name: scoutProps?.name || 'Scout',
        cost: scoutProps?.cost || 15
      };
    }

    // 5b2. Aggressive civs maintain a standing army even before a war plan
    //      exists (AFTER the scout corps, which feeds the intelligence the
    //      offensive plan depends on). Without a standing force the bulk
    //      attack can never form and the civ stays purely defensive.
    const AGGRESSIVE_ARMY_MIN = 3;
    if (aggressivePosture && this.countOffensiveUnits(city.civilizationId) < AGGRESSIVE_ARMY_MIN) {
      console.log('[AutoProduction] Aggressive posture: building standing army (attacker)');
      return this.buildOffensiveProduction(city);
    }

    // 5b. Build the building even if not "high-priority"
    if (buildingPlan) {
      const bProps = BUILDING_PROPS[buildingPlan.buildingType] || BUILDING_PROPERTIES[buildingPlan.buildingType];
      if (bProps) {
        console.log(`[AutoProduction] Building: ${buildingPlan.buildingType} (reason: ${buildingPlan.reason})`);
        return {
          type: 'building',
          itemType: buildingPlan.buildingType,
          name: bProps.name,
          cost: bProps.cost
        };
      }
    }

    // 5c. Caravan for trade routes (Civ I): once the civ has Trade tech and
    //     at least one existing city with fewer than 3 trade routes, build a
    //     Caravan. The AI unit movement logic will then deliver it to a
    //     suitable destination city to establish a permanent trade route.
    //     Caravans are a peacetime economy boost — they never displace
    //     defenders, settlers, or buildings that are still needed.
    if (civ && this.shouldBuildCaravan(civ, city, plannedTypes)) {
      const caravanProps = UNIT_PROPS.caravan;
      if (caravanProps) {
        console.log(`[AutoProduction] Building caravan for trade route (profile ${strategy})`);
        return {
          type: 'unit',
          itemType: 'caravan',
          name: caravanProps.name,
          cost: caravanProps.cost
        };
      }
    }

    // 6. Wonder (only if not threatened and strategy favors it)
    if (!threatAssessment?.needsDefense && civ) {
      const wonderPlans = AIBuildingStrategy.evaluateWonders(city, civ, strategy, gameState);
      const wonderPlan = wonderPlans.length > 0 ? wonderPlans[0] : null;
      if (wonderPlan && !plannedTypes.includes(wonderPlan.buildingType)) {
        const wProps = WONDER_PROPERTIES[wonderPlan.buildingType];
        if (wProps) {
          console.log(`[AutoProduction] Wonder strategy chose: ${wonderPlan.buildingType} (priority: ${wonderPlan.priority})`);
          return {
            type: 'building',
            itemType: wonderPlan.buildingType,
            name: wProps.name,
            cost: wProps.cost
          };
        }
      }
    }

    // 6b. A diplomat for diplomacy (Civ I): diplomatic civs at peace send one
    //     to negotiate with the neighbours. This is a peacetime luxury — it
    //     never displaces defenders, settlers, buildings, or wonders.
    if (civ && this.shouldBuildDiplomat(civ)) {
      const dProps = UNIT_PROPS.diplomat;
      if (dProps) {
        console.log(`[AutoProduction] Building diplomat for diplomacy (profile ${strategy})`);
        return {
          type: 'unit',
          itemType: 'diplomat',
          name: dProps.name,
          cost: dProps.cost
        };
      }
    }

    // 7. Build military units (default)
    //    Balance the army: if the civ has an offensive plan (needs attackers)
    //    or its offense is weaker than its defense, build an attacker;
    //    otherwise keep the garrison topped up with a defender.
    // Count already-queued units so the queue balances attackers/defenders.
    const plannedOffensive = plannedTypes.filter((t: string) => this.isOffensiveUnitType(t)).length;
    const plannedDefensive = plannedTypes.filter((t: string) => this.isDefensiveUnitType(t)).length;
    const offensiveUnits = this.countOffensiveUnits(city.civilizationId) + plannedOffensive;
    const defenders = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId === city.civilizationId && this.isDefensiveUnitType(u.type)
    ).length + plannedDefensive;
    const needsAttackers = offensiveUnits < defenders || this.shouldSupportOffensivePlan(city);

    console.log(`[AutoProduction] Building default military unit (offense: ${offensiveUnits}, defense: ${defenders})`);
    return needsAttackers
      ? this.buildOffensiveProduction(city)
      : this.buildDefenderProduction(city, threatAssessment);
  }

  /**
   * Pick a building for a city that has hit its sustainable unit cap — reuse
   * the same AIBuildingStrategy evaluation used in `determineProductionItem`
   * so the city keeps producing something useful instead of an unaffordable
   * army. Returns null when no sensible building is available.
   */
  private determineFallbackBuilding(
    city: City,
    threatAssessment?: CityThreatAssessment | null,
    plannedTypes: string[] = [],
  ): ProductionItem | null {
    const civ = this.gameEngine.civilizations?.[city.civilizationId];
    if (!civ) return null;
    const gameState = this.buildGameState(city.civilizationId);
    gameState.isUnderThreat = !!threatAssessment?.needsDefense;
    const strategy: StrategyProfile = this.getStrategyForCiv(city.civilizationId);

    const buildingPlans = AIBuildingStrategy.evaluateBuildings(city, civ, strategy, gameState);
    const available = buildingPlans.filter(
      (p: BuildingPlan) => !plannedTypes.includes(p.buildingType)
    );
    if (available.length > 0) {
      const plan = available[0];
      const bProps = BUILDING_PROPS[plan.buildingType] || BUILDING_PROPERTIES[plan.buildingType];
      if (bProps) {
        return {
          type: 'building',
          itemType: plan.buildingType,
          name: bProps.name,
          cost: bProps.cost,
        };
      }
    }

    // No building worth building — fall back to a wonder if safe.
    if (!threatAssessment?.needsDefense) {
      const wonderPlans = AIBuildingStrategy.evaluateWonders(city, civ, strategy, gameState);
      const wonderPlan = wonderPlans.find((p: BuildingPlan) => !plannedTypes.includes(p.buildingType));
      if (wonderPlan) {
        const wProps = WONDER_PROPERTIES[wonderPlan.buildingType];
        if (wProps) {
          return {
            type: 'building',
            itemType: wonderPlan.buildingType,
            name: wProps.name,
            cost: wProps.cost,
          };
        }
      }
    }
    return null;
  }

  /**
   * Resolve the civ's production strategy. The civ's fixed production profile
   * (assigned per civ at game start) is the source of truth so each AI keeps
   * a distinct identity; fall back to the AI-managed strategy state when no
   * profile is set.
   */
  private getStrategyForCiv(civilizationId: number): StrategyProfile {
    const civ = this.gameEngine.civilizations?.[civilizationId];
    const storage = typeof this.gameEngine.getPlayerStorage === 'function'
      ? this.gameEngine.getPlayerStorage(civilizationId)
      : undefined;
    const aiState: AIState | undefined = storage?.turnData?.aiState as AIState | undefined;
    return resolveAICivStrategy(civ, aiState);
  }

  private isDefensiveUnitType(unitType: string): boolean {
    const props = UNIT_PROPS[unitType];
    if (!props) {
      return false;
    }
    return (props.defense || 0) > (props.attack || 0);
  }

  private evaluateCityThreat(city: City): CityThreatAssessment | null {
    if (!this.gameEngine.squareGrid) {
      return null;
    }

    const storage = typeof this.gameEngine.getPlayerStorage === 'function'
      ? this.gameEngine.getPlayerStorage(city.civilizationId)
      : undefined;
    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    const samples = collectCityThreatSamples(this.gameEngine, city, city.civilizationId, storage, roundNumber);
    if (samples.length === 0) {
      return null;
    }

    const garrisonStrength = computeCityGarrisonStrength(this.gameEngine, city, city.civilizationId);
    const dangerThreshold = calculateDangerThreshold(this.gameEngine.currentYear ?? -4000, this.gameEngine.gameSettings?.difficulty ?? 'PRINCE');

    return assessCityThreat({
      city: { id: city.id, col: city.col, row: city.row },
      samples,
      garrisonStrength,
      defensiveBonus: 0,
      dangerThreshold
    });
  }

  private isDefensiveProduction(currentProduction: { type?: string; itemType?: string }): boolean {
    if (!currentProduction || currentProduction.type !== 'unit') {
      return false;
    }
    const unitProps = UNIT_PROPS[currentProduction.itemType];
    if (!unitProps) {
      return false;
    }
    return (unitProps.defense || 0) >= (unitProps.attack || 0);
  }

  /** True when a city is in disorder or already spending 40%+ of its commerce
   *  on luxury to mask unhappiness — the point where a temple is mandatory.
   *  A disordered city produces 0 shields, so happiness must win everything. */
  private isHappinessCrisis(city: City): boolean {
    const civ = this.gameEngine.civilizations?.[city.civilizationId];
    const luxuryRate = civ?.luxuryRate ?? 0;
    return luxuryRate >= 40 || city.disorder === true;
  }

  private isHappinessBuilding(item: { type?: string; itemType?: string } | null | undefined): boolean {
    if (!item || item.type !== 'building') {
      return false;
    }
    return (BUILDING_PROPERTIES[item.itemType]?.effects?.happiness ?? 0) > 0;
  }

  private buildDefenderProduction(city: City, threatAssessment?: CityThreatAssessment | null): ProductionItem {
    const civ = this.gameEngine.civilizations?.[city.civilizationId];
    const unitType = this.selectDefenderTypeForCiv(civ);
    const unitProps = UNIT_PROPS[unitType];
    const production: ProductionItem = {
      type: 'unit',
      itemType: unitType,
      name: unitProps.name,
      cost: unitProps.cost
    };

    if (threatAssessment) {
      console.log('[AutoProduction] Threat level', threatAssessment.netThreat.toFixed(2), '-> producing', unitProps.name);
    }

    return production;
  }

  /** Tech-gated defender selection using the given civ's technologies */
  private selectDefenderTypeForCiv(civ: Civilization | undefined): string {
    const defenderPreference = ['riflemen', 'musketeer', 'phalanx', 'archer', 'warrior'];
    for (const unitType of defenderPreference) {
      if (UNIT_PROPS[unitType] && (!civ || canBuildUnit(civ, unitType))) {
        return unitType;
      }
    }
    return 'warrior';
  }

  private shouldSupportOffensivePlan(city: City): boolean {
    const storage = typeof this.gameEngine.getPlayerStorage === 'function'
      ? this.gameEngine.getPlayerStorage(city.civilizationId)
      : undefined;
    const plan = storage?.turnData?.offensivePlan as AIState['offensivePlan'] | undefined;
    if (!plan || city.population < 2) {
      return false;
    }

    const offensiveUnits = this.countOffensiveUnits(city.civilizationId);
    return offensiveUnits < plan.requiredUnits;
  }

  /** Aggressive posture is driven by both identity and the current war plan. */
  private isAggressivePosture(civilizationId: number): boolean {
    const civ = this.gameEngine.civilizations?.[civilizationId];
    const strategy = this.getStrategyForCiv(civilizationId);
    return strategy === 'military_expansion' || ((civ?.personality?.aggression ?? 5) >= 7);
  }

  private isCivAtWar(civilizationId: number): boolean {
    return (this.gameEngine.civilizations?.[civilizationId]?.warWith?.size ?? 0) > 0;
  }

  /**
   * Remove stale peaceful follow-ups from an aggressive wartime queue. The
   * current production item is intentionally preserved; only future items
   * are reconsidered and replenished by ensureProductionQueue().
   */
  private reconsiderAggressiveQueue(city: City): void {
    if (!this.isAggressivePosture(city.civilizationId) ||
        (!this.isCivAtWar(city.civilizationId) && !this.shouldSupportOffensivePlan(city)) ||
        !Array.isArray(city.buildQueue)) {
      return;
    }

    const original = city.buildQueue;
    const offensiveQueue = original.filter((item: QueueItem) =>
      item.type === 'unit' && !!item.itemType && this.isOffensiveUnitType(item.itemType)
    );
    if (offensiveQueue.length !== original.length) {
      city.buildQueue = offensiveQueue;
      console.log(`[AutoProduction] Reconsidered aggressive queue for ${city.name}: ${original.length} → ${offensiveQueue.length} peaceful follow-ups removed`);
    }
  }

  private countOffensiveUnits(civilizationId: number): number {
    return this.gameEngine.units.filter((unit: Unit) => unit.civilizationId === civilizationId && this.isOffensiveUnitType(unit.type)).length;
  }

  /**
   * Total military units (troops) for a civilization — drives the scout count.
   * Scouts are 'military'-type units, so existing scouts count as troops too.
   */
  private countTotalTroops(civilizationId: number): number {
    return this.gameEngine.units.filter(
      (unit: Unit) => unit.civilizationId === civilizationId && this.isMilitaryUnitType(unit.type)
    ).length;
  }

  private isMilitaryUnitType(unitType: string): boolean {
    const props = UNIT_PROPS[unitType];
    return !!props && props.type === 'military';
  }

  /**
   * Desired number of scouts based on total troop count:
   *   < 6 troops → 1 scout, 6–11 → 2 scouts, >= 12 → 3 scouts.
   */
  private getDesiredScoutCount(civilizationId: number): number {
    const totalTroops = this.countTotalTroops(civilizationId);
    if (totalTroops >= 12) return 3;
    if (totalTroops >= 6) return 2;
    return 1;
  }

  /** Whether the civilization should build another scout to reach its target. */
  private needsScout(civilizationId: number, plannedScouts: number = 0): boolean {
    const scoutCount = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId === civilizationId && u.type === 'scout'
    ).length + plannedScouts;
    return scoutCount < this.getDesiredScoutCount(civilizationId);
  }

  /**
   * Whether the civ should produce a diplomat: at peace, under its diplomat
   * cap (max 2), Writing researched, and rolling the small personality-scaled
   * chance (diplomatic leaders far more likely). Diplomats are a peacetime
   * luxury — this branch runs only after defense/settler/building/wonder needs.
   */
  private shouldBuildDiplomat(civ: Civilization | undefined): boolean {
    if (!civ) return false;
    if (!canBuildUnit(civ, 'diplomat')) return false;

    // Only while at peace (a diplomat built mid-war is dead weight).
    const dm = this.gameEngine.diplomacyManager;
    if (dm) {
      for (const other of this.gameEngine.civilizations ?? []) {
        if (other.id === civ.id || other.isAlive === false) continue;
        if (dm.isAtWar(civ.id, other.id)) return false;
      }
    }

    // Cap the diplomat corps (the AI only needs 1–2).
    const diplomatCount = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId === civ.id && u.type === 'diplomat'
    ).length;
    if (diplomatCount >= 2) return false;

    const personality = civ.personality ?? { aggression: 5, diplomacy: 5, military: 5 };
    const chance = personality.diplomacy >= 7 ? 0.30 : personality.diplomacy >= 5 ? 0.15 : 0.05;
    return Math.random() < chance;
  }

  /**
   * Whether the AI should produce a Caravan to establish trade routes.
   *
   * Rules:
   *  1. Must have the `trade` tech (Caravan prerequisite).
   *  2. Must NOT be at war (Caravans are fragile peacetime units).
   *  3. At least one owned city has fewer than 3 trade routes (room for more).
   *  4. The civ owns fewer than ceil(cities / 2) Caravans already — avoids
   *     flooding the map with undelivered Caravans.
   *  5. The city has enough population (≥ 2) — a pop-1 city should focus on
   *     food/growth, not trade.
   */
  private shouldBuildCaravan(civ: Civilization, city: City, plannedTypes: string[]): boolean {
    if (!canBuildUnit(civ, 'caravan')) return false;

    // Only at peace — Caravans are fragile, no point building them mid-war.
    const dm = this.gameEngine.diplomacyManager;
    if (dm) {
      for (const other of this.gameEngine.civilizations ?? []) {
        if (other.id === civ.id || other.isAlive === false) continue;
        if (dm.isAtWar(civ.id, other.id)) return false;
      }
    }

    // At least one city has room for more trade routes (max 3 per city).
    const civCities = this.gameEngine.cities.filter(
      (c: City) => c.civilizationId === civ.id,
    );
    const hasRoom = civCities.some(
      (c: City) => (c.tradeRoutes?.length ?? 0) < MAX_CARAVAN_TRADE_ROUTES,
    );
    if (!hasRoom) return false;

    // Don't over-build Caravans — cap at ceil(cities / 2).
    const caravanCount = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId === civ.id && u.type === 'caravan',
    ).length + plannedTypes.filter((t: string) => t === 'caravan').length;
    const maxCaravans = Math.ceil(civCities.length / 2);
    if (caravanCount >= maxCaravans) return false;

    // Pop ≥ 2 so the city is stable enough to divert shields to trade.
    if ((city.population ?? 1) < 2) return false;

    return true;
  }

  private isOffensiveUnitType(unitType: string): boolean {
    const props = UNIT_PROPS[unitType];
    if (!props) {
      return false;
    }
    return (props.attack || 0) >= (props.defense || 0);
  }

  private buildOffensiveProduction(city: City): ProductionItem {
    const civ = this.gameEngine.civilizations?.[city.civilizationId];
    const unitType = this.selectOffensiveUnitTypeForCiv(civ);
    const unitProps = UNIT_PROPS[unitType];
    return {
      type: 'unit',
      itemType: unitType,
      name: unitProps.name,
      cost: unitProps.cost
    };
  }

  /** Tech-gated offensive unit selection */
  private selectOffensiveUnitTypeForCiv(civ: Civilization | undefined): string {
    const offensivePreference = ['tank', 'cavalry', 'knights', 'chariot', 'legion', 'archer', 'warrior'];
    for (const unitType of offensivePreference) {
      if (UNIT_PROPS[unitType] && (!civ || canBuildUnit(civ, unitType))) {
        return unitType;
      }
    }
    return 'warrior';
  }

  /**
   * Barbarian faction production — military units ONLY.
   * A threatened city builds a defender; otherwise it builds a raider.
   */
  private buildBarbarianMilitaryProduction(threatAssessment?: CityThreatAssessment | null): ProductionItem {
    if (threatAssessment?.needsDefense) {
      return this.buildBarbarianDefenderProduction();
    }
    return this.buildBarbarianRaiderProduction();
  }

  /** The barbarian raider: a fast, strong attacker (chariot if present). */
  private buildBarbarianRaiderProduction(): ProductionItem {
    const type = UNIT_PROPS.chariot ? 'chariot' : (UNIT_PROPS.legion ? 'legion' : 'warrior');
    const props = UNIT_PROPS[type];
    return { type: 'unit', itemType: type, name: props?.name ?? type, cost: props?.cost ?? 40 };
  }

  /** Barbarian defender: an era-appropriate basic garrison unit. */
  private buildBarbarianDefenderProduction(): ProductionItem {
    const type = UNIT_PROPS.archer ? 'archer' : 'warrior';
    const props = UNIT_PROPS[type];
    return { type: 'unit', itemType: type, name: props?.name ?? type, cost: props?.cost ?? 10 };
  }

  // findCivForYear removed (unused)

  /** Build a game state summary for AIBuildingStrategy */
  private buildGameState(civilizationId: number): {
    currentYear: number;
    roundNumber: number;
    numCities: number;
    totalPopulation: number;
    numMilitaryUnits: number;
    isAtWar: boolean;
    knownEnemyCities: number;
    isBorderCity: boolean;
    isUnderThreat: boolean;
    builtWonders: string[];
  } {
    const cities = this.gameEngine.cities?.filter((c: City) => c.civilizationId === civilizationId) || [];
    const civ = this.gameEngine.civilizations?.[civilizationId];
    const storage = typeof this.gameEngine.getPlayerStorage === 'function'
      ? this.gameEngine.getPlayerStorage(civilizationId)
      : undefined;

    let knownEnemyCities = 0;
    if (storage?.enemyLocations) {
      for (const enemies of storage.enemyLocations.values()) {
        knownEnemyCities += enemies.filter((e: { type?: string }) => e.type === 'city').length;
      }
    }

    // Collect globally built wonders
    const builtWonders: string[] = [];
    for (const c of (this.gameEngine.cities || [])) {
      for (const b of (c.buildings || [])) {
        if (WONDER_PROPERTIES[b]) {
          builtWonders.push(b);
        }
      }
    }

    return {
      currentYear: this.gameEngine.currentYear ?? -4000,
      roundNumber: this.gameEngine.roundManager?.getRoundNumber?.() ?? 0,
      numCities: cities.length,
      totalPopulation: cities.reduce((sum: number, c: City) => sum + (c.population || 1), 0),
      numMilitaryUnits: this.gameEngine.units?.filter(
        (u: Unit) => u.civilizationId === civilizationId && (UNIT_PROPS[u.type]?.attack || 0) > 0
      ).length ?? 0,
      isAtWar: civ?.warWith?.size > 0,
      knownEnemyCities,
      isBorderCity: false, // default, overridden per-city in determineProductionItem
      isUnderThreat: false,
      builtWonders,
    };
  }

  /**
   * Process auto-production for all cities belonging to a civilization
   */
  processAutoProductionForCivilization(civilizationId: number): void {
    try {
      console.log('[AutoProduction] Processing auto-production for civilization', civilizationId);
      
      const civCities = this.gameEngine.cities.filter((c: City) => c.civilizationId === civilizationId);
      
      for (const city of civCities) {
        // Before adjusting production, try to fix happiness problems by
        // assigning Entertainer specialists. This is cheaper than raising
        // the luxury rate (which drains commerce from ALL cities) and avoids
        // the disorder → zero-income death spiral.  Keep assigning until
        // the city is content or no more workers can be converted.
        // After assigning, demote any Entertainers that are now redundant
        // (e.g. a building was completed that provides enough happiness).
        if (city.autoProduction) {
          let assigned = 0;
          while (assigned < 5 && this.assignEntertainerIfHelpful(city, civilizationId)) {
            assigned++;
          }
          if (assigned > 0) {
            console.log(`[AutoProduction] ${city.name}: assigned ${assigned} Entertainer(s) this turn`);
          }
          // Demote Entertainers that are no longer needed (building/garrison
          // now covers the happiness need).  Run AFTER assignment so the
          // cycle is: assign needed → demote unneeded → build production.
          this.demoteUnneededEntertainers(city, civilizationId);
          this.setAutoProduction(city.id);
        }
      }
      // After all cities are evaluated, consider spending gold on rushing
      // urgent production (defenders under threat, nearly-done builds).
      this.evaluateGoldSpending(civilizationId);
    } catch (e) {
      console.error('[AutoProduction] processAutoProductionForCivilization error', e);
    }
  }

  /**
   * Try to fix a city's happiness problems by assigning an Entertainer
   * specialist instead of raising the luxury rate. An Entertainer generates
   * +2 Luxury, which directly helps prevent disorder.
   *
   * This runs every turn for every city with auto-production enabled, so
   * the AI keeps adding Entertainers until the city is content — letting
   * the rate planner (`raiseTaxForAI`) see the reduced need and cut the
   * luxury rate on the next turn.
   *
   * Guards:
   *  1. City must actually have a happiness problem (disorder or unhappiness
   *     ≥ happiness).
   *  2. City must have at least one tile worker to convert (population −
   *     specialists ≥ 2 so the city center stays worked).
   *  3. Removing the worst food-producing worker must leave the city with a
   *     non-negative food surplus (≥ 0 — the city doesn't grow but doesn't
   *     starve either).
   *
   * Returns true if an Entertainer was assigned.
   */
  private assignEntertainerIfHelpful(city: City, civId: number): boolean {
    const civ = this.gameEngine.civilizations?.[civId];
    if (!civ) return false;

    const econ = this.gameEngine.economicManager;
    if (!econ) return false;

    // Only act when the city actually has a happiness problem.
    const happyState = econ.cityHappiness(city, civ);
    if (!happyState.disorder && happyState.unhappiness < happyState.happiness) {
      return false;
    }

    // ── Martial law first: if the government supports garrison units and
    //    there is room for one more, prefer moving a military unit INTO the
    //    city over assigning an Entertainer — a garrison unit costs gold but
    //    also defends, while an Entertainer only gives happiness. ──
    // (This is an advisory check — the actual unit movement is handled by
    //  AIManager. Here we just skip the Entertainer if martial law could
    //  solve the problem instead.)

    // Need at least 2 tile workers so the city center stays worked after
    // converting one (the center is always worked, population − specialists
    // must be ≥ 1 for the center + at least one outer tile for food).
    const workingTiles = city.workingTiles ?? new Set<string>();
    const tileWorkers = workingTiles.size;
    if (tileWorkers < 2) return false;

    // Don't over-assign: cap at 3 Entertainers per city. Beyond that the
    // city is losing too many tile workers and should build a temple instead.
    const curEntertainers = (city.specialists ?? []).filter(s => s === 'entertainer').length;
    if (curEntertainers >= 3) return false;

    // ── Randomness: for borderline cases (disorder=0, unhappiness≈happiness)
    //    roll a dice — sometimes an Entertainer is worth it even when the
    //    city is "technically" content, because next turn growth or a new
    //    citizen could tip it into disorder. This makes AI behaviour less
    //    predictable and more human-like. ──
    const deficit = happyState.unhappiness - happyState.happiness + (happyState.disorder ? 1 : 0);
    if (deficit <= 0) {
      // City is actually content — but maybe it's about to tip. Assign an
      // Entertainer with probability proportional to how close unhappiness
      // is to happiness. If they're equal (deficit=0), 20% chance.
      const borderline = happyState.unhappiness >= happyState.happiness - 1;
      if (!borderline) return false;
      // deficit ≤ 0 means happy > unhappy. The closer they are, the higher
      // the chance. When unhappy == happy-1: 30%. When unhappy == happy: 60%.
      const ratio = 1 - (happyState.happiness - happyState.unhappiness) / Math.max(1, happyState.happiness);
      const chance = Math.min(0.6, ratio * 0.6);
      if (Math.random() > chance) return false;
    }

    // Find the tile worker that produces the LEAST food — converting them to
    // an Entertainer has the smallest impact on the food surplus.
    const centerKey = `${city.col},${city.row}`;
    let worstFoodKey: string | null = null;
    let worstFood = Infinity;
    for (const key of workingTiles) {
      if (key === centerKey) continue; // never remove the center worker
      const sep = key.indexOf(',');
      const col = Number(key.slice(0, sep));
      const row = Number(key.slice(sep + 1));
      const tile = this.gameEngine.getTileAt(col, row);
      if (!tile) continue;
      const y = econ.tileYields(tile);
      if (y.food < worstFood) {
        worstFood = y.food;
        worstFoodKey = key;
      }
    }
    if (!worstFoodKey) return false;

    // Simulate the food surplus AFTER removing this worker. Allow slight
    // negative surplus (up to −2) — the city loses 1 pop on starvation but
    // the Entertainer prevents disorder, which is worse (0 commerce).
    // Only block if starvation would be catastrophic (surplus < −2).
    const currentYields = city.yields ?? { food: 0, production: 0, trade: 0 };
    const foodAfter = currentYields.food - worstFood;
    const pop = city.population ?? 1;
    const foodConsumed = pop * 2; // each citizen eats 2 food
    const surplusAfter = foodAfter - foodConsumed;
    if (surplusAfter < -2) return false;

    // All guards passed — assign the Entertainer.
    const ok = this.gameEngine.promoteCitizenToSpecialist?.(city.id, 'entertainer');
    if (ok) {
      console.log(`[AutoProduction] ${city.name}: assigned Entertainer (food surplus ${surplusAfter}, deficit ${deficit}, cur entertainers ${curEntertainers + 1})`);
    }
    return !!ok;
  }

  /**
   * Demote Entertainers back to tile workers when they are no longer needed.
   * An Entertainer becomes redundant when:
   *  1. A building (temple/colosseum/cathedral) now provides enough happiness.
   *  2. A garrison unit is nearby providing defense bonus.
   *  3. The city's happiness problem is resolved without the Entertainer.
   *
   * This runs AFTER Entertainer assignment, so the cycle is:
   *  assign needed Entertainers → demote unneeded ones → build production.
   *
   * Returns true if any Entertainer was demoted.
   */
  private demoteUnneededEntertainers(city: City, civId: number): boolean {
    const civ = this.gameEngine.civilizations?.[civId];
    if (!civ) return false;
    const econ = this.gameEngine.economicManager;
    if (!econ) return false;

    const specs = city.specialists ?? [];
    const entertainers = specs.filter(s => s === 'entertainer');
    if (entertainers.length === 0) return false;

    // Calculate how much luxury the Entertainers provide
    const entertainerLuxury = entertainers.length * 2;

    // Check if the city would still be happy WITHOUT the Entertainers.
    // Temporarily remove all Entertainers and re-evaluate happiness.
    // Simulate: if the city had no Entertainers, what would happiness look like?
    // We compute: happiness without Entertainer luxury = (current happiness - entertainerLuxury)
    const currentHappy = econ.cityHappiness(city, civ);
    const happinessWithoutEntertainers = currentHappy.happiness - entertainerLuxury;

    // If the city is STILL happy without Entertainers, demote them all.
    if (happinessWithoutEntertainers > currentHappy.unhappiness) {
      console.log(`[AutoProduction] ${city.name}: ${entertainers.length} Entertainer(s) no longer needed (happy ${happinessWithoutEntertainers} vs unhappy ${currentHappy.unhappiness} without them)`);
      let demoted = 0;
      // Demote from last to first to avoid index shifting
      for (let i = specs.length - 1; i >= 0 && demoted < entertainers.length; i--) {
        if (specs[i] === 'entertainer') {
          if (this.gameEngine.demoteSpecialistToWorker?.(city.id, i)) {
            demoted++;
          }
        }
      }
      if (demoted > 0) {
        console.log(`[AutoProduction] ${city.name}: demoted ${demoted} Entertainer(s) back to tile workers`);
      }
      return demoted > 0;
    }

    // If the city is exactly balanced or 1 point short, check if a building
    // is being produced that will add happiness — if so, demote ONE Entertainer
    // to free a worker slot for food/production while the building finishes.
    // Also demote when a garrison unit is present (martial law covers the gap).
    if (happinessWithoutEntertainers <= currentHappy.unhappiness && entertainers.length > 1) {
      let canDemoteOne = false;
      // A building under production will help
      const producing = city.currentProduction;
      if (producing?.type === 'building') {
        const bEffects = BUILDING_PROPERTIES[producing.itemType]?.effects;
        if (bEffects && (bEffects.happiness ?? 0) > 0) {
          canDemoteOne = true;
        }
      }
      // Martial law from garrison units covers part of the need
      const gov = getGovernment(civ?.government);
      const govName = (gov.name ?? '').toLowerCase();
      const martialLawMax = (govName === 'despotism' || govName === 'anarchy') ? 4
        : (govName === 'monarchy' || govName === 'communism') ? 3 : 0;
      if (martialLawMax > 0) {
        const garrisonUnits = (this.gameEngine?.units ?? []).filter((u: Unit) =>
          u.civilizationId === civId
          && u.col === city.col && u.row === city.row
          && !u.isDefeated
          && (u.attack ?? 0) > 0
        ).length;
        if (garrisonUnits > 0 && garrisonUnits < martialLawMax) {
          // There's room for one more garrison unit to cover happiness
          canDemoteOne = true;
        }
      }
      if (canDemoteOne) {
        // Demote the last Entertainer
        for (let i = specs.length - 1; i >= 0; i--) {
          if (specs[i] === 'entertainer') {
            this.gameEngine.demoteSpecialistToWorker?.(city.id, i);
            console.log(`[AutoProduction] ${city.name}: demoted 1 Entertainer (building/martial law covers the gap)`);
            return true;
          }
        }
      }
    }

    console.log(`[AutoProduction] ${city.name}: Entertainer(s) still needed (happy ${happinessWithoutEntertainers} vs unhappy ${currentHappy.unhappiness})`);
    return false;
  }

  /**
   * Process auto-production for all AI civilizations
   */
  processAutoProductionForAI(): void {
    try {
      console.log('[AutoProduction] Processing auto-production for all AI');
      
      const aiCivilizations = this.gameEngine.civilizations.filter(
        (civ: Civilization) => civ.isAI || civ.id !== 0
      );
      
      for (const civ of aiCivilizations) {
        this.processAutoProductionForCivilization(civ.id);
      }
    } catch (e) {
      console.error('[AutoProduction] processAutoProductionForAI error', e);
    }
  }

  // ── Strategic gold spending ───────────────────────────────────────────
  // AI should try to make money and use it strategically:
  //  1. Maintain minimum 8 gold (AI_MIN_GOLD_RESERVE).
  //  2. When gold exceeds the reserve, consider buying/rushing if it would
  //     help (e.g. rush a defender when under threat, rush a wonder, buy a
  //     critical unit).
  //  3. Only spend when the benefit outweighs the gold cost.

  private readonly RUSH_COST_MULTIPLIER = 2; // gold cost = remaining shields × 2

  /**
   * Evaluate whether to spend gold on rushing production in cities.
   * Only rushes when:
   *  1. Gold is above the minimum reserve.
   *  2. The city is under threat and needs an immediate defender.
   *  3. The rush cost is affordable (≤ 50% of available gold above reserve).
   *  4. Rushing would finish within 2 turns of production (not a long build).
   */
  private evaluateGoldSpending(civId: number): void {
    const minimumReserve = this.gameEngine.economicManager?.AI_MIN_GOLD_RESERVE ?? 8;
    const civ = this.gameEngine.civilizations?.[civId];
    if (!civ || civ.isHuman) return;

    const gold = civ.resources?.gold ?? 0;
    const available = gold - minimumReserve - 15; // Keep a buffer of 15gold for emergencies
    if (available <= 5) return; // Too little gold above reserve to spend

    const cities = this.gameEngine.cities.filter(
      (c: City) => c.civilizationId === civId && c.autoProduction,
    );

    for (const city of cities) {
      if (!city.currentProduction) continue;
      if (city.currentProduction.type !== 'unit' && city.currentProduction.type !== 'building') continue;

      const threat = this.evaluateCityThreat(city);
      const isUrgentDefender = threat?.needsDefense && city.currentProduction.type === 'unit'
        && this.isDefensiveProduction(city.currentProduction);
      const productionProgress = city.productionStored ?? 0;
      const productionCost = city.currentProduction.cost ?? 0;
      const remaining = Math.max(0, productionCost - productionProgress);
      if (remaining <= 0) continue;

      const rushGold = remaining * this.RUSH_COST_MULTIPLIER;

      // Only rush if:
      //  (a) under immediate threat and building a defender, OR
      //  (b) gold is abundant (≥ 3× reserve) and the build is nearly done.
      const goldIsAbundant = gold >= minimumReserve * 3;
      const nearlyDone = remaining <= 5;
      const shouldRush = isUrgentDefender || (goldIsAbundant && nearlyDone);

      if (!shouldRush) continue;
      if (rushGold > available) continue; // Can't afford it

      // Rush the production
      console.log(`[AutoProduction] ${city.name}: rushing ${city.currentProduction.itemType} for ${rushGold} gold (${remaining} shields remaining, ${isUrgentDefender ? 'threat' : 'abundant gold'})`);
      this.gameEngine.rushCityProduction(city.id);
      break; // Only rush one city per turn to avoid draining the treasury
    }
  }

  /**
   * React to key game events by refreshing production decisions:
   *  - UNIT_PRODUCED / BUILDING_COMPLETED → top up the queue immediately
   *    (instead of waiting for the next production phase).
   *  - CITY_CAPTURED / CITY_DESTROYED → re-pick production for the affected
   *    civ(s) so they rebuild or reinforce.
   *  - WAR_DECLARED → re-pick production for both sides (fresh threat eval).
   * Wired from the engine event tap in `src/hooks/UseGameEngine.ts`.
   */
  onGameEvent(eventType: string, data: Record<string, unknown>): void {
    try {
      switch (eventType) {
        case 'UNIT_PRODUCED':
        case 'BUILDING_COMPLETED': {
          const cityId = data?.cityId;
          if (typeof cityId === 'string') this.ensureProductionQueue(cityId);
          break;
        }
        case 'CITY_CAPTURED': {
          const originalCiv = data?.originalCiv;
          const capturedBy = data?.capturedBy;
          if (typeof originalCiv === 'number') this.processAutoProductionForCivilization(originalCiv);
          if (typeof capturedBy === 'number') this.processAutoProductionForCivilization(capturedBy);
          break;
        }
        case 'CITY_DESTROYED': {
          const destroyedCity = data?.city as { civilizationId?: unknown } | undefined;
          const owner = destroyedCity?.civilizationId;
          if (typeof owner === 'number') this.processAutoProductionForCivilization(owner);
          break;
        }
        case 'WAR_DECLARED': {
          const aggressor = data?.aggressorId ?? data?.civilizationId;
          const target = data?.targetId ?? data?.targetCivilizationId;
          if (typeof aggressor === 'number') this.processAutoProductionForCivilization(aggressor);
          if (typeof target === 'number' && target !== aggressor) this.processAutoProductionForCivilization(target);
          break;
        }
        default:
          break;
      }
    } catch (e) {
      console.error('[AutoProduction] onGameEvent error', e);
    }
  }
}
