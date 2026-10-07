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
import { WonderArtwork } from './WonderArtwork';
import '@/styles/wonders.css';

// ---------------------------------------------------------------------------
// Shared data (pure over store state — the same functions the tests use)
// ---------------------------------------------------------------------------

interface WonderRowData {
  wonder: WonderDefinition;
  status: WonderStatus;
  ownerCivId: number | null;
  builderCivIds: number[];
  /** True once ANY civilization has researched the obsolescence technology. */
  obsolete: boolean;
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
      obsolete: isWonderObsolete(wonder.id, civilizations),
    }));
  }, [cities, civilizations, activePlayer]);
}

interface CivLike {
  id: number;
  name: string;
  color?: string;
}

function civName(civilizations: CivLike[], id: number | null): string {
  if (id === null) return '';
  return civilizations.find((c) => c.id === id)?.name ?? `Civ ${id}`;
}

/** Coloured dot + name so a wonder's holder is identifiable at a glance. */
function CivTag({ civilizations, id, you }: { civilizations: CivLike[]; id: number; you?: boolean }) {
  const color = civilizations.find((c) => c.id === id)?.color ?? '#8a94a6';
  return (
    <span className="wonders-civ">
      <span className="wonders-civ__dot" style={{ background: color }} aria-hidden="true" />
      {civName(civilizations, id)}
      {you && <span className="wonders-civ__you">you</span>}
    </span>
  );
}

const STATUS_LABEL: Record<WonderStatus, string> = {
  owned: 'Yours',
  building: 'Building',
  contested: 'Race',
  rival: 'Rival',
  locked: 'Locked',
  available: 'Open',
};

/** One line of plain context under the status pill. */
const STATUS_HINT: Record<WonderStatus, string> = {
  owned: 'Completed by you',
  building: 'In production',
  contested: 'Both sides building',
  rival: 'Held elsewhere',
  locked: 'Technology missing',
  available: 'Unclaimed',
};

/** snake_case tech id → human-readable name (bronze_working → Bronze Working). */
function formatTechName(id: string | null | undefined): string {
  if (!id) return 'None';
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const ERA_LABEL: Record<WonderEra, string> = {
  antiquity: 'Antiquity',
  middle: 'Middle Ages',
  industrial: 'Industrial & Modern Age',
};
const ERA_ORDER: WonderEra[] = ['antiquity', 'middle', 'industrial'];

// ---------------------------------------------------------------------------
// List (used by the Statistics tab AND the dedicated Wonders dialog)
// ---------------------------------------------------------------------------

interface WondersOverviewProps {
  /** Open the full Civilopedia-style entry for one wonder. */
  onOpenEntry: (wonderId: string) => void;
}

/**
 * Scrollable ledger of all 22 wonders with the spec's colour-coded statuses,
 * cost / technology / obsolescence details and the civilization that holds (or
 * is building) each one. Grouped by documentation-only era for readability.
 */
const WondersOverview: React.FC<WondersOverviewProps> = ({ onOpenEntry }) => {
  const rows = useWonderRows();
  const civilizations = useGameStore((s) => s.civilizations);
  const activePlayer = useGameStore((s) => s.gameState.activePlayer);

  const summary = useMemo(() => {
    const counts: Record<WonderStatus, number> = {
      owned: 0,
      building: 0,
      contested: 0,
      rival: 0,
      locked: 0,
      available: 0,
    };
    for (const row of rows) counts[row.status] += 1;
    return { counts, built: counts.owned, total: rows.length };
  }, [rows]);

  return (
    <div className="wonders-overview">
      {/* ── At-a-glance summary ─────────────────────────────────────────── */}
      <div className="wonders-summary">
        <div className="wonders-summary__headline">
          <span className="wonders-summary__count">
            <strong>{summary.built}</strong> / {summary.total}
          </span>
          <span className="wonders-summary__label">wonders completed</span>
        </div>
        <div
          className="wonders-summary__bar"
          role="progressbar"
          aria-label="Wonders completed"
          aria-valuenow={summary.built}
          aria-valuemin={0}
          aria-valuemax={summary.total}
        >
          <span style={{ width: `${(summary.built / summary.total) * 100}%` }} />
        </div>
        <ul className="wonders-summary__stats">
          {(['building', 'contested', 'rival', 'locked'] as WonderStatus[]).map((status) => (
            <li key={status} className={`wonders-summary__stat wonders-summary__stat--${status}`}>
              <span className="wonders-summary__dot" aria-hidden="true" />
              <span className="wonders-summary__stat-value">{summary.counts[status]}</span>
              <span className="wonders-summary__stat-label">{STATUS_HINT[status]}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── The ledger, grouped by era ──────────────────────────────────── */}
      <div className="wonders-ledger">
        {ERA_ORDER.map((era) => {
          const eraRows = rows.filter((r) => r.wonder.era === era);
          if (eraRows.length === 0) return null;
          return (
            <section key={era} className="wonders-era">
              <h4 className="wonders-era__title">
                {ERA_LABEL[era]}
                <span className="wonders-era__count">{eraRows.length}</span>
              </h4>

              <ul className="wonders-era__list">
                {eraRows.map((row) => {
                  const { wonder, status, ownerCivId, builderCivIds, obsolete } = row;
                  const builders = builderCivIds.filter((id) => id !== ownerCivId);
                  return (
                    <li key={wonder.id}>
                      <button
                        type="button"
                        className={`wonder-card wonder-card--${status}`}
                        onClick={() => onOpenEntry(wonder.id)}
                        title={`Open Civilopedia entry: ${wonder.name}`}
                      >
                        <span className="wonder-card__lead">
                          <span className="wonder-card__icon" aria-hidden="true">
                            {wonder.icon}
                          </span>
                          <span className="wonder-card__name">{wonder.name}</span>
                          <span className={`wonder-status wonder-status--${status}`}>
                            {STATUS_LABEL[status]}
                          </span>
                          {obsolete && (
                            <span
                              className="wonder-card__obsolete"
                              title={`Obsolete — ${formatTechName(wonder.obsoleteBy)} discovered`}
                            >
                              Obsolete
                            </span>
                          )}
                        </span>

                        <span className="wonder-card__effect">{wonder.shortEffect}</span>

                        <span className="wonder-card__meta">
                          <span className="wonder-card__fact">
                            <span className="wonder-card__fact-label">Cost</span>
                            <span className="wonder-card__fact-value">{wonder.cost} shields</span>
                          </span>
                          <span className="wonder-card__fact">
                            <span className="wonder-card__fact-label">Requires</span>
                            <span className="wonder-card__fact-value">
                              {formatTechName(wonder.requiredTechnology)}
                            </span>
                          </span>
                          <span className="wonder-card__fact">
                            <span className="wonder-card__fact-label">Obsolete by</span>
                            <span className="wonder-card__fact-value">
                              {wonder.obsoleteBy ? formatTechName(wonder.obsoleteBy) : 'Never'}
                            </span>
                          </span>
                          <span className="wonder-card__fact">
                            <span className="wonder-card__fact-label">
                              {ownerCivId !== null ? 'Owner' : builders.length > 0 ? 'Building' : 'Status'}
                            </span>
                            <span className="wonder-card__fact-value wonder-card__holders">
                              {ownerCivId !== null ? (
                                <CivTag civilizations={civilizations} id={ownerCivId} you={ownerCivId === activePlayer} />
                              ) : builders.length > 0 ? (
                                builders.map((id) => (
                                  <CivTag
                                    key={id}
                                    civilizations={civilizations}
                                    id={id}
                                    you={id === activePlayer}
                                  />
                                ))
                              ) : (
                                <span className="wonder-card__muted">{STATUS_HINT[status]}</span>
                              )}
                            </span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
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
 * AND the "Some facts" facts — only facts we actually know are written
 * (per the info-screen rule: never invent).
 */
const WonderEntryModal: React.FC<WonderEntryModalProps> = ({ show, wonderId, onHide }) => {
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
          <WonderArtwork wonder={wonder} active={show} />

          <div className="wonder-entry-meta">
          <span className="wonder-entry-meta__chip">🛡 {wonder.cost} shields</span>
          <span className="wonder-entry-meta__chip">
            🔬 {formatTechName(wonder.requiredTechnology)}
          </span>
          <span className="wonder-entry-meta__chip">
            ⏳ {wonder.obsoleteBy ? `Obsolete: ${formatTechName(wonder.obsoleteBy)}` : 'Never obsolete'}
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
                ⚠ OBSOLETE — {formatTechName(wonder.obsoleteBy)} was discovered somewhere; the
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
            <h6>Some facts</h6>
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
      <Modal show={show} onHide={onHide} centered size="xl" dialogClassName="wonders-modal">
        <Modal.Header closeButton closeVariant="white">
          <Modal.Title>🏆 Wonders of the World</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <WondersOverview onOpenEntry={(id) => setEntryId(id)} />
        </Modal.Body>
        <Modal.Footer>
          <span className="me-auto text-white-50 small">
            {WONDERS.length} unique wonders · first civilization to finish one owns it forever
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
