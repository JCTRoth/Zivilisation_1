import GameModal from '../ModalShell';
import { useTranslation } from '@/i18n/useTranslation';
import type { VillageResult } from '../../../../../types/game';

interface VillageUnitModalProps {
  result: VillageResult;
  onHide: () => void;
}

/**
 * "Friendly Mercenaries" village outcome — a free unit (home city NONE).
 * When a Settler triggered the hut the Civ1 "NONE" hack awards a Settler.
 */
function VillageUnitModal({ result, onHide }: VillageUnitModalProps) {
  const { t } = useTranslation();
  const isSettler = (result.unitType ?? '').toLowerCase() === 'settler' || (result.unitName ?? '').toLowerCase() === 'settler';
  const unitName = result.unitName ?? t('village.unit.fallbackName');
  return (
    <GameModal
      show
      onClose={onHide}
      tone="success"
      icon={isSettler ? '🚶' : '🛡️'}
      artLabel={t('village.unit.art')}
      eyebrow={t('village.eyebrow')}
      title={t('village.unit.title')}
      lede={
        isSettler
          ? t('village.unit.ledeSettler')
          : t('village.unit.ledeVeterans')
      }
      actions={
        <button type="button" className="touch-btn touch-btn--primary" onClick={onHide}>
          {t('village.unit.action')}
        </button>
      }
    >
      <div className="gm-stat-grid">
        <div className="gm-stat gm-stat--accent">
          <span className="gm-stat-value">
            <span className="gm-stat-icon" aria-hidden="true">⚔️</span>
            {unitName}
          </span>
          <span className="gm-stat-label">{t('village.unit.stat')}</span>
        </div>
      </div>
      <div className="gm-section">
        <div className="gm-section-title">{t('village.unit.section')}</div>
        <p className="gm-prose mb-0">
          {t('village.unit.prose')}
        </p>
      </div>
    </GameModal>
  );
}

export default VillageUnitModal;
