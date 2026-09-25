/**
 * Presentation helpers for city production results.
 *
 * `ProductionManager` rejects some production requests on purpose (unresearched
 * tech, building already owned/queued, …) and answers with a machine-readable
 * `reason`. These helpers turn that reason into text the player can act on.
 */

/** Maps a familiar `ProductionResult.reason` code to a human-readable phrase. */
const PRODUCTION_FAILURE_TEXTS: Record<string, string> = {
  already_built: 'it is already built in this city',
  already_queued: 'it is already in the build queue',
  already_in_production: 'it is already being produced',
  city_not_found: 'the city no longer exists',
  already_purchased_this_turn: 'this city already bought something this turn',
  // ProductionManager emits `insufficient_gold`; the older `not_enough_gold`
  // spelling is still accepted so both codes render as a sentence (the mismatch
  // used to fall through to the raw code and show "insufficient gold").
  insufficient_gold: 'there is not enough gold',
  not_enough_gold: 'there is not enough gold',
  no_water_access: 'the city has no water access',
  fisher_boat_limit: 'this city already has a Fisher Boat',
  civ_not_found: 'this civilization no longer exists',
  exception: 'the production manager reported an error',
};

/**
 * Human-readable explanation for a production rejection.
 * `requires_tech_<id>` codes are rendered as "it requires <id>".
 */
export function productionFailureText(reason?: string | null): string {
  if (!reason) return 'the reason is unknown';
  if (reason.startsWith('requires_tech_')) {
    const tech = reason.slice('requires_tech_'.length).replace(/_/g, ' ');
    return `it requires the ${tech} technology`;
  }
  if (reason.startsWith('requires_building_')) {
    const building = reason.slice('requires_building_'.length).replace(/_/g, ' ');
    return `it requires a ${building} in this city`;
  }
  return PRODUCTION_FAILURE_TEXTS[reason] ?? reason.replace(/_/g, ' ');
}
