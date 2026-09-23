/**
 * Reproduction: two AI scouts from different civilizations standing in front
 * of each other should NOT freeze into a permanent "skip" loop — they should
 * fight, flank around, or keep moving.
 */
import { describe, expect, it, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';

describe('AI scouts blocking each other', () => {
  let engine: GameEngine | null = null;

  afterEach(() => {
    if (engine) {
      (engine as unknown as { units: unknown[] }).units = [];
      (engine as unknown as { cities: unknown[] }).cities = [];
      (engine as unknown as { civilizations: unknown[] }).civilizations = [];
      engine = null;
    }
  });

  async function makeEngine() {
    const e = new GameEngine(null);
    (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (e as unknown as { isPaused: boolean }).isPaused = true;
    await e.initialize({ numberOfCivilizations: 2, mapType: 'AI_VS_AI', devMode: false, startingGold: 100 });
    for (const civ of e.civilizations) { civ.isHuman = false; civ.isAI = true; }
    return e;
  }

  /** Find a pair of adjacent, passable, unoccupied tiles on the real map. */
  function findAdjacentPair(e: GameEngine): { a: { col: number; row: number }; b: { col: number; row: number } } | null {
    const w = (e as unknown as { map: { width: number; height: number } }).map.width;
    const h = (e as unknown as { map: { width: number; height: number } }).map.height;
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    for (let col = 1; col < w - 1; col++) {
      for (let row = 1; row < h - 1; row++) {
        if (!e.isTilePassable(col, row)) continue;
        for (const [dc, dr] of dirs) {
          const c2 = col + dc, r2 = row + dr;
          if (c2 < 0 || r2 < 0 || c2 >= w || r2 >= h) continue;
          if (!e.isTilePassable(c2, r2)) continue;
          if (e.getUnitAt(col, row) || e.getUnitAt(c2, r2)) continue;
          if (e.getCityAt(col, row) || e.getCityAt(c2, r2)) continue;
          return { a: { col, row }, b: { col: c2, row: r2 } };
        }
      }
    }
    return null;
  }

  function spawnScout(e: GameEngine, civId: number, col: number, row: number): string {
    const scout = {
      id: `scout_${civId}_${col}_${row}`,
      type: 'scout',
      civilizationId: civId,
      col, row,
      health: 100,
      movesRemaining: 2,
      maxMoves: 2,
      isVeteran: false,
      attack: 0.5,
      defense: 1,
      icon: 'scout',
      orders: 'none',
      homeCityId: '',
      areTurnsDone: false,
      isSkipped: false,
    } as never;
    (e as unknown as { units: unknown[] }).units.push(scout);
    return (scout as { id: string }).id;
  }

  /**
   * Run `rounds` full rounds, returning per-round positions of the scouts plus
   * how many movement log lines were emitted each round. A unit can move
   * several tiles inside one round and still end it where it started, so
   * "frozen" is measured by ACTUAL movement, not by the end-of-round tile.
   */
  async function runRounds(
    e: GameEngine,
    ids: string[],
    rounds: number,
  ): Promise<{ positions: Array<Record<string, string>>; logs: string[]; movesPerRound: number[] }> {
    const logs: string[] = [];
    const realLog = console.log;
    const realWarn = console.warn;
    const realError = console.error;
    const capture = (tag: string, args: unknown[]) =>
      logs.push(`[${tag}] ` + args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
    console.log = (...args: unknown[]) => capture('log', args);
    console.warn = (...args: unknown[]) => capture('warn', args);
    console.error = (...args: unknown[]) => capture('err', args);
    (e as unknown as { log: unknown }).log = (...args: unknown[]) => capture('engine', args);

    const pos = (id: string) => {
      const u = e.units.find((x) => x.id === id);
      return u ? `${u.col},${u.row}` : 'gone';
    };
    const positions: Array<Record<string, string>> = [];
    const movesPerRound: number[] = [];
    const movementLines = (): number => logs.filter((l) => l.includes('[MOVEMENT]')).length;

    // Mimic TurnManager.resetUnitsForPlayer — the real turn cycle does this
    // before each civ's turn (fresh moves, cleared skip/sleep/fortify flags).
    const UNIT_PROPS = ((e as unknown as { constructor: { UNIT_PROPS?: Record<string, { movement?: number }> } }).constructor.UNIT_PROPS) || {};
    const resetFor = (civId: number) => {
      for (const u of e.units) {
        if (u.civilizationId !== civId) continue;
        // The scripted "allied blocker" must stay put: if the AI is allowed to
        // move it too, the corridor opens randomly and the scenario tests
        // nothing (pre-existing map/random flake).
        if (String(u.id).startsWith('ally_')) {
          u.movesRemaining = 0;
          u.areTurnsDone = true;
          continue;
        }
        u.movesRemaining = UNIT_PROPS[u.type]?.movement ?? 1;
        u.hasMovedThisTurn = false;
        u.areTurnsDone = false;
        u.isSkipped = false;
        u.isSleeping = false;
        u.isFortified = false;
      }
    };

    // Replay stored GoTo paths first, exactly like advanceToPhase(UNIT_MOVEMENT).
    const tm = (e as unknown as { turnManager: { processAutomatedMovements: (civId: number) => Promise<void> } }).turnManager;

    try {
      for (let round = 0; round < rounds; round++) {
        const movesBefore = movementLines();
        for (let civId = 0; civId < e.civilizations.length; civId++) {
          resetFor(civId);
          (e as unknown as { activePlayer: number }).activePlayer = civId;
          (e as unknown as { isPaused: boolean }).isPaused = false;
          await tm.processAutomatedMovements(civId);
          await e.aiManager.processAITurn(civId);
          (e as unknown as { isPaused: boolean }).isPaused = true;
        }
        movesPerRound.push(movementLines() - movesBefore);
        const snapshot: Record<string, string> = {};
        for (const id of ids) snapshot[id] = pos(id);
        positions.push(snapshot);
      }
    } finally {
      console.log = realLog;
      console.warn = realWarn;
      console.error = realError;
    }
    return { positions, logs, movesPerRound };
  }

  /** True when a scout sat in the same tile for the last 3+ rounds while alive. */
  function isFrozen(positions: Array<Record<string, string>>, id: string): boolean {
    const last = positions.slice(-4).map((p) => p[id]);
    if (last.includes('gone')) return false;
    return last.every((p) => p === last[0]);
  }

  async function scenario(
    pair: { a: { col: number; row: number }; b: { col: number; row: number } },
    civB: number = 1,
  ) {
    engine = await makeEngine();
    const e = engine;
    (e as unknown as { units: unknown[] }).units = [];
    (e as unknown as { cities: unknown[] }).cities = [];
    const sA = spawnScout(e, 0, pair.a.col, pair.a.row);
    const sB = spawnScout(e, civB, pair.b.col, pair.b.row);
    const { positions, logs } = await runRounds(e, [sA, sB], 10);
    const frozenA = isFrozen(positions, sA);
    const frozenB = isFrozen(positions, sB);
    const skipLogs = logs.filter((l) => l.includes('skip') || l.includes('No path') || l.includes('blocked'));
    const fallbackLogs = logs.filter((l) => l.includes('Fallback move'));
    return {
      frozenA,
      frozenB,
      skipLogs,
      fallbackLogs,
      logs,
      start: `${sA}=${positions[0][sA]} ${sB}=${positions[0][sB]}`,
      end: `${sA}=${positions[positions.length - 1][sA]} ${sB}=${positions[positions.length - 1][sB]}`,
    };
  }

  it('adjacent enemy scouts keep resolving (move/fight) instead of skipping forever', async () => {
    const probe = await makeEngine();
    const pair = findAdjacentPair(probe);
    (probe as unknown as { units: unknown[] }).units = [];
    (probe as unknown as { cities: unknown[] }).cities = [];
    (probe as unknown as { civilizations: unknown[] }).civilizations = [];
    expect(pair).not.toBeNull();
    const result = await scenario(pair!);
    expect(result.frozenA || result.frozenB, `stuck!\n${JSON.stringify(result.skipLogs.slice(0, 20), null, 2)}`).toBe(false);
  }, 120000);

  it('a scout whose ONLY route runs through an ALLIED unit marches through the stack instead of freezing', async () => {
    // ── Deterministic corridor ─────────────────────────────────────────────
    // A village sits at the end of a corridor. The ONLY route to it runs
    // through an ALLIED civ-0 warrior. Civ1 stacking lets the scout pass
    // through/onto the allied tile: it must keep moving (no freeze, no
    // permanent "Path step failed → skip" loop).
    engine = await makeEngine();
    const e = engine;
    (e as unknown as { units: unknown[] }).units = [];
    (e as unknown as { cities: unknown[] }).cities = [];

    // Scout start, allied blocker, village target — a straight north-south
    // corridor where the ONLY route to the village runs through the ally.
    // (AI_VS_AI map is 40x40, cols/rows 0-39; the corridor sits well inside.)
    const scout = spawnScout(e, 0, 20, 20);
    // Allied warrior directly in front of the scout (blocks the only route).
    (e as unknown as { units: unknown[] }).units.push({
      id: 'ally_warrior', type: 'warrior', civilizationId: 0, col: 20, row: 19,
      health: 100, movesRemaining: 1, maxMoves: 1, attack: 1, defense: 1,
      icon: 'warrior', orders: 'none', homeCityId: '', areTurnsDone: false, isSkipped: false,
    } as never);

    // Carve the corridor: everything in the box is ocean EXCEPT the corridor
    // (20,20)→(20,19)[ally]→(20,18)→(20,17)[village] and two fallback lanes
    // (19,20)/(21,20). The diagonal tiles (19,19),(21,19),(19,18),(21,18) are
    // ocean so even with 8-directional movement the ONLY route to the village
    // runs through the allied warrior.
    const grid = (e as unknown as { map: { tiles: { type: string; village?: boolean; explored?: boolean }[]; width: number } }).map;
    const PASSABLE = new Set([
      '20,20', '20,19', '20,18', '20,17', // corridor + village
      '19,20', '21,20', '19,21', '21,21', // fallback lanes
    ]);
    for (let c = 15; c <= 25; c++) {
      for (let r = 15; r <= 25; r++) {
        const tile = grid.tiles[r * grid.width + c];
        if (!tile) continue;
        tile.type = PASSABLE.has(`${c},${r}`) ? 'grassland' : 'ocean';
      }
    }
    // The scripted terrain rewrite changed landmass connectivity — drop the
    // cached graph so the AI's island movement sees the corridor.
    (e as unknown as { invalidateLandmassCache?: () => void }).invalidateLandmassCache?.();

    // Place a village beyond the ally and mark it explored so the scout
    // deterministically targets it (findNearestVillage runs before enemy scan).
    // It is unreachable except through the ally — the exact "path step blocked"
    // deadlock from the game logs (Huns scout stuck on (21,1) for 30 rounds).
    const villageTile = grid.tiles[17 * grid.width + 20];
    villageTile.village = true;
    villageTile.explored = true;
    const ps = e.getPlayerStorage(0) as unknown as { explored: boolean[] };
    ps.explored[17 * grid.width + 20] = true;

    const { positions, logs, movesPerRound } = await runRounds(e, [scout], 6);
    // "Frozen" means NO movement for several rounds. End-of-round position is
    // not a valid freeze signal: a scout can patrol several tiles inside one
    // round and still finish where it started.
    const frozen = movesPerRound.slice(-3).every((moves) => moves === 0);
    const roundTrace = positions.map((p, i) => `r${i}:${p[scout]}`).join(' ');
    // Civ1 stacking: an ALLIED unit no longer blocks the route — the scout
    // marches through/onto the allied tile (row <= 19 in the corridor) instead
    // of freezing or being forced onto a fallback lane.
    const passedBlocker = positions.some((p) => {
      const [col, row] = String(p[scout] ?? '').split(',').map(Number);
      return col === 20 && Number.isFinite(row) && row <= 19;
    });
    expect(passedBlocker, `scout never used the allied tile\npositions: ${roundTrace}\nLOGS:\n${logs.slice(0, 120).join('\n')}`).toBe(true);
    // …and the scout must not sit still for rounds on end.
    expect(frozen, `scout froze\npositions: ${roundTrace}\nmoves: ${movesPerRound.join(',')}\nLOGS:\n${logs.slice(0, 120).join('\n')}`).toBe(false);
  }, 120000);
});
