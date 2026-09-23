import React from 'react';
import { UnitActionsModalProps } from './UnitActionsModalProps';
import '../../styles/unitActionsModal.css';

const UnitActionsModal: React.FC<UnitActionsModalProps> = ({
  contextMenu,
  onExecuteAction,
  onClose,
  gameEngine
}) => {
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
        aria-label="Unit actions"
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
            <strong className="unit-context-menu__title">ORDERS</strong>
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
            🚧 Working on {contextMenu.unit.workTarget} ({contextMenu.unit.workTurns} turn{contextMenu.unit.workTurns !== 1 ? 's' : ''} left)
          </div>
        )}

        {/* Fisher Boat route status */}
        {contextMenu.unit?.fishingRoute && (
          <div className="unit-context-menu__work">
            🎣 {contextMenu.unit.fishingRoute.stage === 'fishing'
              ? `Fishing ${contextMenu.unit.fishStored ?? 0}/6`
              : contextMenu.unit.fishingRoute.stage === 'inbound'
                ? `Returning to port (${contextMenu.unit.fishStored ?? 0}/6)`
                : 'Sailing to the fishing ground'}
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
                  <span aria-hidden="true">🛡️</span>Fortify
                </button>
              )}

              {/* Mobilize: unfreeze a fortified unit (keeps 0 moves for this turn) */}
              {isFortified && (
                <button
                  type="button"
                  className="context-menu-item"
                  onClick={() => handleAction('mobilize')}
                >
                  <span aria-hidden="true">⚔️</span>Mobilize
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
                      <span aria-hidden="true">🏛️</span>Found / Join City
                    </button>
                  )}

                  {improvementStatus('road').possible && (
                    <button
                      type="button"
                      className="context-menu-item"
                      disabled={!improvementStatus('road').executable || isFortified || isSleeping}
                      onClick={() => handleAction('build_road')}
                    >
                      <span aria-hidden="true">🛣️</span>Build Road
                    </button>
                  )}

                  {improvementStatus('irrigation').possible && (
                    <button
                      type="button"
                      className="context-menu-item"
                      disabled={!improvementStatus('irrigation').executable || isFortified || isSleeping}
                      onClick={() => handleAction('build_irrigation')}
                    >
                      <span aria-hidden="true">🌾</span>Build Irrigation
                    </button>
                  )}

                  {improvementStatus('mine').possible && (
                    <button
                      type="button"
                      className="context-menu-item"
                      disabled={!improvementStatus('mine').executable || isFortified || isSleeping}
                      onClick={() => handleAction('build_mine')}
                    >
                      <span aria-hidden="true">⛏️</span>Build Mine
                    </button>
                  )}

                  {improvementStatus('railroad').possible && (
                    <button
                      type="button"
                      className="context-menu-item"
                      disabled={!improvementStatus('railroad').executable || isFortified || isSleeping}
                      onClick={() => handleAction('build_railroad')}
                    >
                      <span aria-hidden="true">🚆</span>Build Railroad
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
                      <span aria-hidden="true">🎣</span>Deploy Fishing Net
                    </button>
                  )}
                  {contextMenu.unit.fishingRoute && (
                    <button
                      type="button"
                      className="context-menu-item"
                      disabled={isFortified || isSleeping}
                      onClick={() => handleAction('remove_fishing_net')}
                    >
                      <span aria-hidden="true">❌</span>Remove Fishing Net (recall)
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
                    <span aria-hidden="true">🕊️</span>Propose Peace
                  </button>
                  <button
                    type="button"
                    className="context-menu-item"
                    disabled={!canAct(contextMenu.unit) || isFortified || isSleeping}
                    onClick={() => handleAction('diplomat_propose_alliance')}
                  >
                    <span aria-hidden="true">🤝</span>Propose Alliance
                  </button>
                  <button
                    type="button"
                    className="context-menu-item"
                    disabled={!canAct(contextMenu.unit) || isFortified || isSleeping}
                    onClick={() => handleAction('diplomat_demand_tribute')}
                  >
                    <span aria-hidden="true">💰</span>Demand Tribute
                  </button>
                  <button
                    type="button"
                    className="context-menu-item"
                    disabled={!canAct(contextMenu.unit) || isFortified || isSleeping}
                    onClick={() => handleAction('diplomat_bribe')}
                  >
                    <span aria-hidden="true">🎭</span>Bribe Unit
                  </button>
                  <button
                    type="button"
                    className="context-menu-item"
                    disabled={!canAct(contextMenu.unit) || isFortified || isSleeping}
                    onClick={() => handleAction('diplomat_gather_intel')}
                  >
                    <span aria-hidden="true">🔍</span>Gather Intelligence
                  </button>
                </>
              )}

              <button
                type="button"
                className="context-menu-item"
                disabled={isFortified || isSleeping}
                onClick={() => handleAction('patrol')}
              >
                <span aria-hidden="true">🔄</span>Patrol
              </button>

              <button
                type="button"
                className="context-menu-item"
                disabled={isFortified || isSleeping}
                onClick={() => handleAction('goto')}
              >
                <span aria-hidden="true">📍</span>Go to
              </button>

              {contextMenu.unit && gameEngine?.goToManager?.getUnitPath(contextMenu.unit.id) && (
                <button
                  type="button"
                  className="context-menu-item context-menu-item--danger"
                  disabled={isFortified || isSleeping}
                  onClick={() => handleAction('goto_cancel')}
                >
                  <span aria-hidden="true">❌</span>GoTo X
                </button>
              )}

              <button
                type="button"
                className="context-menu-item"
                disabled={isFortified || isSleeping}
                onClick={() => handleAction('skip_turn')}
              >
                <span aria-hidden="true">⏭️</span>Skip Turn
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
                  <span aria-hidden="true">🗑️</span>Disband
                </button>
              )}

              {/* Sleep/Wake: always enabled (can wake fortified or sleeping units) */}
              <button
                type="button"
                className="context-menu-item"
                onClick={() => handleAction('sleep')}>
                <span aria-hidden="true">{contextMenu.unit.isSleeping ? '🌅' : '😴'}</span>
                {contextMenu.unit.isSleeping ? 'Wake Up' : 'Sleep'}
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
                <span aria-hidden="true">🏭</span>View Production
              </button>
              <button
                type="button"
                className="context-menu-item"
                onClick={() => handleAction('cityInfo')}
              >
                <span aria-hidden="true">📊</span>City Info
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default UnitActionsModal;
