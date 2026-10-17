#!/usr/bin/env python3
"""
Zivilisation_1 — economy simulator.

A calibrated model of the engine's economic core (src/game/engine/EconomicManager.ts
plus the AI controllers), used to answer one question: *can the AI play stably
without disbanding its units?* — and if not, which single change fixes it.

Every equation is transcribed from the engine ("what the code does", not what the
docs say). Balance levers live in `Params`; every row in `ROWS` is one experiment,
added one after another until a row is stable.

What makes a row "stable" — and a row that is stable only because it never fields
an army does NOT count:
  disbands        units destroyed by the upkeep disbander      -> want 0
  bankruptcies    turns the treasury went negative             -> want 0
  army_final      the army actually fielded                    -> want >= desired
  cities/pop      the empire must still exist and grow         -> want >= opening

Run:  python3 scripts/economy_sim.py
growth        - cities must still grow (a starved "stable" civ is not stable).

WHAT THE TABLE SAYS (rows R0-R15, 400 turns x 3-5 worlds)
---------------------------------------------------------
R0  baseline            33 disbands, 56 bankruptcies, army 2.0, commerce 2.34
                         -> reproduces the measured batch (11-24 disbands per
                            150 rounds, commerce pinned at the 2-trade floor)
R1  cap buffer 0.35     NO EFFECT. Disbanding is not over-building.
R2  trade mult 3         33 -> 19. Helps, not enough.
R3  building upkeep /2   33 -> 17. Helps, not enough.
R4  no city upkeep        NO EFFECT (nothing to charge at two cities).
R5  ROADS LAND           0/0, army 5.7, gold 16.9, commerce 7.11  <-- the fix
R6  commerce floor 4     33 -> 15. Helps, not enough.
R7  unit upkeep /2       33 -> 31 AND the army collapses to 0: cheaper units
                         just let the AI build more of what it cannot pay for.
R8  no appetite ramp     33 -> 35. Growth is not the problem.
R9  floor 4 + mult 3     0/0 but hoards 231 gold a turn on average.
R10 floor 6 + mult 3     0/0 but hoards 1084 gold. Stability bought with inflation.
R11 roads + mult 3       0/0 but hoards 256 gold.
R12 full plan           0/0 but hoards 1062 gold.
R13 slow roads (0.02)    still 3 disbands - too little of the fix.
R14 roads + cap 0.25     0/0, gold 16.9 (same as R5)
R15 roads, 5 worlds      0/0/4, army 6.2, gold 22.9, commerce 7.24  <-- PERFECT

CONCLUSION
----------
The economy is not mis-TUNED, it is mis-PLUMBED, and the table says which pipe:
a city's commerce is the 2-trade centre floor until a road is built on each
worked tile, and the AI essentially never builds one. Income therefore cannot
scale with the empire, and no rate controller and no upkeep table can keep an
army paid.

Raising the constants works only by making everyone rich (R10-R12 hoard
250-1100 gold a turn), which is the wrong fix. The right one is R5/R15 - make the
works programme land - and it is the only row that removes the disbanding while
leaving every balance number untouched (gold still averages ~17).

In the engine that fix is `AIManager.citiesNeedBuildOut` measuring the tiles a
city WORKS instead of its whole area (a ring half-covered in mines nobody works
used to count as built out), plus roads-first in `pickWorksTileForCity`.

Rows R24-R28 (added later) answer a second question — the LONG game. At 320
rounds the live engine still disbanded 48-53 units on seeds 33/51, all from one
civ, 29 of them in one round, while its tax rate swung 54→80→35→69. That is a
feedback gap between the builder and the destroyer, not a poverty problem, and
the rows model it honestly: R24 reproduces the engine's defect (the build queue
invisible to the army cap), R25-R27 add the standing-army budget — queue
priced, one-unit-a-round drawdown, debt service netted out — and the live run
afterwards added an emergency-disbander cap (three units a turn) when seed 51
showed a city-less civ liquidating 12 units the round its treasury crossed
zero. The read: with the
road programme OFF the budget cannot rescue a civ whose income never scales
(disbands stay ~33-37, same as R0) — the works fix remains the root cure —
but it is the mechanism that keeps a FUNCTIONING economy from over-building
into a 29-unit liquidation. The concept lives in
`EconomicManager.armyBudgetFor` + `queuedUnitUpkeep` + `retireSurplusUnit`
+ `EMERGENCY_DISBAND_CAP_PER_TURN`
and is pinned by `tests/standingArmyBudget.test.ts`.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field, replace
from typing import Dict, List


# ── Parameters: one row of the experiment table ────────────────────────────

@dataclass(frozen=True)
class Params:
    name: str

    # Commerce → gold
    trade_gold_multiplier: float = 2.0       # TRADE_GOLD_MULTIPLIER
    city_center_commerce: float = 2.0        # CITY_CENTER_COMMERCE floor

    # Cities
    city_upkeep_per_city: float = 1.0        # CITY_UPKEEP_PER_CITY
    free_city_support: int = 3               # FREE_CITY_SUPPORT

    # Citizens
    citizen_food_demand: float = 2.0         # CITIZEN_FOOD_DEMAND_PER_CITIZEN
    appetite_ramp_above: int = 5             # APPETITE_RAMP_ABOVE_POP
    appetite_ramp_per: float = 0.2           # APPETITE_RAMP_PER_CITIZEN
    aqueduct_housing_cap: int = 10           # AQUEDUCT_HOUSING_CAP

    # Treasury
    absolute_min_gold: float = 8.0           # ABSOLUTE_MIN_GOLD
    debt_repay_per_turn: float = 1.0         # DEBT_REPAYMENT_PER_TURN
    debt_repay_per: float = 50.0             # DEBT_REPAYMENT_PER

    # AI policy
    ai_min_tax: float = 35.0                 # AI_MIN_TAX
    ai_science_floor: float = 20.0           # AI_SCIENCE_FLOOR
    ai_min_gold_reserve: float = 8.0         # AI_MIN_GOLD_RESERVE
    ai_reserve_contribution: float = 0.10    # share of income the army cap holds back
    ai_reserve_turns: float = 2.0            # AI_RESERVE_TURNS
    urgent_defender_ignores_cap: bool = True # the engine's real rule

    # Units
    unit_maintenance: Dict[str, float] = field(default_factory=lambda: {
        "warrior": 1.0, "archer": 1.0, "phalanx": 1.0, "legion": 1.0,
        "riflemen": 1.0, "cavalry": 2.0, "artillery": 3.0, "tank": 4.0,
        "battleship": 6.0, "settler": 0.0, "caravan": 0.0,
    })
    era_units: List[str] = field(default_factory=lambda: [
        "warrior", "archer", "phalanx", "legion", "riflemen", "cavalry",
        "artillery", "tank", "battleship",
    ])
    unit_cost: Dict[str, float] = field(default_factory=lambda: {
        "warrior": 10.0, "archer": 30.0, "phalanx": 50.0, "legion": 60.0,
        "riflemen": 30.0, "cavalry": 100.0, "artillery": 150.0, "tank": 200.0,
        "battleship": 280.0,
    })

    # Buildings
    building_upkeep: Dict[str, float] = field(default_factory=lambda: {
        "granary": 1.0, "temple": 1.0, "colosseum": 1.0, "library": 1.0,
        "marketplace": 1.0, "courthouse": 1.0, "walls": 2.0, "aqueduct": 1.0,
        "cathedral": 2.0, "university": 2.0, "bank": 1.0, "factory": 3.0,
        "stock_exchange": 2.0,
    })
    building_happiness: Dict[str, float] = field(default_factory=lambda: {
        "temple": 1.0, "colosseum": 2.0, "cathedral": 3.0, "oracle": 2.0,
    })
    building_cost: Dict[str, float] = field(default_factory=lambda: {
        "granary": 60.0, "temple": 40.0, "colosseum": 100.0, "library": 80.0,
        "marketplace": 80.0, "courthouse": 80.0, "walls": 120.0, "aqueduct": 120.0,
        "cathedral": 160.0, "university": 160.0, "bank": 120.0, "factory": 200.0,
        "stock_exchange": 160.0,
    })

    # Corruption
    gov_corruption: Dict[str, float] = field(default_factory=lambda: {
        "despotism": 0.30, "monarchy": 0.25, "republic": 0.15,
        "democracy": 0.05, "communism": 0.10, "anarchy": 0.30,
    })
    corruption_distance_step: float = 10.0
    corruption_distance_cap: float = 1.5

    # Tiles
    road_trade_bonus: float = 1.0
    trade_tile_share: float = 0.55
    base_shields: float = 2.0
    base_food_per_tile: float = 2.0
    # CALIBRATED to the measured batch: ~6 improved tiles within 4 tiles of any
    # city across 4 civs in 150 rounds — the works programme essentially never
    # lands (its entry condition counts improvements on tiles the city never
    # works). A city's commerce is therefore the 2-trade centre floor for most of
    # the game, which IS the economic problem.
    road_chance: float = 0.005

    # World pressure — calibrated so the baseline reproduces the MEASURED batch
    # (11–24 upkeep disbands per 150 rounds across 4 civs, avg treasury 16, civs
    # collapsing to 1–2 cities). The pressure is what makes the AI rebuild past
    # what it can pay, which is the loop under test.
    city_loss_chance: float = 0.0025          # per city per turn (barbarians/war)
    war_chance: float = 0.010                 # per turn: a war starts
    war_length: int = 40                      # turns a war lasts
    unit_loss_chance_in_war: float = 0.05     # per turn a unit dies
    unit_loss_chance_peace: float = 0.002

    # Army demand: what the civ WANTS, independent of what it can pay.
    defenders_per_city: int = 1
    standing_force: int = 2

    # ── R24+ the standing-army budget ──────────────────────────────────
    # The engine's measured failure (seed 33, civ2, 53 disbands in four waves,
    # 29 of them in ONE round at r220) is a feedback gap between the builder
    # and the destroyer:
    #
    #   the builder (`AutoProduction.isUnitCapExhausted`) asks "can I pay ONE
    #   more unit's upkeep?" — a marginal question — and prices only units
    #   ALIVE IN THE FIELD. The build queue is invisible: three cities each
    #   see the same headroom and each queue a rifleman, and when all three
    #   land the upkeep triples in one round.
    #
    #   the destroyer (`EconomicManager.processTurn` when gold < 0) fires a
    #   CLIFF: `unitsToRemove = totalUpkeep - incomeAfterTax`, looped until it
    #   fits, which at r220 liquidated 29 units at once — catapults, cannons
    #   and riflemen that took dozens of turns to build.
    #
    #   nothing connects them: there is no state between "solvent, keep
    #   building" and "bankrupt, liquidate now", so an income wobble (the tax
    #   rate swung 54→80→35→69 over 240 rounds) crosses the gap in one turn.
    #
    # The concept is ONE budget every system shares:
    #
    #   armyBudget  = income(policy rates) - buildingUpkeep - cityUpkeep
    #               - debtService - reserve
    #   committed   = unitUpkeep(field) + queuedUnitUpkeep(queue)
    #
    #   R-A build   queue a maintenance-bearing unit only while
    #               committed + price <= budget   (a TOTAL check, queue priced)
    #   R-B drawdown when unitUpkeep(field) > budget, retire ONE unit per round
    #               (cheapest, never a sole defender / mission unit / caravan
    #               in transit / ferry with cargo) — a slope, not a cliff
    #   R-C the disbander is demoted to true emergencies (city captured, war
    #               losses faster than the drawdown) and fires 1-2 units a game
    queue_priced: bool = False          # False = the engine's bug: the queue is invisible
    debt_service_in_budget: bool = False  # the budget subtracts what debt already eats
    army_budget_drawdown: bool = False   # R-B: retire at most one unit a round
    drawdown_share: float = 0.60         # the army may hold this share of income


# ── Entities ───────────────────────────────────────────────────────────────

@dataclass
class City:
    population: int = 2
    food_stored: float = 0.0
    roads: int = 0
    buildings: List[str] = field(default_factory=list)
    has_aqueduct: bool = False
    has_granary: bool = False
    dist_to_capital: float = 0.0
    disorder: bool = False
    production_stored: float = 0.0
    current_item: str | None = None


@dataclass
class Civ:
    name: str
    government: str = "despotism"
    tax_rate: float = 35.0
    science_rate: float = 45.0
    luxury_rate: float = 20.0
    gold: float = 50.0
    debt: float = 0.0
    carry: float = 0.0
    techs: List[str] = field(default_factory=lambda: ["pottery", "masonry"])
    research_progress: float = 0.0
    current_research: str | None = None
    cities: List[City] = field(default_factory=list)
    units: List[str] = field(default_factory=list)
    era_index: int = 0
    war_turns_left: int = 0
    # telemetry
    disbands: int = 0
    bankruptcies: int = 0
    deficit_turns: int = 0
    gold_series: List[float] = field(default_factory=list)
    army_series: List[int] = field(default_factory=list)
    desired_series: List[int] = field(default_factory=list)
    commerce_series: List[float] = field(default_factory=list)


class EconomySim:
    def __init__(self, params: Params, name: str = "TestCiv", turns: int = 400, seed: int = 7):
        self.p = params
        self.rng = random.Random(seed)
        self.turns = turns
        self.civ = Civ(name=name)
        for dist in (0.0, 6.0, 12.0):
            self.civ.cities.append(City(dist_to_capital=dist))
        self.civ.units = ["warrior"] * 3

    # ── city physics ──────────────────────────────────────────────────────

    def worked_tiles(self, city: City) -> int:
        return max(1, city.population + 1)

    def city_commerce(self, city: City) -> float:
        return max(city.roads * self.p.road_trade_bonus, self.p.city_center_commerce)

    def city_corruption(self, city: City) -> float:
        base = self.p.gov_corruption.get(self.civ.government, 0.3)
        mult = min(city.dist_to_capital / self.p.corruption_distance_step,
                   self.p.corruption_distance_cap)
        return base * mult

    def city_food(self, city: City) -> float:
        return (self.worked_tiles(city) * self.p.base_food_per_tile + 2.0
                + city.roads * 0.6)

    def city_food_demand(self, city: City) -> float:
        per = self.p.citizen_food_demand + self.p.appetite_ramp_per * max(
            0, city.population - self.p.appetite_ramp_above)
        return city.population * per

    def city_happiness(self, city: City) -> tuple[float, float]:
        unhappiness = city.population
        happiness = 2.0
        for b in city.buildings:
            happiness += self.p.building_happiness.get(b, 0.0)
        happiness += {"despotism": 0, "monarchy": 1, "republic": 2,
                      "democracy": 4, "communism": 1, "anarchy": 0}.get(
            self.civ.government, 0)
        happiness += self.city_commerce(city) * self.civ.luxury_rate / 100.0
        return happiness, unhappiness

    # ── the turn ──────────────────────────────────────────────────────────

    def step(self) -> None:
        civ, p = self.civ, self.p

        if civ.war_turns_left > 0:
            civ.war_turns_left -= 1
        elif self.rng.random() < p.war_chance:
            civ.war_turns_left = p.war_length

        for city in civ.cities:
            city.food_stored += self.city_food(city) - self.city_food_demand(city)
            threshold = (city.population + 1) * 10
            if city.food_stored < 0:
                city.population = max(1, city.population - 1)
                city.food_stored = 0.0
            elif city.food_stored >= threshold and not city.disorder:
                cap = p.aqueduct_housing_cap if not city.has_aqueduct else 10 ** 6
                if city.population < cap:
                    city.population += 1
                    city.food_stored = (city.food_stored / 2.0
                                        if city.has_granary else 0.0)
                else:
                    city.food_stored = threshold

            happiness, unhappiness = self.city_happiness(city)
            city.disorder = unhappiness > happiness

        for city in civ.cities:
            if city.current_item is None:
                city.current_item = self.choose_item(city)
            if city.current_item is None:
                continue
            city.production_stored += p.base_shields + city.roads * 0.25
            item = city.current_item
            cost = (p.unit_cost.get(item.split(":", 1)[1], 30.0)
                    if item.startswith("unit:")
                    else p.building_cost.get(item, 80.0))
            if city.production_stored >= cost:
                self.complete_item(city, item)
                city.current_item = None
                city.production_stored = 0.0

        # Road programme (see `road_chance` for why this is slow).
        for city in civ.cities:
            if city.roads < min(self.worked_tiles(city), 12) and self.rng.random() < p.road_chance:
                city.roads += 1

        # War losses — the reason an army is rebuilt past its means.
        loss_chance = p.unit_loss_chance_in_war if civ.war_turns_left > 0 \
            else p.unit_loss_chance_peace
        if civ.units and self.rng.random() < loss_chance:
            civ.units.pop(self.rng.randrange(len(civ.units)))

        if self.rng.random() < p.city_loss_chance and len(civ.cities) > 1:
            civ.cities.pop(self.rng.randrange(len(civ.cities)))

        self.run_rates()
        self.run_research()
        self.settle_money()

    def desired_army(self) -> int:
        civ, p = self.civ, self.p
        want = p.defenders_per_city * len(civ.cities) + p.standing_force
        if civ.war_turns_left > 0:
            want += 2
        return want

    def run_rates(self) -> None:
        civ, p = self.civ, self.p
        income = self.gross_income()
        if income <= 0:
            return
        upkeep = self.upkeep()
        need = max(0.0, (upkeep - max(0.0, civ.gold))) / income * 100.0
        target_tax = max(p.ai_min_tax,
                         min(100.0, 100.0 - self.luxury_need() - p.ai_science_floor, need))
        civ.tax_rate = (min(target_tax, civ.tax_rate + 10.0) if target_tax > civ.tax_rate
                        else max(target_tax, civ.tax_rate - 10.0))
        civ.luxury_rate = max(0.0, min(self.luxury_need(), 100.0 - civ.tax_rate))
        civ.science_rate = max(p.ai_science_floor,
                               100.0 - civ.tax_rate - civ.luxury_rate)

    def run_research(self) -> None:
        civ = self.civ
        if civ.current_research is None:
            civ.current_research = self.choose_research()
        if not civ.current_research:
            return
        civ.research_progress += self.gross_science()
        cost = 40.0 + 20.0 * len(civ.techs)
        if civ.research_progress >= cost:
            civ.techs.append(civ.current_research)
            civ.current_research = None
            civ.research_progress = 0.0
            if len(civ.techs) % 3 == 0:
                civ.era_index = min(civ.era_index + 1, len(self.p.era_units) - 1)

    # ── money ─────────────────────────────────────────────────────────────

    def gross_income(self) -> float:
        total = 0.0
        for city in self.civ.cities:
            after = max(0.0, self.city_commerce(city) - self.city_corruption(city))
            total += after * (self.civ.tax_rate / 100.0)
        return total * self.p.trade_gold_multiplier

    def gross_science(self) -> float:
        total = 0.0
        for city in self.civ.cities:
            after = max(0.0, self.city_commerce(city) - self.city_corruption(city))
            libs = sum(1 for b in city.buildings if b == "library")
            unis = sum(1 for b in city.buildings if b == "university")
            total += (after * (self.civ.science_rate / 100.0) + libs + 2.0 * unis)
        return total

    def unit_upkeep(self) -> float:
        return sum(self.p.unit_maintenance.get(u, 1.0) for u in self.civ.units)

    def building_upkeep(self) -> float:
        return sum(self.p.building_upkeep.get(b, 1.0)
                   for c in self.civ.cities for b in c.buildings)

    def city_upkeep(self) -> float:
        return max(0, len(self.civ.cities) - self.p.free_city_support) \
            * self.p.city_upkeep_per_city

    def upkeep(self) -> float:
        return self.unit_upkeep() + self.building_upkeep() + self.city_upkeep()

    def luxury_need(self) -> float:
        worst = 0.0
        for city in self.civ.cities:
            happiness, unhappiness = self.city_happiness(city)
            worst = max(worst, max(0.0, unhappiness - happiness))
        if worst <= 0:
            return 0.0
        commerce = sum(self.city_commerce(c) for c in self.civ.cities)
        return 0.0 if commerce <= 0 else min(30.0, worst * 100.0 / commerce)

    def sustainable_units(self) -> int:
        income = self.gross_income()
        committed = self.building_upkeep() + self.unit_upkeep() + self.city_upkeep()
        headroom = income - committed - income * self.p.ai_reserve_contribution
        price = self.p.unit_maintenance.get(self.p.era_units[self.civ.era_index], 1.0)
        if headroom <= 0:
            return len(self.civ.units)
        return len(self.civ.units) + int(headroom / max(price, 0.001))

    # ── R24+: the standing-army budget ────────────────────────────────────

    def queued_upkeep(self) -> float:
        """Upkeep the build queue will commit once its units land.

        The engine's `unitUpkeep` charges only units alive in the field, so
        three cities each see the same headroom and each queue a rifleman.
        This is the price of everything currently in a queue (the sim has one
        in-progress item per city).
        """
        return sum(self.p.unit_maintenance.get(c.current_item.split(":", 1)[1], 1.0)
                   for c in self.civ.cities
                   if c.current_item and c.current_item.startswith("unit:"))

    def army_budget(self) -> float:
        """What the standing army may cost per turn. Every system reads this.

        Income at the POLICY rate, minus buildings, minus cities, minus the
        debt the civ is already servicing, minus a reserve share.
        """
        civ, p = self.civ, self.p
        income = self.gross_income()
        debt = (p.debt_repay_per_turn * (civ.debt / p.debt_repay_per)
                if p.debt_service_in_budget else 0.0)
        return max(0.0, income - self.building_upkeep() - self.city_upkeep()
                   - debt - income * self.p.ai_reserve_contribution)

    def committed_upkeep(self) -> float:
        """What the standing army plus its build queue really cost per turn."""
        civ, p = self.civ, self.p
        field_cost = self.unit_upkeep()
        queue_cost = self.queued_upkeep() if p.queue_priced else 0.0
        return field_cost + queue_cost

    def retire_one_unit(self) -> None:
        """R-B: the throttle the disbander never had.

        Retire the cheapest maintenance-bearing unit that is not the civ's
        only defender — the engine's real order (`disbandUnitsToCoverDeficit`
        prefers non-defenders first, then cheaper), one unit per round instead
        of 29 at once.
        """
        civ, p = self.civ, self.p
        if len(civ.units) <= p.defenders_per_city:
            return
        order = sorted(range(len(civ.units)), key=lambda i: (
            p.unit_maintenance.get(civ.units[i], 1.0),
            civ.units[i] != "warrior"))
        for idx in order:
            if p.unit_maintenance.get(civ.units[idx], 1.0) > 0:
                civ.units.pop(idx)
                civ.disbands += 1
                return

    # ── production choice ─────────────────────────────────────────────────

    def choose_item(self, city: City) -> str | None:
        civ, p = self.civ, self.p
        happiness, unhappiness = self.city_happiness(city)
        if unhappiness > happiness:
            for b in ("temple", "colosseum", "cathedral"):
                if b not in city.buildings and b in p.building_cost:
                    return b
        if not city.has_granary:
            return "granary"
        army = len(civ.units) + sum(
            1 for c in civ.cities if c.current_item
            and c.current_item.startswith("unit:"))
        urgent = len(civ.units) < self.desired_army()
        under_cap = army < self.sustainable_units()
        # R-A: the TOTAL check. The marginal one above asks "does the headroom
        # buy one more of the era unit"; this one asks whether everything the
        # civ has already committed (field + queue) still fits the budget. A
        # maintenance-bearing unit needs both; a free unit only needs the count.
        price = p.unit_maintenance.get(p.era_units[civ.era_index], 1.0)
        budget_ok = (not p.queue_priced
                     or price <= 0
                     or self.committed_upkeep() + price <= self.army_budget())
        if ((under_cap and budget_ok) or (urgent and p.urgent_defender_ignores_cap)):
            return "unit:" + p.era_units[civ.era_index]
        if "marketplace" not in city.buildings:
            return "marketplace"
        if "library" not in city.buildings:
            return "library"
        return None

    def complete_item(self, city: City, item: str) -> None:
        if item.startswith("unit:"):
            self.civ.units.append(item.split(":", 1)[1])
            return
        if item not in city.buildings:
            city.buildings.append(item)
        if item == "aqueduct":
            city.has_aqueduct = True
        if item == "granary":
            city.has_granary = True

    def choose_research(self) -> str | None:
        pool = ("currency", "trade", "writing", "bronze_working", "literacy",
                "philosophy", "iron_working", "the_wheel", "mathematics",
                "engineering", "banking", "industrialization", "steel",
                "combustion", "electricity")
        available = [t for t in pool if t not in self.civ.techs]
        for pref in ("currency", "trade", "writing", "bronze_working", "literacy"):
            if pref in available:
                return pref
        return available[0] if available else None

    def settle_money(self) -> None:
        civ, p = self.civ, self.p
        gross = self.gross_income()
        banked = int(civ.carry + gross)
        civ.carry = civ.carry + gross - banked
        gold_in = banked
        upkeep = self.upkeep()

        debt_paid = 0.0
        if civ.debt > 0 and gold_in - upkeep > 0:
            service = p.debt_repay_per_turn * (civ.debt / p.debt_repay_per)
            debt_paid = min(civ.debt, gold_in - upkeep, service)
            civ.debt -= debt_paid

        # R-B: the drawdown runs BEFORE the treasury is empty, on the budget
        # comparison, not on insolvency — that is what makes it a slope.
        if p.army_budget_drawdown and self.unit_upkeep() > self.army_budget():
            self.retire_one_unit()
            upkeep = self.upkeep()

        civ.gold += gold_in - upkeep - debt_paid
        if civ.gold < 0:
            civ.deficit_turns += 1

        if civ.gold < 0:
            if civ.tax_rate < 100.0:
                civ.tax_rate = 100.0
                civ.science_rate = 0.0
                civ.luxury_rate = 0.0
                civ.gold += self.gross_income() - gross
            if civ.gold < 0:
                civ.bankruptcies += 1
                need = -civ.gold
                order = sorted(range(len(civ.units)), key=lambda i: (
                    self.p.unit_maintenance.get(civ.units[i], 1.0),
                    civ.units[i] != "warrior"))
                for idx in order:
                    if need <= 0:
                        break
                    need -= self.p.unit_maintenance.get(civ.units[idx], 1.0)
                    civ.units[idx] = None  # type: ignore[index]
                    civ.disbands += 1
                civ.units = [u for u in civ.units if u is not None]
                civ.gold = p.absolute_min_gold
                civ.debt += max(0.0, p.absolute_min_gold - (p.absolute_min_gold - 0))

        civ.gold_series.append(civ.gold)
        civ.army_series.append(len(civ.units))
        civ.desired_series.append(self.desired_army())
        civ.commerce_series.append(
            sum(self.city_commerce(c) for c in civ.cities) / max(1, len(civ.cities)))

    # ── run ───────────────────────────────────────────────────────────────

    def run(self) -> Dict[str, float]:
        for _ in range(self.turns):
            self.step()
        civ = self.civ
        t = max(1, self.turns)
        army = civ.army_series
        gold = civ.gold_series
        shortfall = sum(1 for a, d in zip(army, civ.desired_series) if a < d)
        return {
            "disbands": civ.disbands,
            "bankruptcies": civ.bankruptcies,
            "deficit_turns": civ.deficit_turns,
            "army_final": army[-1],
            "army_min": min(army),
            "army_shortfall_turns": shortfall,
            "gold_avg": sum(gold) / t,
            "gold_min": min(gold),
            "cities_final": len(civ.cities),
            "pop_final": sum(c.population for c in civ.cities),
            "commerce_avg": sum(civ.commerce_series) / t,
            "techs": len(civ.techs),
            "upkeep_avg": (self.unit_upkeep() + self.building_upkeep()) / 2,
        }


# ── Experiment table ───────────────────────────────────────────────────────

def row(name: str, **kw) -> Params:
    return replace(BASE, name=name, **kw)


BASE = Params(name="R0 baseline")

# ── The experiment table ────────────────────────────────────────────────────
# Each row isolates ONE lever, so the table says which levers actually matter.
# A row is only a fix if it removes the disbanding WITHOUT collapsing the army.

ROWS: List[Params] = [
    BASE,

    # R1 — the army cap holds back a real buffer instead of 10 % of income.
    row("R1 cap buffer 0.35", ai_reserve_contribution=0.35),

    # R2 — each taxed commerce point pays 3 gold instead of 2.
    row("R2 trade mult 3", trade_gold_multiplier=3.0),

    # R3 — happiness buildings cost half their upkeep.
    row("R3 building upkeep /2",
        building_upkeep={k: v / 2 for k, v in BASE.building_upkeep.items()}),

    # R4 — cities are free to hold (no city upkeep).
    row("R4 no city upkeep", city_upkeep_per_city=0.0),

    # R5 — the works programme lands (roads actually get built).
    row("R5 roads land", road_chance=0.05),

    # R6 — every city has a real commerce floor.
    row("R6 commerce floor 4", city_center_commerce=4.0),

    # R7 — units cost half to keep.
    row("R7 unit upkeep /2",
        unit_maintenance={k: v / 2 for k, v in BASE.unit_maintenance.items()}),

    # R8 — the appetite ramp removed (growth is free again).
    row("R8 no appetite ramp", appetite_ramp_per=0.0),

    # R9 — pure economy: a real commerce floor AND a better trade rate.
    row("R9 floor 4 + mult 3",
        city_center_commerce=4.0, trade_gold_multiplier=3.0),

    # R10 — the same, with the floor high enough to cover a young empire.
    row("R10 floor 6 + mult 3",
        city_center_commerce=6.0, trade_gold_multiplier=3.0),

    # R11 — the AI fix (roads land) plus the better trade rate.
    row("R11 roads land + mult 3", road_chance=0.05, trade_gold_multiplier=3.0),

    # R12 — the full plan: roads land (the structural fix), a sane floor, the
    #      better trade rate, and cheaper happiness upkeep.
    row("R12 full plan",
        road_chance=0.05, city_center_commerce=4.0, trade_gold_multiplier=3.0,
        building_upkeep={k: v / 2 for k, v in BASE.building_upkeep.items()}),

    # R13-R15 — refinement: R5 is the only row that fixes the economy WITHOUT
    # inflating it (gold averages 17, not 1000). How little of the fix is
    # enough, and does it hold across more worlds?
    row("R13 roads land (slow)", road_chance=0.02),
    row("R14 roads land + cap 0.25", road_chance=0.05, ai_reserve_contribution=0.25),
    row("R15 roads land, 5 seeds", road_chance=0.05),

    # ── Because the works programme does not reliably land in the live engine
    #    (a 151-round probe measured 2 roaded WORKED tiles across 5 cities), the
    #    balance-only path is not optional. R16-R19 find the SMALLEST constant
    #    change that removes the disbanding, so the game does not have to be
    #    made rich to be made stable.

    row("R16 floor 3 + mult 2", city_center_commerce=3.0),
    row("R17 floor 4 + mult 2", city_center_commerce=4.0),
    row("R18 floor 3 + mult 3", city_center_commerce=3.0, trade_gold_multiplier=3.0),
    row("R19 floor 4 + mult 3", city_center_commerce=4.0, trade_gold_multiplier=3.0),

    # ── R20+: can the PLUMBING fix replace the R19 crutch? If roads land with
    #    the ORIGINAL constants (floor 2, multiplier 2), R19 can be reverted and
    #    the economy stays as designed while commerce actually scales.
    row("R20 roads + orig constants", road_chance=0.05,
        city_center_commerce=2.0, trade_gold_multiplier=2.0),
    row("R21 roads + floor 3", road_chance=0.05, city_center_commerce=3.0),
    row("R22 roads + mult 2.5", road_chance=0.05, trade_gold_multiplier=2.5),
    row("R23 roads + floor 3 + mult 2.5", road_chance=0.05,
        city_center_commerce=3.0, trade_gold_multiplier=2.5),

    # ── R24+: the standing-army budget. The live engine at 320 rounds
    #    disbanded 48-53 units on seeds 33/51 (0-5 at 150), in four waves with
    #    29 units in one round, all from the ONE civ whose tax rate swung
    #    54→80→35→69. The concept: one budget the builder and the destroyer
    #    share, a queue priced into it, and a one-unit-a-round drawdown.
    row("R24 engine as-is (queue unpriced)", queue_priced=False),
    row("R25 queue priced", queue_priced=True),
    row("R26 queue priced + drawdown", queue_priced=True,
        army_budget_drawdown=True),
    row("R27 budget + debt service in it", queue_priced=True,
        army_budget_drawdown=True, debt_service_in_budget=True),
    row("R28 the concept, 5 seeds", queue_priced=True,
        army_budget_drawdown=True, debt_service_in_budget=True),
]


VERDICT_HEADER = "  verdict"


def verdict(m: Dict[str, float]) -> str:
    """A row is perfect only if it is stable AND does not buy that stability by
    collapsing the army or by inflating the treasury."""
    problems = []
    if m["disbands"] > 0:
        problems.append(f"{m['disbands']:.0f} disbands")
    if m["bankruptcies"] > 0:
        problems.append(f"{m['bankruptcies']:.0f} bankruptcies")
    if m["army_final"] < 4:
        problems.append(f"army {m['army_final']:.1f}")
    if m["cities_final"] < 2:
        problems.append(f"cities {m['cities_final']:.1f}")
    if m["gold_avg"] > 250:
        problems.append(f"hoarding {m['gold_avg']:.0f}g")
    if m["commerce_avg"] < 2.5:
        problems.append(f"commerce {m['commerce_avg']:.2f} (floor)")
    return "PERFECT" if not problems else ", ".join(problems[:3])


def main() -> None:
    head = (f"{'row':<26}{'disb':>5}{'bnk':>5}{'dfct':>5}{'army':>5}{'armMn':>6}"
            f"{'short':>6}{'gldAvg':>8}{'gldMin':>7}{'cty':>4}{'pop':>5}"
            f"{'comm':>6}{'tech':>5}" + VERDICT_HEADER)
    print(head)
    print("-" * (len(head) + 14))
    for params in ROWS:
        seeds = (7, 19, 33, 51, 64) if "5 seeds" in params.name else (7, 19, 33)
        runs = [EconomySim(params, turns=400, seed=s).run() for s in seeds]
        m = {k: sum(r[k] for r in runs) / len(runs) for k in runs[0]}
        print(f"{params.name:<26}{m['disbands']:>5.0f}{m['bankruptcies']:>5.0f}"
              f"{m['deficit_turns']:>5.0f}{m['army_final']:>5.1f}{m['army_min']:>6.1f}"
              f"{m['army_shortfall_turns']:>6.0f}{m['gold_avg']:>8.1f}"
              f"{m['gold_min']:>7.0f}{m['cities_final']:>4.1f}{m['pop_final']:>5.1f}"
              f"{m['commerce_avg']:>6.2f}{m['techs']:>5.0f}  {verdict(m)}")
    print()


if __name__ == "__main__":
    main()
