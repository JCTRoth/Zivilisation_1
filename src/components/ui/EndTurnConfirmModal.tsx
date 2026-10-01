import React, { useState } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';
import { useGameStore } from '@/stores/GameStore';
import '../../styles/endTurnConfirmModal.css';
import {GameUtils} from "@/utils/GameUtils";


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

  // The checkbox is a pure interface preference ("don't show this confirmation
  // next time") and must not touch auto-end turn. It used to flip `autoEndTurn`
  // on confirm and off on cancel, which meant ticking the box and pressing
  // "End Turn" silently switched Auto Turn Ending on — after that the engine
  // ends turns on its own, which the checkbox never promised. Cancelling had the
  // mirror problem: it switched OFF an auto-end setting the player had chosen
  // deliberately elsewhere. The preference is persisted by the checkbox's own
  // onChange, so both buttons only report their result.
  const handleConfirm = () => {
    console.log('EndTurnConfirmModal: Confirmed end turn');
    onConfirm();
  };

  const handleCancel = () => {
    console.log('EndTurnConfirmModal: Cancelled end turn');
    onCancel();
  };

  return (
    <Modal show={show} onHide={handleCancel} centered fullscreen="lg-down" dialogClassName="end-turn-modal">
      <Modal.Header closeButton className="end-turn-modal-header">
        <Modal.Title className="end-turn-modal-title">
          <i className="bi bi-skip-end-fill me-2" aria-hidden="true"></i>
          End Turn?
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="end-turn-modal-body">
        <div className="text-center mb-3">
          <h5 className="end-turn-modal-heading">{isAutomatic ? 'All Your Units Have Moved!' : 'Are you ready to end your turn?'}</h5>
          <p className="mb-2 end-turn-modal-meta">
            <strong>Turn {currentTurn}</strong> | <strong>{GameUtils.formatYear(currentYear)}</strong>
          </p>
        </div>
        
        <div className="alert alert-info mb-0 end-turn-modal-alert">
          <i className="bi bi-info-circle me-2" aria-hidden="true"></i>
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
          onChange={(e) => {
            const checked = e.target.checked;
            setSkipNextTime(checked);
            actions.updateSettings({ skipEndTurnConfirmation: checked });
          }}
          className="mt-3 end-turn-modal-skip"
        />
      </Modal.Body>
      <Modal.Footer className="end-turn-modal-footer">
        <Button variant="secondary" onClick={handleCancel} className="touch-btn touch-btn--ghost">
          <i className="bi bi-x-circle me-2" aria-hidden="true"></i>
          Cancel
        </Button>
        <Button variant="success" onClick={handleConfirm} className="touch-btn touch-btn--success">
          <i className="bi bi-check-circle me-2" aria-hidden="true"></i>
          End Turn
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default EndTurnConfirmModal;
