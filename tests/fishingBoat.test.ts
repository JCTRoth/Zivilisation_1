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

const G = TERRAIN_TYPES.GRASSLAND;
const O = TERRAIN_TYPES.OCEAN;

function makeEngine(rows: string[][]) {
  const height = rows.length;
  const width = rows[0].length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = new GameEngine(null) as any;
  e.units = [];
  e.cities = [];
  e.civilizations = [
    { id: 0, name: 'Portland', technologies: ['masonry', 'sailing'], resources: { gold: 100 }, personality: {} },
  ];
  e.onStateChange = null;
  e.unitTurnQueue = null;
  e.diplomacyManager = null;
  e.isPaused = true;
  e.activePlayer = 0;
  e.devMode = true; // everything explored
  e.currentTurn = 1;
  e.squareGrid = new SquareGrid(width, height);
  e.map = {
    width,
    height,
    tiles: rows.flatMap((row, r) =>
      row.map((t, c) => ({ col: c, row: r, type: t, terrain: t, resource: null, visible: true, explored: true })),
    ),
  };
  e.checkAndEndTurnIfNoMoves = () => undefined;
  e.initializePlayerStorage(0);
  // roundManager/goToManager/productionManager/economicManager are created by
  // the real GameEngine constructor and are reused as-is.
  return e as GameEngine;
}

function addCity(
  e: GameEngine,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  id: string, civId: number, col: number, row: number, buildings: string[] = [],
) {
  const city = {
    id,
    name: id,
    civilizationId: civId,
    col,
    row,
    population: 3,
    buildings: [...buildings],
    specialists: [],
    workingTiles: new Set([`${col},${row}`]),
    currentProduction: null,
    buildQueue: [],
    foodStored: 0,
    foodNeeded: 40,
    fishingOverflowBonus: 0,
    yields: { food: 6, production: 1, trade: 1 },
    tradeRoutes: [],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (e as any).cities.push(city);
  return city;
}

function addUnit(
  e: GameEngine,
  id: string,
  type: string,
  col: number,
  row: number,
  extra: Record<string, unknown> = {},
) {
  const props = UNIT_PROPERTIES[type];
  const unit = {
    id,
    type,
    civilizationId: 0,
    col,
    row,
    health: 100,
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
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (e as any).units.push(unit);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return unit as any;
}

function setFish(e: GameEngine, col: number, row: number): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tile = (e as any).getTileAt(col, row);
  tile.resource = 'fish';
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
    setFish(e, 0, 0);
    const city = addCity(e, 'port', 0, 1, 1, ['harbor']);
    city.population = 1;
    city.workingTiles = new Set(['0,0']); // one ocean fish tile

    e.economicManager.refreshYieldsFromWorkingTiles(city as never);

    // Ocean base 1 + fish 1 (no boat) = 2. This proves BOTH that the old
    // Harbor +1 ocean bonus is gone (it used to be 4) and that a boat-less
    // fishing ground is half as valuable.
    expect(city.yields?.food).toBe(2);
    // The old harbor per-tile helper is gone entirely.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((e.economicManager as any).tileYieldsForCity).toBeUndefined();

    // Deploying a net restores the full fish value for the working city.
    const boat = addUnit(e, 'f1', 'fisher_boat', 0, 0, { homeCityId: 'port' });
    expect(e.deployFishingNet('f1')).toBe(true);
    expect(city.yields?.food).toBe(3);

    // A recall keeps the boat assigned to the ground → still full value.
    e.recallFishingBoat('f1');
    expect(city.yields?.food).toBe(3);

    // Clearing the route abandons the ground → boat-less value again.
    e.clearFishingRoute('f1');
    expect(city.yields?.food).toBe(2);
    expect(boat.fishingRoute).toBeNull();
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const advance = (e: GameEngine) => (e as any).advanceFishing('f1');

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e.turnManager as any).processCityGrowth(city, false);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).cities = [];
    advance(e);
    expect(boat.fishingRoute).toBeNull();
    expect(boat.fishStored).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AI production
// ---------------------------------------------------------------------------

describe('AI builds Fisher Boats', () => {
  function aiEngine(withHarbor = true, withFisher = false) {
    const e = makeEngine([
      [O, O, O, O, O, O],
      [O, G, G, O, O, O],
      [O, O, O, O, O, O],
    ]);
    const city = addCity(e, 'port', 0, 1, 1, withHarbor ? ['harbor'] : []);
    setFish(e, 4, 0);
    if (withFisher) {
      addUnit(e, 'f1', 'fisher_boat', 4, 0, { homeCityId: 'port' });
    }
    type Extra = { homeCityId: string | null };
    const auto = new AutoProduction(e);
    return { e, city, auto, _extra: undefined as Extra | undefined };
  }

  it('proposes a Fisher Boat in a harbor city short on food with known fish', () => {
    const { city, auto } = aiEngine(true, false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plan = (auto as any).buildFisherBoatProduction(city, false);
    expect(plan?.itemType).toBe('fisher_boat');
    expect(plan?.cost).toBe(20);
  });

  it('stays quiet without a Harbor, without fish, or with a boat already', () => {
    const noHarbor = aiEngine(false, false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((noHarbor.auto as any).buildFisherBoatProduction(noHarbor.city, false)).toBeNull();

    const withFisher = aiEngine(true, true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((withFisher.auto as any).buildFisherBoatProduction(withFisher.city, false)).toBeNull();

    const noFish = aiEngine(true, false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (noFish.e.getTileAt(4, 0) as any).resource = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((noFish.auto as any).buildFisherBoatProduction(noFish.city, false)).toBeNull();
  });

  it('respects the economy unit cap', () => {
    const { city, auto } = aiEngine(true, false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((auto as any).buildFisherBoatProduction(city, true)).toBeNull();
  });
});
