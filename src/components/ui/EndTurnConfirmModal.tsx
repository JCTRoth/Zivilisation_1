import React, { useState } from 'react';
import { Form } from 'react-bootstrap';
import { useGameStore } from '@/stores/GameStore';
import GameModal from '@/components/ui/gamemodals/ModalShell';
import { GameUtils } from '@/utils/GameUtils';
import '../../styles/endTurnConfirmModal.css';

interface EndTurnConfirmModalProps {
  show: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  currentTurn: number;
  currentYear: number;
  isAutomatic?: boolean;
}

/**
 * The audience where the ruler is asked to close the turn — in both flavours:
 * manual (the player pressed End Turn) and automatic (every unit has spent its
 * moves and the game asks to carry on).
 *
 * Two strings are load-bearing for the e2e suite and must stay in the dialog
 * text in BOTH flavours: `End Turn?` (the locators filter on it) and, for the
 * automatic flavour, the heading `All Your Units Have Moved!`. The manual
 * flavour carries the first as its title, the automatic one as its callout.
 */
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

  const stamp = `Turn ${currentTurn} · ${GameUtils.formatYear(currentYear)}`;

  return (
    <GameModal
      show={show}
      onClose={handleCancel}
      dialogClassName="end-turn-modal"
      tone={isAutomatic ? 'success' : 'info'}
      icon={isAutomatic ? '✅' : '⏭️'}
      artLabel={isAutomatic ? 'night falls' : 'war council'}
      eyebrow={isAutomatic ? `End of Turn · ${stamp}` : `Your Counsel · ${stamp}`}
      title={isAutomatic ? 'All Your Units Have Moved!' : 'End Turn?'}
      lede={
        isAutomatic
          ? 'Every soldier under your command has spent their moves. The world will not wait for you — close the turn now, or hold it while you plan.'
          : 'Give the word and the rest of the world plays on: rival courts, caravans and warbands all take their turns while your people wait.'
      }
      actions={
        <>
          <button type="button" className="touch-btn touch-btn--ghost" onClick={handleCancel}>
            <i className="bi bi-x-circle" aria-hidden="true" />
            Cancel
          </button>
          <button type="button" className="touch-btn touch-btn--success" onClick={handleConfirm}>
            <i className="bi bi-check-circle" aria-hidden="true" />
            End Turn
          </button>
        </>
      }
    >
      {isAutomatic ? (
        <div className="gm-callout">
          <span className="gm-callout-title">End Turn?</span>
          Nothing else is left to order this turn. End it and the world plays out — your cities keep
          producing and your research keeps climbing while every rival moves in turn. Hold it instead
          and the map stays yours a while longer.
        </div>
      ) : (
        <>
          <section className="gm-section">
            <h3 className="gm-section-title">The order of play</h3>
            <p className="gm-prose">
              The word is yours to give. Close the turn and every rival court, caravan and warband on
              the board plays out its moves — <strong>your cities keep producing and your research
              keeps climbing</strong> the whole while.
            </p>
          </section>
          <p className="gm-note">
            <strong>Nothing is committed yet.</strong> Cancel returns you to the map exactly as you
            left it — orders, paths and all.
          </p>
        </>
      )}

      <section className="gm-section end-turn-modal-skip-card">
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
          className="end-turn-modal-skip"
        />
      </section>
    </GameModal>
  );
};

export default EndTurnConfirmModal;
