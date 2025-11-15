import React from 'react';
import { Modal, Button } from 'react-bootstrap';
import { HexDetailModalLogic } from './HexDetailModalLogic';

interface HexDetailModalProps {
  show: boolean;
  onHide: () => void;
  selectedHex: any;
  map: any;
  units: any[];
  cities: any[];
}

const HexDetailModal: React.FC<HexDetailModalProps> = ({
  show,
  onHide,
  selectedHex,
  map,
  units,
  cities
}) => {
  if (!selectedHex) return null;

  const logic = new HexDetailModalLogic(selectedHex, map, units, cities);
  const tile = logic.getTile();
  const unitsAtHex = logic.getUnitsAtHex();
  const cityAtHex = logic.getCityAtHex();

  return (
    <Modal show={show} onHide={onHide} centered size="lg" dialogClassName="hex-detail-modal">
      <Modal.Header className="bg-dark text-white hex-detail-modal-header">
        <Modal.Title>
          <i className="bi bi-hexagon"></i> Hex Details ({selectedHex.col}, {selectedHex.row})
        </Modal.Title>
        <Button variant="outline-light" size="sm" onClick={onHide}>
          <i className="bi bi-x-lg"></i>
        </Button>
      </Modal.Header>
      <Modal.Body className="bg-dark text-white hex-detail-modal-body">
        <div className="hex-detail-content">
          <div className="mb-3">
            <strong>Terrain:</strong> {logic.getTileType()}
          </div>
          <div className="mb-3">
            <strong>Resource:</strong> {logic.getTileResource()}
          </div>
          <div className="mb-3">
            <strong>Improvement:</strong> {logic.getTileImprovement()}
          </div>
          {cityAtHex && (
            <div className="mb-3">
              <strong>City:</strong> {cityAtHex.name} (Population: {cityAtHex.population})
            </div>
          )}
          {unitsAtHex.length > 0 && (
            <div className="mb-3">
              <strong>Units:</strong>
              <ul>
                {unitsAtHex.map((unit, i) => (
                  <li key={i}>{unit.name} ({unit.type})</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal.Body>
    </Modal>
  );
};

export default HexDetailModal;