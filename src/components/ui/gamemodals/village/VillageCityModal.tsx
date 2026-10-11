import GameModal from '../ModalShell';
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
  const cityName = result.cityName ?? 'a new city';
  return (
    <GameModal
      show
      onClose={onHide}
      tone="success"
      icon="🏘️"
      artLabel="smoke over new roofs"
      eyebrow="A Village Encounter"
      title="New Settlement"
      lede={
        <>
          The tribe has watched your people farm, build and trade — and now they ask to be part
          of it. Their huts are already inside your borders: <strong>{cityName}</strong> is a
          city of yours from this turn on.
        </>
      }
      actions={
        <button type="button" className="touch-btn touch-btn--primary" onClick={onHide}>
          Welcome, {cityName}
        </button>
      }
    >
      <div className="gm-stat-grid">
        <div className="gm-stat gm-stat--accent">
          <span className="gm-stat-value">
            <span className="gm-stat-icon" aria-hidden="true">🏘️</span>
            {cityName}
          </span>
          <span className="gm-stat-label">Founded at once</span>
        </div>
        <div className="gm-stat">
          <span className="gm-stat-value">
            <span className="gm-stat-icon" aria-hidden="true">👥</span>1
          </span>
          <span className="gm-stat-label">Starting population</span>
        </div>
      </div>
      <div className="gm-section">
        <div className="gm-section-title">Your first duty</div>
        <p className="gm-prose mb-0">
          Open the city and give it something to build — a granary to grow, a warrior to guard
          the gate. A city without orders is only a village with a flag.
        </p>
      </div>
    </GameModal>
  );
}

export default VillageCityModal;
