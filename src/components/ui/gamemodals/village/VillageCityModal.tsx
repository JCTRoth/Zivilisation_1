import GameModal from '../ModalShell';
import { useTranslation } from '@/i18n/useTranslation';
import type { VillageResult } from '../../../../../types/game';

interface VillageCityModalProps {
  result: VillageResult;
  onHide: () => void;
}

/**
 * "Advanced Tribe" / New Settlement village outcome — the hut instantly
 * becomes a size-1 city named after the civ's next available city name.
 */
function VillageCityModal({ result, onHide }: VillageCityModalProps) {
  const { t } = useTranslation();
  const cityName = result.cityName ?? t('village.city.fallbackName');
  return (
    <GameModal
      show
      onClose={onHide}
      tone="success"
      icon="🏘️"
      artLabel={t('village.city.art')}
      eyebrow={t('village.eyebrow')}
      title={t('village.city.title')}
      lede={
        <>
          {t('village.city.ledeBefore')}
          <strong>{cityName}</strong>
          {t('village.city.ledeAfter')}
        </>
      }
      actions={
        <button type="button" className="touch-btn touch-btn--primary" onClick={onHide}>
          {t('village.city.action', { city: cityName })}
        </button>
      }
    >
      <div className="gm-stat-grid">
        <div className="gm-stat gm-stat--accent">
          <span className="gm-stat-value">
            <span className="gm-stat-icon" aria-hidden="true">🏘️</span>
            {cityName}
          </span>
          <span className="gm-stat-label">{t('village.city.statFounded')}</span>
        </div>
        <div className="gm-stat">
          <span className="gm-stat-value">
            <span className="gm-stat-icon" aria-hidden="true">👥</span>1
          </span>
          <span className="gm-stat-label">{t('village.city.statPopulation')}</span>
        </div>
      </div>
      <div className="gm-section">
        <div className="gm-section-title">{t('village.city.section')}</div>
        <p className="gm-prose mb-0">
          {t('village.city.prose')}
        </p>
      </div>
    </GameModal>
  );
}

export default VillageCityModal;
