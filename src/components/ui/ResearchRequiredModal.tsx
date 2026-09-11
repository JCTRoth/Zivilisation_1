import React from 'react';
import { Modal, Button } from 'react-bootstrap';

interface ResearchRequiredModalProps {
  show: boolean;
  /** Dismiss the modal ("Decide Later") — research stays unselected. */
  onHide: () => void;
  /** Open the technology tree so the player can pick a research. */
  onChooseResearch: () => void;
}

/**
 * Informs the player that no technology is selected for research — shown at
 * the start of a game and whenever the auto-end check would otherwise end the
 * turn with research sitting idle.
 *
 * "Choose Technology" opens the technology tree. Dismissing is allowed: the
 * turn can still be ended manually, and the engine then researches a random
 * available technology so the science is never wasted.
 */
const ResearchRequiredModal: React.FC<ResearchRequiredModalProps> = ({
  show,
  onHide,
  onChooseResearch,
}) => (
  <Modal show={show} onHide={onHide} centered dialogClassName="research-required-modal">
    <Modal.Header closeButton className="bg-dark text-white">
      <Modal.Title>🔬 No Research Selected</Modal.Title>
    </Modal.Header>
    <Modal.Body className="bg-dark text-white">
      <p className="mb-2">
        Your civilization has no technology selected for research — the science
        your cities produce would be wasted.
      </p>
      <p className="text-muted small mb-0">
        Pick one now in the technology tree. If you end the turn without
        choosing, a random available technology will be researched
        automatically.
      </p>
    </Modal.Body>
    <Modal.Footer className="bg-dark">
      <Button variant="outline-light" onClick={onHide}>
        Decide Later
      </Button>
      <Button variant="primary" onClick={onChooseResearch}>
        🔬 Choose Technology
      </Button>
    </Modal.Footer>
  </Modal>
);

export default ResearchRequiredModal;
