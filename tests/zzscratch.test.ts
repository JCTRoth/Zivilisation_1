import { describe, it, expect, vi } from 'vitest';
import { makeEngine } from './helpers/world';
import { NOMAD_CIV_ID, NOMAD_TRIGGER_ROUND } from '@/data/NomadConstants';

describe('scratch race', () => {
  it('prints the race window', async () => {
    const w = await makeEngine({ numberOfCivilizations: 3, seed: 4242 });
    const events: any[] = [];
    (w.engine as any).onStateChange = (t: string, d: any) => events.push({ type: t, data: d });
    const spot = w.landNear(10, 10, 8);
    w.settle('Haven', spot.col, spot.row, 0, 1);
    const nm = w.engine.nomadManager as any;
    nm.processRound(NOMAD_TRIGGER_ROUND);
    const camp = w.engine.units.filter((u: any) => u.civilizationId === NOMAD_CIV_ID)[0];
    w.engine.units.push({ id: 'witness', type: 'warriors', civilizationId: 0, col: camp.col, row: camp.row, movesRemaining: 1, maxMoves: 1, health: 100, attack: 1, defense: 1, icon: 'x', orders: null, isDefeated: false });
    nm.processRound(NOMAD_TRIGGER_ROUND + 1);
    nm.resolveParley('maps');
    w.engine.civilizations[1].resources.gold = 500;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    for (let r = NOMAD_TRIGGER_ROUND + 2; r <= NOMAD_TRIGGER_ROUND + 25; r++) {
      nm.processRound(r);
      if (r >= 6) console.log(`r${r} camps=${nm.camps.length} riders=${nm.camps.map((c: any) => c.unitIds.length).join('+')} live=${nm.liveParley} resolved=${nm.camps.map((c: any) => c.parleyResolvedRound).join(',')} hired=${nm.isHired} gold1=${w.engine.civilizations[1].resources.gold}`);
    }
    spy.mockRestore();
    expect(true).toBe(true);
  });
});
