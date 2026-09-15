import React, { useState } from 'react';
import { Modal, Button, Tab, Tabs } from 'react-bootstrap';
import { UNIT_PROPS, BUILDING_PROPS } from '../../../utils/Constants';
import type { ProductionItem } from '../../../../types/game';

interface ProductionSelectionModalProps {
  show: boolean;
  onHide: () => void;
  onSelectProduction: (key: string) => void;
  /** Add item directly to the build queue (bypasses current production). */
  onAddToQueue?: (key: string) => void;
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

/** Convert snake_case tech ids to human-readable names: bronze_working → Bronze Working */
function formatTechName(id: string | null | undefined): string {
  if (!id) return 'None';
  return id
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

type SortDir = 'asc' | 'desc' | null;

interface SortState {
  column: 'name' | 'cost' | null;
  dir: SortDir;
}

/** Sort items: buildable first (when no sort active), then by chosen column. */
function sortItems<T extends { key: string; name: string; cost: number; canBuild: boolean }>(
  items: T[],
  sort: SortState,
): T[] {
  const sorted = [...items];
  sorted.sort((a, b) => {
    // When no sort is active, buildable items first
    if (!sort.column) {
      if (a.canBuild !== b.canBuild) return a.canBuild ? -1 : 1;
      return a.name.localeCompare(b.name);
    }
    // Sort by chosen column
    const cmp = sort.column === 'cost' ? a.cost - b.cost : a.name.localeCompare(b.name);
    return sort.dir === 'desc' ? -cmp : cmp;
  });
  return sorted;
}

const ProductionSelectionModal: React.FC<ProductionSelectionModalProps> = ({
  show,
  onHide,
  onSelectProduction,
  onAddToQueue,
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

  const [unitSort, setUnitSort] = useState<SortState>({ column: 'cost', dir: 'asc' });
  const [buildingSort, setBuildingSort] = useState<SortState>({ column: 'cost', dir: 'asc' });
  const [showUnavailable, setShowUnavailable] = useState(false);

  const toggleUnitSort = (col: 'name' | 'cost') => {
    setUnitSort((prev) =>
      prev.column === col
        ? { column: col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { column: col, dir: 'asc' }
    );
  };
  const toggleBuildingSort = (col: 'name' | 'cost') => {
    setBuildingSort((prev) =>
      prev.column === col
        ? { column: col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { column: col, dir: 'asc' }
    );
  };

  const sortIndicator = (col: 'name' | 'cost', state: SortState) => {
    if (state.column !== col) return null;
    return <span className="ms-1">{state.dir === 'asc' ? '▲' : '▼'}</span>;
  };
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

  const handleAddToQueue = (key: string) => {
    if (!onAddToQueue) return;
    onAddToQueue(key);
    onHide();
  };

  const getPurchaseCost = (type: string, cost: number): number => type === 'unit' ? cost * 2 : cost;
  const canAfford = (type: string, cost: number): boolean => playerGold >= getPurchaseCost(type, cost);

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
        <div className="d-flex justify-content-end mb-2">
          <div className="form-check form-switch mb-0">
            <input
              className="form-check-input"
              type="checkbox"
              id="show-unavailable-toggle"
              checked={showUnavailable}
              onChange={() => setShowUnavailable(!showUnavailable)}
            />
            <label className="form-check-label small text-muted" htmlFor="show-unavailable-toggle">
              Show unavailable
            </label>
          </div>
        </div>
        <Tabs defaultActiveKey="units" id="production-selection-tabs">
          <Tab eventKey="units" title="Units">
            <div className="table-responsive">
              <table className="table table-dark table-striped">
                <thead>
                  <tr>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleUnitSort('name')}>
                      Unit{sortIndicator('name', unitSort)}
                    </th>
                    <th>Required Technology</th>
                    <th>Stats</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleUnitSort('cost')}>
                      Cost{sortIndicator('cost', unitSort)}
                    </th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortItems(
                    Object.keys(UNIT_PROPS)
                      .map((key) => {
                        const unit = UNIT_PROPS[key];
                        const requires = (unit as { requires?: string | string[] }).requires;
                        return {
                          key,
                          name: unit.name,
                          cost: unit.cost,
                          canBuild: hasRequiredTechs(currentPlayer, requires),
                          requires,
                          unit,
                        };
                      })
                      .filter((item) => showUnavailable || item.canBuild),
                    unitSort,
                  ).map(({ key, name, cost, canBuild, requires, unit }) => {
                    const requiredTech = Array.isArray(requires) ? requires.join(', ') : requires || 'None';
                    const stats = `${unit.attack}/${unit.defense} (${unit.movement} moves)`;
                    const purchaseCost = getPurchaseCost('unit', cost);
                    const affordable = canAfford('unit', cost);
                    const canBuy = canBuild && affordable && !purchasedThisTurn && !!onPurchase;
                    return (
                      <tr key={key} className={canBuild ? '' : 'text-muted'}>
                        <td>{name}</td>
                        <td>{formatTechName(requiredTech)}</td>
                        <td>{stats}</td>
                        <td>{purchaseCost} <i className="bi bi-coin"></i></td>
                        <td>
                          <div className="d-flex gap-1">
                            <Button
                              variant="outline-primary"
                              size="sm"
                              disabled={!canBuild}
                              title={canBuild ? 'Set as current production' : `Requires ${formatTechName(requiredTech)}`}
                              onClick={() => handleSelect(key)}
                            >
                              {canBuild ? 'Select' : `Requires ${formatTechName(requiredTech)}`}
                            </Button>
                            {canBuild && onAddToQueue && (
                              <Button
                                variant="outline-success"
                                size="sm"
                                title="Add to build queue"
                                onClick={() => handleAddToQueue(key)}
                              >
                                + Add
                              </Button>
                            )}
                            {canBuild && (
                              <Button
                                variant="outline-warning"
                                size="sm"
                                disabled={!canBuy}
                                title={
                                  purchasedThisTurn
                                    ? 'Already purchased this turn'
                                    : !affordable
                                      ? `Need ${purchaseCost} Gold (have ${playerGold})`
                                      : `Buy now for ${purchaseCost} Gold`
                                }
                                onClick={() => handleBuy(key, 'unit')}
                              >
                                {purchaseCost}🪙
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
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleBuildingSort('name')}>
                      Building{sortIndicator('name', buildingSort)}
                    </th>
                    <th>Required Technology</th>
                    <th>Effect</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleBuildingSort('cost')}>
                      Cost{sortIndicator('cost', buildingSort)}
                    </th>
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
                  {sortItems(
                    buildableBuildingKeys
                      .map((key) => {
                        const building = BUILDING_PROPS[key];
                        const requiredTech = (building as { requiredTechnology?: string }).requiredTechnology || null;
                        return {
                          key,
                          name: building.name,
                          cost: building.cost,
                          canBuild: hasRequiredTechs(currentPlayer, requiredTech),
                          requiredTech,
                          building,
                        };
                      })
                      .filter((item) => showUnavailable || item.canBuild),
                    buildingSort,
                  ).map(({ key, name, cost, canBuild, requiredTech, building }) => {
                    const purchaseCost = getPurchaseCost('building', cost);
                    const affordable = canAfford('building', cost);
                    const canBuy = canBuild && affordable && !purchasedThisTurn && !!onPurchase;
                    return (
                      <tr key={key} className={canBuild ? '' : 'text-muted'}>
                        <td>{name}</td>
                        <td>{formatTechName(requiredTech)}</td>
                        <td>{building.description}</td>
                        <td>{purchaseCost} <i className="bi bi-coin"></i></td>
                        <td>
                          <div className="d-flex gap-1">
                            <Button
                              variant="outline-success"
                              size="sm"
                              disabled={!canBuild}
                              title={canBuild ? 'Set as current production' : `Requires ${formatTechName(requiredTech)}`}
                              onClick={() => handleSelect(key)}
                            >
                              {canBuild ? 'Select' : `Requires ${formatTechName(requiredTech)}`}
                            </Button>
                            {canBuild && onAddToQueue && (
                              <Button
                                variant="outline-info"
                                size="sm"
                                title="Add to build queue"
                                onClick={() => handleAddToQueue(key)}
                              >
                                + Add
                              </Button>
                            )}
                            {canBuild && (
                              <Button
                                variant="outline-warning"
                                size="sm"
                                disabled={!canBuy}
                                title={
                                  purchasedThisTurn
                                    ? 'Already purchased this turn'
                                    : !affordable
                                      ? `Need ${purchaseCost} Gold (have ${playerGold})`
                                      : `Buy now for ${purchaseCost} Gold`
                                }
                                onClick={() => handleBuy(key, 'building')}
                              >
                                🪙{purchaseCost}
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