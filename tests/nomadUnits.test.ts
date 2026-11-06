/**
 * Nomads — their EQUIVALENT units.
 *
 * The tribe does not build: it BUYS, and what it buys mirrors what the
 * players can field. Pinned here:
 *
 *   * a foot copy is a 1:1 mirror of the player's ground unit — only the
 *     name and the picture differ, never a number;
 *   * the mounted shape keeps every number but one step of movement and
 *     costs the beast (×1.5 gold) — and only for soldiers, never for a
 *     tank on a camel;
 *   * no court can ever build one: the equivalent enters the world through
 *     the tribe's war chest, never through a production list;
 *   * the tribe mirrors progress (strongest soldier anybody can build) and
 *     buys foot first, mounted on alternate musters;
 *   * the mounted unit wears its faction's beast (camel / horse / reindeer);
 *   * the name reads "Nomad …" / "Mounted …" in the active language.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeEngine } from './helpers/world';
import {
  NOMAD_MIRRORED_UNITS,
  NOMAD_MOUNTED_UNITS,
  nomadFootType,
  nomadMountedType,
} from '@/data/UnitConstants';
import { UNIT_PROPS } from '@/utils/Constants';
import { canBuildUnit } from '@/game/engine/AI/AITypes';
import { NOMAD_MOUNT_ICONS, NOMAD_SPAWN_UNITS } from '@/data/NomadConstants';
import { tUnitName } from '@/i18n/dataNames';

type Engine = Awaited<ReturnType<typeof makeEngine>>['engine'];

const GATE = 'nomad_bazaar_only';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A single-human world (the tribe only ever exists for one human seat). */
async function world(): Promise<{ engine: Engine; events: Array<{ type: string; data: any }> }> {
  const w = await makeEngine({ numberOfCivilizations: 3, seed: 4242 });
  const events: Array<{ type: string; data: any }> = [];
  (w.engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });
  const spot = w.landNear(10, 10, 8);
  w.settle('Haven', spot.col, spot.row, 0, 1);
  return { engine: w.engine, events };
}

/** Give a court a technology whichever shape its `technologies` takes. */
function learn(engine: Engine, civId: number, tech: string): void {
  const techs = engine.civilizations[civId].technologies as unknown;
  if (Array.isArray(techs)) {
    (techs as string[]).push(tech);
  } else {
    (techs as Set<string>).add(tech);
  }
}

describe('Nomads — equivalent units', () => {
  it('a foot copy mirrors the player unit1:1 — only name and picture differ', () => {
    for (const base of NOMAD_MIRRORED_UNITS) {
      const copy = UNIT_PROPS[nomadFootType(base)];
      const original = UNIT_PROPS[base];
      expect(copy, `${base} has a nomad copy`).toBeDefined();
      expect(copy.attack).toBe(original.attack);
      expect(copy.defense).toBe(original.defense);
      expect(copy.movement).toBe(original.movement);
      expect(copy.cost).toBe(original.cost);
      expect(copy.name).not.toBe(original.name);
      expect(copy.icon).toBe(original.icon);
      // Never offered by any production list.
      expect(copy.requires).toBe(GATE);
    }
    // The opening horde is made of them (two spears and a rider).
    expect(NOMAD_SPAWN_UNITS.every((t) => t.startsWith('nomad_foot_'))).toBe(true);
  });

  it('the mounted shape keeps every number but one step — and costs the beast', () => {
    for (const base of NOMAD_MOUNTED_UNITS) {
      const foot = UNIT_PROPS[nomadFootType(base)];
      const mounted = UNIT_PROPS[nomadMountedType(base)];
      expect(mounted, `${base} has a mounted shape`).toBeDefined();
      expect(mounted.attack).toBe(foot.attack);
      expect(mounted.defense).toBe(foot.defense);
      expect(mounted.movement).toBe(foot.movement + 1);
      expect(mounted.cost).toBe(Math.round(foot.cost * 1.5));
      expect(mounted.requires).toBe(GATE);
    }
    // Nobody puts a tank (or a mech) on a camel.
    expect(NOMAD_MOUNTED_UNITS).not.toContain('tank');
    expect(NOMAD_MOUNTED_UNITS).not.toContain('mech_inf');
    expect(NOMAD_MOUNTED_UNITS).not.toContain('cavalry');
  });

  it('no court can build one — the equivalent comes from the chest alone', () => {
    const broke = { technologies: new Set<string>() } as never;
    const everything = {
      technologies: new Set([
        'bronze_working', 'the_wheel', 'horseback_riding', 'iron_working',
        'mathematics', 'gunpowder', 'combustion', 'metallurgy', 'steel',
      ]),
    } as never;
    for (const type of [nomadFootType('warrior'), nomadMountedType('riflemen'), nomadFootType('tank')]) {
      expect(canBuildUnit(broke, type), `${type} is gated for a techless court`).toBe(false);
      expect(canBuildUnit(everything, type), `${type} stays gated for a fully researched court`).toBe(false);
    }
  });

  it('mirrors progress: the strongest soldier ANY player can build', async () => {
    const { engine } = await world();
    const nm = engine.nomadManager as unknown as { bestMirroredBase: () => string };

    // Nobody has researched anything: the archer (3+2) is the strongest
    // soldier on the board — better than the spear (1+1) and the scout.
    expect(nm.bestMirroredBase()).toBe('archer');

    // As soon as somebody can field armour, the tribe mirrors it.
    learn(engine, 0, 'combustion');
    expect(nm.bestMirroredBase()).toBe('tank');

    // Take the armour away again and the mirror steps back down: the archer
    // needs no technology at all, so it leads a techless board.
    engine.civilizations[0].technologies = [] as never;
    expect(nm.bestMirroredBase()).toBe('archer');
  });

  it('a muster buys a foot copy, then the mounted one — gold only, no shields', async () => {
    const { engine } = await world();
    const nm = engine.nomadManager as unknown as {
      treasury: number;
      musteredIds: string[];
      musterOffer: () => { type: string; cost: number } | null;
    };
    nm.treasury = 5000;
    nm.musteredIds.length = 0;

    const first = nm.musterOffer();
    expect(first?.type).toBe(nomadFootType('archer'));
    expect(first?.cost).toBe(UNIT_PROPS[nomadFootType('archer')]?.cost);

    // One rider already bought → the next muster takes the beast.
    nm.musteredIds.push('already-bought');
    const second = nm.musterOffer();
    expect(second?.type).toBe(nomadMountedType('archer'));
    expect(second?.cost).toBe(Math.round((first?.cost ?? 0) * 1.5));

    // …unless the chest cannot pay for it, it falls back to the foot copy.
    nm.treasury = 1;
    expect(nm.musterOffer()?.type).toBe(nomadFootType('archer'));
  });

  it('the mounted equivalent wears its faction’s beast', async () => {
    const { engine } = await world();
    const nm = engine.nomadManager as unknown as {
      buyUnit: (type: string, col: number, row: number) => { icon?: string } | null;
    };
    // Math.random pinned → clan index0: the Bedouin (camel).
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      engine.nomadManager.processRound(4); // rolls the faction
      const mounted = nm.buyUnit(nomadMountedType('archer'), 5, 5);
      expect(mounted?.icon).toBe(NOMAD_MOUNT_ICONS.bedouin);
      // The foot copy keeps its own picture.
      const foot = nm.buyUnit(nomadFootType('archer'), 6, 6);
      expect(foot?.icon).toBe(UNIT_PROPS[nomadFootType('archer')]?.icon);
    } finally {
      spy.mockRestore();
    }
  });

  it('the name reads Nomad … / Mounted … in the active language', () => {
    expect(tUnitName(nomadFootType('riflemen'), 'Riflemen')).toBe('Nomad Riflemen');
    expect(tUnitName(nomadMountedType('riflemen'), 'Riflemen')).toBe('Mounted Riflemen');
    // Anything else still resolves the way it always did.
    expect(tUnitName('settler', 'Settler')).toBe('Settler');
  });
});
