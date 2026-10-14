import React, { useState, useEffect, useRef } from 'react';
import { Button, Badge, ProgressBar, Tab, Tabs } from 'react-bootstrap';
import { CityModalLogic } from './CityModalLogic';
import { ModalUtils } from './ModalUtils';
import { UNIT_PROPS, BUILDING_PROPS } from '@/utils/Constants';
import { BUILDING_PROPERTIES, WONDER_PROPERTIES } from '@/data/BuildingConstants';
import { isWonderObsolete, getWonder } from '@/data/WonderData';
import { SPECIALIST_YIELDS, PURCHASE_GOLD_PER_SHIELD } from '@/data/GameConstants';
import { MAX_TRADE_ROUTES } from '@/game/engine/GameEngine';
import { CITY_GOVERNOR_OPTIONS, governorOption, terrainLabel } from '@/utils/CityGovernorUtils';
import ProductionSelectionModal from './ProductionSelectionModal';
import { productionFailureText } from '@/utils/ProductionUtils';
import { formatCombatStat, unitRankBadge, unitStatus } from '@/utils/UnitStatus';
import '../../../styles/unitRank.css';
import GameEngine from '@/game/engine/GameEngine';
import { useGameStore } from '@/stores/GameStore';
import { useTranslation } from '@/i18n/useTranslation';
import { tBuildingName, tSpecialistName, tUnitName, tWonderName } from '@/i18n/dataNames';
import { GameUtils } from '@/utils/GameUtils';
import GameModal from './ModalShell';
import { UnitIcon } from '@/components/ui/UnitIcon';
import type { City, Civilization, GameActions, ProductionItem } from '../../../../types/game';
import '../../../styles/cityModal.css';
import '../../../styles/wonders.css';

interface CityModalProps {
  show: boolean;
  onHide: () => void;
  selectedCity: City;
  gameEngine: GameEngine;
  actions: GameActions;
  currentPlayer: Civilization;
  isPlayerCity: boolean;
}

/** Emoji glyph for a production item (unit icon, building icon, or a generic one). */
function productionIcon(item: ProductionItem | null | undefined): string {
  const key = item?.itemType ?? item?.type ?? '';
  if (!key) return '🏗️';
  return UNIT_PROPS[key]?.icon ?? BUILDING_PROPS[key]?.icon ?? (item?.type === 'unit' ? '⚔️' : '🏗️');
}

/** One tile of the shell's `.gm-stat-grid` — yields, ledger figures, counts. */
function statTile(
  icon: string,
  value: React.ReactNode,
  label: string,
  accent = false,
): React.ReactElement {
  return (
    <div className={`gm-stat${accent ? ' gm-stat--accent' : ''}`}>
      <div className="gm-stat-value">
        <span className="gm-stat-icon" aria-hidden="true">
          {icon}
        </span>
        {value}
      </div>
      <div className="gm-stat-label">{label}</div>
    </div>
  );
}

const CityModal: React.FC<CityModalProps> = ({
  show,
  onHide,
  selectedCity,
  gameEngine,
  actions,
  currentPlayer,
  isPlayerCity
}) => {
  const [showProductionModal, setShowProductionModal] = useState<boolean>(false);
  const [autoProduction, setAutoProduction] = useState<boolean>(selectedCity?.autoProduction || false);
  const [specialistsLocked, setSpecialistsLocked] = useState<boolean>(selectedCity?.lockSpecialists ?? false);
  const gameState = useGameStore((state) => state.gameState);
  // Subscribes the modal to language changes: unit/building/wonder/specialist
  // names below resolve through the dataNames helpers and repaint on a switch.
  const { t } = useTranslation();

  /** Localized display name of a queued production item (unit/building/wonder). */
  const productionItemName = (item: ProductionItem): string => {
    if (item.type === 'unit') return tUnitName(item.itemType, item.name);
    return getWonder(item.itemType)
      ? tWonderName(item.itemType, item.name)
      : tBuildingName(item.itemType, item.name);
  };

  // Sync local state when selectedCity changes
  useEffect(() => {
    if (!selectedCity) return;
    setAutoProduction(selectedCity?.autoProduction || false);
    setSpecialistsLocked(selectedCity?.lockSpecialists ?? false);
  }, [selectedCity]);

  // Keep the queue box scrolled to its bottom so a freshly added item is
  // always visible without manual scrolling.
  const queueBoxRef = useRef<HTMLDivElement | null>(null);
  const queueLength = selectedCity?.buildQueue?.length ?? 0;
  useEffect(() => {
    const el = queueBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [queueLength]);

  if (!selectedCity) return null;

  const logic = new CityModalLogic(selectedCity, gameEngine, actions, currentPlayer);

  /** Build a ProductionItem for a unit/building key (null when unknown). */
  const buildProductionItem = (itemType: string | null): ProductionItem | null => {
    if (!itemType) return null;
    const unitDef = UNIT_PROPS[itemType];
    if (unitDef) {
      return { type: 'unit', itemType, name: unitDef.name, cost: unitDef.cost };
    }
    const buildingDef = BUILDING_PROPS[itemType];
    if (buildingDef) {
      return { type: 'building', itemType, name: buildingDef.name, cost: buildingDef.cost };
    }
    // Wonders are produced exactly like buildings (their own data table).
    const wonderDef = getWonder(itemType);
    if (wonderDef) {
      return { type: 'building', itemType, name: wonderDef.name, cost: wonderDef.cost };
    }
    console.warn('Unknown production type:', itemType);
    return null;
  };

  /**
   * "Add" — append ONE entry for the chosen item to the bottom of the build
   * queue (the current production is left untouched). Rejections (building
   * already queued/built, missing tech, …) are reported instead of silently
   * doing nothing.
   */
  const handleQueueProduction = (itemType: string | null) => {
    const item = buildProductionItem(itemType);
    if (!item) return;
    const result = logic.setProduction(item, true);
    if (result.success === false && actions?.addNotification) {
      actions.addNotification({ type: 'warning', message: t('city.notify.cannotQueue', { item: item.name, reason: productionFailureText(result.reason) }) });
    } else if (actions?.addNotification) {
      actions.addNotification({ type: 'info', message: t('city.notify.addedToQueue', { item: item.name }) });
    }
  };

  // handleBuyNow removed (unused)

  const cityName = selectedCity.name;
  const population = selectedCity.population ?? 1;
  const ownerCiv = gameEngine?.civilizations?.find(
    (c: Civilization) => c.id === selectedCity.civilizationId,
  );
  // One-line role for the hero lede — size plus what the city means to you.
  const cityRole = !isPlayerCity
    ? t('city.hero.heldBy', { owner: ownerCiv?.name ?? t('city.hero.rivalPeople') })
    : selectedCity.isCapital
      ? t('city.hero.capital')
      : population <= 2
        ? t('city.hero.settlement')
        : population >= 8
          ? t('city.hero.metropolis')
          : t('city.hero.town');
  // Fields inside this city's radius that still need an improvement — the
  // engine's own count for this one city, so the panel shows what the player
  // can act on right now.
  const unimprovedFields = (() => {
    if (!selectedCity) return 0;
    const ai = (gameEngine as unknown as {
      aiManager?: { countOutstandingWorksForCity?: (cityId: string) => number };
    }).aiManager;
    return typeof ai?.countOutstandingWorksForCity === 'function'
      ? ai.countOutstandingWorksForCity(selectedCity.id)
      : 0;
  })();
  const eyebrow = t('city.hero.eyebrow', {
    owner: isPlayerCity ? t('city.hero.yourEmpire') : ownerCiv?.name ?? t('city.hero.foreignCity'),
    turn: gameState.currentTurn ?? 1,
    year: GameUtils.formatYear(gameState.currentYear ?? -4000),
  });
  const lede = (
    <>
      {t('city.hero.size', { size: population })} · {cityRole}.
      {isPlayerCity && (
        <span className="gm-chip gm-chip--accent city-hero-gold">
          <i className="bi bi-coin" aria-hidden="true"></i> {t('city.hero.gold', { amount: currentPlayer?.resources?.gold ?? 0 })}
        </span>
      )}
    </>
  );

  return (
    <>
      <GameModal
        show={show}
        onClose={onHide}
        tone="gold"
        size="lg"
        dialogClassName="city-details-modal production-selection-modal hex-detail-modal"
        icon="🏛️"
        artLabel={t('city.artLabel', { city: cityName })}
        eyebrow={eyebrow}
        title={cityName}
        lede={lede}
        actions={
          <>
            {isPlayerCity && (
              <button
                type="button"
                className="touch-btn touch-btn--primary production-select-btn"
                onClick={() => setShowProductionModal(true)}
              >
                <i className="bi bi-list-ul" aria-hidden="true"></i>{' '}
                {t('city.chooseProduction')}
              </button>
            )}
            <span className="gm-actions-spacer" />
            <button type="button" className="touch-btn touch-btn--ghost" onClick={onHide}>
              {t('city.close')}
            </button>
          </>
        }
      >
        <div className="city-tabstrip">
          <Tabs defaultActiveKey="overview" id="city-details-tabs" className="mb-0">
            {/* ── Overview ─────────────────────────────────────────────── */}
            <Tab eventKey="overview" title={t('city.tab.overview')}>
              <p className="gm-prose">
                {t('city.overview.lede', { city: cityName })}
              </p>

              <section className="gm-section">
                <div className="gm-section-title">{t('city.overview.yieldsTitle')}</div>
                <div className="gm-stat-grid">
                  {statTile('👥', population, t('city.stat.citizens'))}
                  {statTile('🍞', selectedCity.yields?.food ?? 0, t('city.stat.food'))}
                  {statTile('⛏️', logic.getProductionPerTurn(), t('city.stat.production'), true)}
                  {statTile('💰', selectedCity.yields?.trade ?? 0, t('city.stat.trade'))}
                  {statTile('🔬', selectedCity.science ?? 0, t('city.stat.science'))}
                  {statTile('🪙', selectedCity.gold ?? 0, t('city.stat.gold'))}
                  {logic.getRouteTrade() > 0 && statTile('🛣️', `+${logic.getRouteTrade()}`, t('city.stat.routeTrade'))}
                </div>
                {/* Fields still waiting for a road/irrigation/mine: the number
                    that decides whether this city's commerce can grow at all —
                    a raw tile pays its citizen nothing. */}
                {unimprovedFields > 0 && (
                  <div className="gm-stat-grid mt-2">
                    {statTile('🚧', `${unimprovedFields}`, t('city.stat.unimprovedFields'))}
                  </div>
                )}
                {unimprovedFields > 0 && (
                  <p className="gm-note">
                    {t('city.overview.unimprovedNote', { count: unimprovedFields, city: cityName })}
                  </p>
                )}
                <p className="gm-note">
                  {t('city.overview.note', { city: cityName })}
                </p>
              </section>

              {isPlayerCity && (
                <section className="gm-section">
                  <div className="gm-section-title">
                    {t('city.production.title')}
                    <div className="form-check form-switch mb-0 city-auto-switch">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id={`auto-production-${selectedCity.id}`}
                        checked={autoProduction}
                        onChange={(e) => {
                          const newState = e.target.checked;
                          setAutoProduction(newState);
                          if (gameEngine && typeof gameEngine.toggleAutoProduction === 'function') {
                            gameEngine.toggleAutoProduction(selectedCity.id, newState);
                          }
                        }}
                      />
                      <label className="form-check-label small text-muted" htmlFor={`auto-production-${selectedCity.id}`}>
                        {t('city.production.auto')}
                      </label>
                    </div>
                  </div>

                  <p className="gm-note">
                    {selectedCity.currentProduction ? (
                      <>
                        {t('city.production.busyPre')}{' '}
                        <strong>{logic.getCurrentProductionName()}</strong>
                        {t('city.production.busyMid')}{' '}
                        <strong>{t('city.chooseProduction')}</strong>{' '}
                        {t('city.production.busyEnd')}
                      </>
                    ) : (
                      <>
                        {t('city.production.emptyPre')}{' '}
                        <strong>{t('city.chooseProduction')}</strong>{' '}
                        {t('city.production.emptyEnd')}
                      </>
                    )}
                  </p>

                  {(() => {
                    const purchasedThisTurn = selectedCity.purchasedThisTurn || [];
                    if (purchasedThisTurn.length > 0) {
                      return (
                        <div className="alert alert-warning small mb-0 py-1 px-2">
                          <i className="bi bi-exclamation-triangle"></i> {t('city.production.purchaseUsed')}
                        </div>
                      );
                    }
                    return null;
                  })()}

                  {/* Queue box — current production is always item #0 */}
                  <div className="queue-box" ref={queueBoxRef}>
                    {/* Current production (always first) */}
                    {selectedCity.currentProduction ? (
                      <div className="queue-item queue-item--active">
                        <div className="queue-item-icon" aria-hidden="true">
                          {productionIcon(selectedCity.currentProduction)}
                        </div>
                        <div className="queue-item-body">
                          <div className="queue-item-title">
                            <strong className="text-truncate">{logic.getCurrentProductionName()}</strong>
                          </div>
                          <div className="progress queue-item-progress">
                            <div
                              className="progress-bar bg-warning"
                              style={{width: `${logic.getProgressPercent()}%`}}
                            ></div>
                          </div>
                          <div className="queue-item-meta">
                            {t('city.queue.shieldsProgress', { progress: logic.getProductionProgressValue(), total: logic.getCurrentProductionCost() })}
                            {' · '}
                            {t('city.perTurn', { amount: logic.getProductionPerTurn() })}
                            {' · '}
                            {t('city.queue.turnsLeft', { count: logic.getFormattedTurns() })}
                          </div>
                        </div>
                        <div className="queue-item-actions">
                          {(() => {
                            const totalCost = logic.getCurrentProductionCost();
                            const progress = logic.getProductionProgressValue();
                            const remaining = Math.max(0, totalCost - progress);
                            const gold = currentPlayer?.resources?.gold ?? 0;
                            const purchased = (selectedCity.purchasedThisTurn?.length ?? 0) > 0;
                            const goldCost = remaining * PURCHASE_GOLD_PER_SHIELD;
                            const canBuy = remaining > 0 && gold >= goldCost && !purchased;
                            return (
                              <button
                                type="button"
                                className="queue-action-btn queue-action-btn--rush"
                                disabled={!canBuy}
                                title={purchased ? t('city.queue.alreadyPurchased') : canBuy ? t('city.queue.rushFor', { amount: goldCost }) : t('city.queue.needGold', { amount: goldCost })}
                                onClick={() => {
                                  if (gameEngine && typeof gameEngine.rushCityProduction === 'function') {
                                    gameEngine.rushCityProduction(selectedCity.id);
                                    if (actions?.addNotification) {
                                      actions.addNotification({ type: 'success', message: t('city.notify.rushed', { item: logic.getCurrentProductionName(), amount: goldCost }) });
                                    }
                                  }
                                }}
                              >
                                {t('city.queue.goldAmount', { amount: goldCost })}
                              </button>
                            );
                          })()}
                          <button
                            type="button"
                            className="queue-action-btn"
                            title={t('city.queue.buildNextFirst')}
                            disabled={!logic.hasQueueItems()}
                            onClick={() => {
                              const result = logic.moveCurrentProductionDown();
                              if (result.success === false && actions?.addNotification) {
                                actions.addNotification({
                                  type: 'warning',
                                  message: result.reason === 'no_queued_items'
                                    ? t('city.notify.nothingQueuedBehind')
                                    : t('city.notify.cannotPostpone'),
                                });
                              }
                            }}
                          >
                            <i className="bi bi-arrow-down"></i>
                          </button>
                          <button
                            type="button"
                            className="queue-action-btn queue-action-btn--danger"
                            title={t('city.queue.cancelProduction')}
                            onClick={() => {
                              if (gameEngine && typeof gameEngine.removeCurrentProduction === 'function') {
                                gameEngine.removeCurrentProduction(selectedCity.id);
                              }
                            }}
                          >
                            <i className="bi bi-x-lg"></i>
                          </button>
                        </div>
                      </div>
                    ) : logic.hasQueueItems() ? (
                      <div className="text-muted small p-2">
                        {t('city.queue.nothingChosen')}
                      </div>
                    ) : null}

                    {/* Queued items */}
                    {logic.hasQueueItems() && logic.getQueueItems().map((q: ProductionItem, i: number) => (
                      <div key={i} className="queue-item">
                        <div className="queue-item-icon" aria-hidden="true">
                          {productionIcon(q)}
                        </div>
                        <div className="queue-item-body">
                          <div className="queue-item-title">
                            <span className="queue-item-badge">#{i + 1}</span>
                            <span className="text-truncate">{productionItemName(q)}</span>
                          </div>
                          <div className="queue-item-meta">
                            {t('city.queue.shields', { count: q.cost })}
                            {' · ~'}
                            {ModalUtils.getTurnsRemaining(0, q.cost, logic.getProductionPerTurn())} {t('city.time.turns')}
                          </div>
                        </div>
                        <div className="queue-item-actions">
                          <button type="button" className="queue-action-btn"
                            disabled={i === 0 && !selectedCity.currentProduction}
                            title={i === 0
                              ? selectedCity.currentProduction
                                ? t('city.queue.buildThisFirst')
                                : t('city.queue.nothingProduced')
                              : t('city.queue.moveUp')}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (i === 0) {
                                // Swap with the item being produced right now.
                                const result = logic.promoteQueueItem(0);
                                if (result.success === false && actions?.addNotification) {
                                  actions.addNotification({
                                    type: 'warning',
                                    message: t('city.notify.cannotChangeProduction'),
                                  });
                                }
                                return;
                              }
                              logic.moveQueueItem(i, i - 1);
                            }}>
                            <i className="bi bi-arrow-up"></i>
                          </button>
                          <button type="button" className="queue-action-btn" disabled={i === logic.getQueueItems().length - 1}
                            title={t('city.queue.moveDown')}
                            onClick={(e) => { e.stopPropagation(); logic.moveQueueItem(i, i + 1); }}>
                            <i className="bi bi-arrow-down"></i>
                          </button>
                          <button type="button" className="queue-action-btn queue-action-btn--danger"
                            title={t('city.queue.removeFromQueue')}
                            onClick={(e) => { e.stopPropagation(); logic.removeQueueItem(i); }}>
                            <i className="bi bi-trash"></i>
                          </button>
                        </div>
                      </div>
                    ))}

                    {!selectedCity.currentProduction && !logic.hasQueueItems() && (
                      <div className="city-empty">
                        <i className="bi bi-inbox" aria-hidden="true"></i>
                        <span>
                          {t('city.queue.emptyPre')}{' '}
                          <strong>{t('city.chooseProduction')}</strong>{' '}
                          {t('city.queue.emptyEnd')}
                        </span>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </Tab>

            {/* ── Resources ────────────────────────────────────────────── */}
            <Tab eventKey="resources" title={t('city.tab.resources')}>
              <p className="gm-prose">
                {t('city.resources.lede', { city: cityName })}
              </p>
              {(() => {
                const resources = logic.getCityResources();
                return (
                  <>
                    <section className="gm-section">
                      <div className="gm-section-title">{t('city.resources.ledgerTitle')}</div>
                      <div className="gm-stat-grid">
                        {statTile('🍞', resources.food.produced, t('city.stat.food'))}
                        {statTile('⛏️', resources.production.produced, t('city.stat.production'), true)}
                        {statTile('💰', resources.trade.total, t('city.stat.trade'))}
                        {statTile('🎭', resources.luxuries.amount, t('city.stat.luxuries'))}
                        {statTile('🪙', resources.taxes.amount, t('city.stat.taxes'))}
                        {statTile('🔬', resources.science.amount, t('city.stat.science'))}
                      </div>
                      <div className="gm-kv-grid">
                        <div className="gm-kv">
                          {t('city.resources.foodSurplus')}{' '}
                          <b className={resources.food.surplus >= 0 ? 'city-kv--good' : 'city-kv--bad'}>
                            {resources.food.surplus >= 0 ? `+${resources.food.surplus}` : resources.food.surplus}
                          </b>
                        </div>
                        <div className="gm-kv">
                          {t('city.resources.tradeAfterCorruption')} <b>{resources.trade.afterCorruption}</b>
                        </div>
                        {resources.trade.routeTrade > 0 && (
                          <div className="gm-kv">
                            {t('city.resources.tradeFromRoutes')} <b className="city-kv--good">+{resources.trade.routeTrade}</b>
                          </div>
                        )}
                        {resources.trade.corruption > 0 && (
                          <div className="gm-kv">
                            {t('city.resources.lostToCorruption')} <b className="city-kv--bad">−{resources.trade.corruption}</b>
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="gm-section">
                      <div className="gm-section-title">
                        {t('city.resources.foodGrowth')}
                        {resources.food.hasGranary && <span className="gm-chip">{t('city.resources.granary')}</span>}
                      </div>
                      <div className="gm-kv-grid gm-kv-grid--stack">
                        <div className="gm-kv">
                          {t('city.resources.foodNeeded')} <b>{resources.food.needed}</b>
                        </div>
                        <div className="gm-kv">
                          {t('city.resources.foodStored')} <b>{resources.food.storage} / {resources.food.growthThreshold}</b>
                          {resources.food.hasGranary && (
                            <span className="gm-kv-sub">{t('city.resources.granaryLine', { amount: resources.food.granaryLine })}</span>
                          )}
                        </div>
                        {resources.food.surplus > 0 && resources.food.turnsUntilGrowth > 0 && (
                          <div className="gm-kv">
                            {t('city.resources.growthIn')}{' '}
                            <b className="city-kv--good">
                              {resources.food.turnsUntilGrowth}{' '}
                              {resources.food.turnsUntilGrowth === 1 ? t('city.time.turn') : t('city.time.turns')}
                            </b>
                          </div>
                        )}
                        {resources.food.surplus > 0 && resources.food.turnsUntilGrowth <= 0 && (
                          <div className="gm-kv">
                            {t('city.resources.growth')} <b className="city-kv--good">{t('city.resources.growingNextTurn')}</b>
                          </div>
                        )}
                        {resources.food.surplus < 0 && (
                          <div className="gm-kv">
                            {t('city.resources.starvationIn')}{' '}
                            <b className="city-kv--bad">
                              {resources.food.turnsUntilStarvation > 0
                                ? `${resources.food.turnsUntilStarvation} ${
                                    resources.food.turnsUntilStarvation === 1 ? t('city.time.turn') : t('city.time.turns')
                                  }`
                                : t('city.resources.now')}
                            </b>
                          </div>
                        )}
                      </div>
                      <p className="gm-note">
                        {t('city.resources.growthNote', {
                          threshold: resources.food.growthThreshold,
                          city: cityName,
                        })}
                        {resources.food.hasGranary &&
                          <> {t('city.resources.granaryNote')}</>}
                      </p>
                    </section>

                    <section className="gm-section">
                      <div className="gm-section-title">{t('city.resources.splitTitle')}</div>
                      <div className="gm-kv-grid">
                        <div className="gm-kv">
                          {t('city.resources.luxuriesAt', { rate: resources.luxuries.rate })} <b>{t('city.resources.diamonds', { amount: resources.luxuries.amount })}</b>
                        </div>
                        <div className="gm-kv">
                          {t('city.resources.taxesAt', { rate: resources.taxes.rate })} <b>{t('city.resources.coins', { amount: resources.taxes.amount })}</b>
                        </div>
                        <div className="gm-kv">
                          {t('city.resources.scienceAt', { rate: resources.science.rate })} <b>{t('city.resources.bulbs', { amount: resources.science.amount })}</b>
                        </div>
                        {resources.production.surplus > 0 && (
                          <div className="gm-kv">
                            {t('city.resources.shieldsBanked')} <b className="city-kv--good">+{resources.production.surplus}</b>
                          </div>
                        )}
                      </div>
                      <p className="gm-note">
                        {t('city.resources.splitNote', { city: cityName })}
                      </p>
                      {resources.trade.corruption > 0 && (
                        <p className="gm-note">
                          {t('city.resources.corruptionNote', { city: cityName })}
                        </p>
                      )}
                    </section>
                  </>
                );
              })()}
            </Tab>

            {/* ── Buildings ────────────────────────────────────────────── */}
            <Tab eventKey="buildings" title={t('city.tab.buildings')}>
              <p className="gm-prose">
                {t('city.buildings.lede', { city: cityName })}
              </p>
              {selectedCity.buildings && selectedCity.buildings.length > 0 ? (
                (() => {
                  // Separate regular buildings from wonders
                  const regularBuildings: string[] = [];
                  const wonders: string[] = [];
                  for (const key of selectedCity.buildings) {
                    if (WONDER_PROPERTIES[key]) {
                      wonders.push(key);
                    } else {
                      regularBuildings.push(key);
                    }
                  }

                  const effectIcons: Record<string, string> = {
                    happiness: '😊', food: '🍞', production: '⛏️', trade: '💰',
                    gold: '🪙', science: '🔬', culture: '🎨', corruptionReduction: '⚖️',
                    foodStorage: '📦', growthBonus: '📈', unitProduction: '⚔️',
                    veteranUnits: '⭐', freeUnits: '🎁', extraPopulation: '👥',
                  };

                  const effectLabels: Record<string, string> = {
                    happiness: t('city.effect.happiness'), food: t('city.effect.food'), production: t('city.effect.production'),
                    trade: t('city.effect.trade'), gold: t('city.effect.gold'), science: t('city.effect.science'), culture: t('city.effect.culture'),
                    corruptionReduction: t('city.effect.corruptionReduction'), foodStorage: t('city.effect.foodStorage'),
                    growthBonus: t('city.effect.growthBonus'), unitProduction: t('city.effect.unitProduction'),
                    veteranUnits: t('city.effect.veteranUnits'), freeUnits: t('city.effect.freeUnits'),
                    extraPopulation: t('city.effect.extraPopulation'), isPalace: t('city.effect.isPalace'),
                  };

                  const renderBuildingCard = (key: string) => {
                    // Wonders live in WONDER_PROPERTIES (derived from WonderData),
                    // regular buildings in BUILDING_PROPERTIES — a wonder card
                    // used to vanish because only the latter was consulted.
                    const isWonder = !!WONDER_PROPERTIES[key];
                    const b = BUILDING_PROPERTIES[key] ?? WONDER_PROPERTIES[key];
                    if (!b) return null;
                    const effects = b.effects ?? {};
                    const effectEntries = isWonder
                      ? []
                      : Object.entries(effects).filter(([, v]) => v && v !== false && v !== 0);
                    // Obsolete wonders keep standing (and scoring) but their
                    // effect is dead — say so right on the city card.
                    const wonderObsolete = isWonder
                      && isWonderObsolete(key, (gameEngine?.civilizations ?? []) as Array<{ technologies?: string[] | Set<string> }>);

                    const canSell = !isWonder && !(selectedCity.soldBuildingThisTurn);
                    const sellRefund = Math.floor((b.cost ?? 0) / 2);
                    const sellDisabled = !canSell;
                    const sellTitle = isWonder ? t('city.buildings.cannotSellWonder')
                      : selectedCity.soldBuildingThisTurn ? t('city.buildings.alreadySold')
                      : t('city.buildings.sellFor', { amount: sellRefund });
                    return (
                      <div key={key} className="building-card">
                        <div className="building-card__header">
                          <span className="building-icon">{b.icon ?? '🏗️'}</span>
                          <div className="building-card__body">
                            <div className="d-flex justify-content-between align-items-start">
                              <h6 className="building-name mb-1">
                                {isWonder ? tWonderName(key, b.name) : tBuildingName(key, b.name)}
                              </h6>
                              <button
                                type="button"
                                className={`btn btn-sm building-sell-btn ${canSell ? 'btn-outline-danger' : 'btn-outline-secondary disabled'}`}
                                title={sellTitle}
                                disabled={sellDisabled}
                                onClick={() => {
                                  if (!canSell || !gameEngine || typeof gameEngine.sellBuilding !== 'function') return;
                                  const result = gameEngine.sellBuilding(selectedCity.id, key);
                                  if (result.success && actions?.addNotification) {
                                    actions.addNotification({
                                      type: 'success',
                                      message: t('city.notify.soldBuilding', { name: b.name, amount: result.refund }),
                                    });
                                  } else if (result.reason && actions?.addNotification) {
                                    actions.addNotification({
                                      type: 'warning',
                                      message: result.reason,
                                    });
                                  }
                                }}
                              >
                                <i className="bi bi-trash"></i> {isWonder ? '—' : t('city.buildings.sellShort', { amount: sellRefund })}
                              </button>
                            </div>
                            <div className="building-meta small">
                              <span className="building-meta__item">
                                <i className="bi bi-bricks"></i> {b.cost}
                              </span>
                              {wonderObsolete && (
                                <span className="wonder-obsolete-tag" title={t('city.buildings.obsoleteTitle')}>
                                  {t('city.buildings.obsolete')}
                                </span>
                              )}
                              {b.maintenance > 0 && (
                                <span className="building-meta__item">
                                  <i className="bi bi-coin"></i> {t('city.perTurn', { amount: b.maintenance })}
                                </span>
                              )}
                              {b.requiredTechnology && (
                                <span className="building-meta__item building-meta__tech">
                                  🔬 {b.requiredTechnology.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                                </span>
                              )}
                            </div>
                            {b.description && (
                              <div className="building-description small mt-2">{b.description}</div>
                            )}
                            {effectEntries.length > 0 && (
                              <div className="building-effects mt-2">
                                {effectEntries.map(([effect, value]) => (
                                  <span key={effect} className="building-effect-badge">
                                    {effectIcons[effect] ?? '✨'}{' '}
                                    {effectLabels[effect] ?? effect.replace(/([A-Z])/g, ' $1').replace(/^./, (s: string) => s.toUpperCase())}
                                    {typeof value === 'boolean' ? '' : ` ${value}`}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  };

                  return (
                    <>
                      {regularBuildings.length > 0 && (
                        <section className="gm-section">
                          <div className="gm-section-title">
                            {t('city.buildings.sectionTitle')} <span className="city-section-count">({regularBuildings.length})</span>
                          </div>
                          <div className="buildings-grid">
                            {regularBuildings.map(renderBuildingCard)}
                          </div>
                        </section>
                      )}
                      {wonders.length > 0 && (
                        <section className="gm-section">
                          <div className="gm-section-title">
                            {t('city.buildings.wondersTitle')} <span className="city-section-count">({wonders.length})</span>
                          </div>
                          <div className="buildings-grid">
                            {wonders.map(renderBuildingCard)}
                          </div>
                        </section>
                      )}
                      {regularBuildings.includes('harbor') && isPlayerCity && (() => {
                        const fisher = logic.getFisherBoatStatus();
                        const stageLabel = fisher.stage === 'fishing'
                          ? t('city.fisher.fishing')
                          : fisher.stage === 'inbound'
                            ? t('city.fisher.inbound')
                            : fisher.stage === 'outbound'
                              ? t('city.fisher.outbound')
                              : null;
                        return (
                          <section className="gm-section">
                            <div className="gm-section-title">{t('city.fisher.title')}</div>
                            <div className="building-card">
                              <div className="building-card__header">
                                <span className="building-icon">🎣</span>
                                <div className="building-card__body">
                                  <h6 className="building-name mb-1">
                                    {t('city.fisher.title')} <span className="small text-muted">{t('city.fisher.maxOne')}</span>
                                  </h6>
                                  {fisher.exists ? (
                                    <div className="small">
                                      <div>
                                        {stageLabel}
                                        {(fisher.stage === 'fishing' || fisher.stage === 'inbound') && (
                                          <> {t('city.fisher.hold', { stored: fisher.fishStored, capacity: fisher.capacity })}</>
                                        )}
                                        {fisher.tile && <> {t('city.fisher.at', { col: fisher.tile.col, row: fisher.tile.row })}</>}
                                      </div>
                                      <div className="text-muted">
                                        {t('city.fisher.stats', { distance: fisher.distance, perFish: fisher.foodPerFish, catchValue: fisher.catchValue })}
                                      </div>
                                    </div>
                                  ) : fisher.underConstruction ? (
                                    <div className="small text-muted">{t('city.fisher.underConstruction')}</div>
                                  ) : (
                                    <div className="small text-muted">
                                      {t('city.fisher.notBuilt')}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </section>
                        );
                      })()}
                    </>
                  );
                })()
              ) : (
                <section className="gm-section">
                  <div className="city-empty">
                    <i className="bi bi-building" aria-hidden="true"></i>
                    <span>
                      {t('city.buildings.emptyPre')}{' '}
                      <strong>{t('city.chooseProduction')}</strong>{' '}
                      {t('city.buildings.emptyEnd')}
                    </span>
                  </div>
                </section>
              )}
            </Tab>

            {/* ── Citizens ─────────────────────────────────────────────── */}
            <Tab eventKey="citizens" title={t('city.tab.citizens')}>
              {(() => {
                const pop = selectedCity.population ?? 1;
                const specs = selectedCity.specialists ?? [];
                const workedTiles = selectedCity.workingTiles ?? new Set<string>();
                const manualTiles = selectedCity.userAssignedTiles ?? new Set<string>();
                const tileWorkers = workedTiles.size;
                const freeCitizens = Math.max(0, pop - (tileWorkers - 1) - specs.length);

                return (
                  <>
                    <p className="gm-prose">
                      {t('city.citizens.lede', { city: cityName })}
                    </p>

                    {/* Governor switcher */}
                    {isPlayerCity && (
                      <section className="gm-section">
                        <div className="gm-section-title">{t('city.governor.title')}</div>
                        <div className="city-governor-grid">
                          {CITY_GOVERNOR_OPTIONS.map((option) => {
                            const active = (selectedCity.governor ?? 'balanced') === option.mode;
                            return (
                              <button
                                key={option.mode}
                                type="button"
                                className={`city-governor-card${active ? ' active' : ''}`}
                                aria-pressed={active}
                                onClick={() => {
                                  if (typeof gameEngine.setCityGovernor === 'function') {
                                    gameEngine.setCityGovernor(selectedCity.id, option.mode);
                                  }
                                  actions?.addNotification?.({
                                    type: 'info',
                                    message: t('city.notify.governorSelected', { city: selectedCity.name, governor: option.name }),
                                  });
                                }}
                              >
                                <span className="city-governor-card-icon">{option.icon}</span>
                                <span className="city-governor-card-name">{option.name}</span>
                              </button>
                            );
                          })}
                        </div>
                        <p className="gm-note">{governorOption(selectedCity.governor).description}</p>
                        {selectedCity.governorDirty && (
                          <div className="gm-callout">
                            <span className="gm-callout-title">{t('city.governor.pendingTitle')}</span>
                            {t('city.governor.pendingBody')}
                          </div>
                        )}
                        <p className="gm-note">
                          {t('city.governor.manualPre')}{' '}
                          <span className="city-tile-manual-badge-inline">{t('city.tiles.manual')}</span>{' '}
                          {t('city.governor.manualPost')}
                        </p>
                      </section>
                    )}

                    {/* Lock Specialists toggle */}
                    {isPlayerCity && (
                      <section className="gm-section">
                        <div className="gm-section-title">{t('city.specialists.lockTitle')}</div>
                        <button
                          type="button"
                          className={`city-specialist-lock-btn${specialistsLocked ? ' locked' : ''}`}
                          onClick={() => {
                            const newLock = !specialistsLocked;
                            gameEngine.setCityLockSpecialists(selectedCity.id, newLock);
                            setSpecialistsLocked(newLock);
                            actions?.addNotification?.({
                              type: 'info',
                              message: newLock
                                ? t('city.notify.specialistsLocked', { city: selectedCity.name })
                                : t('city.notify.specialistsUnlocked', { city: selectedCity.name }),
                            });
                          }}
                        >
                          <i className={`bi ${specialistsLocked ? 'bi-lock-fill' : 'bi-unlock-fill'} me-1`}></i>
                          {specialistsLocked ? t('city.specialists.locked') : t('city.specialists.lock')}
                        </button>
                        <p className="gm-note">
                          {t('city.specialists.lockNote')}
                        </p>
                      </section>
                    )}

                    {/* Specialists — interactive management */}
                    {isPlayerCity && (
                      <section className="gm-section">
                        <div className="gm-section-title">
                          {t('city.specialists.sectionTitle')}{' '}
                          <span className="city-section-count">
                            {t('city.specialists.count', { count: specs.length, total: pop })}
                          </span>
                          {specs.length > 0 && (
                            <button
                              type="button"
                              className="city-specialist-demote-all-btn city-section-action"
                              onClick={() => {
                                let demoted = 0;
                                for (let i = specs.length - 1; i >= 0; i--) {
                                  if (gameEngine.demoteSpecialistToWorker(selectedCity.id, i)) {
                                    demoted++;
                                  }
                                }
                                if (demoted > 0) {
                                  actions?.addNotification?.({
                                    type: 'info',
                                    message: demoted > 1
                                      ? t('city.notify.specialistsDemotedMany', { city: selectedCity.name, count: demoted })
                                      : t('city.notify.specialistsDemotedOne', { city: selectedCity.name, count: demoted }),
                                  });
                                }
                              }}
                            >
                              {t('city.specialists.demoteAll')}
                            </button>
                          )}
                        </div>
                        <div className="city-specialist-list">
                          {(Object.keys(SPECIALIST_YIELDS) as Array<keyof typeof SPECIALIST_YIELDS>).map((type) => {
                            const def = SPECIALIST_YIELDS[type];
                            const count = specs.filter((s) => s === type).length;
                            const canAdd = freeCitizens > 0 || tileWorkers > 0;
                            const canRemove = count > 0;
                            return (
                              <div key={type} className="city-specialist-row">
                                <span className="city-specialist-icon">{def.icon}</span>
                                <span className="city-specialist-name">{tSpecialistName(type, def.name)}</span>
                                <span className="city-specialist-yield text-muted">
                                  {def.luxury ? t('city.specialists.lux', { amount: def.luxury }) : ''}
                                  {def.gold ? t('city.specialists.gold', { amount: def.gold }) : ''}
                                  {def.science ? t('city.specialists.sci', { amount: def.science }) : ''}
                                </span>
                                <span className="city-specialist-count">{count}</span>
                                <button
                                  type="button"
                                  className="city-specialist-btn city-specialist-btn-add"
                                  disabled={!canAdd}
                                  title={canAdd ? t('city.specialists.promoteTitle', { name: def.name }) : t('city.specialists.noCitizens')}
                                  onClick={() => {
                                    if (gameEngine.promoteCitizenToSpecialist(selectedCity.id, type)) {
                                      actions?.addNotification?.({
                                        type: 'info',
                                        message: t('city.notify.specialistPromoted', { city: selectedCity.name, name: def.name }),
                                      });
                                    } else {
                                      actions?.addNotification?.({
                                        type: 'warning',
                                        message: t('city.notify.noCitizenFree', { name: def.name, city: selectedCity.name }),
                                      });
                                    }
                                  }}
                                >
                                  +
                                </button>
                                <button
                                  type="button"
                                  className="city-specialist-btn city-specialist-btn-remove"
                                  disabled={!canRemove}
                                  title={canRemove ? t('city.specialists.demoteTitle', { name: def.name }) : t('city.specialists.noneAssigned')}
                                  onClick={() => {
                                    const idx = specs.lastIndexOf(type);
                                    if (idx >= 0 && gameEngine.demoteSpecialistToWorker(selectedCity.id, idx)) {
                                      actions?.addNotification?.({
                                        type: 'info',
                                        message: t('city.notify.specialistDemoted', { city: selectedCity.name, name: def.name }),
                                      });
                                    }
                                  }}
                                >
                                  −
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <p className="gm-note">
                          {t('city.specialists.notePre')}{' '}
                          <strong>+</strong> {t('city.specialists.noteMid')}{' '}
                          <strong>−</strong> {t('city.specialists.notePost')}
                        </p>
                      </section>
                    )}

                    {/* Worked tiles — interactive: - to unassign citizen */}
                    <section className="gm-section">
                      <div className="gm-section-title">
                        {t('city.tiles.workedTitle')}{' '}
                        <span className="city-section-count">
                          {t('city.tiles.workedCount', { count: tileWorkers })}
                        </span>
                      </div>
                      {tileWorkers > 0 ? (
                        <>
                          <div className="city-worked-tile-list">
                            {Array.from(workedTiles)
                              .map((key) => {
                                const sep = key.indexOf(',');
                                const col = Number(key.slice(0, sep));
                                const row = Number(key.slice(sep + 1));
                                return { key, col, row };
                              })
                              .sort((a, b) => (a.row - b.row) || (a.col - b.col))
                              .map(({ key, col, row }) => {
                                const isCenter = col === selectedCity.col && row === selectedCity.row;
                                const manual = !isCenter && manualTiles.has(key);
                                const tile = gameEngine.getTileAt?.(col, row);
                                const yields = tile && gameEngine.economicManager
                                  ? gameEngine.economicManager.cityTileYields(tile)
                                  : null;
                                const resource = tile?.resource ? String(tile.resource) : '';
                                return (
                                  <div
                                    key={key}
                                    className={`city-worked-tile-row${manual ? ' manual' : ''}`}
                                  >
                                    <span className="city-worked-tile-terrain">
                                      {isCenter ? '🏛️' : terrainLabel(tile?.terrain)}
                                    </span>
                                    <span className="city-worked-tile-coords text-muted">
                                      ({col},{row})
                                    </span>
                                    {resource && (
                                      <span className="badge text-bg-dark border border-secondary">
                                        {resource}
                                      </span>
                                    )}
                                    {yields && (
                                      <span className="city-worked-tile-yields">
                                        {yields.food > 0 && <span title={t('city.stat.food')}>🍞{yields.food}</span>}
                                        {yields.production > 0 && <span title={t('city.stat.production')}>⛏️{yields.production}</span>}
                                        {yields.trade > 0 && <span title={t('city.stat.trade')}>💰{yields.trade}</span>}
                                      </span>
                                    )}
                                    {manual ? (
                                      <span className="city-tile-manual-badge" title={t('city.tiles.manualTitle')}>
                                        {t('city.tiles.manual')}
                                      </span>
                                    ) : (
                                      <span className="city-tile-auto-badge">{t('city.tiles.auto')}</span>
                                    )}
                                    {!isCenter && (
                                      <button
                                        type="button"
                                        className="city-tile-unassign-btn"
                                        title={t('city.tiles.removeCitizen')}
                                        onClick={() => {
                                          if (gameEngine.unassignCitizenFromTile(selectedCity.id, col, row)) {
                                            actions?.addNotification?.({
                                              type: 'info',
                                              message: t('city.notify.citizenRemoved', { city: selectedCity.name, col, row }),
                                            });
                                          } else {
                                            actions?.addNotification?.({
                                              type: 'warning',
                                              message: t('city.notify.citizenRemoveFailed', { city: selectedCity.name, col, row }),
                                            });
                                          }
                                        }}
                                      >
                                        −
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                          <p className="gm-note">
                            {t('city.tiles.workedNote', { city: cityName })}
                          </p>
                        </>
                      ) : (
                        <p className="gm-prose">
                          {t('city.tiles.noWorkers')}
                        </p>
                      )}
                    </section>

                    {/* Unworked tiles — + to assign citizen */}
                    <section className="gm-section">
                      <div className="gm-section-title">
                        {t('city.tiles.availableTitle')}{' '}
                        <span className="city-section-count">
                          {freeCitizens === 1
                            ? t('city.tiles.availableCountOne', { count: freeCitizens })
                            : t('city.tiles.availableCountMany', { count: freeCitizens })}
                        </span>
                      </div>
                      {freeCitizens > 0 ? (
                        <>
                          <div className="city-worked-tile-list">
                            {gameEngine
                              .getWorkableTiles(selectedCity.id)
                              .map(({ col, row, key }) => {
                                const tile = gameEngine.getTileAt?.(col, row);
                                if (!tile) return null;
                                const yields = tile && gameEngine.economicManager
                                  ? gameEngine.economicManager.cityTileYields(tile)
                                  : null;
                                const total = yields
                                  ? yields.food + yields.production + yields.trade
                                  : 0;
                                const resource = tile?.resource ? String(tile.resource) : '';
                                return (
                                  <div key={key} className="city-worked-tile-row city-tile-available">
                                    <span className="city-worked-tile-terrain">
                                      {terrainLabel(tile?.terrain)}
                                    </span>
                                    <span className="city-worked-tile-coords text-muted">
                                      ({col},{row})
                                    </span>
                                    {resource && (
                                      <span className="badge text-bg-dark border border-secondary">
                                        {resource}
                                      </span>
                                    )}
                                    {yields && (
                                      <span className="city-worked-tile-yields">
                                        {yields.food > 0 && <span title={t('city.stat.food')}>🍞{yields.food}</span>}
                                        {yields.production > 0 && <span title={t('city.stat.production')}>⛏️{yields.production}</span>}
                                        {yields.trade > 0 && <span title={t('city.stat.trade')}>💰{yields.trade}</span>}
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      className="city-tile-assign-btn"
                                      title={t('city.tiles.assignTitle', { total })}
                                      onClick={() => {
                                        if (gameEngine.assignCitizenToTile(selectedCity.id, col, row)) {
                                          actions?.addNotification?.({
                                            type: 'info',
                                            message: t('city.notify.citizenAssigned', { city: selectedCity.name, col, row }),
                                          });
                                        } else {
                                          actions?.addNotification?.({
                                            type: 'warning',
                                            message: t('city.notify.tileCannotBeWorked', { city: selectedCity.name, col, row }),
                                          });
                                        }
                                      }}
                                    >
                                      +
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                          <p className="gm-note">
                            {t('city.tiles.availableNotePre', { city: cityName })}{' '}
                            <strong>+</strong> {t('city.tiles.availableNotePost')}
                          </p>
                        </>
                      ) : (
                        <p className="gm-prose">
                          {t('city.tiles.allBusy', { city: cityName })}
                        </p>
                      )}
                    </section>

                    {/* How citizens are actually set — the map is the only place */}
                    <div className="gm-callout">
                      <span className="gm-callout-title">{t('city.mapAction.title')}</span>
                      <ol className="gm-list">
                        <li>{t('city.mapAction.step1')}</li>
                        <li>
                          {t('city.mapAction.step2Pre')} <strong>{t('city.mapAction.workedTile')}</strong> {t('city.mapAction.step2Post')}
                        </li>
                        <li>
                          {t('city.mapAction.step3Pre')} <strong>{t('city.mapAction.idleTile')}</strong> {t('city.mapAction.step3Mid')}{' '}
                          <span className="city-tile-manual-badge-inline">{t('city.tiles.manual')}</span>{t('city.mapAction.step3Post')}
                        </li>
                      </ol>
                      <p className="gm-note">
                        <strong>Esc</strong> {t('city.mapAction.escNotePre')}{' '}
                        <span className="city-tile-manual-badge-inline">{t('city.tiles.manual')}</span> {t('city.mapAction.escNotePost')}
                        {freeCitizens > 0 && (
                          <span className="text-warning">
                            {' '}
                            {freeCitizens === 1
                              ? t('city.mapAction.stillNeedTileOne', { count: freeCitizens })
                              : t('city.mapAction.stillNeedTileMany', { count: freeCitizens })}
                          </span>
                        )}
                      </p>
                    </div>
                  </>
                );
              })()}
            </Tab>

            {/* ── Units ────────────────────────────────────────────────── */}
            <Tab eventKey="units" title={t('city.tab.units', { count: logic.getCityUnits().length })}>
              {(() => {
                const cityUnits = logic.getCityUnits();
                return (
                  <>
                    <p className="gm-prose">
                      {t('city.units.lede', { city: cityName })}
                    </p>
                    <section className="gm-section">
                      <div className="gm-section-title">
                        {t('city.units.inCity')} <span className="city-section-count">({cityUnits.length})</span>
                      </div>
                      {cityUnits.length === 0 ? (
                        <div className="city-empty">
                          <i className="bi bi-people" aria-hidden="true"></i>
                          <span>
                            {t('city.units.empty', { city: cityName })}
                          </span>
                        </div>
                      ) : (
                        <div className="d-flex flex-column gap-2">
                        {cityUnits.map((unit) => {
                          const props = UNIT_PROPS[unit.type];
                          const status = unitStatus(unit);
                          const rankBadge = unitRankBadge(unit);
                          const health = Math.max(0, Math.min(100, unit.health ?? 100));
                          const hpText =
                            typeof unit.hitPoints === 'number' && typeof unit.maxHitPoints === 'number'
                              ? t('city.units.hp', { current: unit.hitPoints, max: unit.maxHitPoints })
                              : t('city.units.hpPercent', { value: Math.round(health) });
                          const isGarrison =
                            unit.col === selectedCity.col && unit.row === selectedCity.row;
                          // Effective stats include the rank multiplier — the
                          // same numbers CombatSystem rolls with.
                          const rankMult = rankBadge?.multiplier ?? 1;
                          const effAttack = formatCombatStat((unit.attack ?? props?.attack ?? 0) * rankMult);
                          const effDefense = formatCombatStat((unit.defense ?? props?.defense ?? 0) * rankMult);
                            return (
                              <div
                                key={unit.id}
                                className="p-2 rounded bg-dark border border-secondary d-flex align-items-center gap-3"
                              >
                                <span style={{ display: 'inline-flex', width: 28, justifyContent: 'center' }}>
                                  <UnitIcon
                                    unitType={unit.type}
                                    emoji={unit.icon || props?.icon}
                                    size={24}
                                  />
                                </span>
                                <div className="flex-grow-1 min-width-0">
                                  <div className="d-flex align-items-center gap-2 flex-wrap">
                                  <strong>{props?.name ?? unit.type}</strong>
                                  {isGarrison && <Badge bg="success">{t('city.units.garrison')}</Badge>}
                                  {rankBadge && (
                                    <span className={rankBadge.className} title={rankBadge.title}>
                                      {rankBadge.label}
                                    </span>
                                  )}
                                  <Badge bg={status.variant}>{status.label}</Badge>
                                    {unit.embarkedOn && (
                                      <Badge bg="info" text="dark">{t('city.units.aboardFerry')}</Badge>
                                    )}
                                  </div>
                                  <div className="d-flex align-items-center gap-2 mt-1 flex-wrap">
                                    <ProgressBar
                                      now={health}
                                      variant={health > 60 ? 'success' : health > 30 ? 'warning' : 'danger'}
                                      style={{ height: 6, flex: 1, maxWidth: 220 }}
                                    />
                                  <span className="small text-muted">{hpText}</span>
                                  <span
                                    className="small text-muted"
                                    title={
                                      rankBadge
                                        ? t('city.units.rankTitle', {
                                            attack: unit.attack ?? props?.attack ?? 0,
                                            defense: unit.defense ?? props?.defense ?? 0,
                                            multiplier: rankBadge.multiplier,
                                          })
                                        : undefined
                                    }
                                  >
                                    {t('city.units.attackDefense', { attack: effAttack, defense: effDefense })}
                                  </span>
                                    <span className="small text-muted">({unit.col},{unit.row})</span>
                                  </div>
                                </div>
                                {isPlayerCity && (
                                  <Button
                                    size="sm"
                                    variant="outline-light"
                                    title={t('city.units.selectTitle')}
                                    onClick={() => {
                                      actions.selectUnit?.(unit.id, 'user');
                                      actions.focusCameraOnTile?.(unit.col, unit.row, true, true);
                                    }}
                                  >
                                    <i className="bi bi-crosshair"></i> {t('city.units.select')}
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {isPlayerCity && cityUnits.length > 0 && (
                        <p className="gm-note">
                          {t('city.units.tip')}
                        </p>
                      )}
                    </section>
                  </>
                );
              })()}
            </Tab>

            {/* ── Trade Routes ─────────────────────────────────────────── */}
            <Tab eventKey="trade" title={t('city.tab.trade')}>
              {(() => {
                const routes = logic.getTradeRoutes();
                const routeTrade = logic.getRouteTrade();
                // The OLDEST route is what a new delivery evicts (Civ1's rule,
                // `GameEngine.addTradeRoute`), so the panel marks it: a player
                // about to send a caravan should see which slot it will cost.
                const roundNow = gameEngine.roundManager?.getRoundNumber?.() ?? 0;
                const routeAge = (route: { round?: number }): number =>
                  Math.max(0, roundNow - (route.round ?? roundNow));
                let oldestIdx = -1;
                for (let i = 0; i < routes.length; i++) {
                  if (oldestIdx === -1
                    || (routes[i].round ?? 0) < (routes[oldestIdx].round ?? 0)) oldestIdx = i;
                }
                const oldestRouteKey = oldestIdx === -1 ? null : String(oldestIdx);
                return (
                  <>
                    <p className="gm-prose">
                      {t('city.trade.lede', { city: cityName })}
                    </p>
                    <section className="gm-section">
                      <div className="gm-section-title">{t('city.trade.routesInUse')}</div>
                      <div className="gm-kv-grid gm-kv-grid--stack">
                        <div className="gm-kv">
                          {t('city.trade.routesLabel')} <b>{routes.length}/{MAX_TRADE_ROUTES}</b>
                        </div>
                        <div className="gm-kv">
                          {t('city.resources.tradeFromRoutes')}{' '}
                          <b className={routeTrade > 0 ? 'city-kv--good' : ''}>{t('city.trade.perTurn', { amount: routeTrade })}</b>
                        </div>
                      </div>
                      <p className="gm-note">
                        {t('city.trade.note')}
                      </p>
                      {routes.length > 0 ? (
                        <div className="d-flex flex-column gap-2">
                          {routes.map((route, i) => {
                            const routeKey = String(i);
                            const destCiv = gameEngine.civilizations?.find(
                              (c: Civilization) => c.id === route.civilizationId,
                            );
                            const isForeign = route.civilizationId !== selectedCity.civilizationId;
                            return (
                              <div key={i} className="p-2 rounded bg-dark border border-secondary d-flex justify-content-between align-items-center">
                                <div>
                                  <div>
                                    <strong>{route.cityName}</strong>
                                    {isForeign && <span className="text-warning ms-2 small">{t('city.trade.foreign')}</span>}
                                  </div>
                                  <div className="small text-muted">
                                    {destCiv?.name ?? t('city.trade.civFallback', { id: route.civilizationId })} · {t('city.trade.tilesAway', { count: route.distance })}
                                    {oldestRouteKey !== null && (
                                      <>
                                        {' · '}
                                        {routeKey === oldestRouteKey
                                          ? <span className="text-warning">{t('city.trade.oldestEvicted')}</span>
                                          : t('city.trade.routeAge', { round: routeAge(route) })}
                                      </>
                                    )}
                                  </div>
                                </div>
                                <div className="text-info fw-semibold">{t('city.trade.perTurn', { amount: route.trade })}</div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="city-empty">
                          <i className="bi bi-signpost-split" aria-hidden="true"></i>
                          <span>
                            {t('city.trade.empty', { city: cityName })}
                          </span>
                        </div>
                      )}
                    </section>
                  </>
                );
              })()}
            </Tab>
          </Tabs>
        </div>
      </GameModal>

      <ProductionSelectionModal
        show={showProductionModal}
        onHide={() => setShowProductionModal(false)}
        currentPlayer={currentPlayer}
        playerGold={currentPlayer?.resources?.gold ?? 0}
        purchasedThisTurn={(selectedCity?.purchasedThisTurn?.length ?? 0) > 0}
        cityBuildings={selectedCity?.buildings ?? []}
        productionPerTurn={logic.getProductionPerTurn()}
        cityName={cityName}
        cityId={selectedCity.id}
        onAddToQueue={(key) => {
          handleQueueProduction(key);
        }}
        onPurchase={(_key, item) => {
          if (gameEngine && typeof gameEngine.purchaseCityProduction === 'function') {
            gameEngine.purchaseCityProduction(selectedCity.id, item);
            if (actions?.addNotification) {
              actions.addNotification({
                type: 'success',
                message: t('city.notify.purchased', { name: item.name, amount: item.cost })
              });
            }
          }
          setShowProductionModal(false);
        }}
      />
    </>
  );
};

export default CityModal;
