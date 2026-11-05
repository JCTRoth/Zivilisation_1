# The Nomads

A neutral tribe that visits the single human: three peoples with three
tempers, a relationship with a memory, and — since the AI-player work —
**their own economy** (a war chest, trade routes, a city market and
bribes). They are their own player: civ id **`-2`**, deliberately not the
barbarians' `-1` (the `BarbarianManager` drives every `-1` unit and city
and would commandeer the camp).

Full reference: [`doc/NOMADS.adoc`](../../../../doc/NOMADS.adoc) ·
The three factions (history, temperament, art prompts):
[`FACTIONS_README.md`](./FACTIONS_README.md) ·
Clan portrait prompts: [`doc/NOMAD_ART_PROMPTS.adoc`](../../../../doc/NOMAD_ART_PROMPTS.adoc) (art slot notes; the prompts themselves live in `FACTIONS_README.md`)

## Files

| File | Role |
|---|---|
| `NomadManager.ts` | The state machine: spawn → **contact visit** → parley → relationship → departure/return, plus the per-round economy phase and the `hallState` snapshot the diplomacy screen reads |
| `NomadAI.ts` | The strategy brain: five stances, scored every 8 rounds (instantly when angry), handing the round's plan to the manager |
| [`FACTIONS_README.md`](./FACTIONS_README.md) | **The three peoples** — Bedouin / Mongol / Sámi: where they come from in real history, how they play, and the art prompts that draw them |
| [`src/data/NomadConstants.ts`](../../../../src/data/NomadConstants.ts) | **Every balance number** and the three factions (`NOMAD_CLANS`) |
| [`src/data/UnitConstants.ts`](../../../../src/data/UnitConstants.ts) | `travelling_bazaar` — the camp's own unit, gated by the impossible tech `nomad_bazaar_only` so no player or AI production list ever offers it |
| [`tests/nomads.test.ts`](../../../../tests/nomads.test.ts) | The relationship: trigger, contact rule, doors, race, moods, return |
| [`tests/nomadEconomy.test.ts`](../../../../tests/nomadEconomy.test.ts) | The chest: routes, ceiling, market, bribe, identity |
| [`tests/nomadStrategy.test.ts`](../../../../tests/nomadStrategy.test.ts) | The brain: stance variation, muster, plea, brokerage, friendship |
| [`tests/nomadBalance.test.ts`](../../../../tests/nomadBalance.test.ts) | The 120-round simulation + the pacing invariants |
| [`tests/nomadHire.test.ts`](../../../../tests/nomadHire.test.ts) | The gate rule: only the riders you meet are sold, at ×5 build cost, no door without a meeting — plus the `hallState` snapshot |
| [`tests/nomadTravel.test.ts`](../../../../tests/nomadTravel.test.ts) | The route: your court → a rival's (answered in code), **one group rides on while the other stays**, the food a camp at your gate costs, the settlement's fourth trade route, refusal prices |

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
5. **They ride on.** Once the visit is over — deal, refusal, the linger
   or the 60-round contact window — the tribe strikes camp and rides to
   the **next court**: every alive court in turn (you first, then the
   rivals, then round again), `NOMAD_TRAVEL_ROUNDS` (12) between camps.
   A friendly court keeps its promised return (+30 rounds) and goes to the
   front of the route. At a **rival** there is no audience: the envoy is
   answered in code — a court with diplomacy ≥ 3 and the gold buys the
   knowledge on offer, otherwise they camp, linger and move on — and you
   hear about it as news (`NOMAD_KNOWLEDGE`) — the ONE exception is a
   group sale, which opens a modal (`NOMAD_GROUP_HIRED`). Your `visits`
   counter counts only YOUR court.

## The parley — the doors

Terms are whatever the **button** promised (never re-rolled while the
modal is open):

| Door | Effect |
|---|---|
| Buy their knowledge | one tech the court lacks, half raw cost (clan factor, clamped 25–100); free if the treasury cannot pay |
| Accept their maps | radius-10 reveal around the camp (first visit only) |
| Let them settle *(random, per clan)* | a settlement beside your city: −2 food/turn in the city balance **forever**, defenders raised for you — **and one extra trade-route slot** for that city (3 → 4) |
| Refuse the settlement *(same table)* | a closed hand: `refusals += 1`, their prices rise by `NOMAD_REFUSAL_PRICE_PENALTY` (25 %) per refusal, and past the clan's tolerance they turn hostile |
| Hire the riders you met | **only the units standing with you** (on your city's tile or beside your unit) — build cost × **5** × clan factor × the refusal penalty; the payment lands in **their** chest. The rest of the tribe keeps its tents |
| Pass in peace | departure after 6 rounds instead of 20 — and refusals accumulate |

**What a camp costs you while it stands**: every rider of a visiting camp
within reach of a city eats `NOMAD_CAMP_FOOD_COST` (1) of that city's food
per turn — a tribe parked on your doorstep costs you grain whether or not
you invited them. A *settlement* costs `NOMAD_SETTLEMENT_FOOD_COST` (2)
per turn for as long as it stands (and it defends you).

**Their prices remember closed hands**: every refusal adds 25 % to what
they ask of you (four refusals double it), and an **angry** tribe tables
no knowledge and no maps at all — only the spears, or the door.

**The race**: from 16 rounds after the parley, an eligible AI court may buy
**ONE GROUP** off the tribe (diplomacy-scaled chance, deliberately slim —
≈18 % per visit) — **never the tribe's last camp**, and always announced
with a modal (`NOMAD_GROUP_HIRED`), because half your problem just changed
uniform. The payment fills their chest; the tribe itself keeps trading.

**One travels, one stays**: a grown tribe keeps two camps, and when one
strikes tents the OTHER keeps standing where it is (its own linger runs from
that round). Somebody is always left on the map — the tribe never vanishes
into the fog the way a single camp used to.

**The gate rule**: the hire door is tabled only while your units actually
stand with theirs, and it sells exactly those units — a splinter camp four
tiles away was never yours to buy. Walk away and the door disappears
(`resolveParley('hire')` answers `notMeeting`).

**In the diplomacy hall**: once sighted the tribe gets its own row and its
own panel (`NomadManager.hallState`) — faction art, standing, doctrine and
the doors that are on the table. Everything except *locating their camp* is
locked until you are standing with them.

## Relationship memory

| Standing | Earned by | Buys |
|---|---|---|
| `neutral` | the default; a tolerated refusal | nothing |
| `friendly` | any deal, or a gift from the plea | **one return visit** +30 rounds — same clan, and their promised chart of the world (radius 14) arrives **at the meeting** |
| `angry` | first blood (a camp unit hurt or missing), or refusals past the clan's tolerance | 12 rounds of raids — attack what they reach, steal 15% of the treasury (5–30) every 3 rounds — plus **bribes**; never a return |

Faction tolerances: Bedouin 3, Sámi 2, Mongol 1.

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
  tests/nomadStrategy.test.ts tests/nomadBalance.test.ts \
  tests/nomadRoaming.test.ts tests/nomadHire.test.ts
```

* **Balance lives in `NomadConstants.ts`.** Per the root README's rule:
  change the number *and* update [`doc/GAME_RULES.adoc`](../../../../doc/GAME_RULES.adoc)
  in the same commit.
* The pacing is guarded by `nomadBalance.test.ts` — if a change moves the
  market gate past round 90 or lets the chest snowball, that test says so.
* e2e: the dialogs are entries in `BLOCKING_DIALOGS`
  (`e2e/game.spec.ts`) — *Pass in peace*, *The Nomad Market*,
  *The Nomads Ask*, and the story cards' *Continue*.
* Art (all optional, emoji/gradient fallbacks): faction portraits —
  [`FACTIONS_README.md`](./FACTIONS_README.md) holds the history, the
  prompts and the delivery table.
