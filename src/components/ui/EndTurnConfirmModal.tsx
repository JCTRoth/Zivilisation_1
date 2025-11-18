import React, { useState } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';
import { useGameStore } from '../../stores/GameStore';
import '../../styles/endTurnConfirmModal.css';


interface EndTurnConfirmModalProps {
  show: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  currentTurn: number;
  currentYear: number;
  isAutomatic?: boolean;
}

const EndTurnConfirmModal: React.FC<EndTurnConfirmModalProps> = ({
  show,
  onConfirm,
  onCancel,
  currentTurn,
  currentYear,
  isAutomatic = false
}) => {
  const settings = useGameStore(state => state.settings);
  const actions = useGameStore(state => state.actions);
  const [skipNextTime, setSkipNextTime] = useState(settings.skipEndTurnConfirmation);

  const handleConfirm = () => {
    console.log('EndTurnConfirmModal: Confirmed end turn');
    // Update the setting if the checkbox was checked
    if (skipNextTime !== settings.skipEndTurnConfirmation) {
      actions.updateSettings({ skipEndTurnConfirmation: skipNextTime });
    }
    onConfirm();
  };

  const handleCancel = () => {
    console.log('EndTurnConfirmModal: Cancelled end turn');
    onCancel();
  };

  return (
    <Modal show={show} onHide={handleCancel} centered>
      <Modal.Header closeButton className="end-turn-modal-header">
        <Modal.Title>
          <i className="bi bi-skip-end-fill me-2"></i>
          End Turn?
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="end-turn-modal-body">
        <div className="text-center mb-3">
          <h5>{isAutomatic ? 'All Your Units Have Moved!' : 'Are you ready to end your turn?'}</h5>
          <p className="text-muted mb-1">
            <strong>Turn {currentTurn}</strong> | <strong>{currentYear} BC</strong>
          </p>
        </div>
        
        <div className="alert alert-info mb-0">
          <i className="bi bi-info-circle me-2"></i>
          {isAutomatic 
            ? 'All your units have used their movement points. You can end your turn now, or continue planning your next moves.'
            : 'This will allow other civilizations to take their turns.'
          }
        </div>
        
        <Form.Check
          type="checkbox"
          id="skip-end-turn-confirmation"
          label="Don't show this confirmation next time"
          checked={skipNextTime}
          onChange={(e) => setSkipNextTime(e.target.checked)}
          className="mt-2"
        />
      </Modal.Body>
      <Modal.Footer className="end-turn-modal-footer">
        <Button variant="secondary" onClick={handleCancel}>
          <i className="bi bi-x-circle me-2"></i>
          Cancel
        </Button>
        <Button variant="success" onClick={handleConfirm}>
          <i className="bi bi-check-circle me-2"></i>
          End Turn
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default EndTurnConfirmModal;
