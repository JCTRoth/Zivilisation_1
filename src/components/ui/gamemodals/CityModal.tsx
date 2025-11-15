import React, { useState } from 'react';
import { Modal, Button, Tab, Tabs } from 'react-bootstrap';
import { CityModalLogic } from './CityModalLogic';
import { ModalUtils } from './ModalUtils';
import { UNIT_PROPS } from '../../../utils/constants';
import { BUILDING_PROPERTIES } from '../../../utils/constants';

interface CityModalProps {
  show: boolean;
  onHide: () => void;
  selectedCity: any;
  gameEngine: any;
  actions: any;
  currentPlayer: any;
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

  if (!selectedCity) return null;

  const logic = new CityModalLogic(selectedCity, gameEngine, actions, currentPlayer);

  const handleQueueProduction = (itemType: string) => {
    const unitDef = UNIT_PROPS[itemType];
    if (!unitDef) return;

    const item = {
      type: 'unit',
      itemType,
      name: unitDef.name,
      cost: unitDef.cost
    };
    logic.setProduction(item, true);
  };

  const handleBuyNow = (itemType: string) => {
    const unitDef = UNIT_PROPS[itemType];
    if (!unitDef) return;

    const item = {
      type: 'unit',
      itemType,
      name: unitDef.name,
      cost: unitDef.cost
    };
    logic.purchaseProduction(item);
  };

  const availableProductionKeys = ['warrior']; // Placeholder

  return (
    <Modal show={show} onHide={onHide} centered size="lg" dialogClassName="city-details-modal hex-detail-modal">
      <Modal.Header className="bg-dark text-white hex-detail-modal-header">
        <Modal.Title>
          <i className="bi bi-building"></i> {selectedCity.name}
        </Modal.Title>
        <Button variant="outline-light" size="sm" onClick={onHide}>
          <i className="bi bi-x-lg"></i>
        </Button>
      </Modal.Header>
      <Modal.Body className="bg-dark text-white hex-detail-modal-body">
        <Tabs defaultActiveKey="overview" id="city-details-tabs" className="mb-3">
          <Tab eventKey="overview" title="Overview">
            <div className="hex-detail-content">
              <h5 className="hex-detail-city-name">{selectedCity.name}</h5>
              <p className="hex-detail-city-info"><strong>Population:</strong> {selectedCity.population ?? 1}</p>
              <p className="hex-detail-city-info"><strong>Location:</strong> ({selectedCity.col}, {selectedCity.row})</p>
              <div className="mb-3">
                <strong>Yields</strong>
                <ul>
                  <li>Food: {selectedCity.yields?.food ?? 0}</li>
                  <li>Production: {logic.getProductionPerTurn()}</li>
                  <li>Trade: {selectedCity.yields?.trade ?? 0}</li>
                  <li>Science: {selectedCity.science ?? 0}</li>
                  <li>Gold: {selectedCity.gold ?? 0}</li>
                </ul>
              </div>
              <div>
                <h6>Buildings</h6>
                {selectedCity.buildings && selectedCity.buildings.length > 0 ? (
                  <ul>
                    {selectedCity.buildings.map((building: any, i: number) => <li key={i}>{building}</li>)}
                  </ul>
                ) : <p>No buildings</p>}
              </div>
              {isPlayerCity && (
                <>
                  <div className="mt-3">
                    <h6>Current Production</h6>
                    {selectedCity.currentProduction ? (
                      <div className="bg-secondary text-white p-2 rounded">
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
                    ) : (
                      <div className="text-muted">No active production</div>
                    )}
                  </div>
                  <div className="mt-3">
                    <h6>Production</h6>
                    {(() => {
                      const purchasedThisTurn = (selectedCity as any).purchasedThisTurn || [];
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
                      <select
                        className="form-select bg-secondary text-white"
                        value={selectedProductionKey || ''}
                        onChange={(e) => setSelectedProductionKey(e.target.value || null)}
                        style={{maxWidth: '420px'}}
                        disabled={!logic.getAvailableProductionKeys() || logic.getAvailableProductionKeys().length === 0}
                      >
                        {(logic.getAvailableProductionKeys().length === 0) && <option value="">(No available items)</option>}
                        {logic.getAvailableProductionKeys().map(k => (
                          <option key={k} value={k}>{UNIT_PROPS[k]?.name} ({UNIT_PROPS[k]?.cost || 0} shields)</option>
                        ))}
                      </select>
                      <div className="d-flex gap-2">
                        <Button
                          variant="light"
                          disabled={!selectedProductionKey || !gameEngine || !selectedCity}
                          onClick={() => {
                            if (!selectedProductionKey) return;
                            handleQueueProduction(selectedProductionKey);
                            if (gameEngine.getAllCities) actions.updateCities(gameEngine.getAllCities());
                          }}
                        >
                          Add to Queue
                        </Button>
                        <Button
                          variant="danger"
                          disabled={selectedQueueIndex === null || selectedQueueIndex === undefined || !Array.isArray(selectedCity?.buildQueue) || selectedCity.buildQueue.length === 0 || !gameEngine}
                          onClick={async () => {
                            if (selectedQueueIndex === null || selectedQueueIndex === undefined) return;
                            if (!gameEngine || typeof gameEngine.removeCityQueueItem !== 'function') return;
                            const res = (gameEngine as any).removeCityQueueItem(selectedCity.id, selectedQueueIndex);
                            if (res && res.success) {
                              actions.addNotification({ type: 'success', message: `Removed from queue: ${res.removed?.name || 'item'}` });
                              if (gameEngine.getAllCities) actions.updateCities(gameEngine.getAllCities());
                              setSelectedQueueIndex(null);
                            } else {
                              actions.addNotification({ type: 'warning', message: `Failed to remove: ${res?.reason || 'unknown'}` });
                            }
                          }}
                        >
                          Remove
                        </Button>
                        <Button
                          variant="success"
                          disabled={!selectedProductionKey || !gameEngine || !selectedCity || !logic.canAffordBuyNow(selectedProductionKey)}
                          onClick={() => {
                            if (!selectedProductionKey) return;
                            handleBuyNow(selectedProductionKey);
                            if (gameEngine.getAllCities) actions.updateCities(gameEngine.getAllCities());
                          }}
                        >
                          Buy Now ({UNIT_PROPS[selectedProductionKey]?.cost || 0} gold)
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <h6>Queue</h6>
                    <div className="queue-box bg-dark border border-secondary rounded p-2" style={{maxHeight: '220px', overflowY: 'auto'}}>
                      {logic.hasQueueItems() ? (
                        logic.getQueueItems().map((q: any, i: number) => (
                          <div key={i} className={`queue-item p-2 mb-1 rounded ${selectedQueueIndex === i ? 'bg-secondary text-white' : 'text-white'}`} onClick={() => setSelectedQueueIndex(i)}>
                            <div className="d-flex justify-content-between">
                              <div><strong>{q.name}</strong></div>
                              <div>{q.cost} shields</div>
                            </div>
                            <div className="small">#{i + 1} in queue</div>
                            <div className="small text-muted">Turns: {ModalUtils.getTurnsRemaining(0, q.cost, logic.getProductionPerTurn())}</div>
                          </div>
                        ))
                      ) : (
                        <div className="text-white">Queue is empty</div>
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
                          Needs {resources.food.needed} food per turn. {resources.food.surplus >= 0 ? 'Surplus stored for growth.' : 'Shortfall - population may starve.'}
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
                        <i className="bi bi-coin"></i> Taxes
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
                      <div key={index} className="building-card bg-secondary text-white p-3 rounded mb-2">
                        <div className="d-flex justify-content-between align-items-start">
                          <div>
                            <h6 className="building-name mb-1">{buildingProps?.name || buildingKey}</h6>
                            <div className="building-details small">
                              <div>Cost: {buildingProps?.cost || 0} shields</div>
                              <div>Maintenance: {buildingProps?.maintenance || 0} gold/turn</div>
                            </div>
                          </div>
                        </div>
                        {buildingProps?.description && (
                          <div className="building-description small text-muted mt-2">
                            {buildingProps.description}
                          </div>
                        )}
                        {buildingProps?.effects && (
                          <div className="building-effects small mt-2">
                            <strong>Effects:</strong>
                            <ul className="mb-0 mt-1">
                              {Object.entries(buildingProps.effects).map(([effect, value]) => (
                                <li key={effect}>
                                  {effect.replace(/([A-Z])/g, ' $1').toLowerCase()}: {value}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-muted">No buildings constructed yet</div>
              )}
            </div>
          </Tab>
          <Tab eventKey="raw" title="Raw JSON">
            <pre>{JSON.stringify(selectedCity, null, 2)}</pre>
          </Tab>
        </Tabs>
      </Modal.Body>
    </Modal>
  );
};

export default CityModal;