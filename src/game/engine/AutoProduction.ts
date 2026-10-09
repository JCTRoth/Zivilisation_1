/**
 * AutoProduction - Automatically manages production queues for cities
 * Uses tech-gated unit selection and integrates AIBuildingStrategy for
 * intelligent building/wonder production decisions.
 */

import { UNIT_PROPS, BUILDING_PROPS, MAX_CARAVAN_TRADE_ROUTES } from '@/utils/Constants';
import { BUILDING_PROPERTIES, WONDER_PROPERTIES } from '@/data/BuildingConstants';
import { WONDERS, wonderGroupMembers } from '@/data/WonderData';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import {
  assessCityThreat,
  calculateDangerThreshold,
  collectCityThreatSamples,
  computeCityGarrisonStrength,
  type CityThreatAssessment
} from './AI/AIStrategy';
import { canBuildUnit, type StrategyProfile, type AIState, resolveAICivStrategy, type BuildingPlan } from './AI/AITypes';
import { bestFishingGround } from './FisherEconomics';
import { AIBuildingStrategy } from './AI/AIBuildingStrategy';
import { buildingOnRebuyCooldown } from './AI/BuildingAnalyzer';
import {
  coordinationWeight,
  countBuildingCopies,
  evaluateBuildingForCity,
  DEFENCE_BUILDINGS,
} from './AI/BuildingCoordinator';
import {
  navalDoctrine,
  type AvailableShip,
  type NavalDoctrineInput,
  type NavalDoctrineResult,
  isWarshipHull,
} from './AI/NavalDoctrine';
import { AI_RESERVE_TURNS } from './AI/AIEconomicManager';
import { ABSOLUTE_MIN_GOLD } from './EconomicManager';
import { SettlerGovernor } from './AI/SettlerGovernor';

/**
 * Hulls the AI will consider, cheapest first. The order only decides *which*
 * transport to build when several are available and which techs are worth
 * researching; `NavalDoctrine` decides whether a ship is wanted at all and
 * `bestAvailableShip` decides how strong a warship should be.
 */
const NAVAL_BUILD_ORDER = [
  'ferry',
  'sail',
  'trireme',
  'caravel',
  'frigate',
  'ironclad',
  'destroyer',
  'cruiser',
  'battleship',
  'submarine',
  'carrier',
] as const;

/** The doctrine's answer plus the counts the caller needs to act on it. */
type NavalDoctrineVerdict = NavalDoctrineInput & NavalDoctrineResult & {
  ownTransports: number;
  ownWarships: number;
};
import type { City, Civilization, Unit } from '../../../types/game';
import GameEngine from './GameEngine';
import { debugLog } from '../../utils/DevLog';

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
/**
 * Share of a civ's projected income that building upkeep may consume.
 *
 * Measured on a 187-round AI-vs-AI export: the AI queued `city_walls` 688
 * times (more than settlers, pyramids or barracks) - one per city, 2 gold/turn
 * each, and `NEVER_SELL` meant it could never get the money back - against a
 * per-city income of 0-4 gold. Every civ ran a negative net for the whole run
 * and the upkeep disbander collected the difference. 40% leaves room for a
 * young empire's granary/temple/walls (see the floor below) and stops a
 * 15-building late-game city from buying a 16th.
 */
const BUILDING_UPKEEP_INCOME_RATIO = 0.4;
/**
 * Building-upkeep budget floor, in gold/turn. A brand-new civ earns almost
 * nothing, but granary/temple/barracks are 1 gold each and a city without them
 * never grows - so some upkeep is always affordable, and the ratio above only
 * starts to bite once there is real income to protect.
 */
const BUILDING_UPKEEP_BUDGET_FLOOR = 6;

const AUTO_QUEUE_TARGET = 3;

/** Absolute ceiling on the AI's scout corps (the desired count caps at 3 too). */
const AI_ABSOLUTE_MAX_SCOUTS = 3;

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
  // Measured over 12 batch games (48 civs), wins / cities-per-civ:
  //   military_expansion 6/10 wins, 2.5 cities  — the reference personality
  //   balanced_growth    3/8  wins, 4.6 cities  — expands best
  //   science_focus      1/8  wins, 1.9 cities
  //   wonder_rush        1/7  wins, 1.4 cities
  //   early_expansion    0/9  wins, 0.9 cities  — settler spam, self-destructed
  //   defensive_turtle   1/6  wins, 0.8 cities  — walled in and died owning walls
  // The two losers both under-expanded or over-expanded, so both are pulled
  // toward the cadence that actually survives: two or three cities, then a
  // settler roughly every third city.
  early_expansion: { settlersPerCities: 3, minSettlers: 2, maxSettlers: 4, earlyBonus: true },
  military_expansion: { settlersPerCities: 3, minSettlers: 1, maxSettlers: 4, earlyBonus: false },
  balanced_growth: { settlersPerCities: 3, minSettlers: 1, maxSettlers: 4, earlyBonus: true },
  science_focus: { settlersPerCities: 4, minSettlers: 2, maxSettlers: 3, earlyBonus: false },
  wonder_rush: { settlersPerCities: 3, minSettlers: 2, maxSettlers: 3, earlyBonus: true },
  // A turtle that never expands cannot win and cannot even trade: it just
  // builds walls until somebody walks over them. Keep two settlers in hand.
  defensive_turtle: { settlersPerCities: 4, minSettlers: 2, maxSettlers: 3, earlyBonus: true },
};

export class AutoProduction {
  private gameEngine: GameEngine;
  private settlerGovernor: SettlerGovernor;

  /**
   * Per-civ naval doctrine verdict for the current state of the world. The
   * doctrine probes the map (colonisable islands), every own city's threat and
   * the whole economy, and AutoProduction asks for it once per city per queue
   * slot — dozens of identical answers per turn. The cache key is the cheap set
   * of counts the doctrine consumes, so any of them changing re-runs it.
   */
  private readonly navalDoctrineCache = new Map<number, { key: string; verdict: NavalDoctrineVerdict | null }>();

  constructor(gameEngine: GameEngine) {
    this.gameEngine = gameEngine;
    this.settlerGovernor = new SettlerGovernor();
  }

  /** Reset any per-game state when starting a new game. */
  reset(): void {
    // All production decisions are derived from the engine's current state.
    this.navalDoctrineCache.clear();
  }

  /**
   * Set automatic production for a city based on its needs and current state
   */
  setAutoProduction(cityId: string): boolean {
    try {
      debugLog('[AutoProduction] setAutoProduction called for city', cityId);
      
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

      const civ = this.gameEngine.civilizations?.[city.civilizationId];
      if (city.currentProduction) {
        if (threatAssessment?.needsDefense && !this.isDefensiveProduction(city.currentProduction)) {
          debugLog('[AutoProduction] City under threat, overriding existing production');
          this.gameEngine.removeCurrentProduction(city.id);
        } else if (
          this.isFoodEmergency(city, civ) &&
          city.currentProduction.type === 'unit' &&
          city.currentProduction.itemType === 'settler'
        ) {
          // A starving city must not train settlers: each one eats food from
          // the city and consumes a citizen on completion. The governor fixes
          // the tile assignment; cancelling the settler lets the city recover.
          debugLog('[AutoProduction] Food emergency — cancelling settler production');
          this.gameEngine.removeCurrentProduction(city.id);
        } else if (this.isHappinessCrisis(city) && !this.isHappinessBuilding(city.currentProduction)) {
          // A city in or approaching disorder produces (almost) nothing at all
          // (applyCityOutputs zeroes a disordered city's output), so the
          // happiness building that would fix it must preempt EVERYTHING else.
          // Only override when such a building is actually available, though:
          // with the tech missing (no Ceremonial Burial → no temple) removing
          // the current item every turn made the city churn production forever
          // and never complete anything — the profiled run logged 2,283
          // production changes on Berlin alone. Without a fix available, let
          // the current item finish instead.
          const happyFix = this.chooseHappinessBuilding(city, civ, []);
          if (happyFix) {
            debugLog('[AutoProduction] Happiness crisis, overriding existing production');
            this.gameEngine.removeCurrentProduction(city.id);
          } else {
            debugLog('[AutoProduction] Happiness crisis but no happiness building available — keeping current production');
          }
        } else if (
          city.currentProduction.type === 'building' &&
          (city.buildings ?? []).includes(city.currentProduction.itemType)
        ) {
          // Never keep producing a building the city already owns (the queue
          // item can outlive the building it produced). Re-pick a fresh item.
          debugLog('[AutoProduction] City already has', city.currentProduction.itemType, '- re-picking production');
          this.gameEngine.removeCurrentProduction(city.id);
        } else {
          debugLog('[AutoProduction] City already has production:', city.currentProduction);
          // Keep the current item and top up the queue with sensible follow-ups.
          this.ensureProductionQueue(city.id);
          return true;
        }
      }

      // Determine what the city should produce based on its state
      const productionItem = this.determineProductionItem(city, threatAssessment, []);
      
      if (productionItem) {
        debugLog('[AutoProduction] Setting production item:', productionItem);
        
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

      // A full queue needs no top-up: every call after the first in a turn is
      // already a no-op. (The high `CITY_PRODUCTION_CHANGED` counts in the
      // logs are real per-completion throughput, not churn — a city producing
      // an item a turn legitimately refills its queue an equal number of
      // times. A signature-based throttle here was redundant and could skip a
      // retry after the world changed without the queue changing.)
      const slots = AUTO_QUEUE_TARGET - existingQueue.length;
      if (slots <= 0) return;

      // ── Economy-aware unit cap ──
      // Upkeep = max(totalUnits, cityCount). A civ can only afford to maintain
      // as many units as its full-tax income pays for (beyond the free support
      // of one unit per city). When the civ is already at/over that cap, stop
      // queuing more units — it only produces an army it immediately disbands
      // for upkeep (the AI-vs-AI produce→disband churn). Buildings are still
      // allowed; only military/explorer/settler units are capped.
      const unitCapExhausted = this.isUnitCapExhausted(city.civilizationId);
      // Growth units (scouts/settlers/fisher boats) are exempt from the army
      // cap, but not from solvency: queueing one the treasury cannot pay for
      // just feeds the produce→disband loop.
      const canAffordGrowthUnit = this.canAffordAnotherUnit(city.civilizationId);

      let added = 0;
      let guard = 0;
      const maxBuildingsInQueue = Math.max(1, Math.floor(AUTO_QUEUE_TARGET * 0.25));
      while (added < slots && guard++ < 10) {
        const item = this.determineProductionItem(city, threatAssessment, plannedTypes);
        if (!item) break;
        const itemType = item.itemType || item.type;
        if (!itemType) break;

        const buildingCount = plannedTypes.filter((t: string) =>
          BUILDING_PROPERTIES[t] || WONDER_PROPERTIES[t],
        ).length;
        if (item.type === 'building' && buildingCount >= maxBuildingsInQueue) {
          const unitItem = this.determineFallbackUnit(city, threatAssessment, plannedTypes);
          if (unitItem) {
            const unitResult = this.gameEngine.productionManager.setCityProduction(cityId, unitItem, true);
            if (!unitResult || unitResult.success === false) break;
            plannedTypes.push(unitItem.itemType || unitItem.type);
            added++;
            continue;
          }
          break;
        }

        if (item.type === 'building') {
          const alreadyOwned = (city.buildings ?? []).includes(itemType);
          const alreadyQueued = plannedTypes.includes(itemType);
          const isDuplicate = alreadyOwned || alreadyQueued;
          const isWonder = !!WONDER_PROPERTIES[itemType];
          // Same-civ group members count too: our own completed space station
          // retires its sisters for our other cities as well.
          const groupMembers = wonderGroupMembers(itemType);
          const wonderAlreadyBuilt = isWonder && this.gameEngine.cities.some(
            (c: City) => c.civilizationId === city.civilizationId && (c.buildings ?? []).some(
              (b) => b === itemType || groupMembers.includes(b),
            ),
          );
          if (isDuplicate || wonderAlreadyBuilt) {
            plannedTypes.push(itemType);
            continue;
          }
          const hasPendingBuilding = plannedTypes.some((t: string) => BUILDING_PROPERTIES[t]);
          if (hasPendingBuilding && buildingCount >= maxBuildingsInQueue) {
            const unitItem = this.determineFallbackUnit(city, threatAssessment, plannedTypes);
            if (unitItem) {
              const unitResult = this.gameEngine.productionManager.setCityProduction(cityId, unitItem, true);
              if (!unitResult || unitResult.success === false) break;
              plannedTypes.push(unitItem.itemType || unitItem.type);
              added++;
              continue;
            }
            break;
          }
        }

        // Skip unit items when the civ can't afford to maintain more units.
        // (Fall back to a building so the city still has something to do.)
        if (unitCapExhausted && item.type === 'unit') {
          // Scouts, settlers and Fisher Boats grow the economy — never block
          // them behind the army-upkeep cap while the civ can still pay one
          // more unit. A scout is the civ's eyes on the map; a settler founds
          // a new city that adds free unit support and tax income; the Fisher
          // Boat only reaches this point when the FisherEconomics equation says
          // its food value beats its upkeep, so it pays for itself instead of
          // straining the budget. (Settler count is still limited by the
          // expansion params.)
          const isGrowthUnit = item.itemType === 'scout' || item.itemType === 'settler' || item.itemType === 'fisher_boat';
          if (isGrowthUnit && canAffordGrowthUnit) {
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
            // completes — but never queue a unit the treasury will disband on
            // arrival. Only guarantee the FIRST follow-up this way; if the
            // queue already has something, a missing building just stops
            // topping up.
            if (added > 0 || !canAffordGrowthUnit) break;
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
  /**
   * The next happiness building this city should complete: the first of
   * temple → colosseum → cathedral that the civ can build, does not own and
   * has not already planned. `null` when none is available (typically the
   * required technology is missing), in which case the caller falls through
   * to its other items.
   */
  private chooseHappinessBuilding(
    city: City,
    civ: Civilization | undefined,
    plannedTypes: string[],
  ): ProductionItem | null {
    const existingBuildings = new Set(city.buildings ?? []);
    const civTechs = new Set<string>();
    const techs = civ?.technologies;
    if (Array.isArray(techs)) {
      for (const t of techs) civTechs.add(String(t));
    } else if (techs && typeof (techs as Iterable<string>)[Symbol.iterator] === 'function') {
      for (const t of techs as Iterable<string>) civTechs.add(String(t));
    }
    const happyBuilding = ['temple', 'colosseum', 'cathedral'].find((b) => {
      if (existingBuildings.has(b) || plannedTypes.includes(b)) return false;
      const props = BUILDING_PROPS[b] || BUILDING_PROPERTIES[b];
      if (!props) return false;
      // Only consider buildings the civ has the tech for
      if (props.requiredTechnology && !civTechs.has(props.requiredTechnology)) return false;
      return true;
    });
    if (!happyBuilding) return null;
    const bProps = BUILDING_PROPS[happyBuilding] || BUILDING_PROPERTIES[happyBuilding];
    if (!bProps) return null;
    return {
      type: 'building',
      itemType: happyBuilding,
      name: bProps.name,
      cost: bProps.cost,
    };
  }

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
    // Economy-aware army cap: at/over it the city must not PRODUCE more
    // military units (only defense/settlers/scouts are exempt) — otherwise the
    // army grows until the treasury starves and units are disbanded.
    const unitCapExhausted = this.isUnitCapExhausted(city.civilizationId);
    // Troop production stops when the treasury cannot pay another unit — a
    // defender produced into a deficit is disbanded the turn it arrives (a
    // profiled run produced 2,301 riflemen and disbanded 2,302). A war chest
    // (>= 50 gold) still buys emergency defenders.
    const canAffordMoreTroops = !unitCapExhausted
      || this.canAffordAnotherUnit(city.civilizationId)
      || (civ?.resources?.gold ?? 0) >= 50;

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
    if (threatAssessment?.needsDefense && canAffordMoreTroops) {
      debugLog('[AutoProduction] City needs defender (threat-triggered)');
      return this.buildDefenderProduction(city, threatAssessment);
    }

    // 1a. Disorder emergency runs before ANY naval or expansion project: a
    //     disordered city produces nothing (applyCityOutputs zeroes its
    //     output), so ordering a ferry or settler there just feeds the
    //     treasury spiral — the profiled naval run queued ferries for 200
    //     rounds in a city that never left disorder. Also trigger when the
    //     city's own trade is zero while citizens are unhappy: that is
    //     disorder/luxury eating the commerce, and the fix is a happiness
    //     building, not another hull.
    const earlyEcon = this.gameEngine?.economicManager;
    if (civ && earlyEcon) {
      const happyState = earlyEcon.cityHappiness(city, civ);
      const cityTrade = city.yields?.trade ?? 0;
      const disorderEmergency = happyState.disorder
        || (cityTrade <= 0 && happyState.unhappiness > 0);
      if (disorderEmergency) {
        const happyBuilding = this.chooseHappinessBuilding(city, civ, plannedTypes);
        if (happyBuilding) {
          debugLog(`[AutoProduction] Disorder emergency: building ${happyBuilding.itemType} (trade ${cityTrade}, disorder ${happyState.disorder})`);
          return happyBuilding;
        }

        // No happiness building is available (the tech is missing). A settler
        // completion consumes one citizen, so producing one is the standard
        // Civ1 pressure valve for a crowded, dissatisfied city: the citizen
        // that leaves takes its unhappiness with it, and the settler then
        // improves the empire's tiles. Only useful while there are several
        // malcontents and the city can spare a citizen (pop >= 2).
        const unhappy = happyState.unhappiness ?? 0;
        const population = city.population ?? 1;
        if (unhappy >= 2 && population >= 2 && this.canAffordAnotherUnit(civ.id)) {
          debugLog(`[AutoProduction] Pacification: building a settler to shed an unhappy citizen (unhappy ${unhappy}, pop ${population})`);
          return {
            type: 'unit',
            itemType: 'settler',
            name: UNIT_PROPS.settler?.name || 'Settler',
            cost: UNIT_PROPS.settler?.cost || 40,
          };
        }
      }
    }

    // 1c. Island strategy. A civ alone on a VERY SMALL island must escape:
    //     building a ship is the highest production priority. On a small (but
    //     livable) island a Harbor is promoted — it unlocks ships and feeds the
    //     city from the sea.
    const island = this.getIslandSituation(city.civilizationId);
    if (island?.isAlone) {
      if (island.isVerySmall) {
        const ship = this.buildEscapeShipProduction(city);
        if (ship) {
          debugLog(`[AutoProduction] Trapped on a ${island.size}-tile island — building ${ship.itemType} to escape`);
          return ship;
        }
      }
      if (island.isSmall) {
        const harbor = this.buildHarborProduction(city);
        if (harbor) {
          debugLog(`[AutoProduction] Isolated on a small island — building a Harbor`);
          return harbor;
        }
      }
    }

    // 1d. Colony mission waiting for a hull: build the ferry that will carry
    //     the settler to the small island.
    const colonyFerry = this.buildColonyFerryProduction(city);
    if (colonyFerry) {
      debugLog('[AutoProduction] Colony mission — building a ferry');
      return colonyFerry;
    }

    // 1d-2. Invasion waiting for a hull: the troop that will be ferried to the
    //        enemy city on the far shore. A war is a ferry, so build one.
    const invasionFerry = this.buildInvasionFerryProduction(city);
    if (invasionFerry) {
      debugLog('[AutoProduction] Invasion — building a ferry');
      return invasionFerry;
    }

    // 1e. Fisher Boat: a harbor city that is short on food sends a boat to the
    //     ground the FisherEconomics equation approves (replaces the old harbor
    //     ocean-food bonus).
    const fisherBoat = this.buildFisherBoatProduction(city);
    if (fisherBoat) {
      debugLog('[AutoProduction] Food pressure — building a Fisher Boat');
      return fisherBoat;
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
      const happyBuilding = this.chooseHappinessBuilding(city, civ, plannedTypes);
      if (happyBuilding) {
        debugLog(`[AutoProduction] Happiness emergency: building ${happyBuilding.itemType} (luxury ${luxuryRate}%, disorder ${needsHappiness}, entertainers ${entertainerCount})`);
        return happyBuilding;
      }
    }

    // 2. Build a defender if none exists
    if (!hasDefender && canAffordMoreTroops) {
      debugLog('[AutoProduction] City needs defender');
      return this.buildDefenderProduction(city, threatAssessment);
    }

    if (threatAssessment && threatAssessment.netThreat > 0 && canAffordMoreTroops) {
      debugLog('[AutoProduction] Elevated threat detected, reinforcing garrison');
      return this.buildDefenderProduction(city, threatAssessment);
    }

    // 2a. Minimum city infrastructure. The AI-vs-AI CSV showed cities stuck
    //     queueing one unit type for a dozen turns while a 16-pop city had no
    //     marketplace and no granary — leaving gold and growth on the table.
    //     Once a city is defended it must complete a small core building set
    //     (granary → temple → marketplace) before mass-queueing further units.
    //     Tech-gated and skipped when already owned or queued. Only fires
    //     once the civ holds several cities, so early expansion (settler
    //     production) is never blocked by an infrastructure detour.
    if (civCities.length >= 3) {
      const existingBuildings = new Set(city.buildings ?? []);
      const civTechs = new Set<string>();
      const techs = civ.technologies;
      if (Array.isArray(techs)) {
        for (const t of techs) civTechs.add(String(t));
      } else if (techs && typeof (techs as Iterable<string>)[Symbol.iterator] === 'function') {
        for (const t of techs as Iterable<string>) civTechs.add(String(t));
      }
      const CORE_BUILDINGS = ['granary', 'temple', 'marketplace'];
      const missingCore = CORE_BUILDINGS.find((b) => {
        if (existingBuildings.has(b) || plannedTypes.includes(b)) return false;
        // A building the auditor just sold must not be rebuilt instantly —
        // that ping-pong (build → sell → build) is what the audit exists for.
        if (buildingOnRebuyCooldown(this.gameEngine, city.civilizationId, b)) return false;
        const props = BUILDING_PROPS[b] || BUILDING_PROPERTIES[b];
        if (!props) return false;
        if (props.requiredTechnology && !civTechs.has(props.requiredTechnology)) return false;
        return true;
      });
      if (missingCore) {
        const bProps = BUILDING_PROPS[missingCore] || BUILDING_PROPERTIES[missingCore];
        if (bProps) {
          debugLog(`[AutoProduction] Minimum infrastructure: building ${missingCore} (city lacks core building)`);
          return {
            type: 'building',
            itemType: missingCore,
            name: bProps.name,
            cost: bProps.cost
          };
        }
      }
    }

    // 2b. Coastal infrastructure: a city FOUNDED ON THE WATER with no direct
    //     threat builds its Harbor early. The Harbor is the city's gateway to
    //     the sea (naval units and the Fisher Boat) and is cheap (30 shields);
    //     without it a coastal AI city can never build a fleet. A city under
    //     direct threat already built defenders above; a small isolated island
    //     promotes its Harbor even earlier (step 1c).
    if (!threatAssessment?.needsDefense) {
      const harbor = this.buildHarborProduction(city);
      if (harbor) {
        debugLog('[AutoProduction] Coastal city with no threat — building a Harbor');
        return harbor;
      }
    }

    // 3. Settler expansion FIRST (right after defense) so the civ actually
    //    grows. Previously buildings (and the happiness-emergency path) ran
    //    before this branch, so a civ with 1 city queued colosseum/
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
    const allCivCities = this.gameEngine.cities.filter(
      (c: City) => c.civilizationId === city.civilizationId,
    );
    const desiredSettlers = isSmallMap
      ? Math.min(2, expansion.maxSettlers)
      : Math.min(
          expansion.maxSettlers,
          Math.max(expansion.minSettlers, Math.ceil(civCities.length / expansion.settlersPerCities)) +
            (civCities.length < 3 && expansion.earlyBonus ? 1 : 0),
        );
    // Late-game public works: while the civ still has improvements left on its
    // worked tiles (AIManager's era budget), keep a small works corps on top of
    // the expansion quota. Those settlers walk to worked tiles and build roads,
    // irrigation and railroads — the empire's lasting income/growth investment
    // once the settlement spots run out. Without this the settler branch
    // stopped the moment the expansion count was met, so a mature empire never
    // paved or irrigated anything.
    // Standard behaviour whenever the city is not under imminent threat: a
    // threat-free city keeps the corps even mid-war (the threat branch above
    // already preempts production when a defender is actually needed).
    // A public-works corps is paid for either because the civ-wide improvement
    // budget still has room, or — the size-6 mandate — because a city has
    // reached the size where its fields must be irrigated and paved. A city
    // under direct threat drops the corps: settlers are targets there.
    const aiMgr = this.gameEngine.aiManager;
    const worksBudget = typeof aiMgr?.wantsPublicWorks === 'function'
      && aiMgr.wantsPublicWorks(city.civilizationId);
    const worksMandate = typeof aiMgr?.hasSettlerWorksMandate === 'function'
      && aiMgr.hasSettlerWorksMandate(city.civilizationId);
    // Build-out is a third, budget-free reason to keep a works corps: a city
    // whose area is still raw needs roads and irrigation more than the empire
    // needs a ninth city.
    const buildOut = typeof aiMgr?.citiesNeedBuildOut === 'function'
      && aiMgr.citiesNeedBuildOut(city.civilizationId);
    const wantsWorks = (worksBudget || worksMandate || buildOut)
      && !threatAssessment?.needsDefense;
    const allCivSettlers = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId === city.civilizationId && u.type === 'settler' && !u.isDefeated,
    ).length;
    const isAiControlled = this.gameEngine.civilizations?.[city.civilizationId]?.isAI === true;
    // The governor reports how many settlers are STILL NEEDED (a delta), not a
    // total: it answers "recommended − already alive". Using that number as an
    // absolute cap made the target 0 whenever one settler was already alive —
    // the normal state from turn 1 — so AI civs stopped expanding almost
    // immediately (4 cities founded instead of 9) and the sim starved. Convert
    // it to a total by adding the settlers that exist.
    const governorRecommended = isAiControlled
      ? this.settlerGovernor.getRecommendedSettlerCount(allCivCities, this.gameEngine.units)
        + allCivSettlers
      : desiredSettlers + (wantsWorks ? 2 : 0);
    const settlerTarget = Math.min(
      desiredSettlers + (wantsWorks ? 2 : 0),
      Math.max(0, governorRecommended),
    );
    // Economics before the army: a civ that has climbed back to the minimum
    // reserve but still cannot net a positive gold gets a settler even though
    // `canAffordAnotherUnit` says no, and gives up the army for now. See
    // `economyBeforeArmy`.
    const economyFirst = this.economyBeforeArmy(city, wantsWorks);
    // A city that cannot feed itself must not train settlers (they eat food
    // and consume a citizen). The AI city governor re-assigns workers to food
    // tiles in the same turn; this guard is the production-side half of the
    // famine equation.
    const foodBalance = this.cityFoodBalance(city, civ);
    const starving = !!foodBalance && foodBalance.surplus < 0;
    if (starving) {
      debugLog('[AutoProduction] City is losing food — settlers paused until it recovers');
    }

    // Prevent City from getting disolved by new Settler produced
    const isAiCity = this.gameEngine.civilizations?.[city.civilizationId]?.isAI === true;
    const wouldConsumeCity = (city.population ?? 1) <= 1;
    const hasSettlerInCiv = this.gameEngine.units.some(
      (u: Unit) => u.civilizationId === city.civilizationId && u.type === 'settler' && !u.isDefeated,
    );
    const isCapitalMove = allCivCities.length <= 1 && !hasSettlerInCiv;
    const refusesSelfDestruct = isAiCity && wouldConsumeCity && !isCapitalMove;

    // Settlers still cost 1 gold/turn upkeep even though they eat food from
    // the city, so a civ with no headroom cannot afford one — the economy
    // disbands it on arrival. Gate on the same affordability the disband rule
    // uses (see canAffordAnotherUnit); a healthier civ expands normally.
    // Deliberately NOT gated on unitCapExhausted: the army-sustainability
    // reserve is stricter than solvency and would freeze expansion on a
    // young civ that can still pay its next unit.
    const canAffordSettler = this.canAffordAnotherUnit(city.civilizationId) || economyFirst;
    if (!needsHappiness && canAffordSettler && city.population >= 1 && !starving && !refusesSelfDestruct) {
      const gold = this.gameEngine.civilizations?.[city.civilizationId]?.resources?.gold ?? 0;
      const upkeep = this.gameEngine.economicManager?.totalUpkeep?.(city.civilizationId) ?? 0;
      const goldCrisis = gold < -upkeep;

      // Count queued settlers across ALL cities so the cap is enforced
      // globally — without this, three cities each queueing a settler all
      // pass the per-city check and the civ overshoots the cap.
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
      // otherwise the full desired count (expansion + works corps).
      const effectiveDesired = goldCrisis ? expansion.minSettlers : settlerTarget;

      if (settlerCount < effectiveDesired) {
        debugLog(`[AutoProduction] Civilization has ${settlerCount} settler(s) (unit list + queued across all cities), building another (target ${settlerTarget}, profile ${strategy}, works ${wantsWorks})`);
        return {
          type: 'unit',
          itemType: 'settler',
          name: UNIT_PROPS.settler?.name || 'Settler',
          cost: UNIT_PROPS.settler?.cost || 40
        };
      }
    }

    // 3b. Long-term food plan: an expansionist civ keeps a Granary in its
    //     growing cities so settler production and population growth stay
    //     steady (the growth box is half-refilled on growth). Ranked after
    //     settlers so expansion itself is never blocked, before generic
    //     buildings.
    const foodPlan = this.gameEngine.aiCityManager?.foodSecurityBuilding?.(city, civ, strategy);
    if (foodPlan) {
      const planProps = BUILDING_PROPS[foodPlan] || BUILDING_PROPERTIES[foodPlan];
      if (planProps && !plannedTypes.includes(foodPlan)) {
        debugLog(`[AutoProduction] Long-term food plan: building ${foodPlan}`);
        return {
          type: 'building',
          itemType: foodPlan,
          name: planProps.name,
          cost: planProps.cost,
        };
      }
    }

    // 4. Evaluate buildings via AIBuildingStrategy
    const gameState = this.buildGameState(city.civilizationId);
    gameState.isUnderThreat = !!threatAssessment?.needsDefense;
    gameState.cityCoastal = this.cityHasWaterAccess(city);
    const buildingPlans = civ
      ? AIBuildingStrategy.evaluateBuildings(city, civ, strategy, gameState)
      : [];
    // Never queue the same building twice.
    const availableBuildingPlans = (civ
      ? this.coordinatedBuildingPlans(city, civ, buildingPlans)
      : buildingPlans
    ).filter(
      (p: BuildingPlan) =>
        !plannedTypes.includes(p.buildingType) &&
        !buildingOnRebuyCooldown(this.gameEngine, city.civilizationId, p.buildingType)
    );

    // (The happiness emergency now runs before the defender check above — a
    //  crisis city gets its temple instead of yet another defender, so it is
    //  not stuck at 70% luxury / 0 science for the whole game.)
    const buildingPlan = availableBuildingPlans.length > 0 ? availableBuildingPlans[0] : null;
    const numMilitary = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId === city.civilizationId && this.isOffensiveUnitType(u.type)
    ).length;

    const aggressivePosture = this.isAggressivePosture(city.civilizationId);

    // 4-pre-0. Strategic arsenal: once the civ CAN build a warhead and has a
    //          reason to fire one, a single turn in N is spent on it instead
    //          of another soldier. Deliberately NOT gated on the army cap:
    //          the cap exists so the treasury can feed a standing force, and
    //          one warhead (5 gold/turn) is a strategic asset rather than
    //          another pair of boots. Only a treasury already in deficit
    //          holds back — see `shouldBuildNuclear`.
    if (this.shouldBuildNuclear(city)) {
      const warhead = this.buildNuclearProduction(city);
      if (warhead) {
        debugLog('[AutoProduction] Strategic arsenal — building a nuclear weapon');
        return warhead;
      }
    }

    // 4-pre. A war we cannot walk to is a war we have to sail to, so the hulls
    //        come before the soldiers. The aggressive branch below would
    //        otherwise keep pumping attackers forever while the invasion
    //        mission waited for a ferry that was never ordered — the "declared
    //        the war across the ocean and did nothing about it" failure.
    //        `buildNavalProduction` returns null once the doctrine is
    //        satisfied, so a civ that already has its fleet falls through to
    //        normal wartime production as before.
    if (this.needsNavyForWar(city.civilizationId) && this.shouldBuildNavy(city)) {
      const navalForWar = this.buildNavalProduction(city);
      if (navalForWar) {
        debugLog('[AutoProduction] War across water — building a navy before more soldiers');
        return navalForWar;
      }
    }

    if (!unitCapExhausted && aggressivePosture &&
        (this.isCivAtWar(city.civilizationId) || this.shouldSupportOffensivePlan(city))) {
      debugLog('[AutoProduction] Aggressive posture: prioritizing attacker over buildings');
      return this.buildOffensiveProduction(city);
    }

    // 4b. Naval pivot: when every known enemy sits on another landmass, land
    //     conquest is impossible. A coastal civ with naval tech starts
    //     building ships (it must be able to project power across water). A
    //     civ that cannot build ships yet keeps its land build-up — the
    //     unreachable targets are excluded until shipbuilding is possible.
    if (this.shouldBuildNavy(city)) {
      const naval = this.buildNavalProduction(city);
      if (naval) {
        debugLog(`[AutoProduction] Naval pivot: building ${naval.itemType} (no land-reachable enemy)`);
        return naval;
      }
    }

    // Check if building is high-priority enough to build over a unit
    if (buildingPlan && AIBuildingStrategy.shouldBuildOverUnit(
      buildingPlan, hasDefender, !!threatAssessment?.needsDefense, numMilitary, civCities.length
    )) {
      const bProps = BUILDING_PROPS[buildingPlan.buildingType] || BUILDING_PROPERTIES[buildingPlan.buildingType];
      if (bProps) {
        debugLog(`[AutoProduction] Building strategy chose: ${buildingPlan.buildingType} (priority: ${buildingPlan.priority}, reason: ${buildingPlan.reason})`);
        return {
          type: 'building',
          itemType: buildingPlan.buildingType,
          name: bProps.name,
          cost: bProps.cost
        };
      }
    }

    // 5. Support offensive plan (never over the sustainable unit cap)
    if (!unitCapExhausted && this.shouldSupportOffensivePlan(city)) {
      debugLog('[AutoProduction] Supporting offensive plan with new attacker');
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
      debugLog(`[AutoProduction] Building scout for map exploration (${this.countTotalTroops(city.civilizationId)} troops)`);
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
    if (!unitCapExhausted && !economyFirst && aggressivePosture && this.countOffensiveUnits(city.civilizationId) < AGGRESSIVE_ARMY_MIN) {
      debugLog('[AutoProduction] Aggressive posture: building standing army (attacker)');
      return this.buildOffensiveProduction(city);
    }

    // 5c. Caravan for trade routes (Civ I): a city with fewer than 3 trade
    //     routes is missing permanent commerce, so fill the route capacity
    //     before generic buildings. The AI unit movement delivers the caravan
    //     to the best-value destination (foreign at peace = double payout).
    //     Defense/settlers/happiness emergencies above still take precedence.
    if (civ && this.shouldBuildCaravan(civ, city, plannedTypes)) {
      const caravanProps = UNIT_PROPS.caravan;
      if (caravanProps) {
        debugLog(`[AutoProduction] Building caravan for trade route (profile ${strategy})`);
        return {
          type: 'unit',
          itemType: 'caravan',
          name: caravanProps.name,
          cost: caravanProps.cost
        };
      }
    }

    // 5b. Build the building even if not "high-priority"
    if (buildingPlan) {
      const bProps = BUILDING_PROPS[buildingPlan.buildingType] || BUILDING_PROPERTIES[buildingPlan.buildingType];
      if (bProps) {
        debugLog(`[AutoProduction] Building: ${buildingPlan.buildingType} (reason: ${buildingPlan.reason})`);
        return {
          type: 'building',
          itemType: buildingPlan.buildingType,
          name: bProps.name,
          cost: bProps.cost
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
          debugLog(`[AutoProduction] Wonder strategy chose: ${wonderPlan.buildingType} (priority: ${wonderPlan.priority})`);
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
        debugLog(`[AutoProduction] Building diplomat for diplomacy (profile ${strategy})`);
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
    // Over the sustainable unit cap, or busy fixing the economy first: keep the
    // city productive with a building instead of growing an army the treasury
    // cannot pay for. In the second case the city produces nothing at all if no
    // building is available — that is the point. A settler is already queued for
    // the works, and a rifleman produced here would be disbanded next turn.
    if (unitCapExhausted || economyFirst) {
      const fallback = this.determineFallbackBuilding(city, threatAssessment, plannedTypes);
      if (fallback) {
        debugLog(unitCapExhausted
          ? '[AutoProduction] Unit cap reached — building instead of another unit'
          : '[AutoProduction] Economy first — building instead of another military unit');
        return fallback;
      }
      if (economyFirst) return null;
    }

    // Composition balance: never let the garrison grow past ~2 per city while
    // the offense lags — the AI-vs-AI logs showed endless phalanx/archer
    // queues. Defenders are still prioritized under threat.
    const defenderCapReached = defenders >= civCities.length * 2;
    const needsAttackers = offensiveUnits < defenders
      || this.shouldSupportOffensivePlan(city)
      || (defenderCapReached && !threatAssessment?.needsDefense);

    debugLog(`[AutoProduction] Building default military unit (offense: ${offensiveUnits}, defense: ${defenders})`);
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
  /**
   * Apply the civ-level building policy to a city's candidate list.
   *
   * `AIBuildingStrategy` answers "would this city like this building?" and has
   * no notion of how many the empire already owns — which is how one city ends
   * up holding six Marketplaces and a Temple per citizen, each a fresh exciting
   * purchase and each worth nothing. This is the coordination layer on top:
   *
   *  - a type the city (or the empire) has no room for is dropped outright;
   *  - a type another own city has fewer of is demoted, so empires level their
   *    cities up rather than stacking one;
   *  - a building that measurably pays nothing *here* is demoted hard rather
   *    than deleted, so it can still be built when a city genuinely has nothing
   *    better to do. Most of the building table's declared effects — production,
   *    culture, health, growthBonus, corruptionReduction, unitProduction — are
   *    not read by the engine at all, and this is what stops the AI paying 200
   *    shields and 3 gold a turn for a Factory that does nothing.
   */
  private coordinatedBuildingPlans(
    city: City,
    civ: Civilization,
    plans: BuildingPlan[],
  ): BuildingPlan[] {
    const scored: Array<{ plan: BuildingPlan; priority: number; why: string }> = [];
    for (const plan of plans) {
      const spread = coordinationWeight(this.gameEngine, civ, city, plan.buildingType);
      if (spread.weight <= 0) {
        debugLog(`[AutoProduction] ${city.name}: skipping ${plan.buildingType} — ${spread.reason}`);
        continue;
      }
      const { civCopies, cityCopies } = countBuildingCopies(
        this.gameEngine, civ, city, plan.buildingType,
      );
      const value = evaluateBuildingForCity(
        this.gameEngine, civ, city, plan.buildingType, civCopies, cityCopies,
      );
      // A wall's value is not in the city's output, so the measurement must not
      // be allowed to vote on it — see DEFENCE_BUILDINGS.
      const demote = !DEFENCE_BUILDINGS.has(plan.buildingType) && !value.worthBuilding;
      const factor = demote ? 0.2 * spread.weight : spread.weight;
      const why = spread.reason ? `${value.reason}; ${spread.reason}` : value.reason;
      scored.push({ plan, priority: plan.priority * factor, why });
    }
    scored.sort((a, b) => b.priority - a.priority);
    for (const entry of scored) {
      debugLog(
        `[AutoProduction] ${city.name}: ${entry.plan.buildingType} priority `
        + `${entry.plan.priority.toFixed(1)} → ${entry.priority.toFixed(1)} (${entry.why})`,
      );
    }
    return scored.map(entry => entry.plan);
  }

  /**
   * The UNIT to queue when the follow-up queue is already building-heavy —
   * the counterpart of `determineFallbackBuilding`.
   *
   * This method was called from two places in `ensureProductionQueue` but
   * never existed, so every call threw (`TypeError: this.determineFallbackUnit
   * is not a function`, swallowed by the surrounding try/catch) and the AI
   * never queued a single follow-up item: a city finished whatever it was
   * building and then sat with an empty queue until the next auto-production
   * pass. That silently starved the whole production ladder.
   */
  private determineFallbackUnit(
    city: City,
    threatAssessment?: CityThreatAssessment | null,
    plannedTypes: string[] = [],
  ): ProductionItem | null {
    const civ = this.gameEngine.civilizations?.[city.civilizationId];
    if (!civ) return null;
    if (this.isUnitCapExhausted(city.civilizationId)) return null;
    if (!this.canAffordAnotherUnit(city.civilizationId)) return null;

    const item = threatAssessment?.needsDefense
      ? this.buildDefenderProduction(city, threatAssessment)
      : this.buildOffensiveProduction(city);
    const itemType = item?.itemType || item?.type;
    if (!itemType) return null;
    // Never queue the same unit twice in a row — that is how a city ends up
    // with six archers and nothing else in its build queue.
    if (plannedTypes.includes(itemType)) return null;
    return item;
  }

  private determineFallbackBuilding(
    city: City,
    threatAssessment?: CityThreatAssessment | null,
    plannedTypes: string[] = [],
  ): ProductionItem | null {
    const civ = this.gameEngine.civilizations?.[city.civilizationId];
    if (!civ) return null;
    const gameState = this.buildGameState(city.civilizationId);
    gameState.isUnderThreat = !!threatAssessment?.needsDefense;
    gameState.cityCoastal = this.cityHasWaterAccess(city);
    const strategy: StrategyProfile = this.getStrategyForCiv(city.civilizationId);

    const buildingPlans = AIBuildingStrategy.evaluateBuildings(city, civ, strategy, gameState);
    const available = this.coordinatedBuildingPlans(city, civ, buildingPlans).filter(
      (p: BuildingPlan) =>
        !plannedTypes.includes(p.buildingType) &&
        !buildingOnRebuyCooldown(this.gameEngine, city.civilizationId, p.buildingType)
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

  /**
   * The city's real food balance (shared math with the growth pipeline).
   * Returns null on lightweight test engines without an EconomicManager.
   */
  private cityFoodBalance(city: City, civ: Civilization | undefined) {
    const econ = this.gameEngine.economicManager;
    if (typeof econ?.cityFoodBalance !== 'function') return null;
    try {
      return econ.cityFoodBalance(city, civ);
    } catch {
      return null;
    }
  }

  /** Famine warning: negative net food and the city is about to lose a citizen. */
  private isFoodEmergency(city: City, civ: Civilization | undefined): boolean {
    return this.gameEngine.aiCityManager?.isFoodEmergency?.(city, civ) ?? false;
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
      debugLog('[AutoProduction] Threat level', threatAssessment.netThreat.toFixed(2), '-> producing', unitProps.name);
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
    // `GameEngine.isCivAtWar` reads the diplomacy manager (the old
    // `civ.warWith` was never written for live civs); the fallback keeps
    // partial test doubles working.
    if (typeof this.gameEngine.isCivAtWar === 'function') {
      return this.gameEngine.isCivAtWar(civilizationId);
    }
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
      debugLog(`[AutoProduction] Reconsidered aggressive queue for ${city.name}: ${original.length} → ${offensiveQueue.length} peaceful follow-ups removed`);
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

  /**
   * Whether the civilization should build another scout to reach its target.
   * Counts scouts queued in EVERY city (two cities queueing one each used to
   * overshoot the corps target) and enforces an absolute cap so the civ never
   * fields more than `AI_ABSOLUTE_MAX_SCOUTS` scouts.
   */
  private needsScout(civilizationId: number, plannedScouts: number = 0): boolean {
    const aliveScouts = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId === civilizationId && u.type === 'scout' && !u.isDefeated,
    ).length;
    const queuedScouts = this.gameEngine.cities
      .filter((c: City) => c.civilizationId === civilizationId)
      .reduce((count: number, c: City) => {
        const inProgress = c.currentProduction?.type === 'unit'
          && c.currentProduction?.itemType === 'scout' ? 1 : 0;
        const inQueue = Array.isArray(c.buildQueue)
          ? c.buildQueue.filter((q: QueueItem) =>
              q.type === 'unit' && (q.itemType === 'scout' || q.name?.toLowerCase() === 'scout')).length
          : 0;
        return count + inProgress + inQueue;
      }, 0);
    const scoutCount = aliveScouts + queuedScouts + plannedScouts;
    if (scoutCount >= AI_ABSOLUTE_MAX_SCOUTS) return false;
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
    // Same solvency gate as every other unit: a caravan produced into a
    // deficit is disbanded before it can deliver (a profiled run built 651
    // and disbanded 639 within ~5 rounds).
    if (!this.canAffordAnotherUnit(civ.id)) return false;

    // At least one city has room for more trade routes (max 3 per city).
    const civCities = this.gameEngine.cities.filter(
      (c: City) => c.civilizationId === civ.id,
    );
    const hasRoom = civCities.some(
      (c: City) => (c.tradeRoutes?.length ?? 0) < MAX_CARAVAN_TRADE_ROUTES,
    );
    if (!hasRoom) return false;

    // Keep a steady stream of in-flight Caravans, enough to fill the route
    // capacity (3 per city). The old `ceil(cities / 2)` cap throttled trade to
    // a trickle: a profiled 1,000-round game delivered ZERO routes. War does
    // not block the building — the deliverer prefers domestic cities in war
    // and switches to foreign (double-value) routes at peace.
    const caravanCount = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId === civ.id && u.type === 'caravan',
    ).length + plannedTypes.filter((t: string) => t === 'caravan').length;
    const maxCaravans = Math.max(2, civCities.length);
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

  /**
   * True when the civ is at war with somebody whose cities it cannot walk to.
   *
   * This is the one case where a navy is a WAR requirement rather than an
   * optional projection of power, and it must therefore outrank "keep pumping
   * attackers". Deliberately reads the real map rather than remembered enemy
   * sightings: the declaration was already made against a concrete target, and
   * waiting for a scout to rediscover it would stall the war for dozens of
   * rounds.
   */
  private needsNavyForWar(civilizationId: number): boolean {
    const dm = this.gameEngine.diplomacyManager;
    const raw = dm?.getEnemies?.(civilizationId);
    if (!raw || raw.length === 0) return false;
    const enemies = new Set(raw.map(Number));
    const land = this.gameEngine.areLandConnected;
    if (typeof land !== 'function') return false;

    const ownCities = this.gameEngine.cities.filter((c: City) => c.civilizationId === civilizationId);
    if (ownCities.length === 0) return false;
    const enemyCities = this.gameEngine.cities.filter((c: City) => enemies.has(c.civilizationId));
    if (enemyCities.length === 0) return false;

    return enemyCities.some(
      (ec) => !ownCities.some((oc) => land.call(this.gameEngine, oc.col, oc.row, ec.col, ec.row)),
    );
  }

  /**
   * Whether this city should start a nuclear warhead.
   *
   * The AI only gets to "use nukes if available" if it first builds one, so
   * this is the production half of that requirement. The gates are deliberately
   * few: the tech, a reason to fire (at war, or an aggressive posture that is
   * about to find one), stock still below what the era wants, and a treasury
   * that is not already under its reserve.
   */
  private shouldBuildNuclear(city: City): boolean {
    const civ = this.gameEngine.civilizations?.[city.civilizationId];
    if (!civ) return false;
    if (!canBuildUnit(civ, 'nuclear')) return false;
    if (!this.isCivAtWar(city.civilizationId) && !this.isAggressivePosture(city.civilizationId)) {
      return false;
    }
    // Only a civ actually in deficit holds back. `isUnderEconomicPressure`
    // (below the reserve target) is the WRONG gate here: with a real army the
    // reserve is `upkeep × 2–3`, which a wartime civ is under almost every
    // turn — a 634-round naval test game reached 2085 AD with 31 techs and
    // still never built a single warhead. A warhead costs shields to build and
    // 5 gold/turn to keep; only a negative treasury makes that unaffordable.
    if ((civ.resources?.gold ?? 0) < 0) return false;
    return this.nuclearStock(civ.id) < this.desiredNuclearStock();
  }

  /** Warheads owned plus warheads already sitting in some city's queue. */
  private nuclearStock(civId: number): number {
    const owned = this.gameEngine.units.filter(
      (u) => u.civilizationId === civId && u.type === 'nuclear' && !u.isDefeated,
    ).length;
    let queued = 0;
    for (const c of this.gameEngine.cities) {
      if (c.civilizationId !== civId) continue;
      if (c.currentProduction?.type === 'unit' && c.currentProduction.itemType === 'nuclear') {
        queued++;
      }
      for (const item of c.buildQueue ?? []) {
        if (item.type === 'unit' && item.itemType === 'nuclear') queued++;
      }
    }
    return owned + queued;
  }

  /** One warhead is enough while the game is young; the endgame wants two. */
  private desiredNuclearStock(): number {
    return (this.gameEngine.currentYear ?? -4000) >= 1500 ? 2 : 1;
  }

  private buildNuclearProduction(city: City): ProductionItem | null {
    const civ = this.gameEngine.civilizations?.[city.civilizationId];
    if (!civ || !canBuildUnit(civ, 'nuclear')) return null;
    const props = UNIT_PROPS['nuclear'];
    if (!props) return null;
    return { type: 'unit', itemType: 'nuclear', name: props.name, cost: props.cost };
  }

  /**
   * Naval pivot condition: the civ knows enemies, none of them is reachable
   * over land, it can actually build ships (coastal city + naval tech) and its
   * navy is still below the desired size. The engine tracks which enemy
   * locations share a landmass with one of our cities.
   */
  private shouldBuildNavy(city: City): boolean {
    const civ = this.gameEngine.civilizations?.[city.civilizationId];
    if (!civ) return false;
    // Guard the new engine helpers: lightweight test doubles do not implement
    // them, and the pre-lake behavior is "no navy".
    const canBuildShips = typeof this.gameEngine.civCanBuildShips === 'function'
      && this.gameEngine.civCanBuildShips(city.civilizationId);
    if (!canBuildShips) return false;
    const pm = this.gameEngine.productionManager as { cityHasHarborOrCoast?: (c: City) => boolean } | undefined;
    if (typeof pm?.cityHasHarborOrCoast !== 'function' || !pm.cityHasHarborOrCoast(city)) return false;

    // A civ boxed in on a rock, or facing an enemy it cannot walk to, needs a
    // fleet to function at all. That overrides the economy gate, because
    // "we cannot pay for warships" must never stop us building the transports
    // that let us leave.
    const needsNavy = typeof this.gameEngine.civNeedsNavy === 'function'
      && this.gameEngine.civNeedsNavy(city.civilizationId);
    if (needsNavy) return true;

    // Otherwise the doctrine decides, from economy + threat. The old rule was
    // `navalUnits < max(2, cities)`, which counted fisher boats as warships and
    // ignored both the treasury and the enemy fleet.
    const decision = this.navalDoctrineFor(city.civilizationId);
    return decision?.choice != null;
  }

  /**
   * Economy-aware unit cap: the civ can only maintain as many units as its
   * income supports (reserve-aware model when available, EconomicManager as
   * the floor). When the cap is exhausted the AI must stop PRODUCING military
   * units too — not just stop queueing follow-ups — or the army grows until
   * the treasury starves and units are disbanded for upkeep.
   */
  private isUnitCapExhausted(civilizationId: number): boolean {
    const civ = this.gameEngine?.civilizations?.[civilizationId];
    const econ = this.gameEngine?.economicManager;
    if (!civ || !econ) return false;
    const civCities = this.gameEngine.cities.filter(
      (c: City) => c.civilizationId === civilizationId,
    );
    const cityCount = civCities.length;
    const currentUnits = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId === civilizationId && !u.isDefeated,
    ).length;
    const queuedUnits = civCities.reduce((n: number, c: City) => {
      const inQueue = Array.isArray(c.buildQueue)
        ? c.buildQueue.filter((q: QueueItem) => (q.type ?? q.itemType) === 'unit').length
        : 0;
      const inProgress = c.currentProduction?.type === 'unit' ? 1 : 0;
      return n + inQueue + inProgress;
    }, 0);
    // Take the MOST CONSERVATIVE credible cap, not the most optimistic one.
    // `Math.max` of every source let the 100%-tax projection win over the AI's
    // own figure (which already subtracts building upkeep and keeps a reserve),
    // which is how the AI built a bigger army than it could maintain and then
    // disbanded it again, round after round (92 upkeep disbands in one
    // 587-round AI-vs-AI log).
    const aiSustainableUnits = this.gameEngine.aiEconomicManager?.sustainableUnits?.(civ);
    const econSustainableUnits = typeof econ.sustainableUnits === 'function'
      ? econ.sustainableUnits(civ)
      : null;
    // When BOTH models answer, the SMALLER figure is the credible one — the
    // AI's optimistic tax projection must not override the engine's own
    // upkeep math. Fall back to whichever source exists; lightweight test
    // doubles implement neither, so the free one-unit-per-city support then
    // applies and the cap never blocks them.
    let sustainableUnits = cityCount;
    if (aiSustainableUnits != null && econSustainableUnits != null) {
      sustainableUnits = Math.min(aiSustainableUnits, econSustainableUnits);
    } else if (aiSustainableUnits != null) {
      sustainableUnits = Math.max(cityCount, aiSustainableUnits);
    } else if (econSustainableUnits != null) {
      sustainableUnits = Math.max(cityCount, econSustainableUnits);
    }
    return currentUnits + queuedUnits >= sustainableUnits;
  }

  /**
   * Whether the civ can pay one more unit's upkeep this turn. GROWTH units
   * (settlers/scouts/fisher boats) are deliberately exempt from the army
   * sustainability cap, so without this a civ sitting at net 0 produced them
   * anyway and the economy disbanded each one the turn it arrived — one
   * profiled naval run built 155 settlers and disbanded all 155. Requiring
   * at least the 1-gold upkeep as headroom before starting one ends the loop.
   */
  /**
   * Whether this civ must put its economy right before it adds to its army.
   *
   * `ABSOLUTE_MIN_GOLD` is the level a treasury is reset to when a civ is
   * forced to disband, so a civ sitting on it has money but no income. Its
   * problem is not that it needs more soldiers — it is that every soldier costs
   * upkeep it cannot earn, and the economy produces a surplus of exactly zero
   * units per turn, which is why a profiled run once built 2,301 riflemen and
   * disbanded 2,302 of them.
   *
   * The settler is the one production that breaks that spiral: it is paid in
   * shields rather than gold, and the road it lays is permanent +trade. So once
   * the civ has climbed back to the reserve, still has roads/irrigation waiting,
   * and still cannot net a positive gold, economics outranks the army. As soon
   * as those roads pay, {@link canAffordAnotherUnit} turns true and the army
   * resumes — economics first, then soldiers.
   *
   * Deliberately narrow. A civ that can already pay for a unit is never held
   * back, and a civ below the reserve has no money to fund the settler with.
   */
  private economyBeforeArmy(city: City, wantsWorks: boolean): boolean {
    if (!wantsWorks) return false;
    const civId = city.civilizationId;
    const gold = this.gameEngine.civilizations?.[civId]?.resources?.gold ?? 0;
    const reserve = this.gameEngine.economicManager?.AI_MIN_GOLD_RESERVE ?? ABSOLUTE_MIN_GOLD;
    if (gold < reserve) return false;
    return !this.canAffordAnotherUnit(civId);
  }

  private canAffordAnotherUnit(civId: number): boolean {
    const econ = this.gameEngine?.economicManager;
    const civ = this.gameEngine?.civilizations?.[civId];
    if (!econ || !civ || typeof econ.previewEconomy !== 'function') return true;
    const preview = econ.previewEconomy(civ, {
      tax: civ.taxRate ?? 50,
      science: civ.scienceRate ?? 50,
      luxury: civ.luxuryRate ?? 50,
    });
    if (!preview) return true;
    return preview.net >= 1;
  }

  /** Safe coastal check used to gate the Harbor building (unknown → allow). */
  private cityHasWaterAccess(city: City): boolean {
    const pm = this.gameEngine.productionManager as { cityHasHarborOrCoast?: (c: City) => boolean } | undefined;
    if (typeof pm?.cityHasHarborOrCoast !== 'function') return true;
    return pm.cityHasHarborOrCoast(city);
  }

  /** Safe island-situation lookup (lightweight test engines return null). */
  private getIslandSituation(civilizationId: number): {
    size: number;
    isSmall: boolean;
    isVerySmall: boolean;
    isAlone: boolean;
  } | null {
    if (civilizationId === BARBARIAN_CIV_ID) return null;
    if (typeof this.gameEngine.getIslandSituation !== 'function') return null;
    try {
      return this.gameEngine.getIslandSituation(civilizationId);
    } catch {
      return null;
    }
  }

  /**
   * Escape ship for a civ trapped on a very small island. A Ferry is built
   * first when the civ owns none (it can carry a settler to a new island),
   * otherwise the strongest available warship.
   */
  private buildEscapeShipProduction(city: City): ProductionItem | null {
    const pm = this.gameEngine.productionManager as { cityHasHarborOrCoast?: (c: City) => boolean } | undefined;
    if (typeof pm?.cityHasHarborOrCoast !== 'function' || !pm.cityHasHarborOrCoast(city)) return null;
    const civ = this.gameEngine.civilizations?.[city.civilizationId];
    if (!civ) return null;

    const ownsFerry = this.gameEngine.units.some(
      (u: Unit) => u.civilizationId === city.civilizationId && u.type === 'ferry' && !u.isDefeated,
    );
    if (!ownsFerry && canBuildUnit(civ, 'ferry')) {
      const props = UNIT_PROPS.ferry;
      if (props) {
        return { type: 'unit', itemType: 'ferry', name: props.name, cost: props.cost };
      }
    }
    return this.buildNavalProduction(city);
  }

  /**
   * Ferry for an active colony mission that has no hull yet. The mission is
   * created by the AI when it has seen a small city-free island and owns a
   * settler that can reach the coast.
   */
  /**
   * A ferry for an active invasion mission that has no hull yet. The mission is
   * planned by AIManager (an enemy city on a landmass we cannot walk to); all
   * this does is make sure a hull is actually on the way.
   */
  private buildInvasionFerryProduction(city: City): ProductionItem | null {
    const civ = this.gameEngine.civilizations?.[city.civilizationId];
    if (!civ) return null;
    const storage = this.gameEngine.getPlayerStorage?.(civ.id);
    const mission = storage?.turnData?.invasionMission as { ferryId?: string | null } | undefined;
    if (!mission || mission.ferryId) return null;
    const ownsFerry = this.gameEngine.units.some(
      (u: Unit) => u.civilizationId === civ.id && u.type === 'ferry' && !u.isDefeated,
    );
    if (ownsFerry) return null; // a hull exists; the AI will assign it
    const pm = this.gameEngine.productionManager as { cityHasHarborOrCoast?: (c: City) => boolean } | undefined;
    if (typeof pm?.cityHasHarborOrCoast !== 'function' || !pm.cityHasHarborOrCoast(city)) return null;
    if (!canBuildUnit(civ, 'ferry')) return null;
    const props = UNIT_PROPS.ferry;
    if (!props) return null;
    return { type: 'unit', itemType: 'ferry', name: props.name, cost: props.cost };
  }

  private buildColonyFerryProduction(city: City): ProductionItem | null {
    const civ = this.gameEngine.civilizations?.[city.civilizationId];
    if (!civ) return null;
    const storage = this.gameEngine.getPlayerStorage?.(civ.id);
    const mission = storage?.turnData?.colonyMission as { ferryId?: string | null } | undefined;
    if (!mission || mission.ferryId) return null;
    const ownsFerry = this.gameEngine.units.some(
      (u: Unit) => u.civilizationId === civ.id && u.type === 'ferry' && !u.isDefeated,
    );
    if (ownsFerry) return null;
    const pm = this.gameEngine.productionManager as { cityHasHarborOrCoast?: (c: City) => boolean } | undefined;
    if (typeof pm?.cityHasHarborOrCoast !== 'function' || !pm.cityHasHarborOrCoast(city)) return null;
    if (!canBuildUnit(civ, 'ferry')) return null;
    const props = UNIT_PROPS.ferry;
    if (!props) return null;
    return { type: 'unit', itemType: 'ferry', name: props.name, cost: props.cost };
  }

  /** Whether the city owns a specific building (string or object form). */
  private cityOwnsBuilding(city: City, buildingId: string): boolean {
    return (city.buildings ?? []).some((b: unknown) => {
      const id = typeof b === 'string'
        ? b
        : ((b as { id?: string })?.id ?? (b as { type?: string })?.type ?? '');
      return String(id) === buildingId;
    });
  }

  /**
   * Fisher Boat for a harbor city with a known fish tile and food pressure.
   *
   * The decision is the FisherEconomics equation, not a hunch: over one full
   * cycle the boat delivers `FISHER_BOAT_STORAGE * fisherFoodPerFish(d)` food
   * and the deployed net adds +1 food/turn to the tile when the city can work
   * it. Priced in gold-equivalents against the boat's upkeep and amortised
   * build cost, a close ground the city works pays for the boat, while a
   * distant ground only pays when the richer catch covers the longer round
   * trip. `bestFishingGround` picks the best ground by that equation.
   *
   * One boat per city — ProductionManager enforces the cap centrally.
   */
  private buildFisherBoatProduction(city: City): ProductionItem | null {
    const civ = this.gameEngine.civilizations?.[city.civilizationId];
    if (!civ) return null;
    // The Fisher Boat requires the Harbor BUILDING, not just a coast.
    if (!this.cityOwnsBuilding(city, 'harbor')) return null;
    if (!canBuildUnit(civ, 'fisher_boat')) return null;

    // One per city: alive at sea or already under construction.
    const hasFisher = this.gameEngine.units.some(
      (u: Unit) => u.civilizationId === civ.id && u.type === 'fisher_boat'
        && u.homeCityId === city.id && !u.isDefeated,
    );
    const queuedFisher = String(city.currentProduction?.itemType ?? '') === 'fisher_boat'
      || (city.buildQueue ?? []).some(
        (q: QueueItem) => String(q?.itemType ?? q?.type ?? '') === 'fisher_boat',
      );
    if (hasFisher || queuedFisher) return null;

    // Only worth it when the city actually needs more food.
    const balance = this.cityFoodBalance(city, civ);
    if (!balance || balance.surplus >= 2) return null;

    // Does any known ground beat the boat's upkeep? Pick the best by net value.
    const ground = bestFishingGround(this.gameEngine, city);
    if (!ground) return null;
    if (!ground.worthwhile) {
      debugLog(
        `[AutoProduction] Fisher Boat skipped — best ground (${ground.col},${ground.row}) is ` +
          `${ground.distance} tiles out: ${ground.foodPerTurn.toFixed(2)} food/turn ` +
          `(net ${ground.netValuePerTurn.toFixed(2)} gold/turn)`,
      );
      return null;
    }

    const props = UNIT_PROPS.fisher_boat;
    if (!props) return null;
    debugLog(
      `[AutoProduction] Fisher Boat — ground (${ground.col},${ground.row}) d=${ground.distance}, ` +
        `${ground.foodPerTurn.toFixed(2)} food/turn, +${ground.netValuePerTurn.toFixed(2)} gold/turn`,
    );
    return { type: 'unit', itemType: 'fisher_boat', name: props.name, cost: props.cost };
  }

  /** Harbor for a civ isolated on a small island (coastal cities only). */
  private buildHarborProduction(city: City): ProductionItem | null {
    const existing = new Set(city.buildings ?? []);
    if (existing.has('harbor')) return null;
    const pm = this.gameEngine.productionManager as {
      cityHasHarborOrCoast?: (c: City) => boolean;
      getBuildableBuildingTypes?: (id: string) => string[];
    } | undefined;
    if (typeof pm?.cityHasHarborOrCoast !== 'function' || !pm.cityHasHarborOrCoast(city)) return null;
    const buildable = typeof pm.getBuildableBuildingTypes === 'function'
      ? pm.getBuildableBuildingTypes(city.id)
      : [];
    if (!buildable.includes('harbor')) return null;
    const props = BUILDING_PROPS.harbor || BUILDING_PROPERTIES.harbor;
    if (!props) return null;
    return { type: 'building', itemType: 'harbor', name: props.name, cost: props.cost };
  }

  /**
   * The most useful naval unit the civ can actually build, decided by the
   * doctrine equation in `AI/NavalDoctrine` rather than a hardcoded
   * strongest-first list.
   *
   * Transports come first while the civ still needs hulls to move troops — a
   * fleet of warships can neither settle an island nor invade anybody, so it
   * just sits there. Once the transports are covered, warships are bought up to
   * what the treasury can sustain, weighted by how much pressure the enemy
   * fleet, their coastal cities and threats to our own coast put us under.
   * Returns null when the doctrine is satisfied or the economy cannot carry a
   * hull, so the caller falls through to land production.
   */
  private buildNavalProduction(city: City): ProductionItem | null {
    const decision = this.navalDoctrineFor(city.civilizationId);
    if (!decision) return null;
    const { bestAvailableShip, cheapestAvailableShip, ownTransports, ownWarships } = decision;

    const wanted = ownTransports < decision.wantTransports
      ? cheapestAvailableShip
      : ownWarships < decision.wantWarships
        ? bestAvailableShip
        : null;
    if (!wanted) return null;
    const props = UNIT_PROPS[wanted.type];
    if (!props) return null;
    debugLog(
      `[AutoProduction] Naval doctrine: ${wanted.type} (${decision.reason}; `
      + `budget ${decision.budget.toFixed(1)}, pressure ${decision.pressure.toFixed(1)})`,
    );
    return { type: 'unit', itemType: wanted.type, name: props.name, cost: props.cost };
  }

  /**
   * Gather everything the doctrine equation needs for a civ and run it.
   *
   * Degrades rather than giving up: if the engine helpers the inputs need are
   * missing (lightweight test doubles, or a partially built engine) it falls
   * back to assuming there is somewhere worth sailing to whenever the civ owns
   * troops, so a naval civ still gets a hull instead of silently falling
   * through to land production.
   */
  private navalDoctrineFor(civId: number): NavalDoctrineVerdict | null {
    const civ = this.gameEngine.civilizations?.[civId];
    if (!civ) return null;
    const engine = this.gameEngine as {
      getColonizableIslands?: (id: number) => unknown[];
      hasSeaInvasionTarget?: (id: number) => boolean;
      isCivAtWar?: (id: number) => boolean;
      tileHasNavalAccess?: (c: number, r: number) => boolean;
    };
    const hasIslandProbe = typeof engine.getColonizableIslands === 'function';

    // Cheap, always-fresh counts. They are part of the doctrine input AND the
    // cache key, so a repeated query inside one turn's production pass skips
    // the expensive probes below (island scan, per-city threat, economy).
    const isTransport = (u: Unit): boolean => (UNIT_PROPS[u.type]?.transportCapacity ?? 0) > 0;
    // A hull is only a warship if it can actually fight. Fisher boats are naval
    // and carry nothing, so counting them as escorts let a civ's whole fishing
    // fleet satisfy the warship quota — it stopped buying escorts precisely when
    // it started moving troops by sea, and read enemy fishermen as a war fleet
    // it had to answer with hulls.
    const isWarship = (u: Unit): boolean => isWarshipHull(UNIT_PROPS[u.type]);
    const ownNaval = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId === civId && !u.isDefeated && UNIT_PROPS[u.type]?.naval === true,
    );
    const ownTransports = ownNaval.filter(isTransport).length;
    const ownWarships = ownNaval.filter(isWarship).length;
    const enemyNaval = this.gameEngine.units.filter(
      (u: Unit) => u.civilizationId !== civId && !u.isDefeated && UNIT_PROPS[u.type]?.naval === true,
    );
    const ownCities = this.gameEngine.cities.filter((c: City) => c.civilizationId === civId);
    const strategy = this.getStrategyForCiv(civId);
    // Technologies are a Set on the engine and an array on some test doubles.
    const techCount = civ.technologies instanceof Set
      ? civ.technologies.size
      : (civ.technologies?.length ?? 0);

    const cacheKey = [
      this.gameEngine.roundManager?.getRoundNumber?.() ?? 0,
      strategy,
      civ.resources?.gold ?? 0,
      techCount,
      this.gameEngine.units.length,
      this.gameEngine.cities.length,
      ownNaval.length,
      enemyNaval.length,
      ownCities.length,
    ].join('|');
    const cached = this.navalDoctrineCache.get(civId);
    if (cached && cached.key === cacheKey) return cached.verdict;

    // Which hulls the tech actually allows. `transportCapacity > 0` marks a
    // transport; everything else with real attack power is a warship.
    const available: AvailableShip[] = [];
    for (const type of NAVAL_BUILD_ORDER) {
      const props = UNIT_PROPS[type];
      if (!props?.naval) continue;
      if (!canBuildUnit(civ, type)) continue;
      available.push({
        type,
        cost: props.cost,
        maintenance: props.maintenance ?? 1,
        attack: props.attack,
        defense: props.defense,
        transportCapacity: props.transportCapacity ?? 0,
      });
    }
    const transports = available.filter((s) => s.transportCapacity > 0);
    const warships = available.filter((s) => s.transportCapacity === 0 && s.attack > 0.5);
    const cheapest = transports[0] ?? available[0] ?? null;
    const strongest = [...warships].sort((a, b) => b.attack - a.attack)[0] ?? cheapest;

    const econ = this.gameEngine.economicManager as {
      maxTaxIncome?: (c: unknown) => number;
      totalUpkeep?: (id: number) => number;
    } | undefined;
    // "We cannot afford a warship" and "we have no idea what the economy is
    // doing" are different answers. With no EconomicManager there is no
    // economic information at all, so the budget is left permissive and the
    // doctrine expresses intent rather than declaring bankruptcy. A real engine
    // always has one, and then a collapsing treasury really does mean no hulls.
    const hasEconomy = typeof econ?.maxTaxIncome === 'function'
      && typeof econ?.totalUpkeep === 'function';
    const income = hasEconomy ? econ!.maxTaxIncome!(civ) : 0;
    const upkeep = hasEconomy ? econ!.totalUpkeep!(civId) : 0;
    // The AI's own reserve policy, in turns of upkeep it wants kept spare.
    const reserveTurns = AI_RESERVE_TURNS[strategy]
      ?? AI_RESERVE_TURNS.balanced_growth;
    const reserve = hasEconomy ? Math.max(8, upkeep * reserveTurns) : 0;

    const enemies = new Set<number>(
      (this.gameEngine.diplomacyManager?.getEnemies?.(civId) ?? []).map(Number),
    );
    const hasNavalAccess = typeof engine.tileHasNavalAccess === 'function'
      ? engine.tileHasNavalAccess.bind(this.gameEngine)
      : () => false;
    const ownCoastal = ownCities.filter((c: City) => hasNavalAccess(c.col, c.row));
    // A threatened city inland is a land problem; only coastal exposure is a
    // reason to buy a warship, so cap the signal at what the coast can offer.
    const threatCount = this.gameEngine.aiManager?.countThreatenedCities?.(civId) ?? 0;
    const threatenedCoastal = Math.min(threatCount, ownCoastal.length);

    // Enemy cities on a landmass we cannot walk to. AIManager is the only
    // place that knows which landmasses have a beach the invasion mission can
    // actually use; the engine-level probe is kept first so lightweight test
    // doubles can still answer it themselves.
    const ai = this.gameEngine.aiManager as
      | { hasSeaInvasionTarget?: (id: number) => boolean }
      | undefined;
    const seaInvasionTargets = (typeof engine.hasSeaInvasionTarget === 'function'
      ? engine.hasSeaInvasionTarget(civId)
      : typeof ai?.hasSeaInvasionTarget === 'function' && ai.hasSeaInvasionTarget(civId))
      ? 1
      : 0;

    const input: NavalDoctrineInput = {
      // No economic data at all means no treasury reading either; the
      // permissive budget above is what carries the decision in that case.
      treasury: hasEconomy ? civ.resources?.gold ?? 0 : 0,
      incomePerTurn: income,
      upkeepPerTurn: upkeep,
      reservePerTurn: reserve,
      ownTransports,
      ownWarships,
      ownCities: ownCities.length,
      ownCoastalCities: ownCoastal.length,
      threatenedOwnCoastalCities: threatenedCoastal,
      // Without the probe we cannot know about islands, so assume a naval civ
      // with troops has somewhere to sail: that reproduces the pre-doctrine
      // "build a transport first" behaviour instead of building nothing.
      colonisableIslands: hasIslandProbe
        ? engine.getColonizableIslands(civId)?.length ?? 0
        : (this.gameEngine.units.some((u: Unit) => u.civilizationId === civId
          && !u.isDefeated && !u.embarkedOn && (u.attack ?? 0) > 0.5) ? 1 : 0),
      seaInvasionTargets: seaInvasionTargets ? 1 : 0,
      troopsAvailable: this.gameEngine.units.some(
        (u: Unit) => u.civilizationId === civId && !u.isDefeated
          && !u.embarkedOn && (u.attack ?? 0) > 0.5 && !UNIT_PROPS[u.type]?.naval,
      ),
      atWar: enemies.size > 0
        || (typeof engine.isCivAtWar === 'function' && engine.isCivAtWar(civId)),
      enemyTransports: enemyNaval.filter(isTransport).length,
      enemyWarships: enemyNaval.filter(isWarship).length,
      enemyCoastalCities: this.gameEngine.cities.filter(
        (c: City) => c.civilizationId !== civId
          && enemies.has(c.civilizationId)
          && hasNavalAccess(c.col, c.row),
      ).length,
      bestAvailableShip: strongest,
      cheapestAvailableShip: cheapest,
    };
    const verdict = { ...input, ...navalDoctrine(input), ownTransports, ownWarships };
    this.navalDoctrineCache.set(civId, { key: cacheKey, verdict });
    return verdict;
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
    /** Wonders nobody may start any more (obsolescence tech discovered). */
    obsoleteWonders: string[];
    /**
     * True when the civ's garrison duty is fully satisfied right now: every
     * city has a guard on its tile AND the standing army is at least as big
     * as the city count. Wonders are planned only then — diverting shields
     * into a 300-shield project while a city stands open is how an empire
     * loses cities it already has.
     */
    garrisonOk: boolean;
    cityCoastal: boolean;
    economyPressure: boolean;
    /** Gold/turn this civ already pays to keep its buildings. */
    buildingUpkeep: number;
    /** How much building upkeep it can afford at its current income. */
    buildingUpkeepBudget: number;
  } {
    const cities = this.gameEngine.cities?.filter((c: City) => c.civilizationId === civilizationId) || [];
    const civ = this.gameEngine.civilizations?.[civilizationId];
    const econ = this.gameEngine.economicManager;
    // Upkeep pressure: the treasury is under the reserve the AI's own policy
    // wants. Handed to AIBuildingStrategy so income buildings get built when
    // the money actually runs out, not only when the calendar says so.
    const economyPressure =
      !!civ
      && typeof this.gameEngine.aiEconomicManager?.isUnderEconomicPressure === 'function'
      && this.gameEngine.aiEconomicManager.isUnderEconomicPressure(civ);
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

    // Obsolete wonders: some civ discovered the tech that kills their effect —
    // nobody (AI included) should sink shields into them any more.
    const obsoleteWonders = WONDERS
      .filter((w) => this.gameEngine.wonderManager?.isObsolete(w.id))
      .map((w) => w.id);

    // Garrison duty first, wonders second: only plan a wonder in PEACE and
    // only while every city already has its guard, with at least one spare
    // soldier above the city count — shields go to defenders until then.
    const armySize = this.gameEngine.units?.filter(
      (u: Unit) => u.civilizationId === civilizationId && (UNIT_PROPS[u.type]?.attack || 0) > 0 && !u.isDefeated,
    ).length ?? 0;
    const garrisonOk = !!civ
      && cities.length > 0
      && !this.isCivAtWar(civilizationId)
      && armySize >= cities.length + 1
      && cities.every((c) => (econ?.garrisonOnCityTile?.(civ, c) ?? 0) >= 1);

    return {
      currentYear: this.gameEngine.currentYear ?? -4000,
      roundNumber: this.gameEngine.roundManager?.getRoundNumber?.() ?? 0,
      numCities: cities.length,
      totalPopulation: cities.reduce((sum: number, c: City) => sum + (c.population || 1), 0),
      numMilitaryUnits: this.gameEngine.units?.filter(
        (u: Unit) => u.civilizationId === civilizationId && (UNIT_PROPS[u.type]?.attack || 0) > 0
      ).length ?? 0,
      isAtWar: this.isCivAtWar(civilizationId),
      knownEnemyCities,
      isBorderCity: false, // default, overridden per-city in determineProductionItem
      isUnderThreat: false,
      builtWonders,
      obsoleteWonders,
      garrisonOk,
      cityCoastal: false, // overridden per-city before evaluateBuildings
      economyPressure,
      buildingUpkeep: typeof econ?.buildingUpkeep === 'function'
        ? econ.buildingUpkeep(civilizationId)
        : 0,
      buildingUpkeepBudget: Math.max(
        BUILDING_UPKEEP_BUDGET_FLOOR,
        Math.round((typeof econ?.projectedIncome === 'function' && civ
          ? econ.projectedIncome(civ)
          : 0) * BUILDING_UPKEEP_INCOME_RATIO),
      ),
    };
  }

  /**
   * Process auto-production for all cities belonging to a civilization
   */
  processAutoProductionForCivilization(civilizationId: number): void {
    try {
      debugLog('[AutoProduction] Processing auto-production for civilization', civilizationId);
      
      const civCities = this.gameEngine.cities.filter((c: City) => c.civilizationId === civilizationId);
      const civ = this.gameEngine.civilizations?.[civilizationId];
      const strategy = this.getStrategyForCiv(civilizationId);
      
      for (const city of civCities) {
        // The CITY GOVERNOR runs for every city, independent of its Auto
        // Production switch (Auto decides what a city BUILDS, the governor
        // who WORKS there): contentment, then the mandatory food-security
        // pass, then the mode's surplus/specialist policy. Production
        // decisions below see the updated yields.
        if (civ) {
          this.gameEngine.aiCityManager?.manageCity(city, civ, strategy);
        }

        // Building automation only applies to cities that asked for it.
        if (city.autoProduction) {
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
   * Process auto-production for all AI civilizations
   */
  processAutoProductionForAI(): void {
    try {
      debugLog('[AutoProduction] Processing auto-production for all AI');
      
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
    // Recomputed every iteration: each successful rush actually debits the
    // treasury, and a stale `available` would happily spend the same gold
    // three times over.
    //
    // Next turn's upkeep is part of the reserve. Without it a flush treasury
    // could be rushed down to `reserve + 15`, which is comfortably above zero
    // today and negative the moment upkeep is charged — and a negative treasury
    // means the upkeep disbander starts eating the army (≈12 abandoned units
    // per 300-round test game before this line existed).
    const upkeep = typeof this.gameEngine.economicManager?.totalUpkeep === 'function'
      ? this.gameEngine.economicManager.totalUpkeep(civId)
      : 0;
    const spendable = () =>
      (civ.resources?.gold ?? 0) - minimumReserve - 15 - upkeep;
    if (spendable() <= 5) return; // Too little gold above reserve to spend

    // A treasury far above its reserve is money doing nothing. The old rule
    // only ever bought a build that was within 5 shields of finishing, so an
    // AI-vs-AI run reached year 5397 with one civ holding 10,827 gold while
    // its cities ticked through builds it could have bought outright. Past
    // ~25× the reserve, buy the builds (up to three a turn); while the war
    // chest is merely comfortable the conservative "nearly done" rule stands.
    const flush = gold >= minimumReserve * 25;
    const maxRushes = flush ? 3 : 1;

    const cities = this.gameEngine.cities.filter(
      (c: City) => c.civilizationId === civId && c.autoProduction,
    );

    let rushed = 0;
    for (const city of cities) {
      if (rushed >= maxRushes) break;
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

      // Rush when: (a) under immediate threat and building a defender, or
      // (b) gold is abundant and the build is nearly done, or
      // (c) the treasury is so far above its reserve that sitting on it is
      //     the more expensive choice.
      const goldIsAbundant = gold >= minimumReserve * 3;
      const nearlyDone = remaining <= 5;
      const shouldRush = isUrgentDefender || (goldIsAbundant && nearlyDone) || flush;

      if (!shouldRush) continue;
      if (rushGold > spendable()) continue; // Can't afford it

      debugLog(`[AutoProduction] ${city.name}: rushing ${city.currentProduction.itemType} for ${rushGold} gold (${remaining} shields remaining, ${isUrgentDefender ? 'threat' : flush ? 'flush treasury' : 'abundant gold'})`);
      if (this.gameEngine.rushCityProduction(city.id)) rushed++;
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
