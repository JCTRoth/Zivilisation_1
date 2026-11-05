# The Three Nomad Factions

> The tribe that visits you is rolled **once per game** from three peoples —
> see [`README.md`](./README.md) for the mechanics and
> [`doc/NOMADS.adoc`](../../../../doc/NOMADS.adoc) for the full reference.
> This file is the *who*: where each faction comes from in real history, how
> it plays, and the art prompts that draw it.

The three are **chosen from the history of humanity, not from game
archetypes**: every one of them is a real nomadic people, with a real
landscape, a real economy and a real way of riding into somebody else's
story. They are deliberately spread over three biomes — desert, steppe,
tundra — so the world never sends you the same silhouette twice.

| # | Faction | Temperament | Landscape | Accent | Emoji | Art |
|---|---|---|---|---|---|---|
| 1 | **The Bedouin** | `trader` | Desert / sand sea | Amber-ochre | 🐫 | `bedouin` |
| 2 | **The Mongol Horde** | `warrior` | Open steppe | Iron grey + blood red | 🐎 | `mongol` |
| 3 | **The Sámi** | `mystic` | Tundra / snow road | Moonlit blue + silver | 🦌 | `sami` |

Ids, numbers and image paths live in
[`src/data/NomadConstants.ts`](../../../../src/data/NomadConstants.ts)
(`NOMAD_CLANS`); the strings in `src/i18n/*.ts` under `nomad.clan.<id>.*`.
**The array order is load-bearing** — tests roll the faction by index
(trader / warrior / mystic).

**They travel.** The tribe never settles at one court: after each visit it
rides on to the next one (yours first, then every AI rival, then round
again) — so the people you meet at your gate are the same people dealing
at every other court in the world, in your language and in their own
(tempers, prices and all).

---

## 1. The Bedouin — the desert's merchants (`bedouin`)

**Where they come from.** The Bedouin of Arabia and the Sahara: camel
caravaners who ran the incense, spice and salt routes between wells and
oases, for whom hospitality (*diyafa*) was a duty rather than a courtesy —
a guest was fed before the host's own family, and a road that had fed you
once was a road you remembered.

**How that plays.** The trader: knowledge is cheapest with them
(×0.8), they settle beside your city often (55%) — a camp that brings you
defenders and a day market — and they forgive **three** refusals before
they ride off offended. Their hire price is the honest one (×1.0).

**The voice.** Warm, shrewd, a bit of a showman: "Road-friend!", tea
first, terms second.

**Prompts — `public/assets/nomads/bedouin.png` (512×640)**

```
[shared style block]
A Bedouin caravan leader, mid-forties, sun-weathered face, a smile that is
weighing you up. A light keffiyeh held by a dark igal, layered road-worn
robes in sand and ochre, a trade amulet of small copper coins at the
throat. Behind one shoulder, out of focus: a laden camel's silhouette
walking a dune ridge at dusk, and the faint line of a caravan behind it.
Warm amber rim light from the left, inviting and sly.
```

---

## 2. The Mongol Horde — the steppe's soldiers (`mongol`)

**Where they come from.** The Mongol confederation of the high steppe: horse
archers raised in the saddle, a camp (*ger*) that moves with the season, the
*yam* relay that carried a message across a continent, and an empire held
together by law and loyalty rather than by walls. They did not besiege
patiently — they arrived, and the steppe decided what happened next.

**How that plays.** The warrior: proud (hire ×1.4 — their spears cost you),
they rarely settle (15%; a camp that moves on is a camp that moves on), and
**one** refusal is tolerated — the second ends the meeting as hostility.

**The voice.** Flat, imperative, no bowing: "We do not beg at gates."

**Prompts — `public/assets/nomads/mongol.png` (512×640)**

```
[shared style block]
A Mongol steppe warlord, jaw set, eyes narrowed, no smile. A deel robe in
deep red under black iron lamellar pauldrons, a fur-trimmed cap, hair in
two warrior braids with iron rings, a thin scar across one cheekbone.
Behind the shoulder, out of focus: the blurred head of a steppe horse with
a tasseled lance, and a felt ger camp on the plain behind it. Cold
iron-grey light with a red edge highlight, unyielding and proud.
```

---

## 3. The Sámi — the tundra's path-finders (`sami`)

**Where they come from.** The Sámi of Sápmi (northern Fennoscandia and the
Kola Peninsula): reindeer herders who read the snow the way other peoples
read a map, moving with the herd between seasonal pastures, and navigators
who held the night sky — the stars, the aurora, the shape of a wind — as
the only road across country that has none.

**How that plays.** The mystic: knowledge is nearly as cheap (×0.9), they
settle sometimes (30%), and they keep their own counsel through **two**
refusals. They chart what you have not walked — their gift on a return
visit is a bigger piece of the unknown world.

**The voice.** Quiet, certain, a little unnerving: "The stars named your
city before you laid its stones."

**Prompts — `public/assets/nomads/sami.png` (512×640)**

```
[shared style block]
An elderly Sámi reindeer herder, calm half-smile, deep lines from wind and
snow, a gákti — the traditional tunic — in dark blue with red and yellow
banding at the collar and cuffs, a fur-trimmed hood pushed back, a wooden
herding staff in one hand. Behind the shoulder, out of focus: a reindeer
with broad antlers standing on a snow ridge, and pale green aurora ribbon
over a star-scattered sky. Moonlit blue rim light with silver highlights,
serene and uncanny.
```

---

## The art: files, fallback and prompts

Each faction has three layers of art, tried **in this order** by
[`ClanPortrait.tsx`](../../../../src/components/ui/ClanPortrait.tsx):

1. **`public/assets/nomads/<id>.png`** — the generated portrait. 512×640,
   PNG, dark background baked in (the stage behind it is `#0d1319`).
   Drop the file in and it appears; no code change.
2. **`public/assets/nomads/<id>.svg`** — the built-in poster shipped with
   the game (the caravan at dusk / the ger camp and its rider / the
   reindeer under the aurora). This is what you see until a PNG exists.
3. **The faction emoji** (🐫 / 🐎 / 🦌) — if even the SVG is missing.

The same slot is used by the audience screen and by the diplomacy hall, so
one file upgrades both at once.

### Shared style block (prepend to every prompt)

```
Pixel art, 32-bit JRPG dialogue-portrait style, bust framing of a nomad
leader facing the viewer, three-quarter view, head and shoulders filling
the frame. Chunky readable pixels, limited earthy palette with one
signature accent colour per faction, strong rim light from the left, plain
very dark background (#0d1319) with a soft vignette. Weathered face,
expressive eyes, cloth and leather rendered with visible pixel clusters.
No text, no watermark, no border, no modern objects. 512x640 portrait.
```

### Delivery

| File | Faction | Shown as |
|---|---|---|
| `public/assets/nomads/bedouin.png` | The Bedouin (trader) | `nomad.clan.bedouin.name` + epithet |
| `public/assets/nomads/mongol.png` | The Mongol Horde (warrior) | `nomad.clan.mongol.name` + epithet |
| `public/assets/nomads/sami.png` | The Sámi (mystic) | `nomad.clan.sami.name` + epithet |

Generate them one at a time, in any order — a missing file is never a
broken image.

---

## Changing a faction

* **A name, epithet or line** → `nomad.clan.<id>.*` in **all six**
  dictionaries (`src/i18n/{en,de,fr,es,ru,ja}.ts`); `tests/i18n.test.ts`
  fails if any language is missing a key.
* **A number** (price, settle chance, refusal tolerance) → `NOMAD_CLANS` in
  `NomadConstants.ts`, and update [`doc/GAME_RULES.adoc`](../../../../doc/GAME_RULES.adoc)
  in the same commit.
* **A new faction** → `NOMAD_CLANS` (keep the trader/warrior/mystic order),
  the `NomadClan['id']` union, the i18n keys, an SVG + PNG slot, and the
  faction list in [`tests/nomadHire.test.ts`](../../../../tests/nomadHire.test.ts)
  (it pins the first faction's identity).
