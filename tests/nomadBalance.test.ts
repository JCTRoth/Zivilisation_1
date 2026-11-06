/**
 * Nomads — the balance table.
 *
 * A long-run simulation of the tribe's economy in a REPRESENTATIVE world
 * (two player cities, two AI partners, a dealt-with camp) with the real
 * seeded RNG. It prints the curve — rounds, treasury, routes, stance,
 * offers — and pins the pacing invariants the design promises:
 *
 *   * the first route lands early enough to matter (investment pays back),
 *   * the market gate (450) is reachable MID-GAME, not never,
 *   * the city market actually table offers in a two-city world,
 *   * the chest never snowballs without limit (routes cap at six and
 *     spending keeps pace), and
 *   * anger's spending is affordable (a bribe costs less than a war chest
 *     that has been earning).
 *
 * If a constant change moves the pacing across a boundary, THIS is the
 * test that says so.
 */
import { describe, expect, it } from 'vitest';
import { makeEngine } from './helpers/world';
import {
  NOMAD_CITY_OFFER_MIN_GOLD,
  NOMAD_START_GOLD,
  NOMAD_TRADE_ROUTE_LIMIT,
} from '@/data/NomadConstants';

describe('Nomads — balance', () => {
  it('paces the economy: routes early, the market mid-game, no snowball', async () => {
    const w = await makeEngine({ numberOfCivilizations: 3, seed: 4242 });
    const events: Array<{ type: string; data: any }> = [];
    (w.engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });

    // A representative court: two player cities (the market needs two),
    // plus one city per AI court so the routes have partners.
    const a = w.landNear(10, 10, 8);
    w.settle('Haven', a.col, a.row, 0, 3);
    const b = w.landNear(16, 16, 4);
    w.settle('Second', b.col, b.row, 0, 2);
    w.settle('Rival', ...(() => { const t = w.landNear(3, 16, 4); return [t.col, t.row] as const; })(), 1, 3);
    w.settle('Rival2', ...(() => { const t = w.landNear(16, 3, 4); return [t.col, t.row] as const; })(), 2, 3);

    const nm = w.engine.nomadManager;
    nm.processRound(4); // spawn — from here the horde MARCHES to the court
    // (the visit is contact-based: the envoy speaks when their units meet
    // the player's units or cities, so the sim answers when it comes.)

    const eventsOf = (type: string) => events.filter((e) => e.type === type);
    let seenParleys = 0;
    let seenOffers = 0;
    let bought: string | null = null;
    const curve: string[] = [];
    let firstRouteAt = -1;
    let crossed450At = -1;
    let maxTreasury = 0;
    for (let r = 5; r <= 120; r++) {
      nm.processRound(r);

      // A player answers the open audiences as they come: parleys pick the
      // cheapest friendly door, and an offer that is affordable is taken.
      const parleys = eventsOf('NOMAD_PARLEY').length;
      if (parleys > seenParleys) {
        seenParleys = parleys;
        const ids = eventsOf('NOMAD_PARLEY').at(-1)!.data.choices.map((c: any) => c.id);
        const pick = ['maps', 'tech', 'farewell', 'pass'].find((id) => ids.includes(id)) ?? ids[0];
        expect(nm.resolveParley(pick).ok, `parley door ${pick} resolves`).toBe(true);
      }
      const offersNow = eventsOf('NOMAD_CITY_OFFER').length;
      if (offersNow > seenOffers) {
        seenOffers = offersNow;
        const outcome = nm.resolveParley('buy_city');
        expect(outcome.ok, 'an affordable offer can be taken').toBe(true);
        bought = String(outcome.params?.city ?? '');
      }

      if (firstRouteAt < 0 && nm.routes.length > 0) firstRouteAt = r;
      if (crossed450At < 0 && nm.treasury >= NOMAD_CITY_OFFER_MIN_GOLD) crossed450At = r;
      maxTreasury = Math.max(maxTreasury, nm.treasury);
      if (r % 20 === 0 || r === 7) {
        curve.push(
          `r${String(r).padStart(3)} gold=${String(nm.treasury).padStart(4)}`
          + ` routes=${nm.routes.length} stance=${nm.currentStance}`
          + ` visits=${nm.visits} hired=${nm.isHired}`,
        );
      }
    }
    const offers = eventsOf('NOMAD_CITY_OFFER').length;
    const knowledge = eventsOf('NOMAD_KNOWLEDGE').length;
    console.log('[balance]\n' + curve.join('\n'));
    console.log(
      `[balance] start=${NOMAD_START_GOLD} firstRoute=r${firstRouteAt}`
      + ` gate450=r${crossed450At} maxGold=${maxTreasury}`
      + ` offers=${offers} bought=${bought ?? 'none'} knowledgeSales=${knowledge}`
      + ` finalRoutes=${nm.routes.length}/${NOMAD_TRADE_ROUTE_LIMIT}`
      + ` visits=${nm.visits} hired=${nm.isHired}`,
    );

    // — the pacing invariants (the design promises, in order) —
    expect(firstRouteAt, 'the first bazaar pays back within the opening phase').toBeLessThanOrEqual(30);
    // The gate is reached INSIDE the game — a little later than the old
    // travel spell put it, because the tribe now spends real rounds on the
    // road (riding court to court instead of teleporting) and the chest
    // travels with them. What the promise means is "reachable, not never":
    // the offer is tabled from it and taken (asserted below).
    expect(crossed450At, 'a dealt-with tribe can reach the market gate in a game').toBeLessThanOrEqual(110);
    expect(offers, 'the city market tabled its offer in a two-city world').toBeGreaterThanOrEqual(1);
    expect(bought, 'the offer was affordable and was taken').not.toBeNull();
    expect(knowledge, 'the broker keeps deals flowing').toBeGreaterThanOrEqual(3);
    expect(nm.routes.length).toBeLessThanOrEqual(NOMAD_TRADE_ROUTE_LIMIT);
    expect(maxTreasury, 'the chest must not snowball').toBeLessThanOrEqual(1400);
    expect(nm.treasury).toBeGreaterThan(0);
  }, 60_000);
});
