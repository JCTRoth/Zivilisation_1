import React from 'react';
import { Modal, Button, Tab, Tabs } from 'react-bootstrap';
import { UNIT_PROPS, BUILDING_PROPS } from '../../../utils/Constants';
import type { ProductionItem } from '../../../../types/game';

interface ProductionSelectionModalProps {
  show: boolean;
  onHide: () => void;
  onSelectProduction: (key: string) => void;
  onPurchase?: (key: string, item: ProductionItem) => void;
  /** The owning civilization (must expose `technologies` as an array of tech ids). */
  currentPlayer?: { technologies?: Array<string | Set<string>> | Set<string> } | null;
  /** Player's current gold balance. */
  playerGold?: number;
  /** Whether the city already purchased something this turn. */
  purchasedThisTurn?: boolean;
  /** Buildings the city ALREADY owns — hidden from the Buildings tab. */
  cityBuildings?: string[];
}

/** True when the civ has researched every tech in the (possibly single) requirement. */
function hasRequiredTechs(
  civ: { technologies?: Array<string | Set<string>> | Set<string> } | null | undefined,
  requirement: string | string[] | null | undefined,
): boolean {
  if (!requirement) return true; // No tech required
  if (!civ) return true; // Unknown civ → don't block
  const techs = civ.technologies;
  const techSet = new Set<string>();
  if (Array.isArray(techs)) {
    for (const t of techs) {
      if (typeof t === 'string') {
        techSet.add(t);
      } else if (t instanceof Set) {
        for (const inner of t) techSet.add(inner);
      } else {
        techSet.add(String(t));
      }
    }
  } else if (techs instanceof Set) {
    for (const t of techs) techSet.add(String(t));
  }
  const requirements = Array.isArray(requirement) ? requirement : [requirement];
  return requirements.every((tech: string) => techSet.has(tech));
}

const ProductionSelectionModal: React.FC<ProductionSelectionModalProps> = ({
  show,
  onHide,
  onSelectProduction,
  onPurchase,
  currentPlayer,
  playerGold = 0,
  purchasedThisTurn = false,
  cityBuildings = [],
}) => {
  // Buildings are one-per-city in Civ1 — hide the ones the city already owns.
  const ownedBuildings = new Set((cityBuildings ?? []).map((b) => String(b).toLowerCase()));
  const buildableBuildingKeys = Object.keys(BUILDING_PROPS)
    .filter((key) => !ownedBuildings.has(key.toLowerCase()));
  const handleSelect = (key: string) => {
    onSelectProduction(key);
    onHide();
  };

  const handleBuy = (key: string, type: 'unit' | 'building') => {
    if (!onPurchase) return;
    const props = type === 'unit' ? UNIT_PROPS[key] : BUILDING_PROPS[key];
    if (!props) return;
    const item: ProductionItem = {
      type,
      itemType: key,
      name: props.name,
      cost: props.cost,
    };
    onPurchase(key, item);
    onHide();
  };

  const canAfford = (cost: number) => playerGold >= cost;

  return (
    <Modal show={show} onHide={onHide} centered size="lg" dialogClassName="city-details-modal production-selection-modal hex-detail-modal">
      <Modal.Header className="hex-detail-modal-header text-white">
        <Modal.Title>
          Select Production
          {onPurchase && (
            <span className="ms-3 fs-6 fw-normal">
              <i className="bi bi-coin text-warning"></i> {playerGold} Gold
            </span>
          )}
        </Modal.Title>
        <Button variant="outline-light" size="sm" onClick={onHide} className="hex-detail-close-button">
          <i className="bi bi-x-lg"></i>
        </Button>
      </Modal.Header>
      <Modal.Body className="hex-detail-modal-body text-white">
        <Tabs defaultActiveKey="units" id="production-selection-tabs">
          <Tab eventKey="units" title="Units">
            <div className="table-responsive">
              <table className="table table-dark table-striped">
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>Required Technology</th>
                    <th>Stats</th>
                    <th>Cost</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(UNIT_PROPS).map(key => {
                    const unit = UNIT_PROPS[key];
                    const requires = (unit as { requires?: string | string[] }).requires;
                    const canBuild = hasRequiredTechs(currentPlayer, requires);
                    const requiredTech = Array.isArray(requires) ? requires.join(', ') : requires || 'None';
                    const stats = `${unit.attack}/${unit.defense} (${unit.movement} moves)`;
                    const affordable = canAfford(unit.cost);
                    const canBuy = canBuild && affordable && !purchasedThisTurn && !!onPurchase;
                    return (
                      <tr key={key} className={canBuild ? '' : 'text-muted'}>
                        <td>{unit.name}</td>
                        <td>{requiredTech}</td>
                        <td>{stats}</td>
                        <td>{unit.cost} <i className="bi bi-gear"></i></td>
                        <td>
                          <div className="d-flex gap-1">
                            <Button
                              variant="outline-primary"
                              size="sm"
                              disabled={!canBuild}
                              title={canBuild ? '' : `Requires ${requiredTech} technology`}
                              onClick={() => handleSelect(key)}
                            >
                              {canBuild ? 'Select' : `Requires ${requiredTech}`}
                            </Button>
                            {canBuild && (
                              <Button
                                variant="outline-warning"
                                size="sm"
                                disabled={!canBuy}
                                title={
                                  purchasedThisTurn
                                    ? 'Already purchased this turn'
                                    : !affordable
                                      ? `Need ${unit.cost} Gold (have ${playerGold})`
                                      : `Buy now for ${unit.cost} Gold`
                                }
                                onClick={() => handleBuy(key, 'unit')}
                              >
                                {unit.cost}🪙
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Tab>
          <Tab eventKey="buildings" title="Buildings">
            <div className="table-responsive">
              <table className="table table-dark table-striped">
                <thead>
                  <tr>
                    <th>Building</th>
                    <th>Required Technology</th>
                    <th>Effect</th>
                    <th>Cost</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {buildableBuildingKeys.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-muted">
                        All available buildings are already constructed in this city.
                      </td>
                    </tr>
                  )}
                  {buildableBuildingKeys.map(key => {
                    const building = BUILDING_PROPS[key];
                    const requiredTech = (building as { requiredTechnology?: string }).requiredTechnology || null;
                    const canBuild = hasRequiredTechs(currentPlayer, requiredTech);
                    const affordable = canAfford(building.cost);
                    const canBuy = canBuild && affordable && !purchasedThisTurn && !!onPurchase;
                    return (
                      <tr key={key} className={canBuild ? '' : 'text-muted'}>
                        <td>{building.name}</td>
                        <td>{requiredTech || 'None'}</td>
                        <td>{building.description}</td>
                        <td>{building.cost} <i className="bi bi-gear"></i></td>
                        <td>
                          <div className="d-flex gap-1">
                            <Button
                              variant="outline-success"
                              size="sm"
                              disabled={!canBuild}
                              title={canBuild ? '' : `Requires ${requiredTech} technology`}
                              onClick={() => handleSelect(key)}
                            >
                              {canBuild ? 'Select' : `Requires ${requiredTech}`}
                            </Button>
                            {canBuild && (
                              <Button
                                variant="outline-warning"
                                size="sm"
                                disabled={!canBuy}
                                title={
                                  purchasedThisTurn
                                    ? 'Already purchased this turn'
                                    : !affordable
                                      ? `Need ${building.cost} Gold (have ${playerGold})`
                                      : `Buy now for ${building.cost} Gold`
                                }
                                onClick={() => handleBuy(key, 'building')}
                              >
                                🪙{building.cost}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Tab>
        </Tabs>
      </Modal.Body>
    </Modal>
  );
};

export default ProductionSelectionModal;