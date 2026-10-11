import React from 'react';
import GameModal from './gamemodals/ModalShell';

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
  <GameModal
    show={show}
    onClose={onHide}
    tone="info"
    icon="🔬"
    artLabel="an idle laboratory"
    dialogClassName="research-required-modal"
    eyebrow="Your Academies Are Waiting"
    title="No Research Selected"
    lede="Your scholars are ready to work, but nobody has told them what to discover next. Without an order, the science your cities produce this turn is poured on the floor."
    actions={
      <>
        <span className="gm-actions-spacer" />
        <button type="button" className="touch-btn touch-btn--ghost" onClick={onHide}>
          Decide Later
        </button>
        <button type="button" className="touch-btn touch-btn--primary" onClick={onChooseResearch}>
          🔬 Choose Technology
        </button>
      </>
    }
  >
    <div className="gm-section">
      <div className="gm-section-title">What happens if you wait</div>
      <p className="gm-prose mb-0">
        Open the technology tree now and choose a research. If you end the turn without picking
        anything, your people will fall back on whatever technology they can find lying around —
        the science is never wasted, but the path is not yours.
      </p>
    </div>
    <div className="gm-note">
      Research only moves while something is selected. You can come back here at any time with{' '}
      <strong>F2</strong>.
    </div>
  </GameModal>
);

export default ResearchRequiredModal;
