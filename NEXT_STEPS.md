# Development Report & Next Steps

## Recent Work (Committed)

**Commit `93c95c7` — Performance optimizations:**

| File | Change |
|------|--------|
| `AutoProduction.ts` | Naval doctrine verdict cached per civ; avoids re-running island scans, per-city threat probes, and economy calculations for every city/queue slot |
| `EconomicManager.ts` | `hasActiveFishingNet` (O(units) per tile) replaced with a lazily-built `Set<string>` of active fishing grounds — O(1) lookup after first build |
| `GameEngine.ts` | `Math.min(...cities.map(...))` replaced with a plain loop in the island-distance scan — no array allocation per land tile |
| `GameCanvas.tsx` | `hashTerrainTypes` mixes hash fields directly instead of concatenating a string per tile — no per-tile string garbage |
| `AIManager.ts` | Added `buildLandReachableLookup` wrapper (used by new tests) |

**Verification:** All 1062 tests pass, type-check clean, lint clean.

---

## Dead Code Status

Knip reports **57 unused exports** — all pre-existing, none introduced by the recent changes. These are mostly tuning constants in `src/game/engine/AI/*` and `src/data/*` that are exported but never imported. The TODO.txt already tracks this as a cleanup item.

---



---

## Immediate Recommendation

**Start with #1 (Naval Invasion).** It is the most impactful gap: without it, cross-water AI wars are stalemates, and the AI cannot project power across maps with straits or islands. The transport/embark mechanics already exist at the unit level (cargo capacity, coordinate alignment), so the missing piece is the mission planning layer in AIManager.
