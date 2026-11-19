import GameModal from '../ModalShell';
import { useTranslation } from '@/i18n/useTranslation';
import type { VillageResult } from '../../../../../types/game';

interface VillageGoldModalProps {
  result: VillageResult;
  onHide: () => void;
}

/**
 * "Valuable Metals" village outcome — the villagers gift a lump sum of gold
 * (Civ1: 25, 50, or 100).
 */
function VillageGoldModal({ result, onHide }: VillageGoldModalProps) {
  const { t } = useTranslation();
  const gold = result.goldAmount ?? 50;
  return (
    <GameModal
      show
      onClose={onHide}
      tone="gold"
      icon="🪙"
      artLabel={t('village.gold.art')}
      eyebrow={t('village.eyebrow')}
      title={t('village.gold.title')}
      lede={t('village.gold.lede')}
      actions={
        <button type="button" className="touch-btn touch-btn--primary" onClick={onHide}>
          {t('village.gold.action')}
        </button>
      }
    >
      <div className="gm-stat-grid">
        <div className="gm-stat gm-stat--accent">
          <span className="gm-stat-value">
            <span className="gm-stat-icon" aria-hidden="true">🪙</span>+{gold}
          </span>
          <span className="gm-stat-label">{t('village.gold.stat')}</span>
        </div>
      </div>
      <div className="gm-section">
        <div className="gm-section-title">{t('village.gold.section')}</div>
        <p className="gm-prose mb-0">
          {t('village.gold.prose')}
        </p>
      </div>
    </GameModal>
  );
}

export default VillageGoldModal;
