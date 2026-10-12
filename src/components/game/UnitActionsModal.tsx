import React from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TranslationKey } from '@/i18n';
import { UnitActionsModalProps } from './UnitActionsModalProps';
import '../../styles/unitActionsModal.css';

const UnitActionsModal: React.FC<UnitActionsModalProps> = ({
  contextMenu,
  onExecuteAction,
  onClose,
  gameEngine
}) => {
  const { t } = useTranslation();
  if (!contextMenu) return null;

  const handleAction = (action: string) => {
    onExecuteAction(action);
    onClose();
  };

  const canAct = (unit: { movesRemaining?: number } | null) => (unit?.movesRemaining ?? 0) > 0;

  // Fortified units: all actions except Wake disabled (Civ1: fortified unit is locked)
  // Sleeping units: Fortify disabled, other actions available
  const isFortified = !!contextMenu.unit?.isFortified;
  const isSleeping = !!contextMenu.unit?.isSleeping;

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

              {contextMenu.unit.type === 'diplomat' && (
                <>
                  <button
                    type="button"
                    className="context-menu-item"
                    disabled={!canAct(contextMenu.unit) || isFortified || isSleeping}
                    onClick={() => handleAction('diplomat_propose_peace')}
                  >
                    <span aria-hidden="true">🕊️</span>{t('unitActions.proposePeace' as TranslationKey)}
                  </button>
                  <button
                    type="button"
                    className="context-menu-item"
                    disabled={!canAct(contextMenu.unit) || isFortified || isSleeping}
                    onClick={() => handleAction('diplomat_propose_alliance')}
                  >
                    <span aria-hidden="true">🤝</span>{t('unitActions.proposeAlliance' as TranslationKey)}
                  </button>
                  <button
                    type="button"
                    className="context-menu-item"
                    disabled={!canAct(contextMenu.unit) || isFortified || isSleeping}
                    onClick={() => handleAction('diplomat_demand_tribute')}
                  >
                    <span aria-hidden="true">💰</span>{t('unitActions.demandTribute' as TranslationKey)}
                  </button>
                  <button
                    type="button"
                    className="context-menu-item"
                    disabled={!canAct(contextMenu.unit) || isFortified || isSleeping}
                    onClick={() => handleAction('diplomat_bribe')}
                  >
                    <span aria-hidden="true">🎭</span>{t('unitActions.bribeUnit' as TranslationKey)}
                  </button>
                  <button
                    type="button"
                    className="context-menu-item"
                    disabled={!canAct(contextMenu.unit) || isFortified || isSleeping}
                    onClick={() => handleAction('diplomat_gather_intel')}
                  >
                    <span aria-hidden="true">🔍</span>{t('unitActions.gatherIntelligence' as TranslationKey)}
                  </button>
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
