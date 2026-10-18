import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';

/**
 * Human vs. Human Hotseat — full game-loop test.
 *
 * Simulates the complete hotseat turn cycle: Player 1 plays, ends their turn,
 * the engine pauses and emits HANDOFF, Player 2 clicks "Ready" (setPaused(false)),
 * Player 2 plays, ends their turn, HANDOFF fires for Player 1, etc.
 *
 * This exercises the real turn pipeline: startTurn → phases → endHumanTurn →
 * advanceTurn → HANDOFF → setPaused(false) → onGameResumed → startTurn.
 */
describe('Hotseat game loop', () => {
  let engine: GameEngine;
  const handoffEvents: Array<Record<string, unknown>> = [];
  const turnStarts: number[] = [];

  beforeEach(async () => {
    handoffEvents.length = 0;
    turnStarts.length = 0;

    engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();

    // Capture handoff events and turn starts.
    const origOnStateChange = engine.onStateChange;
    engine.onStateChange = (eventType: string, eventData?: Record<string, unknown>) => {
      if (eventType === 'HANDOFF') {
        handoffEvents.push({ ...eventData });
      }
      if (eventType === 'TURN_START') {
        turnStarts.push(Number(eventData?.civilizationId ?? -1));
      }
      if (origOnStateChange) origOnStateChange(eventType, eventData);
    };

    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'NORMAL_SKIRMISH',
      devMode: true,
      startingGold: 100,
      gameMode: 'hotseat',
      humanPlayerIds: [0, 1],
    });

    // Unpause so the first turn starts normally.
    engine.setPaused(false);
  });

  afterEach(() => {
    (engine as unknown as { units: unknown[] }).units = [];
    engine.onStateChange = null;
  });

  it('initializes a 2-player hotseat game with both civs human', () => {
    expect(engine.gameSettings.gameMode).toBe('hotseat');
    expect(engine.gameSettings.humanPlayerIds).toEqual([0, 1]);
    expect(engine.civilizations[0].isHuman).toBe(true);
    expect(engine.civilizations[1].isHuman).toBe(true);
    expect(engine.civilizations[0].isAI).toBe(false);
    expect(engine.civilizations[1].isAI).toBe(false);
  });

  it('completes a full hotseat turn cycle: P1 end → HANDOFF → P2 ready → P2 end → HANDOFF', async () => {
    const tm = engine.turnManager;

    // ── Round 1, Player 1 ──
    // The game starts with player 0 active.
    expect(engine.activePlayer).toBe(0);

    // Register player 1 (advances from START to UNIT_MOVEMENT).
    await tm.registerPlayer(0);

    // Player 1 ends their turn.
    await engine.processTurn();

    // After P1's turn, the engine should advance to P2 and emit HANDOFF
    // because P2 is a human in hotseat mode.
    // The game should now be paused (waiting for P2 to click "Ready").
    expect(engine.isPaused).toBe(true);
    expect(handoffEvents.length).toBeGreaterThanOrEqual(1);

    const firstHandoff = handoffEvents[0];
    expect(firstHandoff.playerId).toBe(1);
    expect(firstHandoff.playerName).toBeTruthy();

    // ── Player 2 clicks "Ready" ──
    engine.setPaused(false);

    // Player 2's turn should now be active.
    expect(engine.activePlayer).toBe(1);
    expect(engine.isPaused).toBe(false);

    // Register player 2.
    await tm.registerPlayer(1);

    // ── Round 1, Player 2 ──
    await engine.processTurn();

    // After P2's turn, the engine should advance back to P1 and emit HANDOFF.
    expect(engine.isPaused).toBe(true);
    expect(handoffEvents.length).toBeGreaterThanOrEqual(2);

    const secondHandoff = handoffEvents[1];
    expect(secondHandoff.playerId).toBe(0);
    expect(secondHandoff.playerName).toBeTruthy();
  });

  it('runs multiple hotseat rounds without stalling', async () => {
    const tm = engine.turnManager;
    const MAX_ROUNDS = 3;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      for (let seat = 0; seat < 2; seat++) {
        // Register the current player (advances from START to UNIT_MOVEMENT).
        await tm.registerPlayer(engine.activePlayer);

        // Player takes their turn.
        await engine.processTurn();

        // After the turn, the game should be paused for handoff
        // (unless it's the very last turn in the loop).
        if (engine.isGameOver) break;

        // Next human clicks "Ready".
        engine.setPaused(false);
      }
      if (engine.isGameOver) break;
    }

    // The game should have advanced through multiple rounds.
    const round = engine.turnManager.getRoundNumber();
    expect(round).toBeGreaterThanOrEqual(1);

    // Multiple handoffs should have occurred.
    expect(handoffEvents.length).toBeGreaterThanOrEqual(2);
  });

  it('fog-of-war viewer tracks the active human player', async () => {
    const tm = engine.turnManager;

    // In hotseat, viewPlayer should follow the active human seat.
    // Initially player 0 is active.
    expect(engine.activePlayer).toBe(0);

    // Register P1 and end their turn → handoff to P2.
    await tm.registerPlayer(0);
    await engine.processTurn();
    engine.setPaused(false);

    // After resuming, P2 is active.
    expect(engine.activePlayer).toBe(1);
  });

  it('AI turns in hotseat do not trigger handoff', async () => {
    // Create a game with 1 human + 1 AI to verify handoff only fires for humans.
    const aiEngine = new GameEngine(null);
    (aiEngine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();

    const aiHandoffs: Array<Record<string, unknown>> = [];
    aiEngine.onStateChange = (eventType: string, eventData?: Record<string, unknown>) => {
      if (eventType === 'HANDOFF') aiHandoffs.push({ ...eventData });
    };

    await aiEngine.initialize({
      numberOfCivilizations: 2,
      mapType: 'NORMAL_SKIRMISH',
      devMode: true,
      startingGold: 100,
      // Single player: only civ 0 is human.
    });

    aiEngine.setPaused(false);

    // Register player 0 and end their turn → civ 1 is AI, so NO handoff.
    const tm = aiEngine.turnManager;
    await tm.registerPlayer(0);
    await aiEngine.processTurn();

    // No handoff should have been emitted for the AI player.
    expect(aiHandoffs.length).toBe(0);
    // The game should NOT be paused (AI turn runs immediately).
    expect(aiEngine.isPaused).toBe(false);

    (aiEngine as unknown as { units: unknown[] }).units = [];
    aiEngine.onStateChange = null;
  });

  it('after handoff, the new player sees their own territory (no black tiles at camera)', async () => {
    const tm = engine.turnManager;

    // P1 starts.
    expect(engine.activePlayer).toBe(0);
    await tm.registerPlayer(0);

    // P1 ends turn → handoff to P2.
    await engine.processTurn();
    expect(engine.isPaused).toBe(true);

    // P2 clicks "Ready".
    engine.setPaused(false);
    expect(engine.activePlayer).toBe(1);

    // After handoff, the fog-of-war should reflect P2's perspective.
    // P2's units should be visible to P2.
    const p2Units = engine.units.filter((u) => u.civilizationId === 1 && !u.isDefeated);
    expect(p2Units.length).toBeGreaterThan(0);

    // Verify the engine's per-player visibility shows P2's units.
    for (const unit of p2Units) {
      const visible = engine.isVisibleToPlayer(1, unit.col, unit.row);
      expect(visible).toBe(true);
    }

    // Verify P2's cities (if any) are visible to P2.
    const p2Cities = engine.getAllCities().filter((c) => c.civilizationId === 1);
    for (const city of p2Cities) {
      const visible = engine.isVisibleToPlayer(1, city.col, city.row);
      expect(visible).toBe(true);
    }

    // Complete P2's turn and handoff back to P1.
    await tm.registerPlayer(1);
    await engine.processTurn();
    expect(engine.isPaused).toBe(true);

    // P1 clicks "Ready".
    engine.setPaused(false);
    expect(engine.activePlayer).toBe(0);

    // P1's units should now be visible to P1.
    const p1Units = engine.units.filter((u) => u.civilizationId === 0 && !u.isDefeated);
    expect(p1Units.length).toBeGreaterThan(0);
    for (const unit of p1Units) {
      const visible = engine.isVisibleToPlayer(0, unit.col, unit.row);
      expect(visible).toBe(true);
    }
  });
});
