import React from 'react';
import GameModal from './ModalShell';
import { useTranslation } from '@/i18n/useTranslation';
import { STORY_EVENTS, type StoryId } from '@/data/StoryEvents';
import type { StoryNotice } from '../../../../types/game';
import '../../../styles/storyModal.css';

interface StoryModalProps {
  show: boolean;
  notice: StoryNotice | null;
  /** Continue = the card's only door: it closes the moment (and pops the queue). */
  onContinue: () => void;
}

/**
 * The chronicle's huge illustrated card — one moment, one full-bleed image,
 * one Continue button. Blocking by design: the story waits for the player.
 *
 * The image is OPTIONAL (`onError` in the shell falls back to the icon
 * stage), so a game without generated art tells its stories perfectly well.
 */
const StoryModal: React.FC<StoryModalProps> = ({ show, notice, onContinue }) => {
  const { t } = useTranslation();

  const def = notice ? STORY_EVENTS[notice.storyId as StoryId] : undefined;
  if (!notice || !def) return null;

  return (
    <GameModal
      show={show}
      onClose={onContinue}
      size="lg"
      tone={def.tone}
      artSrc={def.image}
      artAlt={t(def.titleKey)}
      artLayout="cover"
      artSize="lg"
      dialogClassName="story-modal"
      eyebrow={t(def.eyebrowKey)}
      title={t(def.titleKey)}
      lede={t(def.bodyKey, notice.params)}
      actions={
        <>
          <span className="gm-actions-spacer" />
          <button
            type="button"
            className="touch-btn touch-btn--primary"
            onClick={onContinue}
            autoFocus
          >
            {t('story.continue')}
          </button>
        </>
      }
    >
      {/* The image IS the moment — no body chrome beyond the lede. */}
      <div className="story-modal__footnote" aria-hidden="true" />
    </GameModal>
  );
};

export default StoryModal;
