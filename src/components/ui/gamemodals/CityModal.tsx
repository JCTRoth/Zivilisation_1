import React, { useState, useEffect, useRef } from 'react';
import { Modal, Button, Badge, ProgressBar, Tab, Tabs } from 'react-bootstrap';
import { CityModalLogic } from './CityModalLogic';
import { ModalUtils } from './ModalUtils';
import { UNIT_PROPS, BUILDING_PROPS } from '@/utils/Constants';
import { BUILDING_PROPERTIES, WONDER_PROPERTIES } from '@/data/BuildingConstants';
import { SPECIALIST_YIELDS } from '@/data/GameConstants';
import { CITY_GOVERNOR_OPTIONS, governorOption, terrainLabel } from '@/utils/CityGovernorUtils';
import ProductionSelectionModal from './ProductionSelectionModal';
import { productionFailureText } from '@/utils/ProductionUtils';
import { unitStatus } from '@/utils/UnitStatus';
import GameEngine from '@/game/engine/GameEngine';
import type { City, Civilization, GameActions, ProductionItem } from '../../../../types/game';
import '../../../styles/cityModal.css';

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

  // Sync local state when selectedCity changes
  useEffect(() => {
    if (!selectedCity) return;
    setAutoProduction(selectedCity?.autoProduction || false);
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

  return (
    <>
      <Modal show={show} onHide={onHide} centered size="lg" dialogClassName="city-details-modal production-selection-modal hex-detail-modal">
        <Modal.Header className="hex-detail-modal-header text-white">
          <Modal.Title>
            <i className="bi bi-building"></i> {selectedCity.name}
            {isPlayerCity && (
              <span className="ms-3 fs-6 fw-normal">
                <i className="bi bi-coin text-warning"></i> {currentPlayer?.resources?.gold ?? 0} Gold
              </span>
            )}
          </Modal.Title>
          <Button variant="outline-light" size="sm" onClick={onHide} className="hex-detail-close-button">
            <i className="bi bi-x-lg"></i>
          </Button>
        </Modal.Header>
        <Modal.Body className="hex-detail-modal-body text-white">
          <Tabs defaultActiveKey="overview" id="city-details-tabs" className="mb-3">
            <Tab eventKey="overview" title="Overview">
              <div className="hex-detail-content">
                <p className="hex-detail-city-info"><strong>Population:</strong> {selectedCity.population ?? 1}</p>
                <div className="mb-3">
                  <strong>Yields</strong>
                  <ul>
                    <li>Food: {selectedCity.yields?.food ?? 0}</li>
                    <li>Production: {logic.getProductionPerTurn()}</li>
                    <li>Trade: {selectedCity.yields?.trade ?? 0}</li>
                    {logic.getRouteTrade() > 0 && (
                      <li>Route trade: +{logic.getRouteTrade()}</li>
                    )}
                    <li>Science: {selectedCity.science ?? 0}</li>
                    <li>Gold: {selectedCity.gold ?? 0}</li>
                  </ul>
                </div>
                <div>
                </div>
                {isPlayerCity && (
                  <>
                    {/* ── Production Queue (redesigned) ─────────────────── */}
                    <div className="mt-3">
                      <div className="d-flex align-items-center justify-content-between mb-2">
                        <h6 className="mb-0">Production</h6>
                        <div className="form-check form-switch mb-0">
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

                      {/* Choose Production button */}
                      <div className="mb-2">
                        <button
                          className="btn btn-secondary text-white w-100 production-select-btn"
                          type="button"
                          onClick={() => setShowProductionModal(true)}
                        >
                          <i className="bi bi-list-ul me-1"></i>
                          Choose Production…
                        </button>
                      </div>

                      {(() => {
                        const purchasedThisTurn = selectedCity.purchasedThisTurn || [];
                        if (purchasedThisTurn.length > 0) {
                          return (
                            <div className="alert alert-warning small mb-2 py-1 px-2">
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
                        ) : (
                          <div className="text-muted small p-2">No active production</div>
                        )}

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
                          <div className="text-center text-muted py-3">
                            <i className="bi bi-inbox fs-3 d-block mb-1"></i>
                            Nothing in production. Choose something above.
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </Tab>
            <Tab eventKey="resources" title="Resources">
              <div className="city-resources-content">
                {(() => {
                  const resources = logic.getCityResources();
                  return (
                    <div className="city-resources-grid">
                      {/* Food Section */}
                      <div className="resource-section">
                        <h6 className="resource-title">
                          <i className="bi bi-apple"></i> Food
                          {resources.food.hasGranary && (
                            <span className="granary-badge ms-2">
                              <i className="bi bi-building"></i> Granary
                            </span>
                          )}
                        </h6>
                        <div className="resource-values">
                          <div className="resource-line">
                            <span className="resource-amount">{resources.food.produced}</span>
                            <span className="resource-break">|</span>
                            <span className={`resource-surplus ${resources.food.surplus >= 0 ? 'positive' : 'negative'}`}>
                              {resources.food.surplus >= 0 ? `+${resources.food.surplus}` : resources.food.surplus}
                            </span>
                          </div>
                          <small className="resource-desc">
                            Needs {resources.food.needed} food per turn.
                          </small>

                          {/* Food storage progress: stored / threshold + turns to grow */}
                          <div className="growth-info">
                            <span>
                              <span className="label">Food stored: </span>
                              <span className="value">{resources.food.storage}</span>
                              <span className="label"> / {resources.food.growthThreshold}</span>
                              {resources.food.hasGranary && (
                                <span className="label"> (granary line: {resources.food.granaryLine})</span>
                              )}
                            </span>
                            {resources.food.surplus > 0 && resources.food.turnsUntilGrowth > 0 && (
                              <span>
                                <span className="label">Growth in: </span>
                                <span className="value positive">{resources.food.turnsUntilGrowth} {resources.food.turnsUntilGrowth === 1 ? 'turn' : 'turns'}</span>
                              </span>
                            )}
                            {resources.food.surplus > 0 && resources.food.turnsUntilGrowth <= 0 && (
                              <span className="value positive">Growing next turn!</span>
                            )}
                            {resources.food.surplus < 0 && (
                              <span>
                                <span className="label">Starvation in: </span>
                                <span className="value negative">{resources.food.turnsUntilStarvation > 0 ? `${resources.food.turnsUntilStarvation} ${resources.food.turnsUntilStarvation === 1 ? 'turn' : 'turns'}` : 'NOW!'}</span>
                              </span>
                            )}
                          </div>
                          <small className="resource-desc">
                            Each citizen consumes 2 food per turn. Surplus fills the storage box; at {resources.food.growthThreshold} food the city grows.
                            {resources.food.hasGranary && ' A Granary preserves 50% of stored food after growth.'}
                          </small>
                        </div>
                      </div>

                      {/* Production Section */}
                      <div className="resource-section">
                        <h6 className="resource-title">
                          <i className="bi bi-gear"></i> Production
                        </h6>
                        <div className="resource-values">
                          <div className="resource-line">
                            <span className="resource-amount">{resources.production.produced}</span>
                            <span className="resource-break">|</span>
                            <span className="resource-surplus positive">
                              +{resources.production.surplus}
                            </span>
                          </div>
                          <small className="resource-desc">
                            Available for building units and city improvements.
                          </small>
                        </div>
                      </div>

                      {/* Trade Section */}
                      <div className="resource-section">
                        <h6 className="resource-title">
                          <i className="bi bi-arrow-left-right"></i> Trade
                        </h6>
                        <div className="resource-values">
                          <div className="resource-line">
                            <span className="resource-amount">{resources.trade.total}</span>
                            <span className="resource-break">|</span>
                            <span className={`resource-corruption ${resources.trade.corruption > 0 ? 'negative' : ''}`}>
                              -{resources.trade.corruption}
                            </span>
                          </div>
                          <small className="resource-desc">
                            {resources.trade.afterCorruption} trade after corruption. Distributed as luxuries, taxes, and science.
                          </small>
                          {resources.trade.routeTrade > 0 && (
                            <small className="resource-desc text-info d-block mt-1">
                              <i className="bi bi-arrow-left-right"></i> Includes +{resources.trade.routeTrade} trade from routes.
                            </small>
                          )}
                        </div>
                      </div>

                      {/* Luxuries Section */}
                      <div className="resource-section">
                        <h6 className="resource-title">
                          <i className="bi bi-gem"></i> Luxuries
                        </h6>
                        <div className="resource-values">
                          <div className="resource-line">
                            <span className="resource-amount">{resources.luxuries.amount}</span>
                            <span className="resource-unit">diamonds</span>
                          </div>
                          <small className="resource-desc">
                            Makes citizens content. Trade rate: {resources.luxuries.rate}%
                          </small>
                        </div>
                      </div>

                      {/* Taxes Section */}
                      <div className="resource-section">
                        <h6 className="resource-title">
                           Taxes🪙🪙🪙
                        </h6>
                        <div className="resource-values">
                          <div className="resource-line">
                            <span className="resource-amount">{resources.taxes.amount}</span>
                            <span className="resource-unit">coins</span>
                          </div>
                          <small className="resource-desc">
                            Added to treasury. Trade rate: {resources.taxes.rate}%
                          </small>
                        </div>
                      </div>

                      {/* Science Section */}
                      <div className="resource-section">
                        <h6 className="resource-title">
                          <i className="bi bi-lightbulb"></i> Science
                        </h6>
                        <div className="resource-values">
                          <div className="resource-line">
                            <span className="resource-amount">{resources.science.amount}</span>
                            <span className="resource-unit">bulbs</span>
                          </div>
                          <small className="resource-desc">
                            Research progress. Trade rate: {resources.science.rate}%
                          </small>
                        </div>
                      </div>

                      {/* Corruption Section */}
                      {resources.trade.corruption > 0 && (
                        <div className="resource-section corruption-section">
                          <h6 className="resource-title">
                            <i className="bi bi-exclamation-triangle"></i> Corruption
                          </h6>
                          <div className="resource-values">
                            <div className="resource-line">
                              <span className="resource-amount corruption-amount">{resources.trade.corruption}</span>
                              <span className="resource-unit">trade lost</span>
                            </div>
                            <small className="resource-desc">
                              Lost to corruption. Distance from capital increases corruption.
                            </small>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </Tab>
            <Tab eventKey="buildings" title="Buildings">
              <div className="city-buildings-content">
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
                      const b = BUILDING_PROPERTIES[key];
                      if (!b) return null;
                      const effects = b.effects ?? {};
                      const effectEntries = Object.entries(effects).filter(([, v]) => v && v !== false && v !== 0);
                      const isWonder = !!WONDER_PROPERTIES[key];
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
                          <div className="mb-3">
                            <div className="buildings-section-title mb-2">
                              <i className="bi bi-building"></i> Buildings ({regularBuildings.length})
                            </div>
                            <div className="buildings-grid">
                              {regularBuildings.map(renderBuildingCard)}
                            </div>
                          </div>
                        )}
                        {wonders.length > 0 && (
                          <div>
                            <div className="buildings-section-title mb-2">
                              <i className="bi bi-trophy"></i> Wonders ({wonders.length})
                            </div>
                            <div className="buildings-grid">
                              {wonders.map(renderBuildingCard)}
                            </div>
                          </div>
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
                            <div className="mt-3">
                              <div className="buildings-section-title mb-2">
                                <i className="bi bi-water"></i> Fisher Boat
                              </div>
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
                            </div>
                          );
                        })()}
                      </>
                    );
                  })()
                ) : (
                  <div className="city-buildings-empty">
                    <i className="bi bi-building fs-1 d-block mb-2 text-muted"></i>
                    No buildings constructed yet
                  </div>
                )}
              </div>
            </Tab>
            <Tab eventKey="citizens" title="Citizens">
              <div className="city-citizens-content">
                {(() => {
                  const pop = selectedCity.population ?? 1;
                  const specs = selectedCity.specialists ?? [];
                  const workedTiles = selectedCity.workingTiles ?? new Set<string>();
                  const manualTiles = selectedCity.userAssignedTiles ?? new Set<string>();
                  const tileWorkers = workedTiles.size;
                  const freeCitizens = Math.max(0, pop - tileWorkers - specs.length);

                  return (
                    <>
                      <p className="small text-muted mb-3">
                        The <strong>city governor</strong> keeps the city fed and decides which tiles your citizens
                        work. Here you choose the governor and who becomes a <strong>specialist</strong>; the tiles
                        themselves are set on the map.
                      </p>

                      {/* Governor switcher */}
                      {isPlayerCity && (
                        <div className="mb-3">
                          <h6 className="mb-2">City Governor</h6>
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
                                      message: `${selectedCity.name}: ${option.name} governor selected — the city will be rebalanced when you close this screen.`,
                                    });
                                  }}
                                >
                                  <span className="city-governor-card-icon">{option.icon}</span>
                                  <span className="city-governor-card-name">{option.name}</span>
                                </button>
                              );
                            })}
                          </div>
                          <small className="text-muted d-block mt-2">
                            {governorOption(selectedCity.governor).description}
                          </small>
                          {selectedCity.governorDirty && (
                            <div className="small text-warning mt-1">
                              Pending rebalance — applied when you close the city screen.
                            </div>
                          )}
                          <small className="text-muted d-block mt-1">
                            Every governor secures food first. Tiles you place a citizen on by hand are marked{' '}
                            <span className="city-tile-manual-badge-inline">manual</span> and are never moved
                            automatically.
                          </small>
                        </div>
                      )}

                      {/* Specialists — a pure indicator: assigning them is a side-panel action */}
                      {isPlayerCity && (
                        <div className="mb-3">
                          <h6>
                            Specialists{' '}
                            <span className="text-muted fw-normal">
                              ({specs.length} of {pop} citizens)
                            </span>
                          </h6>
                          {specs.length > 0 ? (
                            <div className="d-flex flex-wrap gap-2">
                              {specs.map((type, i) => {
                                const def = SPECIALIST_YIELDS[type];
                                return (
                                  <div
                                    key={i}
                                    className="d-flex align-items-center gap-1 p-1 px-2 rounded bg-dark border border-secondary"
                                    title={`${def.name} — +${def.luxury ?? 0} Luxury, +${def.gold ?? 0} Gold, +${def.science ?? 0} Science`}
                                  >
                                    <span>{def.icon}</span>
                                    <span className="small">{def.name}</span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="small text-muted">Everyone works the tiles.</div>
                          )}
                          <small className="text-muted d-block mt-1">
                            Specialists give a fixed city yield instead of a tile&apos;s. Take a citizen off a field
                            with the 🎭 toggle in the side panel — a city starts them as an Entertainer.
                          </small>
                        </div>
                      )}

                      {/* Worked tiles — read-only: they are set on the map */}
                      {tileWorkers > 0 && (
                        <div className="mb-3">
                          <h6>
                            Worked Tiles{' '}
                            <span className="text-muted fw-normal">
                              ({tileWorkers} · the city centre is worked for free)
                            </span>
                          </h6>
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
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      )}

                      {/* How citizens are actually set — the map is the only place */}
                      <div className="city-citizens-howto">
                        <div className="city-citizens-howto-title">🗺️ Setting citizens is a map action</div>
                        <ol className="city-citizens-howto-steps">
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
                        <div className="city-citizens-howto-note">
                          <strong>Esc</strong> or a right-click puts the citizen back. The governor never moves a{' '}
                          <span className="city-tile-manual-badge-inline">manual</span> tile.
                          {freeCitizens > 0 && (
                            <span className="text-warning">
                              {' '}
                              {freeCitizens} citizen{freeCitizens === 1 ? '' : 's'} still need a tile.
                            </span>
                          )}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </Tab>
            <Tab eventKey="units" title={`Units (${logic.getCityUnits().length})`}>
              <div className="city-units-content">
                {(() => {
                  const cityUnits = logic.getCityUnits();
                  if (cityUnits.length === 0) {
                    return (
                      <div className="city-buildings-empty">
                        <i className="bi bi-people fs-1 d-block mb-2 text-muted"></i>
                        No units are inside this city.
                      </div>
                    );
                  }
                  return (
                    <>
                      <p className="small text-muted mb-3">
                        Units inside the city (garrison, settlers or boats standing
                        here). Select one to take command of it.
                      </p>
                      <div className="d-flex flex-column gap-2">
                        {cityUnits.map((unit) => {
                          const props = UNIT_PROPS[unit.type];
                          const status = unitStatus(unit);
                          const health = Math.max(0, Math.min(100, unit.health ?? 100));
                          const hpText =
                            typeof unit.hitPoints === 'number' && typeof unit.maxHitPoints === 'number'
                              ? `${unit.hitPoints}/${unit.maxHitPoints} HP`
                              : `${Math.round(health)}% HP`;
                          const isGarrison =
                            unit.col === selectedCity.col && unit.row === selectedCity.row;
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
                                  {unit.isVeteran && (
                                    <Badge bg="warning" text="dark">★ Veteran</Badge>
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
                                  <span className="small text-muted">
                                    A{unit.attack ?? props?.attack ?? 0}/D{unit.defense ?? props?.defense ?? 0}
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
                      {isPlayerCity && (
                        <small className="text-muted d-block mt-2">
                          Tip: shift-click units on the map to gather a group and move several at once.
                        </small>
                      )}
                    </>
                  );
                })()}
              </div>
            </Tab>
            <Tab eventKey="trade" title="Trade Routes">
              <div className="city-trade-routes-content">
                {(() => {
                  const routes = logic.getTradeRoutes();
                  const routeTrade = logic.getRouteTrade();
                  return (
                    <>
                      <p className="hex-detail-city-info">
                        <strong>Trade routes:</strong> {routes.length}/3
                        {routeTrade > 0 && (
                          <span className="ms-2 text-info">
                            <i className="bi bi-arrow-left-right"></i> +{routeTrade} trade/turn
                          </span>
                        )}
                      </p>
                      <p className="small text-muted">
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
                        <div className="text-muted">
                          No trade routes yet. Build a Caravan (requires Trade) and deliver it to
                          another city to establish a route.
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </Tab>
          </Tabs>
        </Modal.Body>
      </Modal>
      <ProductionSelectionModal
        show={showProductionModal}
        onHide={() => setShowProductionModal(false)}
        currentPlayer={currentPlayer}
        playerGold={currentPlayer?.resources?.gold ?? 0}
        purchasedThisTurn={(selectedCity?.purchasedThisTurn?.length ?? 0) > 0}
        cityBuildings={selectedCity?.buildings ?? []}
        productionPerTurn={logic.getProductionPerTurn()}
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
