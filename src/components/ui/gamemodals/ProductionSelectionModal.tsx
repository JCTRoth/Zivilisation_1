import React from 'react';
import { Modal, Button, Tab, Tabs } from 'react-bootstrap';
import { UNIT_PROPS, BUILDING_PROPS } from '../../../utils/Constants';

interface ProductionSelectionModalProps {
  show: boolean;
  onHide: () => void;
  onSelectProduction: (key: string) => void;
}

const ProductionSelectionModal: React.FC<ProductionSelectionModalProps> = ({
  show,
  onHide,
  onSelectProduction
}) => {
  const handleSelect = (key: string) => {
    onSelectProduction(key);
    onHide();
  };

  return (
    <Modal show={show} onHide={onHide} centered size="lg" dialogClassName="city-details-modal production-selection-modal hex-detail-modal">
      <Modal.Header className="hex-detail-modal-header text-white">
        <Modal.Title>Select Production</Modal.Title>
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
                    const requires = (unit as any).requires;
                    const requiredTech = Array.isArray(requires) ? requires.join(', ') : requires || 'None';
                    const stats = `${unit.attack}/${unit.defense} (${unit.movement} moves)`;
                    return (
                      <tr key={key}>
                        <td>{unit.name}</td>
                        <td>{requiredTech}</td>
                        <td>{stats}</td>
                        <td>{unit.cost}</td>
                        <td>
                          <Button
                            variant="outline-primary"
                            size="sm"
                            onClick={() => handleSelect(key)}
                          >
                            Select
                          </Button>
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
                  {Object.keys(BUILDING_PROPS).map(key => (
                    <tr key={key}>
                      <td>{BUILDING_PROPS[key].name}</td>
                      <td>{BUILDING_PROPS[key].requiredTechnology || 'None'}</td>
                      <td>{BUILDING_PROPS[key].description}</td>
                      <td>{BUILDING_PROPS[key].cost}</td>
                      <td>
                        <Button
                          variant="outline-success"
                          size="sm"
                          onClick={() => handleSelect(key)}
                        >
                          Select
                        </Button>
                      </td>
                    </tr>
                  ))}
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