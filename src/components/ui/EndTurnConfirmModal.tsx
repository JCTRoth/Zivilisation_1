import React, { useState } from 'react';
import { Form } from 'react-bootstrap';
import { useGameStore } from '@/stores/GameStore';
import { useTranslation } from '@/i18n/useTranslation';
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
  animation?: boolean;
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
 * Both live in the English dictionary (`endTurn.titleManual` / `endTurn.titleAuto`),
 * so with the default language the dialog text is byte-identical to before;
 * other languages translate them through the same keys.
 */
const EndTurnConfirmModal: React.FC<EndTurnConfirmModalProps> = ({
  show,
  onConfirm,
  onCancel,
  currentTurn,
  currentYear,
  isAutomatic = false,
  animation = true,
}) => {
  const settings = useGameStore(state => state.settings);
  const actions = useGameStore(state => state.actions);
  const { t } = useTranslation();
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

  const stamp = `${t('common.turn', { turn: currentTurn })} · ${GameUtils.formatYear(currentYear)}`;

  return (
    <GameModal
      show={show}
      onClose={handleCancel}
      animation={animation}
      dialogClassName="end-turn-modal"
      tone={isAutomatic ? 'success' : 'info'}
      icon={isAutomatic ? '✅' : '⏭️'}
      artLabel={isAutomatic ? t('endTurn.artNight') : t('endTurn.artCouncil')}
      eyebrow={isAutomatic ? t('endTurn.eyebrowAuto', { stamp }) : t('endTurn.eyebrowManual', { stamp })}
      title={isAutomatic ? t('endTurn.titleAuto') : t('endTurn.titleManual')}
      lede={isAutomatic ? t('endTurn.ledeAuto') : t('endTurn.ledeManual')}
      actions={
        <>
          <button type="button" className="touch-btn touch-btn--ghost" onClick={handleCancel}>
            <i className="bi bi-x-circle" aria-hidden="true" />
            {t('common.cancel')}
          </button>
          <button type="button" className="touch-btn touch-btn--success" onClick={handleConfirm}>
            <i className="bi bi-check-circle" aria-hidden="true" />
            {t('endTurn.endTurn')}
          </button>
        </>
      }
    >
      {isAutomatic ? (
        <div className="gm-callout">
          <span className="gm-callout-title">{t('endTurn.titleManual')}</span>
          {t('endTurn.calloutBody')}
        </div>
      ) : (
        <>
          <section className="gm-section">
            <h3 className="gm-section-title">{t('endTurn.orderTitle')}</h3>
            <p className="gm-prose">
              {t('endTurn.orderProsePre')}
              <strong>{t('endTurn.orderProseStrong')}</strong>
              {t('endTurn.orderProsePost')}
            </p>
          </section>
          <p className="gm-note">
            <strong>{t('endTurn.nothingCommittedStrong')}</strong>
            {t('endTurn.nothingCommittedRest')}
          </p>
        </>
      )}

      {/* Automatic flavour only: the feature the dialog itself represents,
          explained where the player meets it, with the switch right there.
          This writes ONLY `settings.autoEndTurn` — never the "don't ask again"
          preference below, which stays a pure interface choice. */}
      {isAutomatic && (
        <section className="gm-section end-turn-modal-auto-card">
          <h3 className="gm-section-title">{t('gm.autoEnd.title')}</h3>
          <p className="gm-prose">
            {t('gm.autoEnd.lede.pre')}{' '}
            <strong>{t('gm.autoEnd.title')}</strong>{' '}
            {t('gm.autoEnd.lede.mid')}{' '}
            <strong>{t('gm.autoEnd.lede.strong2')}</strong>{' '}
            {t('gm.autoEnd.lede.post')}
          </p>
          <Form.Check
            type="checkbox"
            id="enable-auto-end-turn"
            label={t('endTurn.enableAutoEnd')}
            checked={settings.autoEndTurn}
            onChange={(e) => actions.updateSettings({ autoEndTurn: e.target.checked })}
            className="end-turn-modal-skip"
          />
        </section>
      )}

      <section className="gm-section end-turn-modal-skip-card">
        <Form.Check
          type="checkbox"
          id="skip-end-turn-confirmation"
          label={t('endTurn.skipConfirmation')}
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
