/**
 * Diagnostic (tmp): why are settlers idle in the idleUnits scenario?
 * Buckets idle settler turns by whether the civ still owns a city, and prints
 * the AI's own log lines for the settlers that stood still.
 */
import { describe, it } from 'vitest';
import { makeEngine, useSeededRandom } from '../helpers/world';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';

describe('tmp idle diag', () => {
  it('diagnoses', async () => {
    useSeededRandom(4242);
    const world = await makeEngine({ mapType: 'AI_VS_AI', numberOfCivilizations: 4, seed: 777 });
    const engine = world.engine as any;

    let t = 0;
    const trace: string[] = [];
    const warns: Record<string, number> = {};
    const origWarn = console.warn; const origErr = console.error;
    console.warn = (...a: unknown[]) => { const k = String(a[0] ?? '').slice(0, 60); warns['WARN ' + k] = (warns['WARN ' + k] ?? 0) + 1; };
    console.error = (...a: unknown[]) => { const k = String(a[0] ?? '').slice(0, 60); warns['ERR ' + k] = (warns['ERR ' + k] ?? 0) + 1; };
    const origLog = console.log;
    console.log = (...a: unknown[]) => {
      const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
      if (trace.length < 400 && /SETTLER|settler/i.test(line)) trace.push(`t${t} ${line}`);
    };
    const globalLogs: Record<string, number> = {};
    const trail: string[] = [];
    const logByUnit = new Map<string, string[]>();
    const events: Record<string, number> = {};
    engine.onStateChange = (type: string, data: any) => {
      events[type] = (events[type] ?? 0) + 1;
      if (type === 'GAME_LOG') {
        if (data?.unitType === 'settler' || data?.unit?.type === 'settler') {
          const gk = `${data.action}${data.reason ? ':' + data.reason : ''}`;
          globalLogs[gk] = (globalLogs[gk] ?? 0) + 1;
        }
        const key = `${data?.unitId ?? ''}`;
        if (!key) return;
        const arr = logByUnit.get(key) ?? [];
        arr.push(`${data.action}${data.reason ? ':' + data.reason : ''}`);
        logByUnit.set(key, arr.slice(-4));
      }
      if (['CITY_FOUNDED', 'UNIT_DISBANDED', 'CITY_CAPTURED', 'CITY_DESTROYED'].includes(type)) {
        if (trail.length < 40) trail.push(`t${t} ${type} ${JSON.stringify(data).slice(0, 160)}`);
      }
    };

    const bucket = {
      withCity: { idle: 0, turns: 0 },
      noCity: { idle: 0, turns: 0 },
    };
    const idleLogs: Record<string, number> = {};
    let noCityTurnsSeen = 0;

    for (t = 1; t <= 120; t++) {
      const before = new Map<any, any>((engine.units ?? []).map((u: any) => [u.id, {
        col: u.col, row: u.row, workTarget: u.workTarget ?? '', workTurns: u.workTurns ?? 0,
        fortified: u.isFortified === true, asleep: u.isSleeping === true,
      }]));
      const eng: any = engine;
      const origProc = eng.processAITurn.bind(eng);
      eng.processAITurn = async (id: number) => { eng.isPaused = false; return origProc(id); };
      try { await world.runTurns(1); } catch (e) { (warns['THROW'] = (warns['THROW'] ?? 0) + 1); }
      eng.processAITurn = origProc;
      const after = new Map<any, any>((engine.units ?? []).map((u: any) => [u.id, {
        col: u.col, row: u.row, workTarget: u.workTarget ?? '', workTurns: u.workTurns ?? 0,
        fortified: u.isFortified === true, asleep: u.isSleeping === true,
      }]));

      const civHasCities = new Map<number, boolean>();
      for (const civ of engine.civilizations) {
        civHasCities.set(civ.id, (engine.cities ?? []).some((c: any) => c.civilizationId === civ.id));
      }

      for (const [id, prev] of before) {
        const unit = (engine.units ?? []).find((u: any) => u.id === id);
        if (!unit || unit.type !== 'settler') continue;
        const now = after.get(id)!;
        const b = civHasCities.get(unit.civilizationId) ? bucket.withCity : bucket.noCity;
        b.turns++;
        const acted = now.col !== prev.col || now.workTarget !== '' || now.workTurns !== 0;
        if (acted || now.fortified || now.asleep) continue;
        b.idle++;
        const st: any = (unit as any);
        const key = [
          st._aiSettlement ? `settle=${st._aiSettlement.col},${st._aiSettlement.row}` : 'settle=none',
          st._aiWorksTarget ? `works=${st._aiWorksTarget.col},${st._aiWorksTarget.row}` : 'works=none',
          st._lastSettlementTarget ? `lock=${st._lastSettlementTarget.col},${st._lastSettlementTarget.row}` : 'lock=none',
          `pos=${st.col},${st.row}`,
          `blocked=${(st._blockedSettlementTargets?.size ?? 0)}`,
          `age=${st._lockedTargetAge ?? '-'}`,
          `canFound=${(engine.canPlaceCityAt(st.col, st.row, st.civilizationId) ? 'y' : 'n')}`,
          `blockedHere=${(engine.getCityAt?.(st.col, st.row) ? 'city' : '-')}`,
          `mv=${st.movesRemaining}/${st.maxMoves}`,
          `skip=${st.isSkipped === true ? 1 : 0}`,
          `done=${st.areTurnsDone === true ? 1 : 0}`,
          `wt=${st.workTurns ?? 0}`,
          `wtStr=${JSON.stringify(st.workTarget ?? '')}`,
          `imp=${(engine.getTileAt?.(st.col, st.row) as any)?.improvement ?? '-'}`,
          `terr=${(engine.getTileAt?.(st.col, st.row) as any)?.terrain ?? '-'}`,
        ].join(' ');
        idleLogs[key] = (idleLogs[key] ?? 0) + 1;
      }
      if (!civHasCities.get(0) && !civHasCities.get(1)) noCityTurnsSeen++;
    }

    console.log = origLog; console.warn = origWarn; console.error = origErr;
    console.log('DIAG buckets', JSON.stringify(bucket));
    console.log('DIAG warns', JSON.stringify(warns, null, 1));
    console.log('DIAG colony/invasion missions');
    for (const civ of engine.civilizations ?? []) {
      const st: any = (engine as any).getPlayerStorage?.(civ.id);
      if (!st) continue;
      console.log(` civ ${civ.id} keys=${Object.keys(st).join('|')} colony=${JSON.stringify(st.colonyMission ?? null)?.slice(0,200)} invasion=${JSON.stringify(st.invasionMission ?? null)?.slice(0,120)}`);
    }
    console.log('DIAG trace window');
    console.log(trace.filter((l) => / t(3[0-9]|4[0-2]) /.test(l)).slice(0, 60).join('\n'));
    console.log('DIAG settler logs', JSON.stringify(globalLogs, null, 1));
    console.log('DIAG idle log tails', JSON.stringify(idleLogs, null, 1));
    console.log('DIAG events', JSON.stringify({
      founded: events.CITY_FOUNDED ?? 0,
      captured: events.CITY_CAPTURED ?? 0,
      destroyed: events.CITY_DESTROYED ?? 0,
      disbanded: events.UNIT_DISBANDED ?? 0,
      defeated: events.UNIT_DEFEATED ?? 0,
    }));
    console.log('DIAG units', (engine.units ?? []).map((u: any) => `${u.type}#${u.civilizationId}`).join(' '));
    console.log('DIAG cities', (engine.cities ?? [])
      .map((c: any) => `${c.name}#${c.civilizationId === BARBARIAN_CIV_ID ? 'BARB' : c.civilizationId}:${c.population}`)
      .join(' '));
    console.log('DIAG trail', trail.join('\n  '));
    console.log('DIAG civs', (engine.civilizations ?? [])
      .map((c: any) => `${c.id}:${c.name} alive=${c.isAlive} units=${(engine.units ?? []).filter((u: any) => u.civilizationId === c.id).length}`)
      .join(' | '));
  }, 900_000);
});
