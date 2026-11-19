import React from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TranslationKey } from '@/i18n';
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
}) => {
  const { t } = useTranslation();
  return (
    <GameModal
      show={show}
      onClose={onHide}
      tone="info"
      icon="🔬"
      artLabel={t('researchReq.artLabel' as TranslationKey)}
      dialogClassName="research-required-modal"
      eyebrow={t('researchReq.eyebrow' as TranslationKey)}
      title={t('researchReq.title' as TranslationKey)}
      lede={t('researchReq.lede' as TranslationKey)}
      actions={
        <>
          <span className="gm-actions-spacer" />
          <button type="button" className="touch-btn touch-btn--ghost" onClick={onHide}>
            {t('researchReq.decideLater' as TranslationKey)}
          </button>
          <button type="button" className="touch-btn touch-btn--primary" onClick={onChooseResearch}>
            🔬 {t('researchReq.chooseTechnology' as TranslationKey)}
          </button>
        </>
      }
    >
      <div className="gm-section">
        <div className="gm-section-title">{t('researchReq.waitTitle' as TranslationKey)}</div>
        <p className="gm-prose mb-0">
          {t('researchReq.waitProse' as TranslationKey)}
        </p>
      </div>
      <div className="gm-note">
        {t('researchReq.f2Note' as TranslationKey)}{' '}
        <strong>F2</strong>.
      </div>
    </GameModal>
  );
};

export default ResearchRequiredModal;
