import React, { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { tUnitName } from '@/i18n/dataNames';
import type { TranslationKey } from '@/i18n';
import type { DiplomatAction, DiplomatTarget } from '@/game/engine/DiplomacyTypes';
import { UnitActionsModalProps } from './UnitActionsModalProps';
import '../../styles/unitActionsModal.css';

/**
 * One entry in the diplomat's menu: which engine ability it runs, what the
 * button says and which emoji stands in for it.
 *
 * The list is deliberately exhaustive over `DiplomatAction` — `Record<DiplomatAction, …>`
 * is what makes a newly added ability a compile error here instead of a button
 * that silently never appears.
 */
const DIPLOMAT_ACTION_UI: Record<
  DiplomatAction,
  { icon: string; label: string; section: 'diplomacy' | 'treaty' | 'bribe' | 'infiltration' }
> = {
  gather_intelligence: { icon: '🔍', label: 'unitActions.gatherIntelligence', section: 'diplomacy' },
  propose_peace: { icon: '🕊️', label: 'unitActions.proposePeace', section: 'diplomacy' },
  propose_ceasefire: { icon: '🏳️', label: 'unitActions.proposeCeasefire', section: 'diplomacy' },
  propose_alliance: { icon: '🤝', label: 'unitActions.proposeAlliance', section: 'diplomacy' },
  demand_tribute: { icon: '💰', label: 'unitActions.demandTribute', section: 'diplomacy' },
  offer_open_borders: { icon: '🚪', label: 'unitActions.openBorders', section: 'treaty' },
  propose_trade_agreement: { icon: '📦', label: 'unitActions.tradeAgreement', section: 'treaty' },
  offer_tech_exchange: { icon: '🔬', label: 'unitActions.techExchange', section: 'treaty' },
  propose_mutual_defense: { icon: '🛡️', label: 'unitActions.mutualDefense', section: 'treaty' },
  propose_non_aggression: { icon: '🤚', label: 'unitActions.nonAggression', section: 'treaty' },
  propose_embargo: { icon: '🚫', label: 'unitActions.embargo', section: 'treaty' },
  bribe_unit: { icon: '🎭', label: 'unitActions.bribeUnit', section: 'bribe' },
  establish_embassy: { icon: '🏛️', label: 'unitActions.establishEmbassy', section: 'infiltration' },
  investigate_city: { icon: '🗺️', label: 'unitActions.investigateCity', section: 'infiltration' },
  industrial_sabotage: { icon: '🔥', label: 'unitActions.industrialSabotage', section: 'infiltration' },
  steal_technology: { icon: '📜', label: 'unitActions.stealTechnology', section: 'infiltration' },
  offer_gift: { icon: '🎁', label: 'unitActions.giveGold', section: 'diplomacy' },
  propose_joint_war: { icon: '⚔️', label: 'unitActions.callToArms', section: 'diplomacy' },
  incite_revolt: { icon: '🔥', label: 'unitActions.inciteRevolt', section: 'infiltration' },
};

/** Sections in the order they are drawn, each with its own heading. */
const DIPLOMAT_SECTIONS = [
  { id: 'diplomacy' as const, heading: 'unitActions.diplomacyHeading' },
  { id: 'treaty' as const, heading: 'unitActions.treatyHeading' },
  { id: 'bribe' as const, heading: 'unitActions.bribeHeading' },
  { id: 'infiltration' as const, heading: 'unitActions.espionageHeading' },
];

/**
 * Which court the click was aimed at. Travels with the action so a diplomat
 * standing between a city and a unit of the same civ can be told which one the
 * player meant, and so the engine never has to guess.
 */
function targetData(target: DiplomatTarget): Record<string, unknown> {
  return {
    targetCivId: target.targetCivId,
    cityId: target.cityId,
    unitId: target.unitId,
  };
}

const UnitActionsModal: React.FC<UnitActionsModalProps> = ({
  contextMenu,
  onExecuteAction,
  onClose,
  gameEngine
}) => {
  const { t } = useTranslation();
  // Which of the adjacent courts the menu is showing. A diplomat can stand
  // between two rivals; without this the player could only ever open with
  // whichever one the engine happened to find first.
  //
  // Remembered per unit: the modal stays mounted between openings, so a raw
  // index would carry the previous unit's choice over to the next one.
  const [selection, setSelection] = useState({ unitId: '', index: 0 });
  if (!contextMenu) return null;

  const handleAction = (action: string, data?: Record<string, unknown>) => {
    onExecuteAction(action, data);
    onClose();
  };

  const canAct = (unit: { movesRemaining?: number } | null) => (unit?.movesRemaining ?? 0) > 0;

  // Fortified units: all actions except Wake disabled (Civ1: fortified unit is locked)
  // Sleeping units: Fortify disabled, other actions available
  const isFortified = !!contextMenu.unit?.isFortified;
  const isSleeping = !!contextMenu.unit?.isSleeping;

  // ── Diplomat ────────────────────────────────────────────────────────
  // Everything comes from the engine, which is the only place that knows what
  // this diplomat can actually do where it stands: a war zone has no embassy to
  // found, a city has no unit to bribe, and a signed treaty is not offered
  // again. The menu used to render a fixed list of buttons regardless, so most
  // of them led to "diplomat action failed".
  const diplomat = contextMenu.unit?.type === 'diplomat' ? contextMenu.unit : null;
  const targets: DiplomatTarget[] = diplomat && gameEngine?.getDiplomatTargets
    ? gameEngine.getDiplomatTargets(diplomat.id)
    : [];
  const targetIndex = selection.unitId === (diplomat?.id ?? '') ? selection.index : 0;
  const selectTarget = (index: number) => setSelection({ unitId: diplomat?.id ?? '', index });
  const target = targets[Math.min(targetIndex, Math.max(targets.length - 1, 0))];
  const targetCivName = (target && gameEngine?.civilizations?.[target.targetCivId]?.name) || '';
  /** How the chosen court is named in the menu — its city name, or its unit type. */
  const targetName = (tg: DiplomatTarget): string => (tg.kind === 'city'
    ? (tg.cityName ?? '')
    : tUnitName(tg.unitType ?? '', tg.unitType ?? ''));
  const targetLabel = target
    ? t(
      (target.kind === 'city' ? 'unitActions.targetCity' : 'unitActions.targetUnit') as TranslationKey,
      { name: targetName(target), civ: targetCivName },
    )
    : '';

  // Settler action availability — mirrors the engine's buildImprovement /
  // foundCityWithSettler checks so only genuinely possible options are shown.
  const improvementStatus = (type: string): { possible: boolean; executable: boolean } => {
    const unit = contextMenu.unit;
    if (!unit || !gameEngine) return { possible: false, executable: false };
    const possible = gameEngine.canBuildImprovement?.(unit.id, type) ?? false;
    const executable = possible && (gameEngine.hasMovesForImprovement?.(unit.id, type) ?? false);
    return { possible, executable };
  };

  const foundCityAvailable = (): boolean => {
    const unit = contextMenu.unit;
    if (!unit || !gameEngine) return false;
    return (gameEngine.canFoundCity?.(unit.id) ?? false)
      || (gameEngine.canJoinCity?.(unit.id) ?? false);
  };

  return (
    <>
      {/* Backdrop for click-outside / tap-outside dismissal */}
      <div
        className="unit-context-backdrop"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
        aria-hidden="true"
      />

      {/* Context Menu — bottom sheet on mobile, anchored popover on desktop */}
      <div
        className="unit-context-menu"
        role="menu"
        aria-label={t('unitActions.menuLabel' as TranslationKey)}
        style={{
          '--ctx-left': `${Math.max(8, Math.min(contextMenu.x, window.innerWidth - 280))}px`,
          '--ctx-top': `${Math.max(8, Math.min(contextMenu.y, window.innerHeight - 420))}px`,
        } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
      >
        {/* Header */}
        <div className="unit-context-menu__header">
          <div>
            <strong className="unit-context-menu__title">{t('unitActions.orders' as TranslationKey)}</strong>
            {contextMenu.unit && (
              <div className="unit-context-menu__unit-type">
                {contextMenu.unit.type}
              </div>
            )}
            {!contextMenu.unit && contextMenu.city && (
              <div className="unit-context-menu__unit-type">
                {contextMenu.city.name}
              </div>
            )}
          </div>
          <div className="unit-context-menu__coords">
            ({contextMenu.hex.col}, {contextMenu.hex.row})
          </div>
        </div>

        {/* Civ1 multi-turn construction progress */}
        {contextMenu.unit?.workTarget && (
          <div className="unit-context-menu__work">
            🚧 {contextMenu.unit.workTurns !== 1
              ? t('unitActions.workingMany' as TranslationKey, {
                  target: contextMenu.unit.workTarget,
                  turns: contextMenu.unit.workTurns,
                })
              : t('unitActions.workingOne' as TranslationKey, {
                  target: contextMenu.unit.workTarget,
                  turns: contextMenu.unit.workTurns,
                })}
          </div>
        )}

        {/* Fisher Boat route status */}
        {contextMenu.unit?.fishingRoute && (
          <div className="unit-context-menu__work">
            🎣 {contextMenu.unit.fishingRoute.stage === 'fishing'
              ? t('unitActions.fishing' as TranslationKey, { count: contextMenu.unit.fishStored ?? 0 })
              : contextMenu.unit.fishingRoute.stage === 'inbound'
                ? t('unitActions.returningToPort' as TranslationKey, { count: contextMenu.unit.fishStored ?? 0 })
                : t('unitActions.sailingToGround' as TranslationKey)}
          </div>
        )}

        <div className="unit-context-menu__scroll">
          {/* Unit Actions */}
          {contextMenu.unit && (
            <>

              {/* Fortify: available for all military units (attack > 0 or defense > 0).
                  Disabled when sleeping, already fortified, or no moves. */}
              {contextMenu.unit && ((contextMenu.unit.attack ?? 0) > 0 || (contextMenu.unit.defense ?? 0) > 0) && (
                <button
                  type="button"
                  className="context-menu-item"
                  disabled={!canAct(contextMenu.unit) || isSleeping || isFortified}
                  onClick={() => handleAction('fortify')}
                >
                  <span aria-hidden="true">🛡️</span>{t('unitActions.fortify' as TranslationKey)}
                </button>
              )}

              {/* Mobilize: unfreeze a fortified unit (keeps 0 moves for this turn) */}
              {isFortified && (
                <button
                  type="button"
                  className="context-menu-item"
                  onClick={() => handleAction('mobilize')}
                >
                  <span aria-hidden="true">⚔️</span>{t('unitActions.mobilize' as TranslationKey)}
                </button>
              )}

              {contextMenu.unit.type === 'settler' && (
                <>
                  {foundCityAvailable() && (
                    <button
                      type="button"
                      className="context-menu-item"
                      disabled={isFortified || isSleeping}
                      onClick={() => handleAction('found_city')}
                    >
                      <span aria-hidden="true">🏛️</span>{t('unitActions.foundJoinCity' as TranslationKey)}
                    </button>
                  )}

                  {improvementStatus('road').possible && (
                    <button
                      type="button"
                      className="context-menu-item"
                      disabled={!improvementStatus('road').executable || isFortified || isSleeping}
                      onClick={() => handleAction('build_road')}
                    >
                      <span aria-hidden="true">🛣️</span>{t('unitActions.buildRoad' as TranslationKey)}
                    </button>
                  )}

                  {improvementStatus('irrigation').possible && (
                    <button
                      type="button"
                      className="context-menu-item"
                      disabled={!improvementStatus('irrigation').executable || isFortified || isSleeping}
                      onClick={() => handleAction('build_irrigation')}
                    >
                      <span aria-hidden="true">🌾</span>{t('unitActions.buildIrrigation' as TranslationKey)}
                    </button>
                  )}

                  {improvementStatus('mine').possible && (
                    <button
                      type="button"
                      className="context-menu-item"
                      disabled={!improvementStatus('mine').executable || isFortified || isSleeping}
                      onClick={() => handleAction('build_mine')}
                    >
                      <span aria-hidden="true">⛏️</span>{t('unitActions.buildMine' as TranslationKey)}
                    </button>
                  )}

                  {improvementStatus('railroad').possible && (
                    <button
                      type="button"
                      className="context-menu-item"
                      disabled={!improvementStatus('railroad').executable || isFortified || isSleeping}
                      onClick={() => handleAction('build_railroad')}
                    >
                      <span aria-hidden="true">🚆</span>{t('unitActions.buildRailroad' as TranslationKey)}
                    </button>
                  )}
                </>
              )}

              {contextMenu.unit.type === 'fisher_boat' && (
                <>
                  {(gameEngine?.canDeployFishingNet?.(contextMenu.unit.id) ?? false) && (
                    <button
                      type="button"
                      className="context-menu-item"
                      disabled={isFortified || isSleeping}
                      onClick={() => handleAction('deploy_fishing_net')}
                    >
                      <span aria-hidden="true">🎣</span>{t('unitActions.deployFishingNet' as TranslationKey)}
                    </button>
                  )}
                  {contextMenu.unit.fishingRoute && (
                    <button
                      type="button"
                      className="context-menu-item"
                      disabled={isFortified || isSleeping}
                      onClick={() => handleAction('remove_fishing_net')}
                    >
                      <span aria-hidden="true">❌</span>{t('unitActions.removeFishingNet' as TranslationKey)}
                    </button>
                  )}
                </>
              )}

{contextMenu.unit.type === 'trade_ship' && (
                <>
                  {(gameEngine?.canEstablishTradeShipRoute?.(contextMenu.unit.id) ?? false) && (
                    <button
                      type="button"
                      className="context-menu-item"
                      disabled={isFortified || isSleeping}
                      onClick={() => handleAction('establish_trade_ship_route')}
                    >
                      <span aria-hidden="true">🚢</span>Establish trade route
                    </button>
                  )}
                  {contextMenu.unit.tradeShipRoute && (
                    <button
                      type="button"
                      className="context-menu-item"
                      disabled={isFortified || isSleeping}
                      onClick={() => handleAction('cancel_trade_ship_route')}
                    >
                      <span aria-hidden="true">❌</span>Cancel trade route
                    </button>
                  )}
                </>
              )}

              {diplomat && (
                <>
                  {/* With several courts in reach, let the player say which one
                      the diplomat opens with. One target needs no chooser. */}
                  {targets.length > 1 && (
                    <div className="context-menu-targets" role="group">
                      <span className="context-menu-targets__label">
                        {t('unitActions.chooseTarget' as TranslationKey)}
                      </span>
                      {targets.map((tg, i) => (
                        <button
                          key={`${tg.kind}-${tg.cityId ?? tg.unitId}`}
                          type="button"
                          className="context-menu-target"
                          aria-pressed={i === (target ? targets.indexOf(target) : 0)}
                          onClick={() => selectTarget(i)}
                        >
                          <span aria-hidden="true">{tg.kind === 'city' ? '🏙️' : '🎖️'}</span>
                          {targetName(tg)}
                        </button>
                      ))}
                    </div>
                  )}

                  {target && (
                    <div className="unit-context-menu__unit-type">{targetLabel}</div>
                  )}

                  {!target && (
                    <div className="context-menu-hint">
                      {t('unitActions.noTarget' as TranslationKey)}
                    </div>
                  )}

                  {target && (
                    <>
                      {/* An audience is not an engine action — the player is
                          simply received, and the negotiation screen opens. */}
                      {target.kind === 'city' && (
                        <button
                          type="button"
                          className="context-menu-item"
                          disabled={!canAct(diplomat) || isFortified || isSleeping}
                          onClick={() => handleAction('diplomat_meet_leader', targetData(target))}
                        >
                          <span aria-hidden="true">👑</span>{t('unitActions.meetLeader' as TranslationKey)}
                        </button>
                      )}

                      {DIPLOMAT_SECTIONS.map((section) => {
                        const actions = target.actions.filter(
                          (a) => DIPLOMAT_ACTION_UI[a].section === section.id,
                        );
                        if (actions.length === 0) return null;
                        return (
                          <div key={section.id} className="context-menu-section">
                            <div className="context-menu-divider" role="separator">
                              {t(section.heading as TranslationKey)}
                            </div>
                            {actions.map((action) => (
                              <button
                                key={action}
                                type="button"
                                className="context-menu-item"
                                disabled={!canAct(diplomat) || isFortified || isSleeping}
                                onClick={() => handleAction(`diplomat_${action}`, targetData(target))}
                              >
                                <span aria-hidden="true">{DIPLOMAT_ACTION_UI[action].icon}</span>
                                {t(DIPLOMAT_ACTION_UI[action].label as TranslationKey)}
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </>
                  )}
                </>
              )}

              <button
                type="button"
                className="context-menu-item"
                disabled={isFortified || isSleeping}
                onClick={() => handleAction('patrol')}
              >
                <span aria-hidden="true">🔄</span>{t('unitActions.patrol' as TranslationKey)}
              </button>

              <button
                type="button"
                className="context-menu-item"
                disabled={isFortified || isSleeping}
                onClick={() => handleAction('goto')}
              >
                <span aria-hidden="true">📍</span>{t('unitActions.goTo' as TranslationKey)}
              </button>

              {contextMenu.unit && gameEngine?.goToManager?.getUnitPath(contextMenu.unit.id) && (
                <button
                  type="button"
                  className="context-menu-item context-menu-item--danger"
                  disabled={isFortified || isSleeping}
                  onClick={() => handleAction('goto_cancel')}
                >
                  <span aria-hidden="true">❌</span>{t('unitActions.goToCancel' as TranslationKey)}
                </button>
              )}

              <button
                type="button"
                className="context-menu-item"
                disabled={isFortified || isSleeping}
                onClick={() => handleAction('skip_turn')}
              >
                <span aria-hidden="true">⏭️</span>{t('unitActions.skipTurn' as TranslationKey)}
              </button>

              {/* Disband: remove the unit from the game entirely. Costs the
                  unit's maintenance for one turn but frees the ongoing upkeep
                  permanently.  Only shown for non-NONE units. */}
              {contextMenu.unit && !contextMenu.unit.isNoneUnit && (
                <button
                  type="button"
                  className="context-menu-item context-menu-item--danger"
                  disabled={isFortified || isSleeping}
                  onClick={() => handleAction('disband_unit')}
                >
                  <span aria-hidden="true">🗑️</span>{t('unitActions.disband' as TranslationKey)}
                </button>
              )}

              {/* Sleep/Wake: always enabled (can wake fortified or sleeping units) */}
              <button
                type="button"
                className="context-menu-item"
                onClick={() => handleAction('sleep')}>
                <span aria-hidden="true">{contextMenu.unit.isSleeping ? '🌅' : '😴'}</span>
                {contextMenu.unit.isSleeping ? t('unitActions.wakeUp' as TranslationKey) : t('unitActions.sleep' as TranslationKey)}
              </button>
            </>
          )}

          {/* City Actions */}
          {contextMenu.city && (
            <>
              <button
                type="button"
                className="context-menu-item"
                onClick={() => handleAction('viewProduction')}
              >
                <span aria-hidden="true">🏭</span>{t('unitActions.viewProduction' as TranslationKey)}
              </button>
              <button
                type="button"
                className="context-menu-item"
                onClick={() => handleAction('cityInfo')}
              >
                <span aria-hidden="true">📊</span>{t('unitActions.cityInfo' as TranslationKey)}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default UnitActionsModal;
