import GameModal from '../ModalShell';
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
  const unitName = result.unitName ?? 'warrior';
  const isSettler = (result.unitType ?? '').toLowerCase() === 'settler' || unitName.toLowerCase() === 'settler';
  return (
    <GameModal
      show
      onClose={onHide}
      tone="success"
      icon={isSettler ? '🚶' : '🛡️'}
      artLabel="a banner in the dusk"
      eyebrow="A Village Encounter"
      title="Friendly Mercenaries"
      lede={
        isSettler
          ? 'A wandering tribe has watched your people from the treeline. Today they decide to walk beside you instead.'
          : `Veterans of a dozen border wars have offered you their spears — and they know the country better than your own scouts.`
      }
      actions={
        <button type="button" className="touch-btn touch-btn--primary" onClick={onHide}>
          Welcome Them
        </button>
      }
    >
      <div className="gm-stat-grid">
        <div className="gm-stat gm-stat--accent">
          <span className="gm-stat-value">
            <span className="gm-stat-icon" aria-hidden="true">⚔️</span>
            {unitName}
          </span>
          <span className="gm-stat-label">Joins your army, free</span>
        </div>
      </div>
      <div className="gm-section">
        <div className="gm-section-title">What they ask in return</div>
        <p className="gm-prose mb-0">
          Only a place in your ranks and a share of your fortunes. Feed them, and they will hold
          the river crossing while your settlers work the fields.
        </p>
      </div>
    </GameModal>
  );
}

export default VillageUnitModal;
