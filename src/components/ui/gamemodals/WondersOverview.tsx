import React, { useMemo, useState } from 'react';
import { Modal, Button } from 'react-bootstrap';
import { useGameStore } from '@/stores/GameStore';
import {
  WONDERS,
  computeWonderStatuses,
  findWonderBuilders,
  findWonderOwner,
  isWonderObsolete,
  type WonderDefinition,
  type WonderEra,
  type WonderStatus,
} from '@/data/WonderData';
import '@/styles/wonders.css';

// ---------------------------------------------------------------------------
// Shared data (pure over store state — the same functions the tests use)
// ---------------------------------------------------------------------------

interface WonderRowData {
  wonder: WonderDefinition;
  status: WonderStatus;
  ownerCivId: number | null;
  builderCivIds: number[];
}

/** Status + ownership for every wonder, from the player's point of view. */
function useWonderRows(): WonderRowData[] {
  const cities = useGameStore((s) => s.cities);
  const civilizations = useGameStore((s) => s.civilizations);
  const activePlayer = useGameStore((s) => s.gameState.activePlayer);

  return useMemo(() => {
    const statuses = computeWonderStatuses(cities, civilizations, activePlayer);
    return WONDERS.map((wonder) => ({
      wonder,
      status: statuses[wonder.id] ?? 'available',
      ownerCivId: findWonderOwner(wonder.id, cities),
      builderCivIds: findWonderBuilders(wonder.id, cities),
    }));
  }, [cities, civilizations, activePlayer]);
}

function civName(civilizations: { id: number; name: string }[], id: number | null): string {
  if (id === null) return '';
  return civilizations.find((c) => c.id === id)?.name ?? `Civ ${id}`;
}

const STATUS_LABEL: Record<WonderStatus, string> = {
  owned: 'Yours',
  building: 'You are building',
  contested: 'Race!',
  rival: 'Rival',
  locked: 'Locked',
  available: 'Available',
};

const ERA_LABEL: Record<WonderEra, string> = {
  antiquity: 'Antiquity',
  middle: 'Middle Ages',
  industrial: 'Industrial / Modern Age',
};
const ERA_ORDER: WonderEra[] = ['antiquity', 'middle', 'industrial'];

/** Small colour-coded legend explaining the status dots (spec B). */
function StatusLegend() {
  const entries: Array<[WonderStatus, string]> = [
    ['owned', 'Owned by you'],
    ['building', 'You are building'],
    ['contested', 'Both sides building'],
    ['rival', 'Rival owns/builds'],
    ['locked', 'Technology missing'],
  ];
  return (
    <div className="wonders-overview__legend">
      {entries.map(([status, label]) => (
        <span key={status} className="d-inline-flex align-items-center gap-1">
          <span className={`wonder-status wonder-status--${status}`}>{STATUS_LABEL[status]}</span>
          {label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List (used by the Statistics tab AND the dedicated Wonders dialog)
// ---------------------------------------------------------------------------

interface WondersOverviewProps {
  /** Open the full Civilopedia-style entry for one wonder. */
  onOpenEntry: (wonderId: string) => void;
}

/**
 * Scrollable list of all 22 wonders with the spec's colour-coded statuses,
 * cost/tech/obsolescence summary, and a reserved thumbnail slot for future
 * artwork. Grouped by documentation-only era (flavour, never mechanics).
 */
export const WondersOverview: React.FC<WondersOverviewProps> = ({ onOpenEntry }) => {
  const rows = useWonderRows();

  return (
    <div className="wonders-overview">
      <StatusLegend />
      {ERA_ORDER.map((era) => {
        const eraRows = rows.filter((r) => r.wonder.era === era);
        if (eraRows.length === 0) return null;
        return (
          <div key={era}>
            <div className="wonders-overview__era">{ERA_LABEL[era]}</div>
            <div className="wonders-overview__list">
              {eraRows.map(({ wonder, status }) => (
                <button
                  key={wonder.id}
                  type="button"
                  className={`wonder-row ${status === 'locked' ? 'wonder-row--locked' : ''}`}
                  onClick={() => onOpenEntry(wonder.id)}
                  title={`Open Civilopedia entry: ${wonder.name}`}
                >
                  {/* Reserved thumbnail slot for future artwork. */}
                  <span className="wonder-row__thumb" aria-hidden="true">
                    {wonder.icon}
                  </span>
                  <span className="wonder-row__main">
                    <span className="wonder-row__name">{wonder.name}</span>
                    <span className="wonder-row__effect">{wonder.shortEffect}</span>
                  </span>
                  <span className="wonder-row__meta">
                    <span className={`wonder-status wonder-status--${status}`}>
                      {STATUS_LABEL[status]}
                    </span>
                    <span>
                      <span className="wonder-row__cost">{wonder.cost}</span> shields ·{' '}
                      {wonder.requiredTechnology.replace(/_/g, ' ')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Civilopedia-style entry
// ---------------------------------------------------------------------------

interface WonderEntryModalProps {
  show: boolean;
  wonderId: string | null;
  onHide: () => void;
}

/**
 * Full wonder entry: image slot, plain-language mechanics, historical flavour
 * AND the "Did you know?" facts — only facts we actually know are written
 * (per the info-screen rule: never invent).
 */
export const WonderEntryModal: React.FC<WonderEntryModalProps> = ({ show, wonderId, onHide }) => {
  const rows = useWonderRows();
  const civilizations = useGameStore((s) => s.civilizations);
  const row = rows.find((r) => r.wonder.id === wonderId) ?? null;
  const wonder = row?.wonder;
  const obsolete = wonder ? isWonderObsolete(wonder.id, civilizations) : false;

  if (!wonder) return null;

  const ownerName = civName(civilizations, row?.ownerCivId ?? null);
  const builderNames = (row?.builderCivIds ?? []).map((id) => civName(civilizations, id));

  return (
    <Modal show={show} onHide={onHide} centered size="lg" dialogClassName="wonder-entry-modal">
      <Modal.Header closeButton closeVariant="white">
        <Modal.Title className="wonder-entry-title">
          {wonder.icon} {wonder.name}
        </Modal.Title>
        <span className={`wonder-status wonder-status--${row?.status ?? 'available'} ms-3`}>
          {STATUS_LABEL[row?.status ?? 'available']}
        </span>
      </Modal.Header>
      <Modal.Body>
        {/* Reserved artwork area. */}
        <div className="wonder-image" role="img" aria-label={`${wonder.name} artwork placeholder`}>
          <span className="wonder-image__icon">{wonder.icon}</span>
          <span className="wonder-image__caption">artwork: {wonder.image}</span>
        </div>

        <div className="wonder-entry-meta">
          <span className="wonder-entry-meta__chip">🛡 {wonder.cost} shields</span>
          <span className="wonder-entry-meta__chip">
            🔬 {wonder.requiredTechnology.replace(/_/g, ' ')}
          </span>
          <span className="wonder-entry-meta__chip">
            ⏳ {wonder.obsoleteBy ? `Obsolete: ${wonder.obsoleteBy.replace(/_/g, ' ')}` : 'Never obsolete'}
          </span>
          <span className="wonder-entry-meta__chip">📜 {ERA_LABEL[wonder.era]}</span>
          <span className="wonder-entry-meta__chip">🔧 No maintenance</span>
        </div>

        <div className="wonder-entry-owner">
          {row?.ownerCivId !== null && row?.ownerCivId !== undefined ? (
            <>
              ✅ Built by <strong>{ownerName}</strong>
              {ownerName ? ' — the wonder stands in their cities and scores for them.' : ''}
            </>
          ) : builderNames.length > 0 ? (
            <>🏗 Under construction by {builderNames.join(', ')} — first to finish claims it.</>
          ) : (
            <>⏳ Nobody has started this wonder yet.</>
          )}
        </div>

        <div className="wonder-entry-section">
          <h6>Effect</h6>
          <p>
            {obsolete && (
              <span className="wonder-obsolete-tag me-2">
                ⚠ OBSOLETE — {wonder.obsoleteBy?.replace(/_/g, ' ')} was discovered somewhere; the
                effect is switched off (the wonder still scores).
              </span>
            )}
            {wonder.effectText}
          </p>
        </div>

        <div className="wonder-entry-section">
          <h6>History</h6>
          <p>{wonder.flavor}</p>
        </div>

        {wonder.facts.length > 0 && (
          <div className="wonder-entry-section">
            <h6>Did you know?</h6>
            <ul className="wonder-entry-facts">
              {wonder.facts.map((fact, i) => (
                <li key={i}>{fact}</li>
              ))}
            </ul>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-light" onClick={onHide}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Standalone dialog (World menu → Wonders)
// ---------------------------------------------------------------------------

interface WondersOverviewModalProps {
  show: boolean;
  onHide: () => void;
}

/**
 * Dedicated Wonders screen (spec B) — World → Statistics → Wonders tab uses
 * the same `WondersOverview` list; this wrapper serves the WORLD menu entry.
 */
const WondersOverviewModal: React.FC<WondersOverviewModalProps> = ({ show, onHide }) => {
  const [entryId, setEntryId] = useState<string | null>(null);

  return (
    <>
      <Modal show={show} onHide={onHide} centered size="lg" dialogClassName="wonders-modal">
        <Modal.Header closeButton closeVariant="white">
          <Modal.Title>🏆 Wonders of the World</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <WondersOverview onOpenEntry={(id) => setEntryId(id)} />
        </Modal.Body>
        <Modal.Footer>
          <span className="me-auto text-white-50 small">
            22 unique wonders · first civilization to finish one owns it forever
          </span>
          <Button variant="outline-light" onClick={onHide}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
      <WonderEntryModal show={!!entryId} wonderId={entryId} onHide={() => setEntryId(null)} />
    </>
  );
};

export default WondersOverviewModal;
