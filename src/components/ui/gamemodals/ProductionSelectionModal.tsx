import React, { useMemo, useState } from 'react';
import { Button, Tab, Tabs } from 'react-bootstrap';
import { UNIT_PROPS, BUILDING_PROPS } from '../../../utils/Constants';
import type { ProductionItem } from '../../../../types/game';
import { useGameStore } from '@/stores/GameStore';
import { GameUtils } from '@/utils/GameUtils';
import {
  WONDERS,
  WONDER_GROUPS,
  computeWonderStatuses,
  findWonderBuilders,
  findWonderOwner,
  getWonder,
  isWonderObsolete,
  wonderGroupMembers,
  type WonderStatus,
} from '@/data/WonderData';
import { WonderArtwork } from './WonderArtwork';
import GameModal from './ModalShell';
import '@/styles/cityModal.css';
import '@/styles/wonders.css';

/** Badge class + label for a wonder status (same colours as the overview). */
const WONDER_STATUS_LABEL: Record<WonderStatus, string> = {
  owned: 'Yours',
  building: 'You are building',
  contested: 'Race!',
  rival: 'Rival',
  locked: 'Locked',
  available: 'Available',
};

interface ProductionSelectionModalProps {
  show: boolean;
  onHide: () => void;
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
  /** City's production per turn — used to estimate build time (shields/turn). */
  productionPerTurn?: number;
  /** City the orders are for — names the hero and every hint line. */
  cityName?: string;
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
  onAddToQueue,
  onPurchase,
  currentPlayer,
  playerGold = 0,
  purchasedThisTurn = false,
  cityBuildings = [],
  productionPerTurn = 0,
  cityName,
}) => {
  // Buildings are one-per-city in Civ1 — hide the ones the city already owns.
  const ownedBuildings = new Set((cityBuildings ?? []).map((b) => String(b).toLowerCase()));
  const buildableBuildingKeys = Object.keys(BUILDING_PROPS)
    .filter((key) => !ownedBuildings.has(key.toLowerCase()));

  const [unitSort, setUnitSort] = useState<SortState>({ column: 'cost', dir: 'asc' });
  const [buildingSort, setBuildingSort] = useState<SortState>({ column: 'cost', dir: 'asc' });
  const [showUnavailable, setShowUnavailable] = useState(false);

  // ── Wonders tab data: world state from the store, statuses from the pure
  //    classifier (the exact function the overview screen and tests use). ──
  const storeCities = useGameStore((s) => s.cities);
  const storeCivilizations = useGameStore((s) => s.civilizations);
  const activePlayer = useGameStore((s) => s.gameState.activePlayer);
  const gameState = useGameStore((s) => s.gameState);
  const wonderStatuses = useMemo(
    () => computeWonderStatuses(storeCities, storeCivilizations, activePlayer),
    [storeCities, storeCivilizations, activePlayer],
  );
  const [selectedWonderId, setSelectedWonderId] = useState<string | null>(null);
  // Collapsed wonder-group ids in the production table (empty = all expanded).
  const [collapsedProdGroups, setCollapsedProdGroups] = useState<ReadonlySet<string>>(new Set());
  const toggleProdGroup = (groupId: string) =>
    setCollapsedProdGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  // Controlled so the wonders detail artwork is only fetched while its tab is
  // actually the visible one (Bootstrap keeps inactive tab panes mounted).
  const [activeTab, setActiveTab] = useState('units');

  interface WonderRow {
    id: string;
    name: string;
    cost: number;
    requiredTechnology: string;
    status: WonderStatus;
    hasTech: boolean;
    obsolete: boolean;
    completed: boolean;
    inThisCity: boolean;
    canStart: boolean;
    ownerCivId: number | null;
    builderCivIds: number[];
    /** A completed group member retires the sisters (space stations). */
    groupClosed: boolean;
  }

  const wonderRows: WonderRow[] = useMemo(() => {
    return WONDERS.map((w) => {
      const ownerCivId = findWonderOwner(w.id, storeCities);
      const hasTech = hasRequiredTechs(currentPlayer, w.requiredTechnology);
      const obsolete = isWonderObsolete(w.id, storeCivilizations);
      const inThisCity = ownedBuildings.has(w.id.toLowerCase());
      // A completed group member closes the whole group for everybody.
      const groupClosed = wonderGroupMembers(w.id).some(
        (m) => findWonderOwner(m, storeCities) !== null,
      );
      // Startable = nobody has finished it yet AND its group is open AND the
      // tech is known AND it is not obsolete AND this city does not hold it.
      // Races are fine — several cities may work on the same wonder (first to
      // finish wins).
      const canStart = ownerCivId === null && !groupClosed && hasTech && !obsolete && !inThisCity;
      return {
        id: w.id,
        name: w.name,
        cost: w.cost,
        requiredTechnology: w.requiredTechnology,
        status: wonderStatuses[w.id] ?? 'available',
        hasTech,
        obsolete,
        completed: ownerCivId !== null,
        inThisCity,
        canStart,
        ownerCivId,
        builderCivIds: findWonderBuilders(w.id, storeCities),
        groupClosed,
      };
    });
    // ownedBuildings is rebuilt every render; depend on the source list instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wonderStatuses, storeCities, storeCivilizations, currentPlayer, cityBuildings]);

  const selectedWonder = selectedWonderId ? getWonder(selectedWonderId) : undefined;
  const selectedWonderRow = selectedWonderId
    ? wonderRows.find((r) => r.id === selectedWonderId)
    : undefined;

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

  const handleBuy = (key: string, type: 'unit' | 'building' | 'wonder') => {
    if (!onPurchase) return;
    const props = type === 'unit' ? UNIT_PROPS[key] : type === 'wonder' ? getWonder(key) : BUILDING_PROPS[key];
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
  const getTurnsText = (cost: number): string => {
    if (cost <= 0 || productionPerTurn <= 0) return '—';
    return `~${Math.ceil(cost / productionPerTurn)} turns`;
  };

  /** One wonder table row — also reused for members of an expandable group. */
  const renderWonderRow = (row: WonderRow) => {
    const affordable = canAfford('wonder', row.cost);
    const canBuy = row.canStart && affordable && !purchasedThisTurn && !!onPurchase;
    const purchaseCost = getPurchaseCost('wonder', row.cost);
    const blockedReason = row.completed
      ? 'Already completed'
      : row.inThisCity
        ? 'Already in this city'
        : row.groupClosed
          ? 'Group completed'
          : row.obsolete
            ? 'Obsolete'
            : !row.hasTech
              ? 'Technology missing'
              : '';
    return (
      <tr
        key={row.id}
        className={`wonder-row-selectable ${selectedWonderId === row.id ? 'selected' : ''} ${row.canStart ? '' : 'text-muted'}`}
        onClick={() => setSelectedWonderId(row.id)}
        title={`Select ${row.name} for details`}
      >
        <td>
          {getWonder(row.id)?.icon} {row.name}
          {row.obsolete && <span className="wonder-obsolete-tag ms-2">⚠ Obsolete</span>}
        </td>
        <td>
          <span className={`wonder-status wonder-status--${row.status}`}>
            {WONDER_STATUS_LABEL[row.status]}
          </span>
        </td>
        <td>{formatTechName(row.requiredTechnology)}</td>
        <td><span className="text-info">{getTurnsText(row.cost)}</span></td>
        <td>
          <div className="d-flex gap-1">
            {row.canStart && onAddToQueue && (
              <Button
                variant="outline-success"
                size="sm"
                title="Add to build queue — races allowed, first to finish wins"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedWonderId(row.id);
                  handleAddToQueue(row.id);
                }}
              >
                + Add
              </Button>
            )}
            {row.canStart && (
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
                onClick={(e) => {
                  e.stopPropagation();
                  handleBuy(row.id, 'wonder');
                }}
              >
                🪙{purchaseCost}
              </Button>
            )}
            {!row.canStart && blockedReason && (
              <span className="small text-white-50">{blockedReason}</span>
            )}
          </div>
        </td>
      </tr>
    );
  };

  /**
   * Wonder rows with mutually exclusive groups folded into one expandable
   * table block at the first member's position. Members keep their own rows
   * (status, tech, shields, action) — the block is only an optical grouping.
   */
  const renderWonderRows = () => {
    const seen = new Set<string>();
    const out: React.ReactNode[] = [];
    for (const row of wonderRows) {
      const groupId = getWonder(row.id)?.groupId;
      if (!groupId) {
        out.push(renderWonderRow(row));
        continue;
      }
      if (seen.has(groupId)) continue;
      seen.add(groupId);
      const group = WONDER_GROUPS[groupId];
      const members = wonderRows.filter((r) => getWonder(r.id)?.groupId === groupId);
      const collapsed = collapsedProdGroups.has(groupId);
      out.push(
        <tr key={`group-${groupId}`} className="wonder-group-row">
          <td colSpan={5}>
            <button
              type="button"
              className="wonder-group__header wonder-group__header--slim"
              onClick={() => toggleProdGroup(groupId)}
              aria-expanded={!collapsed}
              title={collapsed ? `Expand ${group?.name ?? groupId}` : `Collapse ${group?.name ?? groupId}`}
            >
              <span className="wonder-group__icons" aria-hidden="true">
                {members.map((m) => (
                  <span key={m.id}>{getWonder(m.id)?.icon}</span>
                ))}
              </span>
              <span className="wonder-group__name">{group?.name ?? groupId}</span>
              <span className="wonder-group__blurb">{group?.blurb ?? ''}</span>
              <span className="wonder-group__count" title={`${members.length} wonders`}>
                {members.length}
              </span>
              <span className="wonder-group__chevron" aria-hidden="true">
                {collapsed ? '▶' : '▼'}
              </span>
            </button>
          </td>
        </tr>,
      );
      if (!collapsed) for (const m of members) out.push(renderWonderRow(m));
    }
    return out;
  };

  // Rows actually offered this turn (tech-gated unless "Show unavailable").
  const unitRows = sortItems(
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
  );
  const buildingRows = sortItems(
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
  );

  const subject = cityName ?? 'your city';
  const eyebrow = `Production · Turn ${gameState.currentTurn ?? 1} · ${GameUtils.formatYear(
    gameState.currentYear ?? -4000,
  )}`;

  return (
    <GameModal
      show={show}
      onClose={onHide}
      tone="info"
      size="lg"
      dialogClassName="city-details-modal production-selection-modal hex-detail-modal"
      icon="🏗️"
      artLabel="the drawing board"
      eyebrow={eyebrow}
      title={cityName ? `What shall ${cityName} build next?` : 'What shall your city build next?'}
      lede={
        <>
          Your people are ready to work — give them their next order.
          <span className="gm-chip gm-chip--accent city-hero-gold">
            <i className="bi bi-coin" aria-hidden="true"></i> {playerGold} Gold
          </span>
        </>
      }
      actions={
        <>
          <div className="form-check form-switch mb-0 city-avail-toggle">
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
          <span className="gm-actions-spacer" />
          <button type="button" className="touch-btn touch-btn--ghost" onClick={onHide}>
            Done
          </button>
        </>
      }
    >
      <div className="city-tabstrip">
        <Tabs
          activeKey={activeTab}
          onSelect={(k) => setActiveTab(k ?? 'units')}
          id="production-selection-tabs"
          className="mb-0"
        >
          <Tab eventKey="units" title="Units">
            <p className="gm-prose">
              Your people can only field what their tools allow — greyed rows wait on a
              technology your scribes have yet to find.
            </p>
            <section className="gm-section">
              <div className="gm-section-title">Units your people can raise</div>
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
                        Shields{sortIndicator('cost', unitSort)}
                      </th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unitRows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center text-muted">
                          Nothing your workshops can build yet — switch on “Show unavailable”
                          below to see what the future holds.
                        </td>
                      </tr>
                    )}
                    {unitRows.map(({ key, name, cost, canBuild, requires, unit }) => {
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
                          <td>
                            <span className="text-info">{getTurnsText(cost)}</span>
                          </td>
                          <td>
                            <div className="d-flex gap-1">
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
            </section>
          </Tab>

          <Tab eventKey="buildings" title="Buildings">
            <p className="gm-prose">
              One of each per city. What {subject} already owns is left off the list; the rest
              waits on the research of your scribes.
            </p>
            <section className="gm-section">
              <div className="gm-section-title">Buildings for the city</div>
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
                        Shields{sortIndicator('cost', buildingSort)}
                      </th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buildingRows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center text-muted">
                          {buildableBuildingKeys.length === 0
                            ? 'All available buildings are already constructed in this city.'
                            : 'Nothing your knowledge allows yet — switch on “Show unavailable” below to see what is coming.'}
                        </td>
                      </tr>
                    )}
                    {buildingRows.map(({ key, name, cost, canBuild, requiredTech, building }) => {
                      const purchaseCost = getPurchaseCost('building', cost);
                      const affordable = canAfford('building', cost);
                      const canBuy = canBuild && affordable && !purchasedThisTurn && !!onPurchase;
                      return (
                        <tr key={key} className={canBuild ? '' : 'text-muted'}>
                          <td>{name}</td>
                          <td>{formatTechName(requiredTech)}</td>
                          <td>{building.description}</td>
                          <td>
                            <span className="text-info">{getTurnsText(cost)}</span>
                          </td>
                          <td>
                            <div className="d-flex gap-1">
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
            </section>
          </Tab>

          <Tab eventKey="wonders" title="Wonders">
            <p className="gm-prose">
              Only one people may finish each wonder. Several cities can race the same one —
              the first to lay the last stone owns it for the rest of time.
            </p>
            <section className="gm-section">
              <div className="gm-section-title">Wonders of the world</div>
              <div className="production-wonders-layout">
                <div className="production-wonders-layout__list table-responsive">
                  <table className="table table-dark table-striped mb-0">
                    <thead>
                      <tr>
                        <th>Wonder</th>
                        <th>Status</th>
                        <th>Required Technology</th>
                        <th>Shields</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {renderWonderRows()}
                    </tbody>
                  </table>
                </div>

                {/* Side panel (spec E): full details for the selected wonder. */}
                <aside className="production-wonders-layout__detail">
                  {!selectedWonder ? (
                    <div className="text-white-50 small">
                      Choose a wonder from the list to read what it gives, when it falls
                      obsolete, and who is racing you to it.
                    </div>
                  ) : (
                    <>
                      <WonderArtwork wonder={selectedWonder} active={show && activeTab === 'wonders'} />
                      <h6>{selectedWonder.name}</h6>
                      {selectedWonderRow && (
                        <span className={`wonder-status wonder-status--${selectedWonderRow.status}`}>
                          {WONDER_STATUS_LABEL[selectedWonderRow.status]}
                        </span>
                      )}
                      <div className="wonder-detail-effect mt-2">{selectedWonder.effectText}</div>
                      <div className="wonder-detail-meta">
                        🛡 {selectedWonder.cost} shields · 🔬 {formatTechName(selectedWonder.requiredTechnology)} · ⏳{' '}
                        {selectedWonder.obsoleteBy
                          ? `Obsolete: ${formatTechName(selectedWonder.obsoleteBy)}`
                          : 'Never obsolete'}
                        {selectedWonderRow?.obsolete && (
                          <span className="wonder-obsolete-tag ms-2">— effect currently inactive</span>
                        )}
                      </div>
                      <div className="wonder-detail-flavor">{selectedWonder.flavor}</div>
                    </>
                  )}
                </aside>
              </div>
            </section>
          </Tab>
        </Tabs>
      </div>
    </GameModal>
  );
};

export default ProductionSelectionModal;
