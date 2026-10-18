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

  describe('mechInfMove', () => {
    it('plays when the player drives mechanised infantry', () => {
      const mech = makeUnit({ id: 'mech-1', type: 'mech_inf', col: 5, row: 5 });
      seedStoreAt(mech, 4, 5);

      engine.onStateChange?.('UNIT_MOVED', { unit: mech, targetCol: 5, targetRow: 5 });

      expect(cues()).toEqual(['mechInfMove']);
    });

    it('plays once per turn, not once per tile', () => {
      // Mech. Inf. has 3 movement, same as a tank: three move events must not
      // stack three grinding rumbles.
      const mech = makeUnit({ id: 'mech-2', type: 'mech_inf', col: 5, row: 5, movesRemaining: 2 });
      seedStoreAt(mech, 4, 5);

      engine.onStateChange?.('UNIT_MOVED', { unit: mech, targetCol: 5, targetRow: 5 });
      engine.onStateChange?.('UNIT_MOVED', { unit: { ...mech, col: 6 }, targetCol: 6, targetRow: 5 });
      engine.onStateChange?.('UNIT_MOVED', { unit: { ...mech, col: 7 }, targetCol: 7, targetRow: 5 });

      expect(cues()).toEqual(['mechInfMove']);
    });

    it('speaks with its own voice rather than borrowing the tank rumble', () => {
      // One file, one purpose. A tank and a mech. Inf. standing side by side
      // would be indistinguishable if either borrowed the other's cue.
      const tank = makeUnit({ id: 'tank-beside', type: 'tank', col: 5, row: 5 });
      seedStoreAt(tank, 4, 5);
      engine.onStateChange?.('UNIT_MOVED', { unit: tank, targetCol: 5, targetRow: 5 });

      const mech = makeUnit({ id: 'mech-beside', type: 'mech_inf', col: 7, row: 5 });
      seedStoreAt(mech, 6, 5);
      engine.onStateChange?.('UNIT_MOVED', { unit: mech, targetCol: 7, targetRow: 5 });

      expect(cues()).toEqual(['tankMove', 'mechInfMove']);
    });

    it('stays silent for an AI mech. Inf.', () => {
      const mech = makeUnit({ id: 'mech-ai', type: 'mech_inf', civilizationId: 1, col: 5, row: 5 });
      seedStoreAt(mech, 4, 5);

      engine.onStateChange?.('UNIT_MOVED', { unit: mech, targetCol: 5, targetRow: 5 });

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

    it('a surface warship fires naval guns, not the ground knock', () => {
      // The destroyer recording is a broadside, not a rifle: cruisers,
      // destroyers and battleships get `navalStrike` while land units keep
      // the plain impact.
      fight('cruiser');
      expect(cues()).toEqual(['navalStrike']);
    });

    it('an aircraft makes an attack run, not the ground knock', () => {
      fight('fighter');
      expect(cues()).toEqual(['airStrike']);
      vi.mocked(playSfx).mockClear();
      fight('bomber');
      expect(cues()).toEqual(['airStrike']);
    });

    it('leaves every other attacker on the plain impact', () => {
      fight('legion');
      expect(cues()).toEqual(['impactStrike']);
    });

    describe('machine guns only for a unit that carries them', () => {
      // The recording behind `machineGunStrike` is Warzone's
      // `short_machine_gun_fire`. Before this rule it was the fallback for
      // every land unit, so a legion and a tank both fired automatic fire.
      it('gives the burst to mech. inf., which is the only unit that has one', () => {
        fight('mech_inf');
        expect(cues()).toEqual(['machineGunStrike']);
      });

      it('never gives the burst to a unit without machine guns', () => {
        for (const unitType of [
          'warrior', 'archer', 'phalanx', 'chariot', 'knights', 'legion',
          'catapult', 'cavalry', 'musketeer', 'riflemen', 'cannon', 'artillery',
          'tank',
        ]) {
          vi.mocked(playSfx).mockClear();
          fight(unitType);
          expect(cues(), `${unitType} must not fire a machine gun`).toEqual(['impactStrike']);
        }
      });

      it('a unit that kills still only gets its own blow', () => {
        // The death cue layers on top, but the blow underneath has to be the
        // unit's own — a decisive round must not promote anything to gunfire.
        const attacker = makeUnit({ id: 'a', type: 'legion', col: 5, row: 5 });
        const defender = makeUnit({ id: 'd', type: 'warrior', col: 6, row: 5 });
        engine.onStateChange?.('COMBAT_VICTORY', {
          attacker, defender, attackerDamage: 10, defenderDamage: 100,
          attackerSurvived: true, defenderSurvived: false,
        });

        expect(cues()).toEqual(['unitDefeated']);
        expect(cues()).not.toContain('machineGunStrike');
      });
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
    const assault = (attackerType: string, attackerCiv = 0, ownCity = false): void => {
      engine.onStateChange?.('CITY_ATTACKED', {
        city: ownCity ? humanCity() : aiCity(),
        attacker: makeUnit({ id: 'besieger', type: attackerType, civilizationId: attackerCiv }),
        attackerDamage: 0,
        defenderDamage: 10,
      });
    };

    it('plays when gunpowder infantry assaults a city', () => {
      assault('musketeer');
      expect(cues()).toEqual(['cityAttacked']);
    });

    it('plays for the rest of the gunpowder line', () => {
      for (const unitType of ['riflemen', 'mech_inf', 'cannon', 'artillery']) {
        vi.mocked(playSfx).mockClear();
        assault(unitType);
        expect(cues(), `${unitType} should bombard`).toEqual(['cityAttacked']);
      }
    });

    it('plays when the player\'s OWN city is attacked', () => {
      // Defending counts as being part of the fight — arguably the half of it
      // the player most needs to hear.
      assault('musketeer', 1, true);

      expect(cues()).toEqual(['cityAttacked']);
    });

    // The cue is a gunpowder bombardment of walls, so these three kinds are
    // deliberately excluded rather than falling through to it.
    it('stays silent for a tank on the walls', () => {
      assault('tank');
      expect(cues()).toEqual([]);
    });

    it('stays silent for an aircraft over the walls', () => {
      assault('bomber');
      expect(cues()).toEqual([]);
    });

    it('stays silent for a ship at the walls', () => {
      assault('cruiser');
      expect(cues()).toEqual([]);
    });

    it('stays silent for pre-gunpowder attackers', () => {
      for (const unitType of ['warrior', 'archer', 'catapult', 'knights', 'legion', 'cavalry']) {
        vi.mocked(playSfx).mockClear();
        assault(unitType);
        expect(cues(), `${unitType} should not bombard`).toEqual([]);
      }
    });

    it('stays silent for a siege between two AI civs', () => {
      assault('musketeer', 1);

      expect(cues()).toEqual([]);
    });
  });

  describe('cityFounded', () => {
    const found = (civilizationId: number, source?: string): void => {
      engine.onStateChange?.('CITY_FOUNDED', {
        city: makeCity(civilizationId, 4, 5),
        settler: makeUnit({ id: 'settler', civilizationId }),
        ...(source ? { source } : {}),
      });
    };

    it('plays when the player founds a city', () => {
      found(0);

      expect(cues()).toEqual(['cityFounded']);
    });

    it('plays for a city grown out of a village too', () => {
      // The village encounter is a different beat (an ambush, a donation) and
      // says nothing about walls going up, so it does not consume the cheer.
      found(0, 'village');

      expect(cues()).toEqual(['cityFounded']);
    });

    it('stays silent when a rival founds a city', () => {
      found(1);

      expect(cues()).toEqual([]);
    });

    it('is distinct from taking a city — a capture still plays its own march', () => {
      // Founding and capturing are both "a city is yours now", so this pins
      // that they are not the same cue: one file, one purpose.
      found(0);

      engine.currentYear = 1950;
      engine.onStateChange?.('CITY_CAPTURED', {
        city: { ...humanCity(), civilizationId: 1 },
        capturedBy: 0,
        originalCiv: 1,
      });

      expect(cues()).toEqual(['cityFounded', 'cityCapturedModern']);
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

    it('falls to cityLost — and neither march — when the player LOSES a city', () => {
      // The marches are victories; playing one over your own fall would be the
      // wrong news twice over. What is left is a fall in a minor, which must
      // not be mistaken for a fanfare.
      engine.currentYear = 1950;
      engine.onStateChange?.('CITY_CAPTURED', {
        city: { ...humanCity(), civilizationId: 0 },
        capturedBy: 1,
        originalCiv: 0,
      });

      expect(cues()).toEqual(['cityLost']);
      expect(cues()).not.toContain('cityCapturedModern');
      expect(cues()).not.toContain('cityCapturedClassic');
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

    it('is silent for other buildings — production-complete-1.ogg is reserved for electrification', () => {
      // A granary is not a barracks and does not electrify the city, so it
      // rolls out in silence now.
      engine.onStateChange?.('BUILDING_COMPLETED', {
        cityId: humanCity().id,
        buildingType: 'granary',
      });

      expect(cues()).toEqual([]);
    });

    it('plays productionComplete when a power plant electrifies the player\'s city', () => {
      engine.onStateChange?.('BUILDING_COMPLETED', {
        cityId: humanCity().id,
        buildingType: 'power_plant',
      });

      expect(cues()).toEqual(['productionComplete']);
    });

    it('plays productionComplete when a hydro plant electrifies the player\'s city', () => {
      engine.onStateChange?.('BUILDING_COMPLETED', {
        cityId: humanCity().id,
        buildingType: 'hydro_plant',
      });

      expect(cues()).toEqual(['productionComplete']);
    });

    it('plays productionComplete when a nuclear plant electrifies the player\'s city', () => {
      engine.onStateChange?.('BUILDING_COMPLETED', {
        cityId: humanCity().id,
        buildingType: 'nuclear_plant',
      });

      expect(cues()).toEqual(['productionComplete']);
    });

    it('plays productionComplete for a purchased power plant too', () => {
      engine.onStateChange?.('BUILDING_PURCHASED', {
        cityId: humanCity().id,
        buildingType: 'power_plant',
      });

      expect(cues()).toEqual(['productionComplete']);
    });

    it('stays silent for an AI city getting electrified', () => {
      engine.onStateChange?.('BUILDING_COMPLETED', {
        cityId: aiCity().id,
        buildingType: 'power_plant',
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

    it('stays silent for an AI granary too — only the player rolls out loud', () => {
      engine.onStateChange?.('BUILDING_COMPLETED', {
        cityId: aiCity().id,
        buildingType: 'granary',
      });

      expect(cues()).toEqual([]);
    });
  });

  describe('productionComplete', () => {
    // Per design, `production-complete-1.ogg` no longer plays for a unit rolling
    // out of a factory: a unit is announced by its own readiness, and the
    // production-complete fanfare is reserved for a city being electrified.
    it('plays unitProduced — not productionComplete — when a city finishes a unit', () => {
      engine.onStateChange?.('UNIT_PRODUCED', {
        unit: makeUnit({ id: 'fresh', type: 'legion', civilizationId: 0 }),
      });

      expect(cues()).toEqual(['unitProduced']);
    });

    it('stays silent when an AI city finishes a unit', () => {
      engine.onStateChange?.('UNIT_PRODUCED', {
        unit: makeUnit({ id: 'ai-fresh', type: 'legion', civilizationId: 1 }),
      });

      expect(cues()).toEqual([]);
    });
  });

  describe('the news cues — the player\'s own news, nobody else\'s bookkeeping', () => {
    // Ten moments that used to be played in total silence. Every one of them
    // is gated the same way, and that gate is the whole test: these events fire
    // for the AI constantly, so a cue that is not gated to the player is the
    // fastest way to make a game irritating.

    const civs = [
      { id: 0, name: 'Americans', isHuman: true },
      { id: 1, name: 'Zulus', isHuman: false },
      { id: 2, name: 'Romans', isHuman: false },
    ];
    beforeEach(() => {
      (engine as unknown as { civilizations: unknown[] }).civilizations = civs;
    });

    describe('warDeclared', () => {
      const declare = (aggressorId: number, targetId: number): void => {
        engine.onStateChange?.('WAR_DECLARED', { aggressorId, targetId });
      };

      it('plays when a rival declares war on the player', () => {
        declare(1, 0);
        expect(cues()).toEqual(['warDeclared']);
      });

      it('plays when the player declares the war', () => {
        declare(0, 1);
        expect(cues()).toEqual(['warDeclared']);
      });

      it('stays silent for a war between two rivals', () => {
        // The AI declares on itself all game long.
        declare(1, 2);
        expect(cues()).toEqual([]);
      });
    });

    describe('peaceMade', () => {
      it('plays for a peace the player is party to', () => {
        engine.onStateChange?.('PEACE_MADE', { civA: 1, civB: 0 });
        expect(cues()).toEqual(['peaceMade']);
      });

      it('shares one voice with a ceasefire — the fighting stopped either way', () => {
        engine.onStateChange?.('CEASEFIRE_SIGNED', { civA: 0, civB: 1 });
        expect(cues()).toEqual(['peaceMade']);
      });

      it('stays silent for peace between two rivals', () => {
        engine.onStateChange?.('PEACE_MADE', { civA: 1, civB: 2 });
        engine.onStateChange?.('CEASEFIRE_SIGNED', { civA: 1, civB: 2 });
        expect(cues()).toEqual([]);
      });
    });

    describe('wonderCompleted', () => {
      it('plays when the player finishes a Wonder', () => {
        engine.onStateChange?.('WONDER_COMPLETED', { wonderId: 'pyramids', civilizationId: 0 });
        // Guard against a wonder id that does not resolve: the handler returns
        // early, so the cue must not fire on an unknown wonder either.
        expect(cues().every((c) => c === 'wonderCompleted')).toBe(cues().length > 0);
      });

      it('stays silent when a rival finishes one', () => {
        engine.onStateChange?.('WONDER_COMPLETED', { wonderId: 'pyramids', civilizationId: 1 });
        expect(cues()).toEqual([]);
      });
    });

    describe('cityStarved', () => {
      it('plays when one of the player\'s own cities starves', () => {
        engine.onStateChange?.('CITY_STARVED', { city: humanCity() });
        expect(cues()).toEqual(['cityStarved']);
      });

      it('stays silent for a rival\'s famine', () => {
        engine.onStateChange?.('CITY_STARVED', { city: aiCity() });
        expect(cues()).toEqual([]);
      });
    });

    describe('cityDisorder', () => {
      const disorder = (civilizationId: number, isDisordered: boolean): void => {
        const base = civilizationId === 0 ? humanCity() : aiCity();
        engine.onStateChange?.('CITY_DISORDER', {
          city: { ...base, disorder: isDisordered },
        });
      };

      it('plays when one of the player\'s cities tips into unrest', () => {
        disorder(0, true);
        expect(cues()).toEqual(['cityDisorder']);
      });

      it('stays quiet when unrest ENDS — relief gets no alarm', () => {
        // The event fires on both transitions. Sounding the same cue for the
        // end of unrest would train the player to ignore it.
        disorder(0, false);
        expect(cues()).toEqual([]);
      });

      it('stays silent for a rival\'s unrest', () => {
        disorder(1, true);
        expect(cues()).toEqual([]);
      });
    });

    describe('cityDisaster', () => {
      const disaster = (civilizationId: number, kind: string): void => {
        const base = civilizationId === 0 ? humanCity() : aiCity();
        engine.onStateChange?.('CITY_DISASTER', {
          city: base,
          civilizationId,
          kind,
          lostPopulation: 0,
          destroyedBuilding: null,
          goldStolen: 0,
        });
      };

      it('plays when a disaster strikes one of the player\'s cities', () => {
        disaster(0, 'flood');
        expect(cues()).toEqual(['cityDisaster']);
      });

      it('plays for every kind of disaster — one cue, one meaning', () => {
        for (const kind of ['famine', 'flood', 'fire', 'plague', 'pirates', 'volcano', 'earthquake']) {
          vi.mocked(playSfx).mockClear();
          disaster(0, kind);
          expect(cues(), `kind ${kind}`).toEqual(['cityDisaster']);
        }
      });

      it('stays silent for a rival\'s disaster', () => {
        disaster(1, 'flood');
        expect(cues()).toEqual([]);
      });
    });

    describe('unitProduced', () => {
      it('plays when a unit rolls out of one of the player\'s cities', () => {
        engine.onStateChange?.('UNIT_PRODUCED', {
          unit: makeUnit({ id: 'fresh', type: 'tank', civilizationId: 0 }),
        });
        expect(cues()).toEqual(['unitProduced']);
      });

      it('plays for a unit the player bought as well as one they built', () => {
        engine.onStateChange?.('UNIT_PURCHASED', {
          unit: makeUnit({ id: 'bought', type: 'tank', civilizationId: 0 }),
        });
        expect(cues()).toEqual(['unitProduced']);
      });

      it('stays silent for a caravan — it is built, not manufactured', () => {
        // A caravan has the trade-route cue waiting; it should not announce
        // itself twice.
        engine.onStateChange?.('UNIT_PRODUCED', {
          unit: makeUnit({ id: 'car', type: 'caravan', civilizationId: 0 }),
        });
        expect(cues()).toEqual([]);
      });

      it('stays silent for an AI city', () => {
        engine.onStateChange?.('UNIT_PRODUCED', {
          unit: makeUnit({ id: 'ai-fresh', type: 'tank', civilizationId: 1 }),
        });
        expect(cues()).toEqual([]);
      });
    });

    describe('unitPromoted', () => {
      it('plays when one of the player\'s units earns a rank', () => {
        engine.onStateChange?.('UNIT_PROMOTED', {
          unit: makeUnit({ id: 'vet', type: 'legion', civilizationId: 0 }),
        });
        expect(cues()).toEqual(['unitPromoted']);
      });

      it('stays silent for an AI promotion', () => {
        engine.onStateChange?.('UNIT_PROMOTED', {
          unit: makeUnit({ id: 'ai-vet', type: 'legion', civilizationId: 1 }),
        });
        expect(cues()).toEqual([]);
      });
    });

    describe('civEliminated', () => {
      it('plays when a rival is wiped out — including by the player', () => {
        engine.onStateChange?.('CIVILIZATION_ELIMINATED', {
          civilizationId: 1, attackerCivId: 0, unitsDestroyed: 3,
        });
        expect(cues()).toEqual(['civEliminated']);
      });

      it('plays when the player\'s own civilisation ends — the last note of the game', () => {
        engine.onStateChange?.('CIVILIZATION_ELIMINATED', {
          civilizationId: 0, attackerCivId: 1, unitsDestroyed: 4,
        });
        expect(cues()).toEqual(['civEliminated']);
      });

      it('stays silent when two rivals wipe each other out', () => {
        engine.onStateChange?.('CIVILIZATION_ELIMINATED', {
          civilizationId: 1, attackerCivId: 2, unitsDestroyed: 2,
        });
        expect(cues()).toEqual([]);
      });
    });

    describe('tradeRouteEstablished', () => {
      const deliver = (civilizationId: number): void => {
        engine.onStateChange?.('TRADE_ROUTE_ESTABLISHED', {
          homeCity: { id: 'h', name: 'Home' },
          destCity: { id: 'd', name: 'Dest', civilizationId },
          caravan: makeUnit({ id: 'car', type: 'caravan', civilizationId }),
          gold: 10, science: 5,
        });
      };

      it('plays when one of the player\'s caravans arrives', () => {
        deliver(0);
        expect(cues()).toEqual(['tradeRouteEstablished']);
      });

      it('stays silent for an AI caravan delivery', () => {
        deliver(1);
        expect(cues()).toEqual([]);
      });
    });

    it('plays nothing at all in an AI-vs-AI run', () => {
      // `isAIVsAI` is derived from the civilizations themselves, so a
      // self-playing run is modelled the only way it can be: every civ is
      // AI-driven. Civilization 0 still carries the human player id in the
      // real engine, which is exactly why the id test alone is not enough.
      (engine as unknown as { civilizations: unknown[] }).civilizations = civs.map(
        (c) => ({ ...c, isHuman: false }),
      );
      engine.onStateChange?.('WAR_DECLARED', { aggressorId: 1, targetId: 0 });
      engine.onStateChange?.('PEACE_MADE', { civA: 1, civB: 0 });
      engine.onStateChange?.('CIVILIZATION_ELIMINATED', { civilizationId: 0, attackerCivId: 1 });
      engine.onStateChange?.('CITY_STARVED', { city: { ...humanCity(), civilizationId: 0 } });
      engine.onStateChange?.('UNIT_PRODUCED', {
        unit: makeUnit({ id: 'x', type: 'tank', civilizationId: 0 }),
      });
      engine.onStateChange?.('UNIT_PROMOTED', {
        unit: makeUnit({ id: 'y', type: 'legion', civilizationId: 0 }),
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

      // The launch whistle first, then the great explosion — requested in
      // order, the engine serializes them so the boom never steps on the
      // launch.
      expect(cues()).toEqual(['missileLaunch', 'nuclearStrike']);
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

      expect(cues()).toEqual(['missileLaunch', 'nuclearStrike']);
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
