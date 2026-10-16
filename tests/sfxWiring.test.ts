import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { EngineEventRouter } from '@/utils/EngineEventHandlers';
import { useGameStore } from '@/stores/GameStore';
import { playSfx } from '@/utils/Sfx';

/**
 * Which game event plays which cue.
 *
 * `tests/sfx.test.ts` covers the sound layer in isolation — that a file wins
 * over its oscillators, and how loud each path is. This file covers the other
 * half of the contract: that the seven shipped recordings are actually wired
 * to the events they were recorded for, and that the rules which keep them
 * from becoming noise (own units only, once per turn, human involvement) hold.
 *
 * The layer is mocked, so a cue is a string in a list rather than a decoded
 * audio file.
 */
vi.mock('@/utils/Sfx', () => ({
  playSfx: vi.fn(),
}));

describe('cue wiring', () => {
  let engine: GameEngine;
  let router: EngineEventRouter;

  /** Every cue played since the last `cues().length` reset. */
  const cues = (): string[] =>
    vi.mocked(playSfx).mock.calls.map(([cue]) => String(cue));

  beforeEach(async () => {
    vi.mocked(playSfx).mockClear();
    engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (engine as unknown as { isPaused: boolean }).isPaused = true;

    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
    });

    router = new EngineEventRouter(engine);
    engine.onStateChange = (type: string, data?: Record<string, unknown>) => {
      router.handle(type, data ?? {});
    };

    humanCityRef = null;
    aiCityRef = null;
  });

  afterEach(() => {
    (engine as unknown as { units: unknown[] }).units = [];
    (engine as unknown as { cities: unknown[] }).cities = [];
    (engine as unknown as { civilizations: unknown[] }).civilizations = [];
  });

  /** A unit shaped like the engine's, with the fields the router reads. */
  const makeUnit = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'u1',
    civilizationId: 0,
    type: 'warrior',
    col: 5,
    row: 5,
    movesRemaining: 1,
    health: 100,
    icon: '⚔️',
    isDefeated: false,
    ...over,
  });

  /**
   * Put `unit` in the store at `col,row` as its "previous" tile. `onUnitMoved`
   * reads the origin from the store, so a movement test has to seed it or the
   * origin collapses to wherever the unit already is.
   */
  const seedStoreAt = (unit: Record<string, unknown>, col: number, row: number): void => {
    useGameStore.getState().actions.updateUnits([{ ...unit, col, row }] as never);
  };

  /** A tile that is not a city and not water. */
  const openLandTile = (): { col: number; row: number } => {
    const width = (engine as unknown as { map?: { width?: number } }).map?.width ?? 20;
    const height = (engine as unknown as { map?: { height?: number } }).map?.height ?? 20;
    for (let col = 1; col < width - 1; col++) {
      for (let row = 1; row < height - 1; row++) {
        if (engine.getCityAt(col, row)) continue;
        const tile = (engine as unknown as { getTileAt: (c: number, r: number) => { type?: string } | null })
          .getTileAt?.(col, row);
        const type = String(tile?.type ?? '').toLowerCase();
        if (type === 'ocean' || type === 'water') continue;
        return { col, row };
      }
    }
    throw new Error('no open land tile on this map');
  };

  let cityCounter = 0;

  /** The fields of a fixture city the assertions reach for. */
  type FixtureCity = { id: string; col: number; row: number; civilizationId: number };

  /**
   * `CLOSEUP_1V1` hands each civ a settler, not a city, so fixtures that need
   * one build it. A generated map has no city layer of its own, so
   * `engine.cities` is what both `getCityAt` and `getAllCities` read.
   */
  const makeCity = (civilizationId: number, col: number, row: number): FixtureCity => {
    const city = {
      id: `sfx_city_${cityCounter++}`,
      name: `Sfx City ${cityCounter}`,
      civilizationId,
      col,
      row,
      population: 5,
      foodStored: 0,
      foodNeeded: 100,
      buildings: [],
      wonders: [],
      yields: { food: 0, production: 0, trade: 0, gold: 0, science: 0 },
      hitPoints: 10,
      maxHitPoints: 10,
      isCapital: false,
    };
    (engine as unknown as { cities: unknown[] }).cities.push(city);
    return city;
  };

  /** The player's city, made on first use and reused within one test. */
  let humanCityRef: FixtureCity | null = null;
  const humanCity = (): FixtureCity => {
    if (!humanCityRef) {
      const spot = openLandTile();
      humanCityRef = makeCity(0, spot.col, spot.row);
    }
    return humanCityRef;
  };

  /** A rival's city, made on first use and reused within one test. */
  let aiCityRef: FixtureCity | null = null;
  const aiCity = (): FixtureCity => {
    if (!aiCityRef) {
      const spot = openLandTile();
      aiCityRef = makeCity(1, spot.col, spot.row);
    }
    return aiCityRef;
  };

  // ── Movement cues ────────────────────────────────────────────────────

  describe('tankMove', () => {
    it('plays when the player drives a tank', () => {
      const tank = makeUnit({ id: 'tank-1', type: 'tank', col: 5, row: 5 });
      seedStoreAt(tank, 4, 5);

      engine.onStateChange?.('UNIT_MOVED', { unit: tank, targetCol: 5, targetRow: 5 });

      expect(cues()).toEqual(['tankMove']);
    });

    it('plays once per turn, not once per tile', () => {
      // A tank has 3 movement. Three move events must not stack three rumbles.
      const tank = makeUnit({ id: 'tank-2', type: 'tank', col: 5, row: 5, movesRemaining: 2 });
      seedStoreAt(tank, 4, 5);

      engine.onStateChange?.('UNIT_MOVED', { unit: tank, targetCol: 5, targetRow: 5 });
      engine.onStateChange?.('UNIT_MOVED', { unit: { ...tank, col: 6 }, targetCol: 6, targetRow: 5 });
      engine.onStateChange?.('UNIT_MOVED', { unit: { ...tank, col: 7 }, targetCol: 7, targetRow: 5 });

      expect(cues()).toEqual(['tankMove']);
    });

    it('stays silent for an AI tank', () => {
      // Civ 1 is the AI in CLOSEUP_1V1, and it drives tanks every turn.
      const tank = makeUnit({ id: 'tank-ai', type: 'tank', civilizationId: 1, col: 5, row: 5 });
      seedStoreAt(tank, 4, 5);

      engine.onStateChange?.('UNIT_MOVED', { unit: tank, targetCol: 5, targetRow: 5 });

      expect(cues()).toEqual([]);
    });
  });

  describe('airUnitLaunch', () => {
    it('plays when a fighter leaves one of the player\'s cities', () => {
      const city = humanCity();
      const jet = makeUnit({ id: 'jet-1', type: 'fighter', col: city.col, row: city.row });
      seedStoreAt(jet, city.col, city.row);

      engine.onStateChange?.('UNIT_MOVED', {
        unit: { ...jet, col: city.col + 1 },
        targetCol: city.col + 1,
        targetRow: city.row,
      });

      expect(cues()).toEqual(['airUnitLaunch']);
    });

    it('stays silent when the fighter was already in the open', () => {
      // A fighter has 10 movement. Taking off is one cue; the other nine tiles
      // of the sortie are not.
      const open = openLandTile();
      const jet = makeUnit({ id: 'jet-2', type: 'fighter', col: open.col, row: open.row });
      seedStoreAt(jet, open.col, open.row);

      engine.onStateChange?.('UNIT_MOVED', {
        unit: { ...jet, col: open.col + 1 },
        targetCol: open.col + 1,
        targetRow: open.row,
      });

      expect(cues()).toEqual([]);
    });

    it('plays once per turn even from a city', () => {
      const city = humanCity();
      const jet = makeUnit({ id: 'jet-3', type: 'fighter', col: city.col, row: city.row });
      seedStoreAt(jet, city.col, city.row);

      engine.onStateChange?.('UNIT_MOVED', {
        unit: { ...jet, col: city.col + 1 }, targetCol: city.col + 1, targetRow: city.row,
      });
      // Back onto the city tile, then out again — still the same turn.
      engine.onStateChange?.('UNIT_MOVED', {
        unit: { ...jet, col: city.col }, targetCol: city.col, targetRow: city.row,
      });
      engine.onStateChange?.('UNIT_MOVED', {
        unit: { ...jet, col: city.col + 1 }, targetCol: city.col + 1, targetRow: city.row,
      });

      expect(cues()).toEqual(['airUnitLaunch']);
    });
  });

  // ── Combat cues ──────────────────────────────────────────────────────

  describe('torpedoAttack', () => {
    const fight = (attackerType: string): void => {
      const attacker = makeUnit({ id: 'a', type: attackerType, col: 5, row: 5 });
      const defender = makeUnit({ id: 'd', type: 'battleship', col: 6, row: 5 });
      engine.onStateChange?.('COMBAT_HIT', {
        attacker,
        defender,
        attackerDamage: 0,
        defenderDamage: 20,
        attackerSurvived: true,
        defenderSurvived: true,
      });
    };

    it('replaces the generic blow when a submarine fires', () => {
      fight('submarine');
      expect(cues()).toEqual(['torpedoAttack']);
    });

    it('leaves every other attacker on unitStrike', () => {
      fight('cruiser');
      expect(cues()).toEqual(['unitStrike']);
    });

    it('layers the death cue over a torpedo that sank something', () => {
      const attacker = makeUnit({ id: 'a', type: 'submarine', col: 5, row: 5 });
      const defender = makeUnit({ id: 'd', type: 'battleship', col: 6, row: 5 });
      // A decisive round: COMBAT_VICTORY means the defender went down.
      engine.onStateChange?.('COMBAT_VICTORY', {
        attacker, defender, attackerDamage: 0, defenderDamage: 100,
        attackerSurvived: true, defenderSurvived: false,
      });

      expect(cues()).toEqual(['torpedoAttack', 'unitDefeated']);
    });
  });

  describe('cityAttacked', () => {
    it('plays when the player assaults a city', () => {
      engine.onStateChange?.('CITY_ATTACKED', {
        city: aiCity(),
        attacker: makeUnit({ id: 'besieger', type: 'tank' }),
        attackerDamage: 0,
        defenderDamage: 10,
      });

      expect(cues()).toEqual(['cityAttacked']);
    });

    it('plays when the player\'s OWN city is attacked', () => {
      // Defending counts as being part of the fight — arguably the half of it
      // the player most needs to hear.
      engine.onStateChange?.('CITY_ATTACKED', {
        city: humanCity(),
        attacker: makeUnit({ id: 'rival', civilizationId: 1, type: 'tank' }),
        attackerDamage: 0,
        defenderDamage: 0,
      });

      expect(cues()).toEqual(['cityAttacked']);
    });

    it('stays silent for a siege between two AI civs', () => {
      engine.onStateChange?.('CITY_ATTACKED', {
        city: aiCity(),
        attacker: makeUnit({ id: 'rival', civilizationId: 1, type: 'tank' }),
        attackerDamage: 0,
        defenderDamage: 0,
      });

      expect(cues()).toEqual([]);
    });
  });

  // ── Fanfares ─────────────────────────────────────────────────────────

  describe('the city-capture marches', () => {
    const capture = (year: number): void => {
      engine.currentYear = year;
      engine.onStateChange?.('CITY_CAPTURED', {
        city: { ...humanCity(), civilizationId: 1 },
        capturedBy: 0,
        originalCiv: 1,
      });
    };

    it('plays the classical march before the modern era', () => {
      capture(1500);
      expect(cues()).toEqual(['cityCapturedClassic']);
    });

    it('plays the modern march once the game has reached the modern era', () => {
      capture(1950);
      expect(cues()).toEqual(['cityCapturedModern']);
    });

    it('stays silent when the player LOSES a city', () => {
      // Same event, wrong direction: a victory march over your own fall would
      // be the wrong news twice over.
      engine.currentYear = 1950;
      engine.onStateChange?.('CITY_CAPTURED', {
        city: { ...humanCity(), civilizationId: 0 },
        capturedBy: 1,
        originalCiv: 0,
      });

      expect(cues()).toEqual([]);
    });
  });

  describe('barracksBuilt', () => {
    it('plays when a barracks finishes in the player\'s city', () => {
      engine.onStateChange?.('BUILDING_COMPLETED', {
        cityId: humanCity().id,
        buildingType: 'barracks',
      });

      expect(cues()).toEqual(['barracksBuilt']);
    });

    it('plays for a purchased barracks too', () => {
      engine.onStateChange?.('BUILDING_PURCHASED', {
        cityId: humanCity().id,
        buildingType: 'barracks',
      });

      expect(cues()).toEqual(['barracksBuilt']);
    });

    it('ignores other buildings', () => {
      engine.onStateChange?.('BUILDING_COMPLETED', {
        cityId: humanCity().id,
        buildingType: 'granary',
      });

      expect(cues()).toEqual([]);
    });

    it('stays silent for an AI barracks', () => {
      engine.onStateChange?.('BUILDING_COMPLETED', {
        cityId: aiCity().id,
        buildingType: 'barracks',
      });

      expect(cues()).toEqual([]);
    });
  });

  describe('nuclearStrike', () => {
    /** Read the store's active full-screen flourishes. */
    const effects = (): Array<{ id: string; kind: string; col: number; row: number; duration: number; shake: number }> =>
      useGameStore.getState().visualEffects as unknown as Array<{
        id: string; kind: string; col: number; row: number; duration: number; shake: number;
      }>;

    const strike = (fromCivId: number, col: number, row: number) =>
      engine.onStateChange?.('NUCLEAR_STRIKE', { fromCivId, col, row, radius: 2, destroyedUnitIds: [], razedCityIds: [] });

    beforeEach(() => {
      // Both sides of the effect have to start from a clean slate: an effect
      // left over from another test would make "added exactly one" a coin flip.
      useGameStore.setState({ visualEffects: [] });
    });

    it('flashes the screen when the player fires', () => {
      strike(0, 8, 8);

      expect(cues()).toEqual(['nuclearStrike']);
      expect(effects()).toHaveLength(1);
      expect(effects()[0].kind).toBe('nuclear-flash');
      // A flash that never leaves is a broken game, so the lifetime and the
      // shake are part of the contract.
      expect(effects()[0].duration).toBeGreaterThan(100);
      expect(effects()[0].shake).toBeGreaterThan(0);
    });

    it('flashes the screen when the blast lands near one of the player cities', () => {
      const home = humanCity();
      strike(1, home.col + 2, home.row);

      expect(cues()).toEqual(['nuclearStrike']);
      expect(effects()).toHaveLength(1);
    });

    it('stays a log line — no flash — when the blast is far from home', () => {
      // The AI-vs-AI case: nobody is firing *at* the player, so a screen-wide
      // strobe would be noise. This is the guard that keeps a spectator run
      // watchable and a normal game unannoying.
      strike(1, 3, 3);

      expect(cues()).toEqual([]);
      expect(effects()).toEqual([]);
    });

    it('records where it went off, so a future effect can aim the bloom', () => {
      strike(0, 9, 4);

      expect(effects()[0].col).toBe(9);
      expect(effects()[0].row).toBe(4);
    });

    it('drops the effect when the renderer is done with it', () => {
      strike(0, 8, 8);
      const [effect] = effects();

      useGameStore.getState().actions.removeVisualEffect(effect.id);

      expect(effects()).toEqual([]);
    });
  });

  describe('NUCLEAR_MELTDOWN', () => {
    const effects = (): Array<{ kind: string; col: number; row: number; duration: number; shake: number }> =>
      useGameStore.getState().visualEffects as unknown as Array<{
        kind: string; col: number; row: number; duration: number; shake: number;
      }>;

    const meltdown = (civilizationId: number, cityName: string, col: number, row: number, radius = 3) =>
      engine.onStateChange?.('NUCLEAR_MELTDOWN', {
        cityId: `melt_${col}_${row}`,
        cityName,
        col,
        row,
        civilizationId,
        radius,
      });

    beforeEach(() => {
      useGameStore.setState({ visualEffects: [] });
    });

    it('reports it to the player when their own reactor goes up', () => {
      // The engine has emitted NUCLEAR_MELTDOWN since nuclear plants gained a
      // meltdown chance, and until now nothing listened: the player's own city
      // could detonate, poison every tile around it and produce no news at all.
      const notifications = () => useGameStore.getState().uiState.notifications.map((n) => n.message);
      const before = notifications().length;

      meltdown(0, 'Springfield', 7, 7);

      const added = notifications().slice(before).join(' ');
      expect(added).toContain('Springfield');
      expect(added).toContain('Meltdown');
      expect(cues()).toEqual(['nuclearStrike']);
      expect(effects()).toHaveLength(1);
    });

    it('is a smaller fire than a warhead: less flash, less shake', () => {
      useGameStore.setState({ visualEffects: [] });
      engine.onStateChange?.('NUCLEAR_STRIKE', {
        fromCivId: 0, col: 8, row: 8, radius: 2, destroyedUnitIds: [], razedCityIds: [],
      });
      const nuke = effects()[0];

      useGameStore.setState({ visualEffects: [] });
      meltdown(0, 'Springfield', 7, 7);
      const melt = effects()[0];

      expect(melt.duration).toBeLessThan(nuke.duration);
      expect(melt.shake).toBeLessThan(nuke.shake);
    });

    it("stays quiet about somebody else's reactor blowing up far away", () => {
      const before = useGameStore.getState().uiState.notifications.length;

      meltdown(1, 'Somewhere Else', 3, 3);

      expect(useGameStore.getState().uiState.notifications.length).toBe(before);
      expect(effects()).toEqual([]);
    });
  });
});
