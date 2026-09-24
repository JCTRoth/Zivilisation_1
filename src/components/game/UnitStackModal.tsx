import React, { useEffect, useState } from 'react';
import { Modal, Button, Badge, ProgressBar } from 'react-bootstrap';
import { UNIT_PROPERTIES } from '@/data/UnitConstants';
import { unitStatus } from '@/utils/UnitStatus';
import type { City, Unit } from '../../../types/game';

/**
 * Unit stack modal — shown when the player clicks a city or a field holding
 * several of their units. Lists every unit with its status and health and lets
 * the player either
 *   - activate ONE unit (click its row / "Select"), or
 *   - tick 0..N units and confirm a group move: the next map click orders
 *     every selected unit that still has movement points to that destination.
 */
export interface UnitStackModalProps {
  show: boolean;
  col: number;
  row: number;
  units: Unit[];
  city?: City | null;
  onSelectUnit: (unitId: string) => void;
  onConfirmGroup: (unitIds: string[]) => void;
  onShowCity?: (cityId: string) => void;
  onClose: () => void;
}

const UnitStackModal: React.FC<UnitStackModalProps> = ({
  show,
  col,
  row,
  units,
  city,
  onSelectUnit,
  onConfirmGroup,
  onShowCity,
  onClose,
}) => {
  const [checked, setChecked] = useState<string[]>([]);

  // Fresh selection whenever the modal opens for a tile.
  useEffect(() => {
    if (show) setChecked([]);
  }, [show, col, row]);

  const movable = units.filter((u) => (u.movesRemaining || 0) > 0 && !u.isDefeated);
  const checkedMovable = checked.filter((id) => movable.some((u) => u.id === id));

  const toggle = (id: string) => {
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <Modal show={show} onHide={onClose} centered size="lg" dialogClassName="unit-stack-modal">
      <Modal.Header closeButton className="text-white" style={{ background: '#1b2430' }}>
        <Modal.Title className="fs-5">
          <i className="bi bi-stack"></i> Units at ({col}, {row})
          {city ? ` — ${city.name}` : ''}
          <span className="ms-2 badge bg-secondary">{units.length}</span>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ background: '#12181f', color: '#e9ecef' }}>
        <p className="small text-muted mb-3">
          Click a unit to activate it, or tick several and then click the map destination to move
          them together (units without movement points stay put). Shift-click units on the map to
          add them to the group from other tiles.
        </p>

        <div className="d-flex align-items-center gap-2 mb-3">
          <Button
            size="sm"
            variant="outline-light"
            disabled={movable.length === 0}
            onClick={() => setChecked(movable.map((u) => u.id))}
          >
            <i className="bi bi-check2-square"></i> All movable ({movable.length})
          </Button>
          <Button
            size="sm"
            variant="outline-light"
            disabled={checked.length === 0}
            onClick={() => setChecked([])}
          >
            <i className="bi bi-x-square"></i> Clear
          </Button>
          <span className="small text-muted ms-auto">
            {checkedMovable.length} selected
          </span>
        </div>

        <div className="list-group">
          {units.map((unit) => {
            const props = UNIT_PROPERTIES[unit.type];
            const status = unitStatus(unit);
            const health = Math.max(0, Math.min(100, unit.health ?? 100));
            const hpText = typeof unit.hitPoints === 'number' && typeof unit.maxHitPoints === 'number'
              ? `${unit.hitPoints}/${unit.maxHitPoints} HP`
              : `${Math.round(health)}% HP`;
            const isChecked = checked.includes(unit.id);
            const canMove = (unit.movesRemaining || 0) > 0 && !unit.isDefeated;
            return (
              <div
                key={unit.id}
                className={`list-group-item d-flex align-items-center gap-3 ${isChecked ? 'active' : ''}`}
                style={{ background: isChecked ? '#2b3a4a' : '#1b2430', color: '#e9ecef', cursor: 'pointer' }}
                onClick={() => onSelectUnit(unit.id)}
                title="Activate this unit"
              >
                <input
                  type="checkbox"
                  className="form-check-input m-0"
                  checked={isChecked}
                  disabled={!canMove}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggle(unit.id)}
                  aria-label={`Select ${unit.type} for group move`}
                />

                <span style={{ fontSize: '1.5rem', width: 32, textAlign: 'center' }}>
                  {unit.icon || props?.icon || '⚔️'}
                </span>

                <div className="flex-grow-1 min-width-0">
                  <div className="d-flex align-items-center gap-2">
                    <strong>{props?.name ?? unit.type}</strong>
                    {unit.isVeteran && <Badge bg="warning" text="dark">★ Veteran</Badge>}
                    <Badge bg={status.variant}>{status.label}</Badge>
                  </div>
                  <div className="d-flex align-items-center gap-2 mt-1">
                    <ProgressBar
                      now={health}
                      variant={health > 60 ? 'success' : health > 30 ? 'warning' : 'danger'}
                      style={{ height: 6, flex: 1, maxWidth: 220 }}
                    />
                    <span className="small text-muted">{hpText}</span>
                  </div>
                </div>

                <div className="d-flex align-items-center gap-2">
                  <span className="small text-muted">
                    A{props?.attack ?? 0}/D{props?.defense ?? 0}
                  </span>
                  <Button
                    size="sm"
                    variant="outline-light"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectUnit(unit.id);
                    }}
                  >
                    Select
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Modal.Body>
      <Modal.Footer style={{ background: '#1b2430' }}>
        {city && onShowCity && (
          <Button
            variant="outline-info"
            onClick={() => {
              onShowCity(city.id);
              onClose();
            }}
          >
            <i className="bi bi-building"></i> City details
          </Button>
        )}
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="primary"
          disabled={checkedMovable.length === 0}
          onClick={() => onConfirmGroup(checkedMovable)}
          title={
            checkedMovable.length === 0
              ? 'Tick at least one unit with movement points'
              : 'Click the map destination to move the selected units'
          }
        >
          Move selected ({checkedMovable.length})
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default UnitStackModal;
