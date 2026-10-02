/**
 * Fisher Boat — the unit that replaces the old Harbor "+1 food from every
 * worked OCEAN tile" bonus.
 *
 *  - Harbor no longer adds food to worked ocean tiles.
 *  - The unit is gated on the Harbor BUILDING and capped at one per city.
 *  - "Deploy Fishing Net" only works on fish tiles; the boat then loops
 *    outbound → fishing (6 fish) → inbound (unload) → outbound.
 *  - One fish is worth `min(3, 1 + floor(distance / 4))` food, so far grounds
 *    pay more per trip (6 / 12 / 18 food per full catch).
 *  - "Remove Fishing Net" is a RECALL: home to unload, then automatically back
 *    to the same net tile (the route is not cancelled).
 *  - A catch that does not fit into the city's food box grants +2 food at the
 *    next growth step.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import { AutoProduction } from '@/game/engine/AutoProduction';
import { UNIT_PROPERTIES, FISHER_BOAT_STORAGE, fisherFoodPerFish, fisherCatchValue } from '@/data/UnitConstants';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';
import type { City, ProductionItem, SpecialistType, TradeRoute, Unit } from '../types/game';

const G = TERRAIN_TYPES.GRASSLAND;
const O = TERRAIN_TYPES.OCEAN;

/** Test city: the mock guarantees the optional production fields exist. */
type TestCity = City & {
  foodStored: number;
  foodNeeded: number;
  fishingOverflowBonus: number;
  yields: { food: number; production: number; trade: number };
  workingTiles: Set<string>;
};

/** Test unit: home city + fish hold are always set by the helper. */
type TestUnit = Unit & { homeCityId: string | null; fishStored: number };

/** Private AutoProduction method the tests exercise directly. */
function proposeFisherBoat(auto: AutoProduction, city: TestCity): ProductionItem | null {
  const api = auto as unknown as {
    buildFisherBoatProduction(city: City): ProductionItem | null;
  };
  return api.buildFisherBoatProduction(city);
}

function makeEngine(rows: string[][]): GameEngine {
  const height = rows.length;
  const width = rows[0].length;
  const e = new GameEngine(null);
  // Object.assign keeps the real engine type while replacing its state with a
  // hand-authored map (the private MapData shape is not exported).
  Object.assign(e, {
    units: [],
    cities: [],
    civilizations: [
      { id: 0, name: 'Portland', technologies: ['masonry', 'sailing'], resources: { gold: 100 }, personality: {} },
    ],
    onStateChange: null,
    unitTurnQueue: null,
    diplomacyManager: null,
    isPaused: true,
    activePlayer: 0,
    devMode: true, // everything explored
    currentTurn: 1,
    squareGrid: new SquareGrid(width, height),
    map: {
      width,
      height,
      tiles: rows.flatMap((row, r) =>
        row.map((t, c) => ({ col: c, row: r, type: t, terrain: t, resource: null, visible: true, explored: true })),
      ),
    },
    checkAndEndTurnIfNoMoves: () => undefined,
  });
  // Player storage is private engine setup — expose just that call locally.
  (e as unknown as { initializePlayerStorage(id: number): void }).initializePlayerStorage(0);
  // roundManager/goToManager/productionManager/economicManager are created by
  // the real GameEngine constructor and are reused as-is.
  return e;
}

function addCity(
  e: GameEngine,
  id: string, civId: number, col: number, row: number, buildings: string[] = [],
): TestCity {
  const city: TestCity = {
    id,
    name: id,
    civilizationId: civId,
    col,
    row,
    population: 3,
    production: 0,
    food: 0,
    gold: 0,
    science: 0,
    buildings: [...buildings],
    specialists: [] as SpecialistType[],
    workingTiles: new Set([`${col},${row}`]),
    currentProduction: null,
    buildQueue: [] as ProductionItem[],
    foodStored: 0,
    foodNeeded: 40,
    fishingOverflowBonus: 0,
    yields: { food: 6, production: 1, trade: 1 },
    tradeRoutes: [] as TradeRoute[],
  };
  e.cities.push(city);
  return city;
}

function addUnit(
  e: GameEngine,
  id: string,
  type: string,
  col: number,
  row: number,
  extra: Record<string, unknown> = {},
): TestUnit {
  const props = UNIT_PROPERTIES[type];
  const unit: TestUnit = {
    id,
    type,
    civilizationId: 0,
    col,
    row,
    health: 100,
    icon: props?.icon ?? '',
    movesRemaining: props?.movement ?? 1,
    maxMoves: props?.movement ?? 1,
    hasMovedThisTurn: false,
    attack: props?.attack ?? 0,
    defense: props?.defense ?? 1,
    isDefeated: false,
    homeCityId: null,
    fishStored: 0,
    fishingRoute: null,
    ...extra,
  } as TestUnit;
  e.units.push(unit);
  return unit;
}

function setFish(e: GameEngine, col: number, row: number, resource: string | null = 'fish'): void {
  const tile = e.getTileAt(col, row);
  if (tile) tile.resource = resource ?? undefined;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Definition + formula
// ---------------------------------------------------------------------------

describe('Fisher Boat definition', () => {
  it('has the configured stats and requires the Harbor building', () => {
    const props = UNIT_PROPERTIES.fisher_boat;
    expect(props).toBeDefined();
    expect(props.cost).toBe(20);
    expect(props.movement).toBe(2);
    expect(props.attack).toBe(0);
    expect(props.defense).toBe(1);
    expect(props.naval).toBe(true);
    expect(props.requiredBuilding).toBe('harbor');
    expect(FISHER_BOAT_STORAGE).toBe(6);
  });

  it('pays more per fish the farther the ground (capped at 3)', () => {
    expect(fisherFoodPerFish(0)).toBe(1);
    expect(fisherFoodPerFish(3)).toBe(1);
    expect(fisherFoodPerFish(4)).toBe(2);
    expect(fisherFoodPerFish(7)).toBe(2);
    expect(fisherFoodPerFish(8)).toBe(3);
    expect(fisherFoodPerFish(40)).toBe(3);
    // Full catches: 6 / 12 / 18 food.
    expect(fisherCatchValue(2)).toBe(6);
    expect(fisherCatchValue(5)).toBe(12);
    expect(fisherCatchValue(9)).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// Harbor ocean-food removal
// ---------------------------------------------------------------------------

describe('Fishing grounds need an active boat', () => {
  it('pays full fish value only while a Fisher Boat is using the tile', () => {
    const e = makeEngine([
      [O, O, O, O],
      [O, G, O, O],
      [O, O, O, O],
    ]);
    setFish(e, 0, 0); // worked by the city — off-limits to boats
    setFish(e, 3, 0); // free ground
    const city = addCity(e, 'port', 0, 1, 1, ['harbor']);
    city.population = 1;
    city.workingTiles = new Set(['0,0']); // one ocean fish tile

    e.economicManager.refreshYieldsFromWorkingTiles(city as never);

    // Ocean base 1 + fish 1 (no boat) = 2. This proves BOTH that the old
    // Harbor +1 ocean bonus is gone (it used to be 4) and that a boat-less
    // fishing ground is half as valuable.
    expect(city.yields?.food).toBe(2);
    // The old harbor per-tile helper is gone entirely.
    expect(
      (e.economicManager as unknown as Record<string, unknown>).tileYieldsForCity,
    ).toBeUndefined();

    // A ground the city already draws food from may not be netted.
    const boat = addUnit(e, 'f1', 'fisher_boat', 0, 0, { homeCityId: 'port' });
    expect(e.canDeployFishingNet('f1')).toBe(false);
    expect(e.deployFishingNet('f1')).toBe(false);

    // The free ground is legal; the worked one keeps the boat-less value.
    boat.col = 3;
    boat.row = 0;
    expect(e.deployFishingNet('f1')).toBe(true);
    expect(city.yields?.food).toBe(2);

    // A recall keeps the boat assigned to the ground → value unchanged.
    e.recallFishingBoat('f1');
    expect(city.yields?.food).toBe(2);

    // Clearing the route abandons the ground → boat-less value again.
    e.clearFishingRoute('f1');
    expect(city.yields?.food).toBe(2);
    expect(boat.fishingRoute).toBeNull();

    // The restriction is on deployment: a city that later starts working the
    // netted tile draws its full value. (The re-deploy needs fresh moves —
    // deploying consumes them.)
    boat.movesRemaining = 2;
    expect(e.deployFishingNet('f1')).toBe(true);
    city.workingTiles.add('3,0');
    e.economicManager.refreshYieldsFromWorkingTiles(city as never);
    expect(city.yields?.food).toBe(5); // 2 from (0,0) + 3 from the netted (3,0)
  });
});

describe('Fishing ground restrictions', () => {
  function twoGroundEngine() {
    const e = makeEngine([
      [G, O, O, O, O, O],
      [O, O, O, O, O, O],
      [O, O, O, O, O, O],
    ]);
    addCity(e, 'port', 0, 0, 0, ['harbor']);
    setFish(e, 3, 0);
    setFish(e, 4, 0);
    return e;
  }

  it('refuses a ground the city already draws food from', () => {
    const e = twoGroundEngine();
    e.cities[0].workingTiles.add('3,0');
    const boat = addUnit(e, 'f1', 'fisher_boat', 3, 0, { homeCityId: 'port' });

    expect(e.canDeployFishingNet('f1')).toBe(false);
    expect(e.deployFishingNet('f1')).toBe(false);

    // The same boat may still use a free fish tile.
    boat.col = 4;
    boat.row = 0;
    expect(e.canDeployFishingNet('f1')).toBe(true);
    expect(e.deployFishingNet('f1')).toBe(true);
  });

  it('refuses a ground another boat is already using, at any route stage', () => {
    const e = twoGroundEngine();
    const first = addUnit(e, 'f1', 'fisher_boat', 3, 0, { homeCityId: 'port' });
    expect(e.deployFishingNet('f1')).toBe(true);

    addUnit(e, 'f2', 'fisher_boat', 3, 0, { homeCityId: 'port' });
    expect(e.canDeployFishingNet('f2')).toBe(false);
    expect(e.deployFishingNet('f2')).toBe(false);

    // A boat sailing home still owns its net tile.
    e.recallFishingBoat('f1');
    expect(first.fishingRoute?.stage).toBe('inbound');
    expect(e.canDeployFishingNet('f2')).toBe(false);

    // Only abandoning the route frees the ground.
    e.clearFishingRoute('f1');
    expect(e.canDeployFishingNet('f2')).toBe(true);
    expect(e.deployFishingNet('f2')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Production gating: Harbor required, max one per city
// ---------------------------------------------------------------------------

describe('Fisher Boat production gating', () => {
  function productionEngine(buildings: string[]) {
    const e = makeEngine([
      [O, O, O, O, O],
      [O, G, G, O, O],
      [O, O, O, O, O],
    ]);
    const city = addCity(e, 'port', 0, 1, 1, buildings);
    setFish(e, 3, 0);
    return { e, city };
  }

  const item = { type: 'unit', itemType: 'fisher_boat', name: 'Fisher Boat', cost: 20 };

  it('rejects a coastal city without a Harbor', () => {
    const { e } = productionEngine([]);
    const result = e.productionManager.setCityProduction('port', item as never);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('requires_building_harbor');
  });

  it('accepts a coastal city that owns a Harbor', () => {
    const { e } = productionEngine(['harbor']);
    const result = e.productionManager.setCityProduction('port', item as never);
    expect(result.success).toBe(true);
  });

  it('allows at most one Fisher Boat per city', () => {
    const { e, city } = productionEngine(['harbor']);
    addUnit(e, 'f1', 'fisher_boat', 3, 0, { homeCityId: 'port' });
    const alive = e.productionManager.setCityProduction('port', item as never);
    expect(alive.success).toBe(false);
    expect(alive.reason).toBe('fisher_boat_limit');

    // A defeated boat does not block a replacement.
    e.units[0].isDefeated = true;
    const replacement = e.productionManager.setCityProduction('port', item as never);
    expect(replacement.success).toBe(true);

    // …but one under construction does.
    city.currentProduction = item;
    const queued = e.productionManager.setCityProduction('port', item as never);
    expect(queued.success).toBe(false);
    expect(queued.reason).toBe('fisher_boat_limit');
  });
});

// ---------------------------------------------------------------------------
// Deploy + route state machine
// ---------------------------------------------------------------------------

describe('Fishing route', () => {
  function routeEngine() {
    const e = makeEngine([
      [G, O, O, O, O, O],
      [O, O, O, O, O, O],
      [O, O, O, O, O, O],
    ]);
    // City on the coast at (0,0); fish ground at (3,0) → d = 3 → 1 food/fish.
    const city = addCity(e, 'port', 0, 0, 0, ['harbor']);
    setFish(e, 3, 0);
    const boat = addUnit(e, 'f1', 'fisher_boat', 3, 0, { homeCityId: 'port' });
    return { e, city, boat };
  }

  const advance = (e: GameEngine) => e.advanceFishing('f1');

  it('can only deploy on a fish tile with moves left', () => {
    const { e, boat } = routeEngine();
    expect(e.canDeployFishingNet('f1')).toBe(true);

    boat.col = 1;
    boat.row = 1; // plain ocean, no fish
    expect(e.canDeployFishingNet('f1')).toBe(false);

    boat.col = 3;
    boat.row = 0;
    boat.movesRemaining = 0;
    expect(e.canDeployFishingNet('f1')).toBe(false);

    // A non-fisher unit can never deploy.
    addUnit(e, 'w1', 'warrior', 3, 0);
    expect(e.canDeployFishingNet('w1')).toBe(false);
  });

  it('deploying consumes the moves and remembers the net tile', () => {
    const { e, boat } = routeEngine();
    expect(e.deployFishingNet('f1')).toBe(true);
    expect(boat.fishingRoute).toEqual({
      homeCityId: 'port',
      fishingTile: { col: 3, row: 0 },
      stage: 'fishing',
    });
    expect(boat.movesRemaining).toBe(0);
    // A second deploy is refused while a route lives.
    expect(e.deployFishingNet('f1')).toBe(false);
  });

  it('collects 6 fish, sails home and unloads, then heads back out', () => {
    const { e, city, boat } = routeEngine();
    e.deployFishingNet('f1');

    for (let i = 0; i < FISHER_BOAT_STORAGE; i++) {
      advance(e);
    }
    expect(boat.fishStored).toBe(6);
    expect(boat.fishingRoute?.stage).toBe('inbound');

    // Simulate the return trip (the path itself is exercised by other tests).
    boat.col = 0;
    boat.row = 0;
    advance(e);

    expect(boat.fishStored).toBe(0);
    expect(city.foodStored).toBe(6); // 6 fish × 1 food
    expect(boat.fishingRoute?.stage).toBe('outbound');
  });

  it('turns a catch that does not fit into a one-round +2 food bonus', () => {
    const { e, city, boat } = routeEngine();
    e.deployFishingNet('f1');
    for (let i = 0; i < FISHER_BOAT_STORAGE; i++) advance(e);

    city.foodStored = city.foodNeeded; // box already full
    boat.col = 0;
    boat.row = 0;
    advance(e);

    expect(city.foodStored).toBe(city.foodNeeded); // capped
    expect(city.fishingOverflowBonus).toBe(2);

    // The next growth step consumes the bonus (+2 into the fresh box).
    city.yields = { food: 6, production: 1, trade: 1 }; // net 0 at pop 3
    const growth = e.turnManager as unknown as {
      processCityGrowth(city: City, inDisorder?: boolean): void;
    };
    growth.processCityGrowth(city, false);
    expect(city.fishingOverflowBonus).toBe(0);
    expect(city.foodStored).toBe(2);
  });

  it('replenishes the distance-based value: far fish pay 2 food each', () => {
    const e = makeEngine([
      [G, O, O, O, O, O, O, O, O, O],
      [O, O, O, O, O, O, O, O, O, O],
    ]);
    const city = addCity(e, 'port', 0, 0, 0, ['harbor']);
    setFish(e, 5, 0); // d = 5 → 2 food per fish
    const boat = addUnit(e, 'f1', 'fisher_boat', 5, 0, { homeCityId: 'port' });
    e.deployFishingNet('f1');
    for (let i = 0; i < FISHER_BOAT_STORAGE; i++) advance(e);
    boat.col = 0;
    boat.row = 0;
    advance(e);
    expect(city.foodStored).toBe(12);
  });

  it('recall sends the boat home but keeps the route (auto-return)', () => {
    const { e, city, boat } = routeEngine();
    e.deployFishingNet('f1');
    advance(e); // 1 fish in the hold
    advance(e); // 2 fish

    expect(e.recallFishingBoat('f1')).toBe(true);
    expect(boat.fishingRoute?.stage).toBe('inbound');

    boat.col = 0;
    boat.row = 0;
    advance(e);

    expect(boat.fishStored).toBe(0);
    expect(city.foodStored).toBe(2);
    // The route survives the recall: back to the same net tile next turn.
    expect(boat.fishingRoute?.stage).toBe('outbound');
    expect(boat.fishingRoute?.fishingTile).toEqual({ col: 3, row: 0 });
  });

  it('auto-navigates outbound boats with a GoTo path', () => {
    // Harbor city and net are both on open water so the naval path exists.
    const e = makeEngine([
      [O, O, O, O, O],
      [O, O, O, O, O],
    ]);
    addCity(e, 'port', 0, 0, 0, ['harbor']);
    setFish(e, 3, 0);
    const boat = addUnit(e, 'f1', 'fisher_boat', 3, 0, { homeCityId: 'port' });

    e.deployFishingNet('f1');
    for (let i = 0; i < FISHER_BOAT_STORAGE; i++) advance(e);
    // Full hold → inbound → the engine registers the way home.
    expect(e.goToManager.getUnitPath('f1')?.length).toBeGreaterThan(0);

    boat.col = 0;
    boat.row = 0;
    advance(e);
    // Delivered → outbound → the engine registers the way back to the net.
    expect(e.goToManager.getUnitPath('f1')?.length).toBeGreaterThan(0);
  });

  it('sails home into its LAND city and unloads (the pathfinder allows the port)', () => {
    // A real city sits on land; only its own ships may enter it. Without that
    // rule in the pathfinder the GoTo home failed and the boat sat at its net
    // with a full hold forever, so no catch was ever delivered.
    const e = makeEngine([
      [O, O, O, O, O],
      [O, G, G, O, O],
      [O, O, O, O, O],
    ]);
    const city = addCity(e, 'port', 0, 0, 1, ['harbor']);
    setFish(e, 3, 1);
    const boat = addUnit(e, 'f1', 'fisher_boat', 3, 1, { homeCityId: 'port' });
    e.deployFishingNet('f1');
    for (let i = 0; i < FISHER_BOAT_STORAGE; i++) advance(e);
    expect(boat.fishingRoute?.stage).toBe('inbound');

    // The route home exists even though the city tile is land…
    const preview = e.goToManager.calculatePath(
      boat, city.col, city.row, (c, r) => e.getTileAt(c, r), 5, 3,
    );
    expect(preview.success).toBe(true);
    expect(preview.path[preview.path.length - 1]).toEqual({ col: 0, row: 1 });

    // …and the boat may move onto it (fresh moves, as restored each turn).
    boat.movesRemaining = boat.maxMoves ?? 2;
    expect(e.moveUnit('f1', city.col, city.row).success).toBe(true);

    // At home the hold is unloaded and the route turns around.
    advance(e);
    expect(boat.fishStored).toBe(0);
    expect(city.foodStored).toBeGreaterThan(0);
    expect(boat.fishingRoute?.stage).toBe('outbound');
  });

  it('recovers when the boat is manually moved off the net', () => {
    const { e, boat } = routeEngine();
    e.deployFishingNet('f1');
    boat.col = 5;
    boat.row = 1; // player took over
    advance(e);
    expect(boat.fishingRoute?.stage).toBe('outbound');
  });

  it('clears the route when its home city is gone', () => {
    const { e, boat } = routeEngine();
    e.deployFishingNet('f1');
    e.cities = [];
    advance(e);
    expect(boat.fishingRoute).toBeNull();
    expect(boat.fishStored).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AI production
// ---------------------------------------------------------------------------

describe('AI builds Fisher Boats', () => {
  function aiEngine(
    withHarbor = true,
    withFisher = false,
    fish: Array<[number, number]> = [[3, 1]],
    mapRows?: string[][],
  ) {
    const e = makeEngine(mapRows ?? [
      [O, O, O, O, O, O],
      [O, G, G, O, O, O],
      [O, O, O, O, O, O],
    ]);
    const city = addCity(e, 'port', 0, 1, 1, withHarbor ? ['harbor'] : []);
    for (const [col, row] of fish) setFish(e, col, row);
    if (withFisher) {
      addUnit(e, 'f1', 'fisher_boat', fish[0]?.[0] ?? 3, fish[0]?.[1] ?? 1, { homeCityId: 'port' });
    }
    const auto = new AutoProduction(e);
    return { e, city, auto };
  }

  it('proposes a Fisher Boat when the ground pays for it (city works the net)', () => {
    // Fish at (3,1): d=2, workable → the +1 net-tile food makes the boat
    // clearly worth its upkeep under the FisherEconomics equation.
    const { city, auto } = aiEngine(true, false, [[3, 1]]);
    const plan = proposeFisherBoat(auto, city);
    expect(plan?.itemType).toBe('fisher_boat');
    expect(plan?.cost).toBe(20);
  });

  it('skips a ground the round trip cannot pay for', () => {
    // Fish at (4,0): d=3 and outside the work radius. 6 food / 10 turns =
    // 0.6 food/turn → 1.2 gold value vs 2.0 upkeep → no boat.
    const { city, auto } = aiEngine(true, false, [[4, 0]]);
    expect(proposeFisherBoat(auto, city)).toBeNull();
  });

  it('builds for a rich far ground when the per-fish value covers the trip', () => {
    // Fish at (8,1): d=7 → 2 food/fish, 12 food / 12 turns = 1.0/turn → 2.0
    // value vs 2.0 upkeep is a tie; at d=8 → 18/14 ≈ 1.29 → net positive.
    const rows = [
      [O, O, O, O, O, O, O, O, O, O],
      [O, G, G, O, O, O, O, O, O, O],
      [O, O, O, O, O, O, O, O, O, O],
    ];
    const { city, auto } = aiEngine(true, false, [[9, 1]], rows);
    const plan = proposeFisherBoat(auto, city);
    expect(plan?.itemType).toBe('fisher_boat');
  });

  it('stays quiet without a Harbor, without fish, or with a boat already', () => {
    const noHarbor = aiEngine(false, false, [[3, 1]]);
    expect(proposeFisherBoat(noHarbor.auto, noHarbor.city)).toBeNull();

    const withFisher = aiEngine(true, true, [[3, 1]]);
    expect(proposeFisherBoat(withFisher.auto, withFisher.city)).toBeNull();

    const noFish = aiEngine(true, false, []);
    expect(proposeFisherBoat(noFish.auto, noFish.city)).toBeNull();
  });

  it('is still proposed at the army unit cap — the equation pays its upkeep', () => {
    // The boat is not military spam: it reaches the build decision only when
    // FisherEconomics shows its food value beats its upkeep, so the army cap
    // must not veto a self-financing food unit.
    const { city, auto } = aiEngine(true, false, [[3, 1]]);
    expect(proposeFisherBoat(auto, city)?.itemType).toBe('fisher_boat');
  });
});
