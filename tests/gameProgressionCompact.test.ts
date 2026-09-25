/**
 * Verifies the compact AI-optimised progression export helpers:
 *  - filterLogEntries drops engine-internal noise + noisy GAME_LOG categories
 *    and strips the duplicated full-city payloads.
 *  - computeCivDelta delta-encodes unchanged civ fields across rounds.
 *  - serializeCityCompact produces the slim city snapshot.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { filterLogEntries, computeCivDelta, hydrateCiv, gameProgression, PROGRESSION_SNAPSHOT_INTERVAL } from '../src/utils/GameProgression';
import { gameLogger } from '../src/utils/GameLogger';
import { serializeCityCompact } from '../src/utils/CitySnapshots';
import type { ProgressionCivSnapshot, ProgressionCivDelta, ProgressionLogEntry } from '../types/progression';

function entry(event: string, message = '', detail: Record<string, unknown> = {}): ProgressionLogEntry {
  return { ts: '2026-01-01T00:00:00.000Z', round: 1, player: 0, event, message, detail };
}

describe('filterLogEntries', () => {
  it('drops engine-internal noise events', () => {
    const entries = [
      entry('PHASE_CHANGE', '  phase → moving (civ 0)'),
      entry('AI_FINISHED', '🤖 AI turn finished — civ 0'),
      entry('RESEARCH_PHASE', '🔬 Research phase — civ 0'),
      entry('UNIT_MOVED', 'Move: warrior(5) → (12,8)'),
    ];
    const filtered = filterLogEntries(entries);
    expect(filtered.map((e) => e.event)).toEqual(['UNIT_MOVED']);
  });

  it('drops noisy GAME_LOG categories but keeps AI/economy decisions', () => {
    const entries = [
      entry('GAME_LOG', '[turn] ROUND 100 | Year: 2000 BC', { data: { category: 'turn' } }),
      entry('GAME_LOG', '[map] exploring terrain', { data: { category: 'map' } }),
      entry('GAME_LOG', '[ai] Research — Germans selects pottery (balanced_growth)', {
        data: { category: 'ai', tech: 'pottery' },
      }),
      entry('GAME_LOG', '[economy] Upkeep −5 gold (deficit 0)', {
        data: { category: 'economy', upkeep: 5, deficit: 0 },
      }),
    ];
    const filtered = filterLogEntries(entries);
    expect(filtered.map((e) => e.message)).toEqual([
      '[ai] Research — Germans selects pottery (balanced_growth)',
      '[economy] Upkeep −5 gold (deficit 0)',
    ]);
  });

  it('strips duplicated full-city payloads from kept entries', () => {
    const entries = [
      entry('TURN_END', '■ Turn end — civ 0 (round 1)', {
        data: { civilizationId: 0, roundNumber: 1, cities: '[array:1]' },
        cities: [{ id: 'city_1', name: 'Berlin', civilizationId: 0, col: 5, row: 7, population: 2 }],
      }),
      entry('CITY_FOUNDED', '🏙 City founded: Berlin at (5,7)', {
        data: { city: '{id,name,...}' },
        city: { id: 'city_1', name: 'Berlin', civilizationId: 0, col: 5, row: 7, population: 1 },
      }),
    ];
    const filtered = filterLogEntries(entries);
    expect(filtered).toHaveLength(2);
    for (const e of filtered) {
      expect(e.detail).not.toHaveProperty('city');
      expect(e.detail).not.toHaveProperty('cities');
      expect(e.detail.data).toBeDefined();
    }
  });
});

describe('computeCivDelta', () => {
  const baseCiv = (): ProgressionCivSnapshot => ({
    id: 0,
    name: 'Germans',
    leaderName: '',
    color: '#949494',
    isHuman: false,
    alive: true,
    score: 10,
    gold: 50,
    goldPerTurn: 4,
    science: 12,
    trade: 8,
    production: 6,
    food: 10,
    taxRate: 50,
    scienceRate: 50,
    luxuryRate: 0,
    government: 'despotism',
    cities: 2,
    cityData: [],
    population: 12,
    units: 3,
    military: 5,
    technologies: 3,
    techList: ['irrigation', 'mining', 'roads'],
    currentResearch: 'pottery',
    researchProgress: 20,
    warWith: [],
    wonders: 0,
    personality: { aggression: 50 },
    priorities: { militaryUnits: 20 },
  });

  it('emits the full state on the first round', () => {
    const delta = computeCivDelta(baseCiv(), undefined);
    expect(delta.id).toBe(0);
    expect(delta.name).toBe('Germans');
    expect(delta.techList).toEqual(['irrigation', 'mining', 'roads']);
    expect(delta.personality).toEqual({ aggression: 50 });
    expect(delta.government).toBe('despotism');
  });

  it('omits unchanged fields in later rounds but always emits gold/science/cityData', () => {
    const prev = baseCiv();
    const next = { ...baseCiv(), gold: 62, science: 18 };
    const delta = computeCivDelta(next, prev);
    expect(delta.gold).toBe(62);
    expect(delta.science).toBe(18);
    expect(delta.cityData).toEqual([]);
    expect(delta).not.toHaveProperty('techList');
    expect(delta).not.toHaveProperty('personality');
    expect(delta).not.toHaveProperty('priorities');
    expect(delta).not.toHaveProperty('government');
    expect(delta).not.toHaveProperty('name');
    expect(delta).not.toHaveProperty('warWith');
  });

  it('emits only the changed fields', () => {
    const prev = baseCiv();
    const next = {
      ...baseCiv(),
      techList: ['irrigation', 'mining', 'roads', 'pottery'],
      cities: 3,
      currentResearch: 'code_of_laws',
      researchProgress: 35,
    };
    const delta = computeCivDelta(next, prev);
    expect(delta.techList).toEqual(['irrigation', 'mining', 'roads', 'pottery']);
    expect(delta.cities).toBe(3);
    expect(delta.currentResearch).toBe('code_of_laws');
    expect(delta.researchProgress).toBe(35);
    expect(delta).not.toHaveProperty('warWith');
    expect(delta).not.toHaveProperty('priorities');
  });
});

describe('serializeCityCompact', () => {
  it('produces a slim city snapshot with itemTypes instead of full item objects', () => {
    const city = {
      id: 'city_1',
      name: 'Berlin',
      civilizationId: 0,
      col: 5,
      row: 7,
      population: 8,
      production: 0,
      food: 0,
      gold: 0,
      science: 0,
      productionProgress: 27,
      productionStored: 27,
      currentProduction: { type: 'unit', itemType: 'phalanx', name: 'Phalanx', cost: 50 },
      buildQueue: [
        { type: 'building', itemType: 'granary', name: 'Granary', cost: 60 },
        { type: 'building', itemType: 'barracks', name: 'Barracks', cost: 40 },
      ],
      isCapital: true,
      yields: { food: 12, production: 9, trade: 4 },
      foodStored: 48,
      foodNeeded: 160,
      buildings: ['palace', 'granary'],
      autoProduction: true,
      processTurn: () => {},
    };
    const compact = serializeCityCompact(city);
    expect(compact).toEqual({
      id: 'city_1',
      name: 'Berlin',
      civilizationId: 0,
      col: 5,
      row: 7,
      population: 8,
      productionStored: 27,
      currentProduction: 'phalanx',
      buildQueue: ['granary', 'barracks'],
      isCapital: true,
      yields: { food: 12, production: 9, trade: 4 },
      foodStored: 48,
      foodNeeded: 160,
      buildings: ['palace', 'granary'],
      autoProduction: true,
    });
    expect(JSON.stringify(compact)).not.toContain('processTurn');
    expect(JSON.stringify(compact)).not.toContain('"cost"');
  });

  it('falls back to productionProgress when productionStored is missing', () => {
    const compact = serializeCityCompact({ id: 'c', name: 'X', civilizationId: 0, col: 1, row: 1, population: 1, production: 0, food: 0, gold: 0, science: 0, productionProgress: 12 });
    expect(compact.productionStored).toBe(12);
  });
});

describe('hydrateCiv (compact CSV)', () => {
  it('carries omitted delta fields forward from the previous round', () => {
    const prev: ProgressionCivSnapshot = {
      id: 0, name: 'Germans', leaderName: 'Frederick', color: '#888', isHuman: true, alive: true,
      score: 10, gold: 50, goldPerTurn: 4, science: 3, trade: 8, production: 6, food: 10,
      taxRate: 40, scienceRate: 50, luxuryRate: 10, government: 'despotism',
      cities: 2, cityData: [], population: 12, units: 4, military: 6, technologies: 3, techList: ['irrigation'],
      currentResearch: 'pottery', researchProgress: 7, warWith: [], wonders: 0, personality: {}, priorities: {},
    };
    // Next round: only gold/science changed (delta encoding).
    const delta: ProgressionCivDelta = { id: 0, gold: 62, science: 4, cityData: [] };
    const full = hydrateCiv(prev, delta);
    expect(full.gold).toBe(62);
    expect(full.science).toBe(4);
    // Carried forward unchanged:
    expect(full.name).toBe('Germans');
    expect(full.government).toBe('despotism');
    expect(full.cities).toBe(2);
    expect(full.units).toBe(4);
    expect(full.currentResearch).toBe('pottery');
    expect(full.researchProgress).toBe(7);
  });

  it('provides sane defaults when there is no previous round', () => {
    const delta: ProgressionCivDelta = { id: 1, gold: 50, science: 0, cityData: [] };
    const full = hydrateCiv(undefined, delta);
    expect(full.id).toBe(1);
    expect(full.name).toBe('Civ 1');
    expect(full.alive).toBe(true);
    expect(full.isHuman).toBe(false);
  });
});

/** Parse a compact CSV into typed rows keyed by the export's column names. */
function csvRows(csv: string): Record<string, string | number>[] {
  const lines = csv.trim().split('\n').filter((l) => !l.startsWith('#'));
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Record<string, string | number> = {};
    header.forEach((h, i) => { row[h] = /^-?\d+(\.\d+)?$/.test(cells[i]) ? Number(cells[i]) : (cells[i] ?? ''); });
    return row;
  });
}

describe('buildCompactCsv (strongly reduced export)', () => {
  let engine: GameEngine;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 50,
    });
    gameLogger.setSession('compact-test');
    gameProgression.reset();
    gameProgression.startSession(engine, {
      mapType: 'CLOSEUP_1V1',
      difficulty: 'PRINCE',
      numberOfCivilizations: 2,
      playerCivilization: 0,
    });
  });

  afterEach(() => {
    (engine as GameEngine).units = [];
    (engine as GameEngine).cities = [];
    (engine as GameEngine).civilizations = [];
    gameProgression.reset();
  });

  /** Drive full rounds: start the human turn, then advance through AI → human. */
  const advanceRounds = (n: number) => {
    (engine.turnManager as any).startTurn?.(0);
    for (let i = 0; i < n; i++) {
      engine.turnManager.advanceTurn(); // human -> AI
      engine.turnManager.advanceTurn(); // AI -> human (new round)
      gameProgression.recordIfNewRound(engine);
    }
  };

  it('produces a CSV scoreboard with one row per civ per round', async () => {
    advanceRounds(3);

    const csv = await gameProgression.buildCompactCsv(engine);
    const lines = csv.trim().split('\n');
    // Comment line + header + at least one row per civ.
    expect(lines[0]).toMatch(/^# Civ1Browser progression \(compact\)/);
    expect(lines[1]).toBe(
      'round,year,civId,civ,human,alive,score,gold,goldPerTurn,science,trade,production,food,cities,population,units,military,techs,research,researchProgress,government,tax,scirate,lux,warWith,wonders,strategy,unitComposition,cityProduction,aiActions,moves,moveFailures,attacks,combatWins,combatLosses,unitsLost,citiesFounded,citiesCaptured,skips,stalls,noTarget,misbehavingUnits,aiNotes,snapshotUnits,snapshotCities',
    );
    expect(lines.length).toBeGreaterThanOrEqual(4); // 2 header lines + ≥ 2 rows
    expect(lines[2]).toMatch(/^1,/); // round 1 first
    for (const row of lines.slice(2)) {
      expect(row.split(',')).toHaveLength(lines[1].split(',').length);
    }
  });

  it('seeds the first exported row per civ from live state (not delta defaults)', async () => {
    // Regression from an AI-vs-AI export: the export keeps only the last 200
    // round-deltas, but each delta only carries what changed in THAT round, so
    // the first exported row hydrated from defaults and the whole file inherited
    // `cities 0 / units 0 / techs 0 / tax 0` forever (a civ with 7 cities was
    // exported as having none).
    const civ = engine.civilizations[0];
    expect(civ).toBeDefined();
    advanceRounds(2);
    const rowsForCiv0 = csvRows(await gameProgression.buildCompactCsv(engine)).filter((r) => String(r.civId) === '0');

    const liveCities = engine.getAllCities().filter((c) => c.civilizationId === 0).length;
    const liveUnits = engine.getAllUnits().filter((u) => u.civilizationId === 0).length;
    const liveTechs = civ?.technologies?.length ?? 0;

    const rows = rowsForCiv0;
    expect(rows.length).toBeGreaterThan(0);
    // The FIRST row for the civ already matches the live engine, even though its
    // delta carried only the fields that changed in that single round.
    expect(rows[0].cities).toBe(liveCities);
    expect(rows[0].units).toBe(liveUnits);
    expect(rows[0].techs).toBe(liveTechs);
    // Rates are a real, normalised vector — never the 0/50/50 default.
    expect(Number(rows[0].tax) + Number(rows[0].scirate) + Number(rows[0].lux)).toBe(100);
    // A civ with cities must never be exported as city-less.
    for (const row of rows) {
      if (liveCities > 0) expect(row.cities).toBe(liveCities);
    }
  });

  it('research shows a tech name (not [object Object]) and gold reads from resources', async () => {
    // Give the human civ real resources + a researched tech object.
    const civ = engine.civilizations[0];
    if (civ && civ.resources) civ.resources.gold = 123;
    (engine as any).setResearch?.(0, 'pottery');

    // Two rounds: the first advance-cycle returns to currentTurn 1 (the round
    // already recorded at session start), the second records a fresh round.
    advanceRounds(2);

    const csv = await gameProgression.buildCompactCsv(engine);
    expect(csv).not.toContain('[object Object]');
    // The human civ's row carries its treasury (from resources, after upkeep)
    // and the research tech id.
    const humanRow = csv.split('\n').find((line) => line.includes('true,') && line.includes('pottery'));
    expect(humanRow).toBeDefined();
    // Gold read from civ.resources (was always 0 before) — non-zero treasury.
    expect(Number(humanRow!.split(',')[7])).toBeGreaterThan(0);
    expect(humanRow!.split(',')[18]).toBe('pottery'); // research column
  });

  it('emits complete unit and city listings at the configured snapshot interval', async () => {
    (engine as any).currentTurn = PROGRESSION_SNAPSHOT_INTERVAL;
    (engine as any).currentYear = -3600;
    gameProgression.recordIfNewRound(engine);

    const csv = await gameProgression.buildCompactCsv(engine);
    const lines = csv.trim().split('\n');
    const header = lines[1].split(',');
    const row = lines.find((line) => line.startsWith(`${PROGRESSION_SNAPSHOT_INTERVAL},`));
    expect(row).toBeDefined();
    expect(header).toContain('snapshotUnits');
    expect(header).toContain('snapshotCities');
    expect(row).toContain('settler_0_0');
  });

  it('is much smaller than the full JSON payload when the log is large', async () => {
    // Drive a few rounds so progression has several snapshots.
    advanceRounds(3);

    // Seed a realistic volume of move events (≈200), the dominant cost of the
    // full export — the compact CSV drops the log entirely.
    for (let i = 0; i < 200; i++) {
      gameLogger.log('UNIT_MOVED', `Move: warrior(${i}) → (${i % 20},${(i * 7) % 20})`, {
        data: { unitId: `u_${i}`, from: { col: i % 20, row: (i * 3) % 20 }, to: { col: (i + 1) % 20, row: (i * 7) % 20 } },
      });
    }

    const csv = await gameProgression.buildCompactCsv(engine);
    const payload = await gameProgression.buildDownloadPayload(engine);
    const fullJson = JSON.stringify(payload);

    console.log('[SIZE] full JSON:', fullJson.length, 'bytes | compact CSV:', csv.length, 'bytes | ratio:', (fullJson.length / Math.max(1, csv.length)).toFixed(1), 'x smaller');
    expect(csv.length).toBeLessThan(fullJson.length);
    // The compact CSV must be dramatically smaller (≥ 5×) than the full export.
    expect(csv.length).toBeLessThan(Math.ceil(fullJson.length / 5));
  });
});
