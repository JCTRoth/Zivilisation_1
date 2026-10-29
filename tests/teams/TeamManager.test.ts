import { describe, expect, it } from 'vitest';
import { validateTeamAssignments } from '@/game/engine/TeamManager';
import { makeTeamEngine, teamSettings } from './teamHelpers';

describe('validateTeamAssignments', () => {
  it('rejects a missing assignment', () => {
    expect(validateTeamAssignments(undefined, 3).ok).toBe(false);
  });

  it('rejects the wrong number of slots', () => {
    const result = validateTeamAssignments([0, 1], 3);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('Expected 3');
  });

  it('rejects negative and non-integer team ids', () => {
    expect(validateTeamAssignments([0, -1, 1], 3).ok).toBe(false);
    expect(validateTeamAssignments([0, 1.5, 1], 3).ok).toBe(false);
  });

  it('rejects a single team (everyone allied is not a team game)', () => {
    expect(validateTeamAssignments([0, 0, 0], 3).ok).toBe(false);
  });

  it('rejects a game where every civ is alone', () => {
    const result = validateTeamAssignments([0, 1, 2], 3);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('share a team');
  });

  it('normalizes arbitrary team indices to a dense range', () => {
    const result = validateTeamAssignments([3, 7, 3, 7, 9], 5);
    expect(result.ok).toBe(true);
    expect(result.normalized).toEqual([0, 1, 0, 1, 2]);
    expect(result.teamCount).toBe(3);
  });
});

describe('TeamManager', () => {
  it('is disabled by default and for invalid assignments', () => {
    const engine = makeTeamEngine(3, [0, 0, 1]);
    expect(engine.teamManager.enabled).toBe(true);

    const freeForAll = makeTeamEngine(3, [0, 1, 2]);
    expect(freeForAll.teamManager.enabled).toBe(false);
    expect(freeForAll.teamManager.getTeamId(0)).toBeNull();
  });

  it('answers membership and teammate queries from one source of truth', () => {
    const { teamManager } = makeTeamEngine(4, [0, 0, 1, 1]);

    expect(teamManager.getTeamId(0)).toBe(0);
    expect(teamManager.getTeamId(1)).toBe(0);
    expect(teamManager.getTeamMembers(0)).toEqual([0, 1]);
    expect(teamManager.getTeamMembersOf(1)).toEqual([0, 1]);
    expect(teamManager.getTeammates(0)).toEqual([1]);
    expect(teamManager.isTeammate(0, 1)).toBe(true);
    expect(teamManager.isTeammate(0, 2)).toBe(false);
    // A civ is never its own teammate.
    expect(teamManager.isTeammate(0, 0)).toBe(false);
  });

  it('writes the denormalized team id onto every civilization', () => {
    const engine = makeTeamEngine(4, [0, 0, 1, 1]);
    expect(engine.civilizations.map((civ) => civ.teamId)).toEqual([0, 0, 1, 1]);
  });

  it('treats a team as alive while any member owns a unit or city', () => {
    const engine = makeTeamEngine(4, [0, 0, 1, 1]);
    engine.units = [{ id: 'u1', civilizationId: 1, isDefeated: false }];
    expect(engine.teamManager.isTeamAlive(0)).toBe(true);
    expect(engine.teamManager.isTeamAlive(1)).toBe(false);
    expect(engine.teamManager.getAliveTeamIds()).toEqual([0]);

    engine.units[0].isDefeated = true;
    engine.cities = [{ id: 'c1', civilizationId: 3 }];
    expect(engine.teamManager.isTeamAlive(0)).toBe(false);
    expect(engine.teamManager.isTeamAlive(1)).toBe(true);
  });

  it('falls back to free-for-all rather than throwing on a corrupt assignment', () => {
    const engine = makeTeamEngine(3, [0, 0, 1]);
    engine.teamManager.configure(teamSettings([0, 1]), 3);
    expect(engine.teamManager.enabled).toBe(false);
  });

  it('exposes stable team names and ids', () => {
    const { teamManager } = makeTeamEngine(3, [0, 0, 1]);
    expect(teamManager.getTeamIds()).toEqual([0, 1]);
    expect(teamManager.getTeamName(0)).toBe('Team 1');
    expect(teamManager.getTeamName(1)).toBe('Team 2');
    expect(teamManager.teamCount).toBe(2);
  });

  it('reset clears every map and disables the mode', () => {
    const engine = makeTeamEngine(3, [0, 0, 1]);
    engine.teamManager.reset();
    expect(engine.teamManager.enabled).toBe(false);
    expect(engine.teamManager.teamCount).toBe(0);
    expect(engine.teamManager.getTeamMembers(0)).toEqual([]);
  });
});
