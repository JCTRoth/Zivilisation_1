/**
 * DiplomatAbilities — which abilities a diplomat actually has at a given spot.
 *
 * The player menu, the AI's choice and `GameEngine.executeDiplomatAction`'s
 * validation all have to agree on that list. When they were each written out
 * separately they did not: the menu showed every button regardless of context,
 * the engine offered only a handful, and `executeDiplomatAction` implemented a
 * third set — so the player could click "Establish Embassy" in a war zone and
 * be told it failed, while six treaty abilities were unreachable from the unit
 * at all.
 *
 * So the list is computed once, here, from plain facts about the situation.
 * Nothing in this file touches the engine: the caller collects the facts, and
 * the rules stay testable on their own.
 *
 * The rules encode Civ I:
 *
 *  - a diplomat speaks to whoever it is standing next to, and what it may
 *    propose depends on what the two civs currently are to each other;
 *  - a city you are *fighting* is entered with soldiers, so no infiltration is
 *    ever offered inside a war zone;
 *  - terms beyond the basic statuses (borders, trade, an exchange of
 *    knowledge, an embargo) need a channel — an embassy — because that is the
 *    same gate the negotiation screen uses;
 *  - a term already in force is not offered again.
 */

import type { DiplomatAction, DiplomaticStatus, TreatyType } from '../DiplomacyTypes';

/** Everything the rules below need to know about one adjacent target. */
export interface DiplomatAbilityFacts {
  /** A foreign city or a foreign unit is what the diplomat stands next to. */
  kind: 'city' | 'unit';
  /** How the two civs currently stand to each other. */
  status: DiplomaticStatus;
  /** Whether a channel to this court exists (an embassy). */
  hasEmbassy: boolean;
  /** Treaties already in force between the two civs. */
  activeTreaties: TreatyType[];
  /** Whether both sides hold a technology the other lacks. */
  canTradeTechs: boolean;
  /**
   * Whether both courts have a diplomat standing within reach of the other.
   * Knowledge is only ever handed over face to face, so a deal that names a
   * technology is not worth offering without it.
   */
  hasDiplomatContact?: boolean;
  /**
   * Techs WE hold that the listener lacks — the supply side of a deal. A
   * secret we hold and they do not is something we can sell them, or give
   * them outright.
   */
  techsWeCanOffer?: number;
  /**
   * Techs the LISTENER holds that we lack — the demand side of a deal, and
   * the reason to name a price for what we want.
   */
  techsWeWant?: number;
  /** Third parties an embargo could be agreed against. */
  embargoCandidates: number[];
  /**
   * Enemies of OUR side the listener has met — the only civs a call to arms
   * can honestly name. Ask an ally to fight a stranger and the ask is
   * nonsense; ask them to join a war they already know is real, and the
   * joint-war scoring has something to weigh.
   */
  jointWarCandidates: number[];
}

/**
 * Every ability the diplomat has here, in menu order: intelligence first, then
 * the negotiation, then the treaties, then bribery, then the infiltrations.
 */
export function diplomatActionsFor(facts: DiplomatAbilityFacts): DiplomatAction[] {
  const actions: DiplomatAction[] = ['gather_intelligence'];

  // ── 1. The negotiation, which depends on what the two civs are ────────
  switch (facts.status) {
    case 'war':
      actions.push('propose_ceasefire', 'propose_peace', 'demand_tribute');
      break;
    case 'ceasefire':
      actions.push('propose_peace');
      break;
    case 'peace':
      actions.push('propose_alliance', 'demand_tribute');
      break;
    case 'alliance':
      // An ally is not a partner to be re-welcomed, but it can still be milked.
      actions.push('demand_tribute');
      break;
  }

  // A call to arms: we are at war and the listener is a friend who has met
  // the enemy. Only wars the listener can see are named — asking an ally to
  // fight a stranger it has never heard of is not a proposal, it is nonsense.
  if (
    facts.jointWarCandidates.length > 0
    && (facts.status === 'alliance' || facts.activeTreaties.includes('mutual_defense'))
  ) {
    actions.push('propose_joint_war');
  }

  // ── 2. Terms beyond the basic statuses — these need a channel ─────────
  if (facts.status !== 'war' && facts.hasEmbassy) {
    if (!facts.activeTreaties.includes('open_borders')) actions.push('offer_open_borders');
    if (!facts.activeTreaties.includes('trade_agreement')) actions.push('propose_trade_agreement');
    if (!facts.activeTreaties.includes('mutual_defense')) actions.push('propose_mutual_defense');
    if (!facts.activeTreaties.includes('non_aggression')) actions.push('propose_non_aggression');
    // An embargo names a third party, so it is only real when one exists.
    if (!facts.activeTreaties.includes('embargo_target') && facts.embargoCandidates.length > 0) {
      actions.push('propose_embargo');
    }
    if (facts.canTradeTechs) actions.push('offer_tech_exchange');
    // A secret we hold and they lack is money in the bank — they can buy it
    // from us, or we can hand it over as a gift. Both need the two diplomats
    // to actually be standing together.
    if (facts.hasDiplomatContact !== false) {
      if ((facts.techsWeCanOffer ?? 0) > 0) {
        actions.push('offer_tech_for_gold', 'gift_technology');
      } else if ((facts.techsWeWant ?? 0) > 0) {
        // What we lack and they hold can still be bought, if they are willing.
        actions.push('offer_tech_for_gold');
      }
    }
  }

  // Gold only changes hands through the channel, and Gold gifts/requests need
  // an ally to be meaningful — they follow a call-to-arms ticket, not a
  // stranger at peace.
  if (facts.status === 'alliance') {
    actions.push('call_for_help', 'gift_gold', 'request_gold');
  }
  // An ally (or mutual-defense partner) with a named, met enemy gets the
  // explicit call-to-arms button on top.
  if (
    facts.jointWarCandidates.length > 0
    && (facts.status === 'alliance' || facts.activeTreaties.includes('mutual_defense'))
  ) {
    if (!actions.includes('propose_joint_war')) actions.push('propose_joint_war');
  }

  // ── 3. Bribery and infiltration, which are about the thing itself ─────
  if (facts.kind === 'unit') {
    actions.push('bribe_unit');
  } else if (facts.status !== 'war') {
    // An embassy already founded is not re-founded, and one refused in a war
    // is never offered there in the first place.
    if (!facts.hasEmbassy) actions.push('establish_embassy');
    actions.push('investigate_city', 'industrial_sabotage', 'steal_technology');
    // Incitement is bought from agents inside the city, so it needs the same
    // peacetime access every other infiltration does.
    actions.push('incite_revolt');
  }

  return actions;
}
