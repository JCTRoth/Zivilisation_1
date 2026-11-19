/**
 * Caravan economics — what a trade route is worth, and whether a civ should be
 * trying to build any.
 *
 * The pure money half (`fisherEconomics`'s counterpart for trade) is
 * `caravanPayoutValue` in `GameEngine.establishTradeRoute`; what lives here is
 * the QUESTION the AI asks: *is a caravan worth researching the tech for?*
 *
 * It matters because the answer used to be no, forever: `MAX_CARAVAN_TRADE_ROUTES`
 * said a city could hold three routes, and the AI researched Currency → Trade
 * only when some other profile happened to want it, so a profiled 1,000-round
 * game delivered ZERO trade routes. A civ with several cities and no routes has
 * a large, permanent income sitting behind one tech, and this module is how the
 * research pass finds out.
 */

/**
 * How many permanent trade routes a city can hold — the engine's own cap
 * (`GameEngine.MAX_TRADE_ROUTES`), re-stated here so this module stays pure.
 */
export const MAX_TRADE_ROUTES_PER_CITY = 3;

/**
 * How much a civ should want the `trade` tech right now, 0–3.
 *
 * 0 — no city could host a route, or there is nobody else on the map to trade
 *     with;
 * 1 — some cities have room for a route;
 * 2 — several cities have room;
 * 3 — most of the empire is route-less and the civ is at peace (foreign routes
 *     pay double, but they are only legal at peace).
 *
 * A civ with ONE city qualifies: its routes are foreign ones, which are the
 * valuable kind and exactly the reason to research the tech.
 *
 * **A city qualifies at population 1.** It used to require population 2, on the
 * grounds that a pop-1 route pays nothing — but the hook is what makes the
 * trade line get researched at all, and the payout is a function of BOTH ends
 * (a size-6 neighbour pays for a size-1 home). The measured cost of the old
 * threshold: `scripts/trade_pipeline_sim.py` row "G1: pop>=1 hosts" — a young
 * civ's first city reaches pop 2 around round 43, so a 160-beaker chain does not
 * finish until round 78, and any slower growth pushes it past the horizon
 * entirely. No civ in the 150-round batch ever researched `trade`.
 */
export function caravanRelevanceForCiv(
  cities: ReadonlyArray<{
    population?: number;
    tradeRoutes?: unknown[];
    civilizationId: number;
  }>,
  civilizationId: number,
  atPeace: boolean,
): number {
  const own = cities.filter((c) => c.civilizationId === civilizationId);
  if (own.length === 0) return 0;
  const hosts = own.filter(
    (c) => (c.tradeRoutes?.length ?? 0) < MAX_TRADE_ROUTES_PER_CITY,
  );
  if (hosts.length === 0) return 0;
  // Nobody else in the world: a route needs two ends, and our own cities are
  // already counted as hosts.
  if (cities.every((c) => c.civilizationId === civilizationId)) return 0;

  const tradedShare = own.filter((c) => (c.tradeRoutes?.length ?? 0) > 0).length / own.length;
  if (!atPeace) return tradedShare > 0.5 ? 1 : 2;
  return tradedShare > 0.75 ? 2 : 3;
}
