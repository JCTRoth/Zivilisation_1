import GameModal from '../ModalShell';
import { useTranslation } from '@/i18n/useTranslation';
import type { VillageResult } from '../../../../../types/game';

interface VillageBarbarianModalProps {
  result: VillageResult;
  onHide: () => void;
}

/**
 * "Barbarian Ambush" village outcome — the hut reveals a hostile barbarian
 * village: 1–3 barbarians spawn in adjacent tiles and attack immediately.
 */
function VillageBarbarianModal({ result, onHide }: VillageBarbarianModalProps) {
  const { t } = useTranslation();
  const count = result.barbarianCount ?? 0;
  return (
    <GameModal
      show
      onClose={onHide}
      tone="danger"
      icon="🐎"
      artLabel={t('village.barbarian.art')}
      eyebrow={t('village.eyebrow')}
      title={t('village.barbarian.title')}
      lede={t('village.barbarian.lede')}
      actions={
        <button type="button" className="touch-btn touch-btn--danger" onClick={onHide}>
          {t('village.barbarian.action')}
        </button>
      }
    >
      <div className="gm-stat-grid">
        <div className="gm-stat gm-stat--accent">
          <span className="gm-stat-value">
            <span className="gm-stat-icon" aria-hidden="true">⚔️</span>
            {count} {count === 1 ? t('village.barbarian.countOne') : t('village.barbarian.countMany')}
          </span>
          <span className="gm-stat-label">{t('village.barbarian.stat')}</span>
        </div>
      </div>
      <div className="gm-callout">
        <span className="gm-callout-title">{t('village.barbarian.calloutTitle')}</span>
        {t('village.barbarian.calloutBody')}
      </div>
    </GameModal>
  );
}

export default VillageBarbarianModal;
