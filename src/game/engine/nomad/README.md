# The Nomads

A neutral tribe that visits the single human: three clans with three
tempers, a relationship with a memory, and — since the AI-player work —
**their own economy** (a war chest, trade routes, a city market and
bribes). They are their own player: civ id **`-2`**, deliberately not the
barbarians' `-1` (the `BarbarianManager` drives every `-1` unit and city
and would commandeer the camp).

Full reference: [`doc/NOMADS.adoc`](../../../../doc/NOMADS.adoc) ·
Clan portrait prompts: [`doc/NOMAD_ART_PROMPTS.adoc`](../../../../doc/NOMAD_ART_PROMPTS.adoc)

## Files

| File | Role |
|---|---|
| `NomadManager.ts` | The state machine: spawn → **contact visit** → parley → relationship → departure/return, plus the per-round economy phase |
| `NomadAI.ts` | The strategy brain: five stances, scored every 8 rounds (instantly when angry), handing the round's plan to the manager |
| [`src/data/NomadConstants.ts`](../../../../src/data/NomadConstants.ts) | **Every balance number** and the three clans (`NOMAD_CLANS`) |
| [`src/data/UnitConstants.ts`](../../../../src/data/UnitConstants.ts) | `travelling_bazaar` — the camp's own unit, gated by the impossible tech `nomad_bazaar_only` so no player or AI production list ever offers it |
| [`tests/nomads.test.ts`](../../../../tests/nomads.test.ts) | The relationship: trigger, contact rule, doors, race, moods, return |
| [`tests/nomadEconomy.test.ts`](../../../../tests/nomadEconomy.test.ts) | The chest: routes, ceiling, market, bribe, identity |
| [`tests/nomadStrategy.test.ts`](../../../../tests/nomadStrategy.test.ts) | The brain: stance variation, muster, plea, brokerage, friendship |
| [`tests/nomadBalance.test.ts`](../../../../tests/nomadBalance.test.ts) | The 120-round simulation + the pacing invariants |

## The visit — contact, never a timer

1. **Spawn** at round ≥ 4 once the player has a city (fallback: round 12,
   visiting the settler instead), 9–13 tiles away on the same landmass,
   fortified and revealed (`NOMAD_SIGHTED`).
2. **The wander**: until the envoy has spoken, the group wanders toward the
   player's court — nearest city, else nearest unit — zig-zagging (most
   steps close in, some drift sideways, the distance never grows). The
   final step ONTO the court is *placed*, never moved: `moveUnit` would
   resolve it as an assault — *visitors do not storm cities*.
3. **The message binds to the appearance**: the parley opens only when a
   nomad unit stands **ON your city's tile** — or on the same tile as a
   player unit (the city-less settler visit). No nomad on the tile, no
   envoy — and there is no timer.
4. **After the answer**: they walk home to the tents and wait. A
   *dismissed* parley re-offers when a player unit comes within 2 of the
   camp (3-round cooldown) — dismissal is not refusal.

## The parley — the doors

Terms are whatever the **button** promised (never re-rolled while the
modal is open):

| Door | Effect |
|---|---|
| Buy their knowledge | one tech the court lacks, half raw cost (clan factor, clamped 25–100); free if the treasury cannot pay |
| Accept their maps | radius-10 reveal around the camp (first visit only) |
| Let them settle *(random, per clan)* | a settlement beside your city: −2 food/turn in the city balance, defenders raised for you |
| Hire the horde | build cost × 1.1 × clan factor; the payment lands in **their** chest |
| Pass in peace | departure after 6 rounds instead of 20 — and refusals accumulate |

**The race**: from 16 rounds after the parley, any AI court may hire the
camp (diplomacy-scaled chance). The payment fills their chest; the tribe
itself keeps trading.

## Relationship memory

| Standing | Earned by | Buys |
|---|---|---|
| `neutral` | the default; a tolerated refusal | nothing |
| `friendly` | any deal, or a gift from the plea | **one return visit** +30 rounds — same clan, and their promised chart of the world (radius 14) arrives **at the meeting** |
| `angry` | first blood (a camp unit hurt or missing), or refusals past the clan's tolerance | 12 rounds of raids — attack what they reach, steal 15% of the treasury (5–30) every 3 rounds — plus **bribes**; never a return |

Clan tolerances: Sandborne 3, Greywind 2, Ironhoof 1.

## Their own books — the economy

One chest funds every door (that *is* the balance):

| Line | Number |
|---|---|
| Opening purse | **300** gold |
| Travelling Bazaar | **100** gold, one every **8** rounds, max **2** in flight, consumed on delivery |
| Trade routes | **6** ceiling; income **3 + floor(pop/2)** per turn; the route dies with its partner |
| Bought cities | **1** gold per head per turn |
| City market | offers at **450+** in the chest (the `market` stance waives the gate, not the price), price **250 + 75 × pop**, one per 15 rounds, refused cities never again, **never your last city** |
| The plea | under **80** gold and peaceful → asks you for **60** (give = they remember; refuse = a refusal) |
| Knowledge brokerage | a tech sold to an AI court every **15** rounds (half cost, clan factor, 25–100) |
| Camp muster | `steel` stance only, max **2** soldiers beyond the horde, one per 8 rounds |

**Strategy** (`NomadAI`): `roads` (early — build bazaars, broker knowledge)
→ `treasury` (hoard) → `market` (buy cities) → `steel` (warrior clans,
world ≥ 60) → `bribery` (angry — forced, not scored). Re-scored every 8
rounds over routes, chest, garrison room, clan temperament and *where in
history they are*, plus a jitter so two identical games drift apart.
Every change is announced (`NOMAD_STRATEGY` toast) — the player gets to
watch them change their mind.

## Barbarian friendship

`BarbarianManager.act()` never touches negative ids: the nomads and the
barbarians are friends. When the barbarians **take a city**, the tribe
strikes camp and moves in beside it (`onBarbariansTookCity` → migration
+ a friendship route) — unless angry (revenge first).

## Tests & docs

```bash
npx vitest run tests/nomads.test.ts tests/nomadEconomy.test.ts \
  tests/nomadStrategy.test.ts tests/nomadBalance.test.ts
```

* **Balance lives in `NomadConstants.ts`.** Per the root README's rule:
  change the number *and* update [`doc/GAME_RULES.adoc`](../../../../doc/GAME_RULES.adoc)
  in the same commit.
* The pacing is guarded by `nomadBalance.test.ts` — if a change moves the
  market gate past round 90 or lets the chest snowball, that test says so.
* e2e: the dialogs are entries in `BLOCKING_DIALOGS`
  (`e2e/game.spec.ts`) — *Pass in peace*, *The Nomad Market*,
  *The Nomads Ask*, and the story cards' *Continue*.
* Art (all optional, emoji/gradient fallbacks): clan portraits
  [`doc/NOMAD_ART_PROMPTS.adoc`](../../../../doc/NOMAD_ART_PROMPTS.adoc).
