import React, { useState, useEffect, useRef } from 'react';
import { Button, Badge, ProgressBar, Tab, Tabs } from 'react-bootstrap';
import { CityModalLogic } from './CityModalLogic';
import { ModalUtils } from './ModalUtils';
import { UNIT_PROPS, BUILDING_PROPS } from '@/utils/Constants';
import { BUILDING_PROPERTIES, WONDER_PROPERTIES } from '@/data/BuildingConstants';
import { isWonderObsolete, getWonder } from '@/data/WonderData';
import { SPECIALIST_YIELDS } from '@/data/GameConstants';
import { CITY_GOVERNOR_OPTIONS, governorOption, terrainLabel } from '@/utils/CityGovernorUtils';
import ProductionSelectionModal from './ProductionSelectionModal';
import { productionFailureText } from '@/utils/ProductionUtils';
import { formatCombatStat, unitRankBadge, unitStatus } from '@/utils/UnitStatus';
import '../../../styles/unitRank.css';
import GameEngine from '@/game/engine/GameEngine';
import { useGameStore } from '@/stores/GameStore';
import { GameUtils } from '@/utils/GameUtils';
import GameModal from './ModalShell';
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
      actions.addNotification({ type: 'warning', message: `Cannot queue ${item.name}: ${productionFailureText(result.reason)}` });
    } else if (actions?.addNotification) {
      actions.addNotification({ type: 'info', message: `Added to queue: ${item.name}` });
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
    ? `Held by ${ownerCiv?.name ?? 'a rival people'}`
    : selectedCity.isCapital
      ? 'Your capital — the seat of your rule'
      : population <= 2
        ? 'A young settlement, barely more than huts and hope'
        : population >= 8
          ? 'A teeming city, the pride of your people'
          : 'A working town of your empire';
  const eyebrow = `${isPlayerCity ? 'Your Empire' : ownerCiv?.name ?? 'Foreign city'} · Turn ${
    gameState.currentTurn ?? 1
  } · ${GameUtils.formatYear(gameState.currentYear ?? -4000)}`;
  const lede = (
    <>
      Size {population} · {cityRole}.
      {isPlayerCity && (
        <span className="gm-chip gm-chip--accent city-hero-gold">
          <i className="bi bi-coin" aria-hidden="true"></i> {currentPlayer?.resources?.gold ?? 0} Gold
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
        artLabel={`${cityName} from the walls`}
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
                <i className="bi bi-list-ul" aria-hidden="true"></i>
                Choose Production…
              </button>
            )}
            <span className="gm-actions-spacer" />
            <button type="button" className="touch-btn touch-btn--ghost" onClick={onHide}>
              Close
            </button>
          </>
        }
      >
        <div className="city-tabstrip">
          <Tabs defaultActiveKey="overview" id="city-details-tabs" className="mb-0">
            {/* ── Overview ─────────────────────────────────────────────── */}
            <Tab eventKey="overview" title="Overview">
              <p className="gm-prose">
                What {cityName} eats, forges and earns this turn — and the work your people
                already have in hand.
              </p>

              <section className="gm-section">
                <div className="gm-section-title">Yields this turn</div>
                <div className="gm-stat-grid">
                  {statTile('👥', population, 'Citizens')}
                  {statTile('🍞', selectedCity.yields?.food ?? 0, 'Food')}
                  {statTile('⛏️', logic.getProductionPerTurn(), 'Production', true)}
                  {statTile('💰', selectedCity.yields?.trade ?? 0, 'Trade')}
                  {statTile('🔬', selectedCity.science ?? 0, 'Science')}
                  {statTile('🪙', selectedCity.gold ?? 0, 'Gold')}
                  {logic.getRouteTrade() > 0 && statTile('🛣️', `+${logic.getRouteTrade()}`, 'Route trade')}
                </div>
                <p className="gm-note">
                  Every figure is what {cityName}'s people hand you when the turn closes — the
                  shields go into whatever stands on the drawing board below.
                </p>
              </section>

              {isPlayerCity && (
                <section className="gm-section">
                  <div className="gm-section-title">
                    Production
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
                        Auto
                      </label>
                    </div>
                  </div>

                  <p className="gm-note">
                    {selectedCity.currentProduction ? (
                      <>
                        Your workshops are busy with <strong>{logic.getCurrentProductionName()}</strong>.
                        Press <strong>Choose Production…</strong> below to lay the next order
                        behind it.
                      </>
                    ) : (
                      <>
                        Nothing stands on the drawing board. Press <strong>Choose Production…</strong>{' '}
                        below and set your people to work.
                      </>
                    )}
                  </p>

                  {(() => {
                    const purchasedThisTurn = selectedCity.purchasedThisTurn || [];
                    if (purchasedThisTurn.length > 0) {
                      return (
                        <div className="alert alert-warning small mb-0 py-1 px-2">
                          <i className="bi bi-exclamation-triangle"></i> Purchase used this turn.
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
                            {logic.getProductionProgressValue()}/{logic.getCurrentProductionCost()} shields
                            {' · '}
                            {logic.getProductionPerTurn()}/turn
                            {' · '}
                            {logic.getFormattedTurns()} turns left
                          </div>
                        </div>
                        <div className="queue-item-actions">
                          {(() => {
                            const totalCost = logic.getCurrentProductionCost();
                            const progress = logic.getProductionProgressValue();
                            const remaining = Math.max(0, totalCost - progress);
                            const gold = currentPlayer?.resources?.gold ?? 0;
                            const purchased = (selectedCity.purchasedThisTurn?.length ?? 0) > 0;
                            const goldCost = remaining * 2;
                            const canBuy = remaining > 0 && gold >= goldCost && !purchased;
                            return (
                              <button
                                type="button"
                                className="queue-action-btn queue-action-btn--rush"
                                disabled={!canBuy}
                                title={purchased ? 'Already purchased' : canBuy ? `Rush for ${goldCost}g` : `Need ${goldCost}g`}
                                onClick={() => {
                                  if (gameEngine && typeof gameEngine.rushCityProduction === 'function') {
                                    gameEngine.rushCityProduction(selectedCity.id);
                                    if (actions?.addNotification) {
                                      actions.addNotification({ type: 'success', message: `Rushed ${logic.getCurrentProductionName()} for ${goldCost}g!` });
                                    }
                                  }
                                }}
                              >
                                🪙 {goldCost}g
                              </button>
                            );
                          })()}
                          <button
                            type="button"
                            className="queue-action-btn"
                            title="Build the next queued item first"
                            disabled={!logic.hasQueueItems()}
                            onClick={() => {
                              const result = logic.moveCurrentProductionDown();
                              if (result.success === false && actions?.addNotification) {
                                actions.addNotification({
                                  type: 'warning',
                                  message: result.reason === 'no_queued_items'
                                    ? 'Nothing is queued behind this item.'
                                    : 'Cannot postpone production.',
                                });
                              }
                            }}
                          >
                            <i className="bi bi-arrow-down"></i>
                          </button>
                          <button
                            type="button"
                            className="queue-action-btn queue-action-btn--danger"
                            title="Cancel production"
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
                        Nothing chosen yet — the first item in the queue steps forward the moment
                        you set one.
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
                            <span className="text-truncate">{q.name}</span>
                          </div>
                          <div className="queue-item-meta">
                            {q.cost} shields
                            {' · ~'}
                            {ModalUtils.getTurnsRemaining(0, q.cost, logic.getProductionPerTurn())} turns
                          </div>
                        </div>
                        <div className="queue-item-actions">
                          <button type="button" className="queue-action-btn"
                            disabled={i === 0 && !selectedCity.currentProduction}
                            title={i === 0
                              ? selectedCity.currentProduction
                                ? 'Build this first — the current production moves one down'
                                : 'Nothing is being produced yet'
                              : 'Move up'}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (i === 0) {
                                // Swap with the item being produced right now.
                                const result = logic.promoteQueueItem(0);
                                if (result.success === false && actions?.addNotification) {
                                  actions.addNotification({
                                    type: 'warning',
                                    message: 'Cannot change production right now.',
                                  });
                                }
                                return;
                              }
                              logic.moveQueueItem(i, i - 1);
                            }}>
                            <i className="bi bi-arrow-up"></i>
                          </button>
                          <button type="button" className="queue-action-btn" disabled={i === logic.getQueueItems().length - 1}
                            title="Move down"
                            onClick={(e) => { e.stopPropagation(); logic.moveQueueItem(i, i + 1); }}>
                            <i className="bi bi-arrow-down"></i>
                          </button>
                          <button type="button" className="queue-action-btn queue-action-btn--danger"
                            title="Remove from queue"
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
                          The yards are quiet — nothing is on the drawing board yet. Give your
                          people their next order with <strong>Choose Production…</strong> below.
                        </span>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </Tab>

            {/* ── Resources ────────────────────────────────────────────── */}
            <Tab eventKey="resources" title="Resources">
              <p className="gm-prose">
                Every crumb, coin and beaker {cityName} produces — and how it is shared out
                among your people.
              </p>
              {(() => {
                const resources = logic.getCityResources();
                return (
                  <>
                    <section className="gm-section">
                      <div className="gm-section-title">This turn's ledger</div>
                      <div className="gm-stat-grid">
                        {statTile('🍞', resources.food.produced, 'Food')}
                        {statTile('⛏️', resources.production.produced, 'Production', true)}
                        {statTile('💰', resources.trade.total, 'Trade')}
                        {statTile('🎭', resources.luxuries.amount, 'Luxuries')}
                        {statTile('🪙', resources.taxes.amount, 'Taxes')}
                        {statTile('🔬', resources.science.amount, 'Science')}
                      </div>
                      <div className="gm-kv-grid">
                        <div className="gm-kv">
                          Food surplus:{' '}
                          <b className={resources.food.surplus >= 0 ? 'city-kv--good' : 'city-kv--bad'}>
                            {resources.food.surplus >= 0 ? `+${resources.food.surplus}` : resources.food.surplus}
                          </b>
                        </div>
                        <div className="gm-kv">
                          Trade after corruption: <b>{resources.trade.afterCorruption}</b>
                        </div>
                        {resources.trade.routeTrade > 0 && (
                          <div className="gm-kv">
                            Trade from routes: <b className="city-kv--good">+{resources.trade.routeTrade}</b>
                          </div>
                        )}
                        {resources.trade.corruption > 0 && (
                          <div className="gm-kv">
                            Lost to corruption: <b className="city-kv--bad">−{resources.trade.corruption}</b>
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="gm-section">
                      <div className="gm-section-title">
                        Food &amp; growth
                        {resources.food.hasGranary && <span className="gm-chip">Granary</span>}
                      </div>
                      <div className="gm-kv-grid gm-kv-grid--stack">
                        <div className="gm-kv">
                          Food needed each turn: <b>{resources.food.needed}</b>
                        </div>
                        <div className="gm-kv">
                          Food stored: <b>{resources.food.storage} / {resources.food.growthThreshold}</b>
                          {resources.food.hasGranary && (
                            <span className="gm-kv-sub">granary line: {resources.food.granaryLine}</span>
                          )}
                        </div>
                        {resources.food.surplus > 0 && resources.food.turnsUntilGrowth > 0 && (
                          <div className="gm-kv">
                            Growth in:{' '}
                            <b className="city-kv--good">
                              {resources.food.turnsUntilGrowth}{' '}
                              {resources.food.turnsUntilGrowth === 1 ? 'turn' : 'turns'}
                            </b>
                          </div>
                        )}
                        {resources.food.surplus > 0 && resources.food.turnsUntilGrowth <= 0 && (
                          <div className="gm-kv">
                            Growth: <b className="city-kv--good">Growing next turn!</b>
                          </div>
                        )}
                        {resources.food.surplus < 0 && (
                          <div className="gm-kv">
                            Starvation in:{' '}
                            <b className="city-kv--bad">
                              {resources.food.turnsUntilStarvation > 0
                                ? `${resources.food.turnsUntilStarvation} ${
                                    resources.food.turnsUntilStarvation === 1 ? 'turn' : 'turns'
                                  }`
                                : 'NOW!'}
                            </b>
                          </div>
                        )}
                      </div>
                      <p className="gm-note">
                        Each citizen eats 2 food a turn; the surplus fills the store and at{' '}
                        {resources.food.growthThreshold} food {cityName} grows by one.
                        {resources.food.hasGranary &&
                          ' A Granary keeps 50% of the store after every growth.'}
                      </p>
                    </section>

                    <section className="gm-section">
                      <div className="gm-section-title">The split of your trade</div>
                      <div className="gm-kv-grid">
                        <div className="gm-kv">
                          Luxuries at {resources.luxuries.rate}%: <b>{resources.luxuries.amount} diamonds</b>
                        </div>
                        <div className="gm-kv">
                          Taxes at {resources.taxes.rate}%: <b>{resources.taxes.amount} coins</b>
                        </div>
                        <div className="gm-kv">
                          Science at {resources.science.rate}%: <b>{resources.science.amount} bulbs</b>
                        </div>
                        {resources.production.surplus > 0 && (
                          <div className="gm-kv">
                            Shields banked this turn: <b className="city-kv--good">+{resources.production.surplus}</b>
                          </div>
                        )}
                      </div>
                      <p className="gm-note">
                        Trade reaching {cityName} is split by your rates: luxuries buy contentment,
                        taxes fill the treasury, science carries your people toward the next advance.
                      </p>
                      {resources.trade.corruption > 0 && (
                        <p className="gm-note">
                          Corrupt trade never reaches the city — the farther {cityName} sits from
                          your capital, the more is siphoned away on the road.
                        </p>
                      )}
                    </section>
                  </>
                );
              })()}
            </Tab>

            {/* ── Buildings ────────────────────────────────────────────── */}
            <Tab eventKey="buildings" title="Buildings">
              <p className="gm-prose">
                What your people have raised in {cityName}. Stone lasts: every building feeds,
                defends or enriches the city turn after turn.
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
                    happiness: 'Happiness', food: 'Food', production: 'Production',
                    trade: 'Trade', gold: 'Gold', science: 'Science', culture: 'Culture',
                    corruptionReduction: 'Corruption Reduction', foodStorage: 'Food Storage',
                    growthBonus: 'Growth Bonus', unitProduction: 'Military Production',
                    veteranUnits: 'Veteran Units', freeUnits: 'Free Units',
                    extraPopulation: 'Extra Population', isPalace: 'Capital',
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
                    const sellTitle = isWonder ? 'Wonders cannot be sold'
                      : selectedCity.soldBuildingThisTurn ? 'Already sold a building this turn'
                      : `Sell for ${sellRefund} gold`;
                    return (
                      <div key={key} className="building-card">
                        <div className="building-card__header">
                          <span className="building-icon">{b.icon ?? '🏗️'}</span>
                          <div className="building-card__body">
                            <div className="d-flex justify-content-between align-items-start">
                              <h6 className="building-name mb-1">{b.name}</h6>
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
                                      message: `Sold ${b.name} for ${result.refund} gold`,
                                    });
                                  } else if (result.reason && actions?.addNotification) {
                                    actions.addNotification({
                                      type: 'warning',
                                      message: result.reason,
                                    });
                                  }
                                }}
                              >
                                <i className="bi bi-trash"></i> {isWonder ? '—' : `Sell (${sellRefund}g)`}
                              </button>
                            </div>
                            <div className="building-meta small">
                              <span className="building-meta__item">
                                <i className="bi bi-bricks"></i> {b.cost}
                              </span>
                              {wonderObsolete && (
                                <span className="wonder-obsolete-tag" title="Obsolescence technology discovered — effect inactive">
                                  ⚠ Obsolete
                                </span>
                              )}
                              {b.maintenance > 0 && (
                                <span className="building-meta__item">
                                  <i className="bi bi-coin"></i> {b.maintenance}/turn
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
                            Buildings <span className="city-section-count">({regularBuildings.length})</span>
                          </div>
                          <div className="buildings-grid">
                            {regularBuildings.map(renderBuildingCard)}
                          </div>
                        </section>
                      )}
                      {wonders.length > 0 && (
                        <section className="gm-section">
                          <div className="gm-section-title">
                            Wonders <span className="city-section-count">({wonders.length})</span>
                          </div>
                          <div className="buildings-grid">
                            {wonders.map(renderBuildingCard)}
                          </div>
                        </section>
                      )}
                      {regularBuildings.includes('harbor') && isPlayerCity && (() => {
                        const fisher = logic.getFisherBoatStatus();
                        const stageLabel = fisher.stage === 'fishing'
                          ? 'Fishing'
                          : fisher.stage === 'inbound'
                            ? 'Returning to port'
                            : fisher.stage === 'outbound'
                              ? 'Sailing to the fishing ground'
                              : null;
                        return (
                          <section className="gm-section">
                            <div className="gm-section-title">Fisher Boat</div>
                            <div className="building-card">
                              <div className="building-card__header">
                                <span className="building-icon">🎣</span>
                                <div className="building-card__body">
                                  <h6 className="building-name mb-1">
                                    Fisher Boat <span className="small text-muted">(max 1 per city)</span>
                                  </h6>
                                  {fisher.exists ? (
                                    <div className="small">
                                      <div>
                                        {stageLabel}
                                        {(fisher.stage === 'fishing' || fisher.stage === 'inbound') && (
                                          <> — hold {fisher.fishStored}/{fisher.capacity}</>
                                        )}
                                        {fisher.tile && <> at ({fisher.tile.col}, {fisher.tile.row})</>}
                                      </div>
                                      <div className="text-muted">
                                        Distance {fisher.distance} · {fisher.foodPerFish} food per fish · full catch {fisher.catchValue} food
                                      </div>
                                    </div>
                                  ) : fisher.underConstruction ? (
                                    <div className="small text-muted">Under construction (20 shields)</div>
                                  ) : (
                                    <div className="small text-muted">
                                      Not built — 20 shields, requires this Harbor. Fish tiles with a net feed the city.
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
                      Nothing but walls and wishes so far. Open <strong>Choose Production…</strong>{' '}
                      below and give your builders something worthy to raise.
                    </span>
                  </div>
                </section>
              )}
            </Tab>

            {/* ── Citizens ─────────────────────────────────────────────── */}
            <Tab eventKey="citizens" title="Citizens">
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
                      Your governor keeps {cityName} fed and decides which land is worked; you
                      set the rulebook here, and place citizens by hand on the map.
                    </p>

                    {/* Governor switcher */}
                    {isPlayerCity && (
                      <section className="gm-section">
                        <div className="gm-section-title">City Governor</div>
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
                                    message: `${selectedCity.name}: ${option.name} governor selected — tiles and specialists will be reassigned when you close this screen. Lock specialists to prevent changes.`,
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
                            <span className="gm-callout-title">Pending rebalance</span>
                            The governor's new order is applied the moment you close this screen.
                          </div>
                        )}
                        <p className="gm-note">
                          Every governor secures food first. Tiles you place a citizen on by hand
                          are marked <span className="city-tile-manual-badge-inline">manual</span>{' '}
                          and are never moved automatically.
                        </p>
                      </section>
                    )}

                    {/* Lock Specialists toggle */}
                    {isPlayerCity && (
                      <section className="gm-section">
                        <div className="gm-section-title">Specialist lock</div>
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
                                ? `${selectedCity.name}: specialists locked — the governor will not change them.`
                                : `${selectedCity.name}: specialists unlocked — the governor may manage them.`,
                            });
                          }}
                        >
                          <i className={`bi ${specialistsLocked ? 'bi-lock-fill' : 'bi-unlock-fill'} me-1`}></i>
                          {specialistsLocked ? 'Specialists Locked' : 'Lock Specialists'}
                        </button>
                        <p className="gm-note">
                          While locked, the governor leaves your specialists exactly where they
                          stand — no promotions, no demotions, no surprises.
                        </p>
                      </section>
                    )}

                    {/* Specialists — interactive management */}
                    {isPlayerCity && (
                      <section className="gm-section">
                        <div className="gm-section-title">
                          Specialists{' '}
                          <span className="city-section-count">
                            ({specs.length} of {pop} citizens)
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
                                    message: `${selectedCity.name}: ${demoted} specialist${demoted > 1 ? 's' : ''} returned to tile work.`,
                                  });
                                }
                              }}
                            >
                              Demote All
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
                                <span className="city-specialist-name">{def.name}</span>
                                <span className="city-specialist-yield text-muted">
                                  {def.luxury ? `+${def.luxury} Lux` : ''}
                                  {def.gold ? `+${def.gold} Gold` : ''}
                                  {def.science ? `+${def.science} Sci` : ''}
                                </span>
                                <span className="city-specialist-count">{count}</span>
                                <button
                                  type="button"
                                  className="city-specialist-btn city-specialist-btn-add"
                                  disabled={!canAdd}
                                  title={canAdd ? `Promote a citizen to ${def.name} (frees worst tile)` : 'No citizens available'}
                                  onClick={() => {
                                    if (gameEngine.promoteCitizenToSpecialist(selectedCity.id, type)) {
                                      actions?.addNotification?.({
                                        type: 'info',
                                        message: `${selectedCity.name}: citizen promoted to ${def.name}.`,
                                      });
                                    } else {
                                      actions?.addNotification?.({
                                        type: 'warning',
                                        message: `No citizen free to become ${def.name} in ${selectedCity.name}.`,
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
                                  title={canRemove ? `Demote ${def.name} back to tile worker` : 'None assigned'}
                                  onClick={() => {
                                    const idx = specs.lastIndexOf(type);
                                    if (idx >= 0 && gameEngine.demoteSpecialistToWorker(selectedCity.id, idx)) {
                                      actions?.addNotification?.({
                                        type: 'info',
                                        message: `${selectedCity.name}: ${def.name} returned to tile work.`,
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
                          A specialist gives a fixed city yield instead of a tile's. Press{' '}
                          <strong>+</strong> to lift a citizen off a worked tile,{' '}
                          <strong>−</strong> to send them back to the fields. Right-click the map
                          icons to demote them too.
                        </p>
                      </section>
                    )}

                    {/* Worked tiles — interactive: - to unassign citizen */}
                    <section className="gm-section">
                      <div className="gm-section-title">
                        Worked Tiles{' '}
                        <span className="city-section-count">
                          ({tileWorkers} · the city centre is worked for free)
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
                                        {yields.food > 0 && <span title="Food">🍞{yields.food}</span>}
                                        {yields.production > 0 && <span title="Production">⛏️{yields.production}</span>}
                                        {yields.trade > 0 && <span title="Trade">💰{yields.trade}</span>}
                                      </span>
                                    )}
                                    {manual ? (
                                      <span className="city-tile-manual-badge" title="Placed by hand — the governor never moves it">
                                        manual
                                      </span>
                                    ) : (
                                      <span className="city-tile-auto-badge">auto</span>
                                    )}
                                    {!isCenter && (
                                      <button
                                        type="button"
                                        className="city-tile-unassign-btn"
                                        title="Remove citizen from this tile"
                                        onClick={() => {
                                          if (gameEngine.unassignCitizenFromTile(selectedCity.id, col, row)) {
                                            actions?.addNotification?.({
                                              type: 'info',
                                              message: `${selectedCity.name}: citizen removed from (${col},${row}).`,
                                            });
                                          } else {
                                            actions?.addNotification?.({
                                              type: 'warning',
                                              message: `${selectedCity.name}: could not remove the citizen from (${col},${row}).`,
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
                            These are the tiles {cityName}'s workers stand on this turn — each one
                            gives what its land gives, and the governor shuffles them unless you
                            place them by hand.
                          </p>
                        </>
                      ) : (
                        <p className="gm-prose">
                          None of your citizens work the fields yet — the city centre feeds itself
                          for free until you put them on the land.
                        </p>
                      )}
                    </section>

                    {/* Unworked tiles — + to assign citizen */}
                    <section className="gm-section">
                      <div className="gm-section-title">
                        Available Tiles{' '}
                        <span className="city-section-count">
                          ({freeCitizens} citizen{freeCitizens === 1 ? '' : 's'} available)
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
                                        {yields.food > 0 && <span title="Food">🍞{yields.food}</span>}
                                        {yields.production > 0 && <span title="Production">⛏️{yields.production}</span>}
                                        {yields.trade > 0 && <span title="Trade">💰{yields.trade}</span>}
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      className="city-tile-assign-btn"
                                      title={`Put a citizen on this tile (${total} total)`}
                                      onClick={() => {
                                        if (gameEngine.assignCitizenToTile(selectedCity.id, col, row)) {
                                          actions?.addNotification?.({
                                            type: 'info',
                                            message: `${selectedCity.name}: citizen assigned to (${col},${row}).`,
                                          });
                                        } else {
                                          actions?.addNotification?.({
                                            type: 'warning',
                                            message: `${selectedCity.name}: (${col},${row}) cannot be worked.`,
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
                            Empty ground inside {cityName}'s reach. Press <strong>+</strong> to put
                            a citizen on the tile that feeds your people best.
                          </p>
                        </>
                      ) : (
                        <p className="gm-prose">
                          Every citizen already has a plot to stand on — let {cityName} grow and
                          new land opens up for the taking.
                        </p>
                      )}
                    </section>

                    {/* How citizens are actually set — the map is the only place */}
                    <div className="gm-callout">
                      <span className="gm-callout-title">🗺️ Setting citizens is a map action</span>
                      <ol className="gm-list">
                        <li>Close this screen so you can see the city.</li>
                        <li>
                          Click a <strong>worked tile</strong> (green) to pick up its citizen.
                        </li>
                        <li>
                          Click an <strong>idle tile</strong> in the yellow radius — the citizen moves there and the
                          new tile turns <span className="city-tile-manual-badge-inline">manual</span>. Tiles that
                          already have a citizen are not valid targets.
                        </li>
                      </ol>
                      <p className="gm-note">
                        <strong>Esc</strong> or a right-click puts the citizen back. The governor never moves a{' '}
                        <span className="city-tile-manual-badge-inline">manual</span> tile.
                        {freeCitizens > 0 && (
                          <span className="text-warning">
                            {' '}
                            {freeCitizens} citizen{freeCitizens === 1 ? '' : 's'} still need a tile.
                          </span>
                        )}
                      </p>
                    </div>
                  </>
                );
              })()}
            </Tab>

            {/* ── Units ────────────────────────────────────────────────── */}
            <Tab eventKey="units" title={`Units (${logic.getCityUnits().length})`}>
              {(() => {
                const cityUnits = logic.getCityUnits();
                return (
                  <>
                    <p className="gm-prose">
                      Every soldier, settler and boat standing in {cityName} this turn — select
                      one to take command of it.
                    </p>
                    <section className="gm-section">
                      <div className="gm-section-title">
                        In the city <span className="city-section-count">({cityUnits.length})</span>
                      </div>
                      {cityUnits.length === 0 ? (
                        <div className="city-empty">
                          <i className="bi bi-people" aria-hidden="true"></i>
                          <span>
                            No units are inside {cityName} — the gates stand open and unguarded.
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
                              ? `${unit.hitPoints}/${unit.maxHitPoints} HP`
                              : `${Math.round(health)}% HP`;
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
                                <span style={{ fontSize: '1.4rem', width: 28, textAlign: 'center' }}>
                                  {unit.icon || props?.icon || '⚔️'}
                                </span>
                                <div className="flex-grow-1 min-width-0">
                                  <div className="d-flex align-items-center gap-2 flex-wrap">
                                  <strong>{props?.name ?? unit.type}</strong>
                                  {isGarrison && <Badge bg="success">Garrison</Badge>}
                                  {rankBadge && (
                                    <span className={rankBadge.className} title={rankBadge.title}>
                                      {rankBadge.label}
                                    </span>
                                  )}
                                  <Badge bg={status.variant}>{status.label}</Badge>
                                    {unit.embarkedOn && (
                                      <Badge bg="info" text="dark">Aboard ferry</Badge>
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
                                        ? `Base A${unit.attack ?? props?.attack ?? 0}/D${unit.defense ?? props?.defense ?? 0}, ×${rankBadge.multiplier} rank strength`
                                        : undefined
                                    }
                                  >
                                    A{effAttack}/D{effDefense}
                                  </span>
                                    <span className="small text-muted">({unit.col},{unit.row})</span>
                                  </div>
                                </div>
                                {isPlayerCity && (
                                  <Button
                                    size="sm"
                                    variant="outline-light"
                                    title="Select and centre this unit"
                                    onClick={() => {
                                      actions.selectUnit?.(unit.id, 'user');
                                      actions.focusCameraOnTile?.(unit.col, unit.row, true, true);
                                    }}
                                  >
                                    <i className="bi bi-crosshair"></i> Select
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {isPlayerCity && cityUnits.length > 0 && (
                        <p className="gm-note">
                          Tip: shift-click units on the map to gather a group and move several at once.
                        </p>
                      )}
                    </section>
                  </>
                );
              })()}
            </Tab>

            {/* ── Trade Routes ─────────────────────────────────────────── */}
            <Tab eventKey="trade" title="Trade Routes">
              {(() => {
                const routes = logic.getTradeRoutes();
                const routeTrade = logic.getRouteTrade();
                return (
                  <>
                    <p className="gm-prose">
                      Roads of commerce running out of {cityName} — each route pays your two
                      cities every single turn.
                    </p>
                    <section className="gm-section">
                      <div className="gm-section-title">Routes in use</div>
                      <div className="gm-kv-grid gm-kv-grid--stack">
                        <div className="gm-kv">
                          Trade routes: <b>{routes.length}/3</b>
                        </div>
                        <div className="gm-kv">
                          Trade from routes:{' '}
                          <b className={routeTrade > 0 ? 'city-kv--good' : ''}>+{routeTrade} trade/turn</b>
                        </div>
                      </div>
                      <p className="gm-note">
                        A Caravan establishes a permanent route when it delivers to another city
                        (lump-sum Gold + Science). Each route adds per-turn trade to both cities.
                        At most 3 routes; a stronger new route replaces the weakest.
                      </p>
                      {routes.length > 0 ? (
                        <div className="d-flex flex-column gap-2">
                          {routes.map((route, i) => {
                            const destCiv = gameEngine.civilizations?.find(
                              (c: Civilization) => c.id === route.civilizationId,
                            );
                            const isForeign = route.civilizationId !== selectedCity.civilizationId;
                            return (
                              <div key={i} className="p-2 rounded bg-dark border border-secondary d-flex justify-content-between align-items-center">
                                <div>
                                  <div>
                                    <strong>{route.cityName}</strong>
                                    {isForeign && <span className="text-warning ms-2 small">foreign ×2</span>}
                                  </div>
                                  <div className="small text-muted">
                                    {destCiv?.name ?? `Civ ${route.civilizationId}`} · {route.distance} tiles away
                                  </div>
                                </div>
                                <div className="text-info fw-semibold">+{route.trade} trade/turn</div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="city-empty">
                          <i className="bi bi-signpost-split" aria-hidden="true"></i>
                          <span>
                            No roads of trade reach {cityName} yet. Build a Caravan (it needs the
                            Trade advance) and deliver it to another city to open one.
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
        onAddToQueue={(key) => {
          handleQueueProduction(key);
        }}
        onPurchase={(_key, item) => {
          if (gameEngine && typeof gameEngine.purchaseCityProduction === 'function') {
            gameEngine.purchaseCityProduction(selectedCity.id, item);
            if (actions?.addNotification) {
              actions.addNotification({
                type: 'success',
                message: `Purchased ${item.name} for ${item.cost} Gold!`
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
