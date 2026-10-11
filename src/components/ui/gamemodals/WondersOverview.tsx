import React, { useMemo, useState } from 'react';
import { Modal } from 'react-bootstrap';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import { useGameStore } from '@/stores/GameStore';
import { centerCameraOnTile, getGameViewport } from '@/utils/CameraUtils';
import {
  WONDERS,
  WONDER_GROUPS,
  computeWonderStatuses,
  findWonderBuilders,
  findWonderOwner,
  isWonderObsolete,
  type WonderDefinition,
  type WonderEra,
  type WonderStatus,
} from '@/data/WonderData';
import { WonderCreditFor } from './WonderArtwork';
import GameModal from './ModalShell';
import '@/styles/wonders.css';

/** Artwork URL for the hero image — the same path `WonderArtwork` fetches. */
const wonderArtSrc = (wonder: WonderDefinition): string =>
  `${import.meta.env.BASE_URL}${wonder.image}`;

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

/** One wonder card in the ledger — also reused for group members. */
function WonderCardItem({
  row,
  civilizations,
  activePlayer,
  onOpenEntry,
  compact = false,
}: {
  row: WonderRowData;
  civilizations: CivLike[];
  activePlayer: number;
  onOpenEntry: (wonderId: string) => void;
  /**
   * Compact cards (group members) skip the meta block — cost, tech,
   * obsolescence and holder are identical for every member (or one click
   * away in the full entry), so repeating them clutters the group.
   */
  compact?: boolean;
}) {
  const { wonder, status, ownerCivId, builderCivIds, obsolete } = row;
  const builders = builderCivIds.filter((id) => id !== ownerCivId);
  return (
    <li>
      <button
        type="button"
        className={`wonder-card wonder-card--${status}`}
        onClick={() => onOpenEntry(wonder.id)}
        title={`Open Civilopedia entry: ${wonder.name}`}
      >
        <span className="wonder-card__lead">
          <span className="wonder-card__icon" aria-hidden="true">
            {/* Space stations identify by their programme flag, not a generic craft */}
            {compact ? wonder.flag : wonder.icon}
          </span>
          <span className="wonder-card__name">{wonder.name}</span>
          <span className="wonder-card__flag" title={wonder.location} aria-hidden="true">
            {wonder.flag}
          </span>
          <span className={`gm-chip wonder-chip wonder-chip--${status}`}>{STATUS_LABEL[status]}</span>
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

        {!compact && (
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
        )}
      </button>
    </li>
  );
}

/**
 * Scrollable ledger of all 23 wonders with the spec's colour-coded statuses,
 * cost / technology / obsolescence details and the civilization that holds (or
 * is building) each one. Grouped by documentation-only era for readability.
 */
const WondersOverview: React.FC<WondersOverviewProps> = ({ onOpenEntry }) => {
  const rows = useWonderRows();
  const civilizations = useGameStore((s) => s.civilizations);
  const activePlayer = useGameStore((s) => s.gameState.activePlayer);
  // Collapsed group ids — empty means every group is expanded.
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const toggleGroup = (groupId: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });

  /**
   * Era rows with mutually exclusive groups folded into one expandable block
   * at the first member's position. Members keep their own cards (and their
   * own full Civilopedia entries) — the block is only an optical grouping.
   */
  const renderEraRows = (eraRows: WonderRowData[]) => {
    const seenGroups = new Set<string>();
    return eraRows.map((row) => {
      const groupId = row.wonder.groupId;
      if (!groupId) {
        return (
          <WonderCardItem
            key={row.wonder.id}
            row={row}
            civilizations={civilizations}
            activePlayer={activePlayer}
            onOpenEntry={onOpenEntry}
          />
        );
      }
      if (seenGroups.has(groupId)) return null;
      seenGroups.add(groupId);
      const group = WONDER_GROUPS[groupId];
      const members = rows.filter((r) => r.wonder.groupId === groupId);
      const collapsed = collapsedGroups.has(groupId);
      // Shared specs, shown once: the data test guarantees group members
      // share cost, tech and obsolescence.
      const spec = members[0]?.wonder;
      return (
        <li key={`group-${groupId}`} className="wonder-group">
          <button
            type="button"
            className="wonder-group__header"
            onClick={() => toggleGroup(groupId)}
            aria-expanded={!collapsed}
            title={collapsed ? `Expand ${group?.name ?? groupId}` : `Collapse ${group?.name ?? groupId}`}
          >
            <span className="wonder-group__icons" aria-hidden="true">
              {members.map((m) => (
                <span key={m.wonder.id} title={m.wonder.name}>
                  {/* Grouped wonders (space stations) show the programme flag */}
                  {m.wonder.groupId ? m.wonder.flag : m.wonder.icon}
                </span>
              ))}
            </span>
            <span className="wonder-group__name">{group?.name ?? groupId}</span>
            <span className="wonder-group__blurb">{group?.blurb ?? ''}</span>
            <span className="wonder-group__count" title={`${members.length} wonders`}>
              {members.length}
            </span>
            <span className="wonder-group__chevron" aria-hidden="true">
              {collapsed ? '▶' : '▼'}
            </span>
          </button>
          {spec && (
            <div className="wonder-group__specs">
              Cost {spec.cost} shields · Requires {formatTechName(spec.requiredTechnology)} · Obsolete by{' '}
              {spec.obsoleteBy ? formatTechName(spec.obsoleteBy) : 'Never'}
            </div>
          )}
          {!collapsed && (
            <ul className="wonder-group__members">
              {members.map((m) => (
                <WonderCardItem
                  key={m.wonder.id}
                  row={m}
                  civilizations={civilizations}
                  activePlayer={activePlayer}
                  onOpenEntry={onOpenEntry}
                  compact
                />
              ))}
            </ul>
          )}
        </li>
      );
    });
  };

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
                {renderEraRows(eraRows)}
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

/** A spec chip with an explanation — the numbers mean little without them. */
const SpecChip: React.FC<{ tip: string; children: React.ReactNode; className?: string }> = ({
  tip,
  children,
  className,
}) => (
  <OverlayTrigger
    placement="top"
    delay={{ show: 120, hide: 60 }}
    overlay={<Tooltip className={`wonder-chip-tip ${className ?? ''}`.trim()}>{tip}</Tooltip>}
  >
    <span className={`gm-chip${className ? ` ${className}` : ''}`} tabIndex={0}>
      {children}
    </span>
  </OverlayTrigger>
);

/**
 * The artwork on its own, large. Reached by clicking the hero picture.
 */
const WonderZoom: React.FC<{ wonder: WonderDefinition; show: boolean; onHide: () => void }> = ({
  wonder,
  show,
  onHide,
}) => (
  <Modal show={show} onHide={onHide} centered size="lg" className="gm" dialogClassName="wonder-zoom" contentClassName="gm-modal">
    <Modal.Body className="gm-body" data-tone="gold">
      <button type="button" className="gm-close" onClick={onHide} aria-label="Close">
        <i className="bi bi-x-lg" aria-hidden="true" />
      </button>
      <img className="wonder-zoom__img" src={wonderArtSrc(wonder)} alt={`${wonder.name} — ${wonder.fullName}`} />
      <div className="wonder-zoom__caption">
        <span className="wonder-zoom__name">
          {wonder.icon} {wonder.name}
        </span>
        <WonderCreditFor wonder={wonder} />
      </div>
    </Modal.Body>
  </Modal>
);

/**
 * Full wonder entry: the artwork is the hero, then the mechanical payoff, the
 * story, and the facts — only facts we actually know are written (per the
 * info-screen rule: never invent).
 */
const WonderEntryModal: React.FC<WonderEntryModalProps> = ({ show, wonderId, onHide }) => {
  const rows = useWonderRows();
  const civilizations = useGameStore((s) => s.civilizations);
  const cities = useGameStore((s) => s.cities);
  const camera = useGameStore((s) => s.camera);
  const map = useGameStore((s) => s.map);
  const activePlayer = useGameStore((s) => s.gameState.activePlayer);
  const actions = useGameStore((s) => s.actions);
  const [zoomed, setZoomed] = useState(false);
  const row = rows.find((r) => r.wonder.id === wonderId) ?? null;
  const wonder = row?.wonder;
  const obsolete = wonder ? isWonderObsolete(wonder.id, civilizations) : false;

  if (!wonder) return null;

  const ownerName = civName(civilizations, row?.ownerCivId ?? null);
  const ownerIsYou = row?.ownerCivId === activePlayer;
  const builderNames = (row?.builderCivIds ?? []).map((id) => civName(civilizations, id));
  const status = row?.status ?? 'available';

  /** The city actually holding the wonder, if it has been built in this world. */
  const wonderCity = cities.find(
    (c) => c.civilizationId === row?.ownerCivId && (c.buildings ?? []).includes(wonder.id),
  );

  /** Jump the camera to the wonder's city and open it. */
  const goToWonder = (): void => {
    if (!wonderCity) return;
    const viewport = getGameViewport();
    const next = centerCameraOnTile({
      col: wonderCity.col,
      row: wonderCity.row,
      zoom: camera.zoom,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      mapWidth: map.width,
      mapHeight: map.height,
    });
    actions.updateCamera(next);
    actions.selectCity(wonderCity.id, 'user');
    onHide();
  };

  return (
    <>
    <GameModal
      show={show}
      onClose={onHide}
      tone="gold"
      size="lg"
      className="wonder-entry-overlay"
      dialogClassName="wonder-entry-modal"
      eyebrow={<>Civilopedia · {ERA_LABEL[wonder.era]}</>}
      title={
        <>
          {wonder.icon} {wonder.name}
        </>
      }
      lede={<>{wonder.fullName} — {wonder.shortEffect}</>}
      artLayout="cover"
      artSrc={wonderArtSrc(wonder)}
      artAlt={`${wonder.name} — ${wonder.fullName}`}
      artLabel="wonder illustration"
      artCredit={<WonderCreditFor wonder={wonder} variant="hero" />}
      onArtClick={() => setZoomed(true)}
      actions={
        <>
          {wonderCity && (
            <button type="button" className="touch-btn touch-btn--primary" onClick={goToWonder}>
              📍 Go to {wonderCity.name}
            </button>
          )}
          <span className="gm-actions-spacer" />
          <button type="button" className="touch-btn touch-btn--ghost" onClick={onHide}>
            Close
          </button>
        </>
      }
    >
      <div className="wonder-entry-meta">
        <span className={`gm-chip wonder-chip wonder-chip--${status}`}>{STATUS_LABEL[status]}</span>
        <SpecChip
          tip={`Shields this wonder costs. A city spends its whole shield output on one project at a time.`}
          className="wonder-chip-spec"
        >
          🛡 {wonder.cost} shields
        </SpecChip>
        <SpecChip tip={`You must have researched ${formatTechName(wonder.requiredTechnology)} before a city can start it.`}>
          🔬 {formatTechName(wonder.requiredTechnology)}
        </SpecChip>
        <SpecChip
          tip={
            wonder.obsoleteBy
              ? `Once ANY civilization researches ${formatTechName(wonder.obsoleteBy)}, the effect stops working for everyone — the wonder still counts for score.`
              : 'This wonder never becomes obsolete; its effect lasts to the end of the game.'
          }
        >
          ⏳ {wonder.obsoleteBy ? `Obsolete: ${formatTechName(wonder.obsoleteBy)}` : 'Never obsolete'}
        </SpecChip>
        <SpecChip tip="Wonders cost nothing to maintain, and can never be sold.">
          🔧 No maintenance
        </SpecChip>
        <SpecChip tip={`Where it stands in the real world: ${wonder.location}.`} className="gm-chip--accent">
          <span aria-hidden="true">{wonder.flag}</span> {wonder.location}
        </SpecChip>
      </div>

      <div className="gm-note">
        {row?.ownerCivId !== null && row?.ownerCivId !== undefined ? (
          <>
            ✅ Built by <strong>{ownerIsYou ? 'you' : ownerName}</strong>
            {ownerName
              ? ownerIsYou
                ? ' — the wonder stands in your cities and scores for you.'
                : ' — the wonder stands in their cities and scores for them.'
              : ''}
            {wonderCity && (
              <>
                {' '}
                in <strong>{wonderCity.name}</strong>.
              </>
            )}
          </>
        ) : builderNames.length > 0 ? (
          <>🏗 Under construction by {builderNames.join(', ')} — first to finish claims it.</>
        ) : (
          <>⏳ Nobody has started this wonder yet.</>
        )}
      </div>

      {/* The payoff first: what the wonder actually does to your empire. */}
      <section className="gm-section wonder-entry-effect">
        <h3 className="gm-section-title">
          <span aria-hidden="true">{wonder.icon}</span> Effect
        </h3>
        {obsolete && (
          <div className="gm-callout">
            <span className="gm-callout-title">Obsolete</span>
            ⚠ {formatTechName(wonder.obsoleteBy)} was discovered somewhere; the effect is switched off (the
            wonder still scores).
          </div>
        )}
        <p className="gm-prose">{wonder.effectText}</p>
      </section>

      <section className="gm-section">
        <h3 className="gm-section-title">History</h3>
        <p className="gm-prose">{wonder.flavor}</p>
      </section>

      {wonder.about && (
        <section className="gm-section">
          <h3 className="gm-section-title">Trivia</h3>
          <p className="gm-prose">{wonder.about}</p>
        </section>
      )}

      {wonder.facts.length > 0 && (
        <section className="gm-section">
          <h3 className="gm-section-title">Some facts</h3>
          <ul className="gm-list wonder-entry-facts">
            {wonder.facts.map((fact, i) => (
              <li key={i}>{fact}</li>
            ))}
          </ul>
        </section>
      )}
    </GameModal>
    <WonderZoom wonder={wonder} show={zoomed} onHide={() => setZoomed(false)} />
    </>
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
      <GameModal
        show={show}
        onClose={onHide}
        tone="gold"
        size="xl"
        dialogClassName="wonders-modal"
        eyebrow="World Heritage"
        title="Wonders of the World"
        lede="Every wonder raised in this world — and every one still waiting to be claimed. Who holds it, who races you for it, what it costs and what it gives: choose an entry to open its chronicle."
        icon="🏆"
        artLabel="wonder gallery"
        actions={
          <>
            <span className="wonders-modal__note">
              {WONDERS.length} unique wonders · first civilization to finish one owns it forever
            </span>
            <span className="gm-actions-spacer" />
            <button type="button" className="touch-btn touch-btn--ghost" onClick={onHide}>
              Close
            </button>
          </>
        }
      >
        <WondersOverview onOpenEntry={(id) => setEntryId(id)} />
      </GameModal>
      <WonderEntryModal show={!!entryId} wonderId={entryId} onHide={() => setEntryId(null)} />
    </>
  );
};

export default WondersOverviewModal;
