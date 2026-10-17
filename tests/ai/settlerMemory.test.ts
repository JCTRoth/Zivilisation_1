/**
 * SettlerMemory + SettlerGovernor memory integration.
 *
 * The governor used to re-scan the map and re-pick targets every turn with no
 * memory: settlers were re-sent to sites where previous settlers died, tiles
 * were re-improved, and expansion never paced to survivability. These tests
 * pin that the memory layer now stops that.
 */
import { describe, it, expect } from 'vitest';
import { SettlerMemory, evaluateColonySite } from '@/game/engine/AI/SettlerMemory';
import { SettlerGovernor } from '@/game/engine/AI/SettlerGovernor';
import GameEngine from '@/game/engine/GameEngine';
import type { City, Unit } from '../../types/game';

const city = (over: Partial<City> = {}): City => ({
  id: 'c1', name: 'Town', civilizationId: 0, col: 5, row: 5, population: 6,
  buildings: [], specialists: [], workingTiles: new Set(['5,5']),
  tradeRoutes: [], yields: { food: 6, production: 3, trade: 2 },
  isCapital: true,
  getTileAt: (_c: number, _r: number) => ({ type: 'grassland', terrain: 'grassland' }),
  ...over,
} as unknown as City);

const settler = (id: string, over: Partial<Unit> = {}): Unit => ({
  id, type: 'settler', civilizationId: 0, col: 5, row: 6,
  attack: 1, defense: 1, movesRemaining: 1,
  ...over,
} as unknown as Unit);

const hostile = (id: string, over: Partial<Unit> = {}): Unit => ({
  id, type: 'warrior', civilizationId: 1, col: 7, row: 6,
  attack: 3, defense: 2, movesRemaining: 1, isDefeated: false,
  ...over,
} as unknown as Unit);

describe('SettlerMemory site lifecycle', () => {
  it('records and retrieves a site', () => {
    const m = new SettlerMemory();
    m.recordTurn(10);
    m.recordSite({
      siteId: '7,7', col: 7, row: 7, yieldScore: 70, threatScore: 10,
      distanceFromCapital: 3, status: 'open',
    });
    const s = m.getSite('7,7');
    expect(s?.status).toBe('open');
    expect(s?.yieldScore).toBe(70);
    expect(s?.lastEvaluatedTurn).toBe(10);
  });

  it('ranks open high-yield low-threat sites first, excludes colonized/blocked/poor', () => {
    const m = new SettlerMemory();
    m.recordTurn(1);
    m.recordSite({ siteId: 'a', col: 1, row: 1, yieldScore: 80, threatScore: 5,
      distanceFromCapital: 2, status: 'open' });
    m.recordSite({ siteId: 'b', col: 2, row: 2, yieldScore: 90, threatScore: 5,
      distanceFromCapital: 2, status: 'colonized', colonizedByCivId: 0 });
    m.recordSite({ siteId: 'c', col: 3, row: 3, yieldScore: 50, threatScore: 80,
      distanceFromCapital: 2, status: 'blocked', blockedReason: 'enemy unit' });
    m.recordSite({ siteId: 'd', col: 4, row: 4, yieldScore: 20, threatScore: 5,
      distanceFromCapital: 2, status: 'poor' });

    const ranked = m.rankExpansionSites({ civId: 0 });
    expect(ranked.map((s) => s.siteId)).toEqual(['a']);
    expect(ranked.length).toBe(1);
  });

  it('penalizes high-loss sites so settlers stop being fed to them', () => {
    const m = new SettlerMemory();
    m.recordTurn(1);
    m.recordSite({ siteId: 'death-trap', col: 1, row: 1, yieldScore: 90, threatScore: 10,
      distanceFromCapital: 2, status: 'open' });
    m.recordSite({ siteId: 'safe', col: 2, row: 2, yieldScore: 60, threatScore: 10,
      distanceFromCapital: 2, status: 'open' });
    // Three settlers died at the death-trap.
    m.recordSettlerLost('death-trap', 1);
    m.recordSettlerLost('death-trap', 2);
    m.recordSettlerLost('death-trap', 3);

    const ranked = m.rankExpansionSites({ civId: 0 });
    expect(ranked.map((s) => s.siteId)).toEqual(['safe', 'death-trap']);
    expect(m.getSite('death-trap')?.settlerLosses).toBe(3);
  });

  it('marks colonized / blocked / poor and excludes them from ranking', () => {
    const m = new SettlerMemory();
    m.recordTurn(1);
    m.recordSite({ siteId: 'x', col: 1, row: 1, yieldScore: 80, threatScore: 5,
      distanceFromCapital: 2, status: 'open' });
    m.markColonized('x', 0, 1);
    expect(m.getSite('x')?.status).toBe('colonized');
    expect(m.rankExpansionSites({ civId: 0 }).length).toBe(0);

    m.markPoor('x', 2);
    expect(m.getSite('x')?.status).toBe('poor');

    m.markBlocked('x', 'barb camp', 3);
    expect(m.getSite('x')?.blockedReason).toBe('barb camp');
    expect(m.getSite('x')?.status).toBe('blocked');
  });

  it('prunes stale entries past TTL but keeps colonized sites', () => {
    const m = new SettlerMemory({ siteTtlTurns: 5 });
    m.recordTurn(1);
    m.recordSite({ siteId: 'stale', col: 1, row: 1, yieldScore: 80, threatScore: 5,
      distanceFromCapital: 2, status: 'open' });
    m.recordSite({ siteId: 'kept', col: 2, row: 2, yieldScore: 80, threatScore: 5,
      distanceFromCapital: 2, status: 'colonized', colonizedByCivId: 0 });
    m.recordTurn(10); // 9 turns past evaluation > TTL 5

    expect(m.getSite('stale')).toBeNull();
    expect(m.getSite('kept')).not.toBeNull();
  });

  it('caps at maxSites, dropping oldest non-colonized first', () => {
    const m = new SettlerMemory({ maxSites: 3 });
    m.recordTurn(1);
    for (const id of ['a', 'b', 'c']) {
      m.recordSite({ siteId: id, col: 1, row: 1, yieldScore: 80, threatScore: 5,
        distanceFromCapital: 2, status: 'open' });
    }
    expect(m.getSiteCount()).toBe(3);
    m.recordTurn(2);
    m.recordSite({ siteId: 'd', col: 1, row: 1, yieldScore: 80, threatScore: 5,
      distanceFromCapital: 2, status: 'open' });
    // Oldest open ('a') dropped to make room; capped at 3.
    expect(m.getSiteCount()).toBe(3);
    expect(m.getSite('a')).toBeNull();
    expect(m.getSite('d')).not.toBeNull();
  });

  it('expansion aggressiveness falls as settlers die, reaching 0 under heavy loss', () => {
    const m = new SettlerMemory();
    m.recordTurn(1);
    expect(m.getExpansionAggressiveness()).toBe(1.0); // no data: safe

    // 10 built, 9 lost this turn -> high loss rate + recent-loss clamp -> ~0.
    for (let i = 0; i < 10; i++) m.recordSettlerBuilt();
    for (let i = 0; i < 9; i++) m.recordSettlerLost(undefined, 1);
    expect(m.getExpansionAggressiveness()).toBeLessThan(0.1);

    // A fresh, loss-free civ is fully aggressive again.
    const m2 = new SettlerMemory();
    m2.recordTurn(1);
    for (let i = 0; i < 10; i++) m2.recordSettlerBuilt();
    expect(m2.getExpansionAggressiveness()).toBe(1.0);
  });

  it('tile improvement memory stops re-assignment', () => {
    const m = new SettlerMemory();
    m.recordTurn(1);
    m.recordTileImproved('6,6', 'irrigation', 's1', 1);
    expect(m.isTileImproved('6,6')).toBe(true);
    expect(m.getTileImprovement('6,6')?.improvementType).toBe('irrigation');
    expect(m.isTileImproved('6,7')).toBe(false);
    expect(m.getLedger().tilesImproved).toBe(1);
  });

  it('ledger tracks builds, losses, colonies and improvements', () => {
    const m = new SettlerMemory();
    m.recordTurn(1);
    m.recordSettlerBuilt();
    m.recordSettlerBuilt();
    m.recordSettlerLost('x', 1);
    m.recordSiteColonized();
    m.recordTileImproved('t', 'road', 's1', 1);
    const ledger = m.getLedger();
    expect(ledger.settlersBuilt).toBe(2);
    expect(ledger.settlersLost).toBe(1);
    expect(ledger.sitesColonized).toBe(1);
    expect(ledger.tilesImproved).toBe(1);
    expect(ledger.lastLossTurn).toBe(1);
  });
});

describe('evaluateColonySite helper', () => {
  it('scores a settled city site as colonized with yield from population', () => {
    const m = new SettlerMemory();
    const engine = new GameEngine(null);
    (engine as unknown as { cities: City[] }).cities = [
      city({ col: 5, row: 5, population: 8, yields: { food: 6, production: 3, trade: 2 } }),
    ];
    const out = evaluateColonySite({
      col: 5, row: 5, civId: 0,
      cities: engine.cities,
      units: [],
      memory: m,
    });
    expect(out.status).toBe('colonized');
    expect(out.yieldScore).toBeGreaterThan(50);
  });

  it('scores an unsettled worked tile higher than an untouched one', () => {
    const m = new SettlerMemory();
    const engine = new GameEngine(null);
    const worked = city({ col: 1, row: 1, population: 3 });
    (worked.workingTiles as Set<string>).add('10,10');
    const untouched = city({ col: 1, row: 1, population: 3 });
    (engine as unknown as { cities: City[] }).cities = [worked, untouched];
    const good = evaluateColonySite({
      col: 10, row: 10, civId: 0,
      cities: engine.cities, units: [], memory: m,
    });
    const bad = evaluateColonySite({
      col: 20, row: 20, civId: 0,
      cities: engine.cities, units: [], memory: m,
    });
    expect(good.yieldScore).toBeGreaterThan(bad.yieldScore);
  });

  it('flags high-threat sites as contested', () => {
    const m = new SettlerMemory();
    const engine = new GameEngine(null);
    (engine as unknown as { cities: City[] }).cities = [city()];
    // A strong hostile ON the candidate tile (no city there) -> contested.
    const out = evaluateColonySite({
      col: 7, row: 7, civId: 0,
      cities: engine.cities,
      units: [hostile('h1', { col: 7, row: 7, attack: 6, defense: 4 })],
      memory: m,
    });
    expect(out.status).toBe('contested');
    expect(out.threatScore).toBeGreaterThan(60);

    // No hostile nearby -> open.
    const quiet = evaluateColonySite({
      col: 20, row: 20, civId: 0,
      cities: engine.cities,
      units: [],
      memory: m,
    });
    expect(quiet.status).toBe('open');
    expect(quiet.threatScore).toBe(0);
  });
});

describe('SettlerGovernor memory integration', () => {
  const gov = () => new SettlerGovernor();

  it('updateFromCities advances the memory turn clock', () => {
    const g = gov();
    const units = [settler('s1')];
    const cities = [city()];
    g.updateFromCities(cities, units, 7);
    expect(g.currentTurnNumber()).toBe(7);
  });

  it('does not re-assign an already-improved tile to another settler', () => {
    const g = gov();
    const cities = [city({ workingTiles: new Set(['5,5', '6,6']) })];

    // Turn 1: s1 walks to 6,6 (the only workable tile besides the city center).
    g.updateFromCities(cities, [settler('s1', { col: 5, row: 6 })], 1);
    expect(g.getAssignment('s1')?.targetCol).toEqual(6);

    // s1 completes the improvement.
    g.recordTileImproved('6,6', 'irrigation', 's1', 1);

    // Turn 2: s2 has no assignment; 6,6 is remembered as improved so s2 is
    // not sent there a second time.
    g.updateFromCities(
      cities,
      [settler('s1', { col: 5, row: 6 }), settler('s2', { col: 5, row: 7 })],
      2,
    );
    expect(g.getAssignment('s2')).toBeUndefined();
    expect(g.isTileImproved('6,6')).toBe(true);
  });

  it('avoids high-threat tiles when choosing an improvement target', () => {
    // Two workable tiles: 6,6 (a hostile stands ON it) and 10,10 (four tiles
    // away, outside the threat radius). With the hostile present the governor
    // picks the safe far tile; without it, the nearer 6,6 wins.
    const threatened = gov();
    const safe = gov();
    const cities = [city({ workingTiles: new Set(['5,5', '6,6', '10,10']) })];

    threatened.updateFromCities(
      cities,
      [settler('s1', { col: 5, row: 6 }), hostile('h1', { col: 6, row: 6 })],
      1,
    );
    safe.updateFromCities(cities, [settler('s1', { col: 5, row: 6 })], 1);

    expect(threatened.getAssignment('s1')?.targetCol).toEqual(10);
    expect(safe.getAssignment('s1')?.targetCol).toEqual(6);
  });

  it('getRecommendedSettlerCount slows expansion when settlers keep dying', () => {
    const g = gov();
    const cities = [city({ population: 6 }), city({ population: 4 })];
    // No settlers alive yet -> the expansion need of 1 is unsatisfied.
    g.updateFromCities(cities, [], 1);
    const baseline = g.getRecommendedSettlerCount(cities, []);
    expect(baseline).toBe(1);

    // Pile up settler losses -> aggressiveness collapses -> recommendation drops to 0.
    for (let i = 0; i < 20; i++) g.recordSettlerBuilt();
    for (let i = 0; i < 18; i++) g.recordSettlerLost(undefined, 1);
    const paced = g.getRecommendedSettlerCount(cities, []);
    expect(paced).toBe(0);
    expect(paced).toBeLessThan(baseline);
    expect(g.getExpansionAggressiveness()).toBeLessThan(0.5);
  });

  it('stays backward compatible: construct and use with no memory arg', () => {
    const g = new SettlerGovernor();
    const units = [settler('s1')];
    const cities = [city({ population: 6 })];
    const rec = g.getRecommendedSettlerCount(cities, units);
    expect(typeof rec).toBe('number');
    expect(rec).toBeGreaterThanOrEqual(0);
  });
});
