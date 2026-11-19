import React from 'react';
import { getWonder } from '@/data/WonderData';
import { useTranslation } from '@/i18n/useTranslation';
import type { TranslationKey } from '@/i18n';
import GameModal from './ModalShell';
import '@/styles/wonders.css';

/** The 'conflict' variant of the wonder dialog queue entry. */
interface WonderConflictNotice {
  kind: 'conflict';
  wonderId: string;
  cityId: string;
  cityName: string;
  ownerCityId: string;
  ownerCityName: string;
  ownerCivId: number;
  ownerCivName: string;
  /** Completed group member that won, when this was a group loss. */
  blockedByWonderId?: string;
  blockedByWonderName?: string;
}

interface WonderConflictModalProps {
  show: boolean;
  notice: WonderConflictNotice | null;
  /** Center the map on the idle city and open its city screen. */
  onGoToCity: (cityId: string) => void;
  /** Plain close. */
  onClose: () => void;
}

/**
 * Production conflict popup (spec D): a human city finished a wonder that
 * somebody else completed first. Civ 1 wastes the shields and leaves the city
 * idle — this modal says exactly that, names the winner, and offers
 * "Go to City" / "Close".
 */
const WonderConflictModal: React.FC<WonderConflictModalProps> = ({ show, notice, onGoToCity, onClose }) => {
  const { t } = useTranslation();
  if (!notice) return null;
  const wonder = getWonder(notice.wonderId);
  // Group loss (e.g. Tiangong while the ISS exists): name the wonder that
  // actually won instead of claiming the attempted one was completed.
  const won = notice.blockedByWonderId && notice.blockedByWonderId !== notice.wonderId
    ? (getWonder(notice.blockedByWonderId) ?? wonder)
    : wonder;
  const wonName = won?.name ?? t('wonderConflict.theWonder' as TranslationKey);

  return (
    <GameModal
      show={show}
      onClose={onClose}
      tone="danger"
      dialogClassName="wonder-conflict-modal"
      eyebrow={t('wonderConflict.eyebrow' as TranslationKey)}
      title={
        <>
          {won?.icon ?? '🏗️'} {wonName} {t('wonderConflict.titleSuffix' as TranslationKey)}
        </>
      }
      lede={t('wonderConflict.lede' as TranslationKey)}
      icon={won?.icon ?? '🏗️'}
      artLabel={t('wonderConflict.artLabel' as TranslationKey)}
      actions={
        <>
          <button type="button" className="touch-btn touch-btn--ghost" onClick={onClose}>
            {t('wonderConflict.close' as TranslationKey)}
          </button>
          <button type="button" className="touch-btn touch-btn--primary" onClick={() => onGoToCity(notice.cityId)}>
            <i className="bi bi-geo-alt" aria-hidden="true" /> {t('wonderConflict.goToCity' as TranslationKey)}
          </button>
        </>
      }
    >
      <div className="gm-callout">
        <span className="gm-callout-title">{t('wonderConflict.calloutTitle' as TranslationKey)}</span>
        {t('wonderConflict.calloutPre' as TranslationKey)}
        <strong>{notice.cityName}</strong>
        {t('wonderConflict.calloutPost' as TranslationKey)}
      </div>

      <section className="gm-section">
        <h3 className="gm-section-title">{t('wonderConflict.firstSectionTitle' as TranslationKey)}</h3>
        <div className="gm-kv-grid gm-kv-grid--stack">
          <div className="gm-kv">
            {t('wonderConflict.winner' as TranslationKey)} <b>{notice.ownerCivName} — {notice.ownerCityName}</b>
          </div>
          <div className="gm-kv">
            {t('wonderConflict.wonderFinished' as TranslationKey)} <b>{wonName}</b>
          </div>
          <div className="gm-kv">
            {t('wonderConflict.idleCity' as TranslationKey)} <b>{notice.cityName}</b>
          </div>
        </div>
      </section>

      <p className="gm-note">
        <strong>{t('wonderConflict.whatNext' as TranslationKey)}</strong>
        {t('wonderConflict.openCity' as TranslationKey)}
        <strong>{notice.cityName}</strong>
        {t('wonderConflict.newProduction' as TranslationKey)}
      </p>
    </GameModal>
  );
};

export default WonderConflictModal;
