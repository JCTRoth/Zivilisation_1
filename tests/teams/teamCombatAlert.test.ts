import { describe, it, expect, beforeEach, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { EngineEventRouter } from '@/utils/EngineEventHandlers';
import { useGameStore } from '@/stores/GameStore';

/**
 * Ally combat alerts: when the human's locked teammate is attacked, the toast
 * must route to the human (seat 0) so `NotificationCenter` shows it. Before
 * fixed alliances, only civ 0 itself counted as "the human", so a teammate's
 * battle was routed to the teammate's civ id and filtered away — the player
 * never heard their own team was under attack.
 */
vi.mock('@/utils/Sfx', () => ({ playSfx: vi.fn() }));

const unit = (id: string, civilizationId: number, col: number, row: number) => ({
  id,
  civilizationId,
  type: 'warrior',
  col,
  row,
  movesRemaining: 1,
  health: 90,
  icon: '⚔️',
  isDefeated: false,
});

async function makeGame(fixedAlliances: boolean): Promise<GameEngine> {
  const engine = new GameEngine(null);
  (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
  (engine as unknown as { isPaused: boolean }).isPaused = true;
  await engine.initialize({
    numberOfCivilizations: 3,
    mapType: 'NORMAL_SKIRMISH',
    mapWidth: 40,
    mapHeight: 30,
    devMode: false,
    startingGold: 100,
    ...(fixedAlliances ? { fixedAlliances: true, teamAssignments: [0, 0, 1] } : {}),
  });
  const router = new EngineEventRouter(engine);
  engine.onStateChange = (type: string, data?: Record<string, unknown>) =>
    router.handle(type, data ?? {});
  return engine;
}

const lastAlertCiv = (): number | undefined =>
  useGameStore.getState().uiState.notifications.at(-1)?.civId;

describe('ally combat alerts', () => {
  beforeEach(() => {
    // A human must exist in the store or addNotification would drop everything
    // for its AI-vs-AI guard; start each case from a clean notification list.
    useGameStore.setState((s) => ({
      ...s,
      civilizations: [{ id: 0, name: 'Human', isHuman: true } as never],
      uiState: { ...s.uiState, notifications: [] },
    }));
  });

  it('a teammate under attack alerts the human (routed to seat 0)', async () => {
    const engine = await makeGame(true);
    // civ 1 is the human's locked teammate; civ 2 the attacker.
    engine.onStateChange!('COMBAT_HIT', {
      attacker: unit('atk', 2, 5, 5),
      defender: unit('dfn', 1, 6, 5),
    });
    expect(lastAlertCiv()).toBe(0);
  });

  it('free-for-all keeps the old routing (teammate-equivalent does not become "the human")', async () => {
    const engine = await makeGame(false);
    engine.onStateChange!('COMBAT_HIT', {
      attacker: unit('atk', 2, 5, 5),
      defender: unit('dfn', 1, 6, 5),
    });
    // In free-for-all civ 1 is nobody's ally, so the toast routes to the first
    // party (the attacker, civ 2) — exactly as before fixed alliances existed.
    expect(lastAlertCiv()).not.toBe(0);
  });
});
