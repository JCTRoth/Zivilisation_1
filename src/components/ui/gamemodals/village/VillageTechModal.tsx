import GameModal from '../ModalShell';
import { useTranslation } from '@/i18n/useTranslation';
import type { VillageResult } from '../../../../../types/game';

interface VillageTechModalProps {
  result: VillageResult;
  onHide: () => void;
}

/**
 * "Scroll of Ancient Wisdom" village outcome — an instant free technology.
 */
function VillageTechModal({ result, onHide }: VillageTechModalProps) {
  const { t } = useTranslation();
  const techName = result.techName ?? result.techId ?? t('village.tech.fallbackName');
  return (
    <GameModal
      show
      onClose={onHide}
      tone="solemn"
      icon="📜"
      artLabel={t('village.tech.art')}
      eyebrow={t('village.eyebrow')}
      title={t('village.tech.title')}
      lede={t('village.tech.lede')}
      actions={
        <button type="button" className="touch-btn touch-btn--primary" onClick={onHide}>
          {t('village.tech.action')}
        </button>
      }
    >
      <div className="gm-stat-grid">
        <div className="gm-stat gm-stat--accent">
          <span className="gm-stat-value">
            <span className="gm-stat-icon" aria-hidden="true">🔬</span>
            {techName}
          </span>
          <span className="gm-stat-label">{t('village.tech.stat')}</span>
        </div>
      </div>
      <div className="gm-section">
        <div className="gm-section-title">{t('village.tech.section')}</div>
        <p className="gm-prose mb-0">
          {t('village.tech.prose')}
        </p>
      </div>
    </GameModal>
  );
}

export default VillageTechModal;
