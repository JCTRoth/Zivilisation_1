import GameModal from './ModalShell';
import { useGameStore } from '@/stores/GameStore';
import { useTranslation } from '@/i18n/useTranslation';
import VillageGoldModal from './village/VillageGoldModal';
import VillageTechModal from './village/VillageTechModal';
import VillageUnitModal from './village/VillageUnitModal';
import VillageCityModal from './village/VillageCityModal';
import VillageBarbarianModal from './village/VillageBarbarianModal';

interface VillageModalProps {
  show: boolean;
  onHide: () => void;
}

/**
 * Dispatcher for Civ1 village (goody hut) encounters. Every event opens its
 * OWN dedicated modal — gold, technology, mercenary unit, new settlement, or
 * barbarian ambush — so each outcome is presented distinctly.
 */
function VillageModal({ show, onHide }: VillageModalProps) {
  const result = useGameStore((state) => state.villageResult);
  // Hook must run before any early return — see rules of hooks.
  const { t } = useTranslation();
  if (!show || !result) return null;

  switch (result.outcome) {
    case 'valuable_metals':
      return <VillageGoldModal result={result} onHide={onHide} />;
    case 'scroll_of_ancient_wisdom':
      return <VillageTechModal result={result} onHide={onHide} />;
    case 'friendly_mercenaries':
      return <VillageUnitModal result={result} onHide={onHide} />;
    case 'advanced_tribe':
      return <VillageCityModal result={result} onHide={onHide} />;
    case 'barbarians':
      return <VillageBarbarianModal result={result} onHide={onHide} />;
    default:
      // Fallback for unknown/destroyed outcomes — a plain village notice.
      return (
        <GameModal
          show
          onClose={onHide}
          tone="neutral"
          icon="💨"
          artLabel={t('village.fallback.art')}
          eyebrow={t('village.fallback.eyebrow')}
          title={t('village.fallback.title')}
          lede={t('village.fallback.lede')}
          actions={
            <button type="button" className="touch-btn touch-btn--primary" onClick={onHide}>
              {t('village.fallback.moveOn')}
            </button>
          }
        >
          <div className="gm-section">
            <div className="gm-section-title">{t('village.fallback.scoutsTitle')}</div>
            <p className="gm-prose mb-0">
              {t('village.fallback.scoutsBody')}
            </p>
          </div>
        </GameModal>
      );
  }
}

export default VillageModal;
