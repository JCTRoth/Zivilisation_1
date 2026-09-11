import React, { useState, useEffect } from 'react';
import { Modal, Button, Tab, Tabs } from 'react-bootstrap';
import { CityModalLogic } from './CityModalLogic';
import { ModalUtils } from './ModalUtils';
import { UNIT_PROPS, BUILDING_PROPS } from '@/utils/Constants';
import { BUILDING_PROPERTIES } from '@/data/BuildingConstants';
import { SPECIALIST_YIELDS } from '@/data/GameConstants';
import ProductionSelectionModal from './ProductionSelectionModal';
import GameEngine from '@/game/engine/GameEngine';
import type { City, Civilization, GameActions, ProductionItem, SpecialistType } from '../../../../types/game';
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

const CityModal: React.FC<CityModalProps> = ({
  show,
  onHide,
  selectedCity,
  gameEngine,
  actions,
  currentPlayer,
  isPlayerCity
}) => {
  const [selectedProductionKey, setSelectedProductionKey] = useState<string | null>(null);
  const [selectedQueueIndex, setSelectedQueueIndex] = useState<number | null>(null);
  const [showProductionModal, setShowProductionModal] = useState<boolean>(false);
  const [autoProduction, setAutoProduction] = useState<boolean>(selectedCity?.autoProduction || false);

  // Sync local state when selectedCity changes
  useEffect(() => {
    if (!selectedCity) return;
    setAutoProduction(selectedCity?.autoProduction || false);
  }, [selectedCity]);

  if (!selectedCity) return null;

  const logic = new CityModalLogic(selectedCity, gameEngine, actions, currentPlayer);

  const handleQueueProduction = (itemType: string) => {
    // Check if it's a unit
    const unitDef = UNIT_PROPS[itemType];
    if (unitDef) {
      const item: ProductionItem = {
        type: 'unit',
        itemType,
        name: unitDef.name,
        cost: unitDef.cost
      };
      logic.setProduction(item, true);
      return;
    }

    // Check if it's a building
    const buildingDef = BUILDING_PROPS[itemType];
    if (buildingDef) {
      const item: ProductionItem = {
        type: 'building',
        itemType,
        name: buildingDef.name,
        cost: buildingDef.cost
      };
      logic.setProduction(item, true);
      return;
    }

    console.warn('Unknown production type:', itemType);
  };

  // handleBuyNow removed (unused)

  const getSelectedProductionCost = (key: string | null): number => {
    if (!key) return 0;
    return UNIT_PROPS[key]?.cost || BUILDING_PROPS[key]?.cost || 0;
  };

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
                    <div className="mt-3">
                      <h6>Current Production</h6>
                      {selectedCity.currentProduction ? (
                        <div className="text-white p-2 rounded d-flex justify-content-between align-items-start">
                          <div className="flex-grow-1">
                            <strong>{logic.getCurrentProductionName()}</strong>
                            <div className="small text-muted">
                              Progress: {logic.getProductionProgressValue()} / {logic.getCurrentProductionCost()} ({logic.getProgressPercent()}%)
                            </div>
                            <div className="small text-muted">
                              Production per turn: {logic.getProductionPerTurn()}
                            </div>
                            <div className="small text-muted">
                              Turns remaining: {logic.getFormattedTurns()}
                            </div>
                          </div>
                          <div className="d-flex flex-column gap-1 ms-2">
                            {(() => {
                              const totalCost = logic.getCurrentProductionCost();
                              const progress = logic.getProductionProgressValue();
                              const remainingShields = Math.max(0, totalCost - progress);
                              const playerGold = currentPlayer?.resources?.gold ?? 0;
                              const purchasedThisTurn = (selectedCity.purchasedThisTurn?.length ?? 0) > 0;
                              const goldCost = remainingShields * 2;
                              const canBuy = remainingShields > 0 && playerGold >= goldCost && !purchasedThisTurn;
                              return (
                                <button
                                  type="button"
                                  className="btn btn-sm city-buy-button"
                                  disabled={!canBuy}
                                  title={
                                    purchasedThisTurn
                                      ? 'Already purchased this turn'
                                      : remainingShields <= 0
                                        ? 'Production complete'
                                        : playerGold < goldCost
                                          ? `Need ${goldCost} Gold (have ${playerGold})`
                                          : `Buy remaining for ${goldCost} Gold`
                                  }
                                  onClick={() => {
                                    if (gameEngine && typeof gameEngine.rushCityProduction === 'function') {
                                      gameEngine.rushCityProduction(selectedCity.id);
                                      if (actions?.addNotification) {
                                        actions.addNotification({
                                          type: 'success',
                                          message: `Rushed ${logic.getCurrentProductionName()} for ${goldCost} Gold!`
                                        });
                                      }
                                    }
                                  }}
                                >
                                  🪙 Rush ({goldCost}g)
                                </button>
                              );
                            })()}
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger"
                              title="Remove current production"
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
                        <div className="text-muted">No active production</div>
                      )}
                    </div>
                    <div className="mt-3">
                      <div className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id={`auto-production-${selectedCity.id}`}
                          checked={autoProduction}
                          onChange={(e) => {
                            const newState = e.target.checked;
                            // Immediate visual feedback
                            setAutoProduction(newState);
                            // Trigger engine action
                            if (gameEngine && typeof gameEngine.toggleAutoProduction === 'function') {
                              const result = gameEngine.toggleAutoProduction(selectedCity.id, newState);
                              console.log(`[CityModal] Auto Production ${newState ? 'enabled' : 'disabled'} for city ${selectedCity.id}, result:`, result);
                              // Update actions if available
                              if (actions?.addNotification) {
                                actions.addNotification({
                                  type: 'success',
                                  message: `Auto Production ${newState ? 'enabled' : 'disabled'}`
                                });
                              }
                            } else {
                              console.warn('[CityModal] toggleAutoProduction method not available');
                            }
                          }}
                        />
                        <label className="form-check-label" htmlFor={`auto-production-${selectedCity.id}`}>
                          <strong>Auto Production</strong>
                          <div className="small text-muted">Automatically set production items based on city needs</div>
                        </label>
                      </div>
                    </div>
                    <div className="production-queue-layout">
                      <div className="production-panel">
                        <h6>Production</h6>
                        {(() => {
                          const purchasedThisTurn = selectedCity.purchasedThisTurn || [];
                          if (purchasedThisTurn.length > 0) {
                            return (
                              <div className="alert alert-warning small mb-2">
                                <i className="bi bi-exclamation-triangle"></i> Already purchased an item this turn. Purchase will be available next turn.
                              </div>
                            );
                          }
                          return null;
                        })()}
                        <div className="d-flex gap-2 align-items-center">
                          {/* This button opens a modal with Units and Buildings tabs, listing all items. */}
                          <button
                            className="btn btn-secondary text-white production-select-btn"
                            type="button"
                            onClick={() => setShowProductionModal(true)}
                            disabled={!isPlayerCity}
                          >
                            <i className="bi bi-plus-lg me-1"></i>
                            {selectedProductionKey ? `${UNIT_PROPS[selectedProductionKey]?.name || BUILDING_PROPS[selectedProductionKey]?.name} (${getSelectedProductionCost(selectedProductionKey)} shields)` : 'Add to Queue'}
                          </button>
                        </div>
                      </div>
                      <div className="queue-panel">
                        <h6>Queue</h6>
                        <div className="queue-box bg-dark border border-secondary rounded p-2" style={{maxHeight: '240px', overflowY: 'auto'}}>
                          {logic.hasQueueItems() ? (
                            logic.getQueueItems().map((q: ProductionItem, i: number) => (
                              <div key={i} className={`queue-item p-2 mb-1 rounded ${selectedQueueIndex === i ? 'text-white' : 'text-white'}`} onClick={() => setSelectedQueueIndex(i)}>
                                <div className="d-flex justify-content-between align-items-center gap-2">
                                  <div className="flex-grow-1">
                                    <div><strong>{q.name}</strong></div>
                                    <div className="small">#{i + 1} in queue · {q.cost} shields</div>
                                    <div className="small text-muted">Turns: {ModalUtils.getTurnsRemaining(0, q.cost, logic.getProductionPerTurn())}</div>
                                  </div>
                                  <div className="queue-item-actions">
                                    <button
                                      type="button"
                                      className="btn btn-outline-light btn-sm queue-action-btn"
                                      title="Move up in queue"
                                      disabled={i === 0}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        logic.moveQueueItem(i, i - 1);
                                        setSelectedQueueIndex(i - 1);
                                      }}
                                    >
                                      <i className="bi bi-arrow-up"></i>
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-outline-light btn-sm queue-action-btn"
                                      title="Move down in queue"
                                      disabled={i === logic.getQueueItems().length - 1}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        logic.moveQueueItem(i, i + 1);
                                        setSelectedQueueIndex(i + 1);
                                      }}
                                    >
                                      <i className="bi bi-arrow-down"></i>
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-outline-danger btn-sm queue-action-btn"
                                      title="Remove from queue"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        logic.removeQueueItem(i);
                                        setSelectedQueueIndex(null);
                                      }}
                                    >
                                      <i className="bi bi-trash"></i>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="text-white">Queue is empty</div>
                          )}
                        </div>
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
                  <div className="buildings-grid">
                    {selectedCity.buildings.map((buildingKey: string, index: number) => {
                      const buildingProps = BUILDING_PROPERTIES[buildingKey];
                      return (
                        <div key={index} className="building-card">
                          <div className="building-card__header">
                            {buildingProps?.icon && (
                              <span className="building-icon">{buildingProps.icon}</span>
                            )}
                            <div className="building-card__body">
                              <h6 className="building-name mb-1">{buildingProps?.name || buildingKey}</h6>
                              <div className="building-details small">
                                <span>Cost: {buildingProps?.cost || 0} shields</span>
                                <span className="building-details-sep">•</span>
                                <span>Maintenance: {buildingProps?.maintenance || 0} gold/turn</span>
                              </div>
                              {buildingProps?.description && (
                                <div className="building-description small mt-2">{buildingProps.description}</div>
                              )}
                              {buildingProps?.effects && (
                                <div className="building-effects small mt-2">
                                  <strong>Effects:</strong>
                                  <ul className="mb-0 mt-1">
                                    {Object.entries(buildingProps.effects).map(([effect, value]) => (
                                      <li key={effect}>
                                        {effect.replace(/([A-Z])/g, ' $1').toLowerCase()}: {String(value)}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="city-buildings-empty">No buildings constructed yet</div>
                )}
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
            <Tab eventKey="citizens" title="Citizens">
              <div className="city-citizens-content">
                {(() => {
                  const pop = selectedCity.population ?? 1;
                  const specs = selectedCity.specialists ?? [];
                  const workedTiles = selectedCity.workingTiles ?? new Set<string>();
                  const tileWorkers = workedTiles.size;
                  const freeCitizens = Math.max(0, pop - tileWorkers - specs.length);

                  const handlePromote = (type: SpecialistType) => {
                    if (gameEngine && typeof gameEngine.promoteCitizenToSpecialist === 'function') {
                      const ok = gameEngine.promoteCitizenToSpecialist(selectedCity.id, type);
                      if (!ok && actions?.addNotification) {
                        actions.addNotification({ type: 'warning', message: 'Cannot convert citizen — all tile workers are protected or city is full.' });
                      }
                    }
                  };

                  const handleDemote = (index: number) => {
                    if (gameEngine && typeof gameEngine.demoteSpecialistToWorker === 'function') {
                      gameEngine.demoteSpecialistToWorker(selectedCity.id, index);
                    }
                  };

                  const handlePickUp = (col: number, row: number) => {
                    actions.setCitizenReassign({ cityId: selectedCity.id, col, row });
                    if (actions?.addNotification) {
                      actions.addNotification({ type: 'info', message: '🧑‍🌾 Citizen selected for reassignment — click a tile on the map to place' });
                    }
                  };

                  return (
                    <>
                      <p className="small text-muted mb-3">
                        Pull a citizen off a tile to make them a <strong>Specialist</strong>. You lose the tile's
                        Food/Production/Trade but gain a fixed city yield: <strong>Entertainer</strong> (+2 Luxury),
                        <strong> Taxman</strong> (+2 Gold), or <strong>Scientist</strong> (+2 Science).
                      </p>

                      {/* Specialist summary */}
                      {specs.length > 0 && (
                        <div className="mb-3">
                          <h6>Specialists ({specs.length})</h6>
                          <div className="d-flex flex-wrap gap-2">
                            {specs.map((type, i) => {
                              const def = SPECIALIST_YIELDS[type];
                              return (
                                <div key={i} className="d-flex align-items-center gap-1 p-1 px-2 rounded bg-dark border border-secondary">
                                  <span>{def.icon}</span>
                                  <span className="small">{def.name}</span>
                                  {isPlayerCity && (
                                    <button
                                      type="button"
                                      className="btn btn-outline-danger btn-sm p-0 px-1 ms-1"
                                      style={{ fontSize: '0.65rem', lineHeight: 1 }}
                                      title="Convert back to tile worker"
                                      onClick={() => handleDemote(i)}
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Worked tiles with reassignment */}
                      {isPlayerCity && tileWorkers > 1 && (
                        <div className="mb-3">
                          <h6>Worked Tiles ({tileWorkers})</h6>
                          <div className="d-flex flex-wrap gap-2">
                            {Array.from(workedTiles).map((key) => {
                              const sep = key.indexOf(',');
                              const col = Number(key.slice(0, sep));
                              const row = Number(key.slice(sep + 1));
                              const isCenter = col === selectedCity.col && row === selectedCity.row;
                              if (isCenter) return null; // City center is always worked, can't reassign
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  className="btn btn-outline-success btn-sm"
                                  title={`Move citizen from (${col},${row}) to another tile`}
                                  onClick={() => handlePickUp(col, row)}
                                >
                                  🧑‍🌾 ({col},{row})
                                </button>
                              );
                            })}
                          </div>
                          <small className="text-muted d-block mt-1">Click a tile to pick up its citizen, then click an empty tile on the map to place it.</small>
                        </div>
                      )}

                      {/* Convert citizen buttons */}
                      {isPlayerCity && (
                        <div className="mb-3">
                          <h6>Convert Tile Citizen → Specialist</h6>
                          <div className="d-flex flex-wrap gap-2">
                            {(Object.keys(SPECIALIST_YIELDS) as SpecialistType[]).map((type) => {
                              const def = SPECIALIST_YIELDS[type];
                              return (
                                <button
                                  key={type}
                                  type="button"
                                  className="btn btn-outline-secondary btn-sm"
                                  disabled={tileWorkers <= 1}
                                  title={tileWorkers <= 1 ? 'Need at least one tile worker' : `Convert a tile citizen to ${def.name}`}
                                  onClick={() => handlePromote(type)}
                                >
                                  {def.icon} {def.name} <span className="text-muted ms-1">+{type === 'entertainer' ? '2 Luxury' : type === 'taxman' ? '2 Gold' : '2 Science'}</span>
                                </button>
                              );
                            })}
                          </div>
                          {tileWorkers <= 1 && (
                            <small className="text-muted d-block mt-1">All citizens are already specialists or on the city center.</small>
                          )}
                        </div>
                      )}

                      {/* Stats */}
                      <div className="small text-muted">
                        <div>Population: {pop} · Tile workers: {tileWorkers} · Specialists: {specs.length}</div>
                        {freeCitizens > 0 && <div className="text-warning">{freeCitizens} unassigned citizen(s)</div>}
                      </div>
                    </>
                  );
                })()}
              </div>
            </Tab>
            <Tab eventKey="raw" title="Raw JSON">
              <pre className="city-raw-json">{JSON.stringify(selectedCity, null, 2)}</pre>
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
        onSelectProduction={key => {
          // Always queue the selected item when picking from the modal
          handleQueueProduction(key);
          // keep the selected production visible after queuing
          setSelectedProductionKey(key);
          setShowProductionModal(false);
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
