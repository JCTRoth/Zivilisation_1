import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Form } from 'react-bootstrap';
import { CIVILIZATIONS, DIFFICULTY_LEVELS } from '@/data/GameData';
import { LEADER_PORTRAITS } from '@/data/LeaderPortraits';
import LeaderPortrait from '@/components/ui/LeaderPortrait';
import { useTranslation } from '@/i18n/useTranslation';
import { translateDynamic, type TranslationKey } from '@/i18n';
import LanguageSwitcher from '@/components/ui/LanguageSwitcher';
import { defaultNationIndexForBrowser } from '@/data/CivilizationByLanguage';
import { tGovernmentName } from '@/i18n/dataNames';
import '../../styles/gameModalShell.css';
import '../../styles/gameSetupModal.css';
import { isAutoScenario } from '@/data/GameConstants';
import { validateTeamAssignments } from '@/game/engine/TeamManager';
import { TEAM_COLORS } from '@/data/TeamConstants';
import {
  MAP_DIM_MAX_HEIGHT,
  MAP_DIM_MAX_WIDTH,
  MAP_DIM_MIN_HEIGHT,
  MAP_DIM_MIN_WIDTH,
  MAP_SIZE_PRESETS,
  STANDARD_MAP_HEIGHT,
  STANDARD_MAP_WIDTH,
  clampMapHeight,
  clampMapWidth,
  mapTiles,
  presetForSize,
  sizeFactorLabel,
  tilesPerCiv,
  type MapSizePreset,
} from '@/data/MapSizePresets';

/** Translation keys for the map presets — the raw ids are for the engine. */
const MAP_TYPE_LABEL_KEYS: Record<string, TranslationKey> = {
  NORMAL_SKIRMISH: 'setup.mapLabel.NORMAL_SKIRMISH',
  EARTH: 'setup.mapLabel.EARTH',
  CLOSEUP_1V1: 'setup.mapLabel.CLOSEUP_1V1',
  CLOSEUP_BEATUP: 'setup.mapLabel.CLOSEUP_BEATUP',
  NAVAL_CLOSEUP: 'setup.mapLabel.NAVAL_CLOSEUP',
  NO_SETTLERS: 'setup.mapLabel.NO_SETTLERS',
  MANY_CITIES: 'setup.mapLabel.MANY_CITIES',
  TECH_LEVEL_10: 'setup.mapLabel.TECH_LEVEL_10',
  ALL_UNITS: 'setup.mapLabel.ALL_UNITS',
  AI_VS_AI: 'setup.mapLabel.AI_VS_AI',
  AI_VS_AI_SMALL: 'setup.mapLabel.AI_VS_AI_SMALL',
  AI_VS_AI_NAVAL: 'setup.mapLabel.AI_VS_AI_NAVAL',
  AEGEAN_CAMPAIGN: 'setup.mapLabel.AEGEAN_CAMPAIGN',
};

/** Full option text of the map preset select ("Label · description"). */
const MAP_TYPE_OPTION_KEYS: Record<string, TranslationKey> = {
  NORMAL_SKIRMISH: 'setup.mapOption.NORMAL_SKIRMISH',
  EARTH: 'setup.mapOption.EARTH',
  CLOSEUP_1V1: 'setup.mapOption.CLOSEUP_1V1',
  CLOSEUP_BEATUP: 'setup.mapOption.CLOSEUP_BEATUP',
  NAVAL_CLOSEUP: 'setup.mapOption.NAVAL_CLOSEUP',
  NO_SETTLERS: 'setup.mapOption.NO_SETTLERS',
  MANY_CITIES: 'setup.mapOption.MANY_CITIES',
  TECH_LEVEL_10: 'setup.mapOption.TECH_LEVEL_10',
  ALL_UNITS: 'setup.mapOption.ALL_UNITS',
  AI_VS_AI: 'setup.mapOption.AI_VS_AI',
  AI_VS_AI_SMALL: 'setup.mapOption.AI_VS_AI_SMALL',
  AI_VS_AI_NAVAL: 'setup.mapOption.AI_VS_AI_NAVAL',
  AEGEAN_CAMPAIGN: 'setup.mapOption.AEGEAN_CAMPAIGN',
};

/** Map type categories for organized dropdown with <optgroup>.
 *
 * Ordering rule: every human-playable group comes first, the AI-vs-AI
 * spectator group is ALWAYS last — never interleave them, a human browsing
 * the list must never trip over a self-playing map mid-way.
 */
interface MapTypeCategory {
  label: TranslationKey;
  types: string[];
}

const MAP_TYPE_CATEGORIES: MapTypeCategory[] = [
  {
    label: 'setup.mapCategory.standard',
    types: ['NORMAL_SKIRMISH', 'EARTH'],
  },
  {
    label: 'setup.mapCategory.closeup',
    types: ['CLOSEUP_1V1', 'CLOSEUP_BEATUP', 'NAVAL_CLOSEUP'],
  },
  {
    label: 'setup.mapCategory.scenarios',
    types: ['NO_SETTLERS', 'MANY_CITIES', 'TECH_LEVEL_10', 'ALL_UNITS'],
  },
  {
    label: 'setup.mapCategory.naval',
    types: ['AEGEAN_CAMPAIGN'],
  },
  {
    label: 'setup.mapCategory.ai_vs_ai',
    types: ['AI_VS_AI', 'AI_VS_AI_SMALL', 'AI_VS_AI_NAVAL'],
  },
];

/**
 * Fixed (hand-authored) maps: identical shores every game, so the map-size
 * tool is hidden for them and they carry the 🗺️ badge. Keep in sync with the
 * engine's `staticMapType` list in `GameEngine` — a map the engine generates
 * must never wear the badge.
 */
const FIXED_MAP_TYPES: ReadonlySet<string> = new Set([
  'EARTH',
  'NAVAL_CLOSEUP',
  'AI_VS_AI_NAVAL',
  'AEGEAN_CAMPAIGN',
]);

/**
 * One glanceable glyph per map, prefixed to the option text (native
 * `<option>` cannot render HTML, but emoji travel fine). 🤖 marks the
 * self-playing AI-vs-AI maps; everything else gets a flavor icon so the
 * list scans without reading every description.
 */
const MAP_TYPE_ICONS: Record<string, string> = {
  NORMAL_SKIRMISH: '⚔️',
  EARTH: '🌍',
  CLOSEUP_1V1: '🤺',
  CLOSEUP_BEATUP: '💥',
  NAVAL_CLOSEUP: '🌊',
  NO_SETTLERS: '🛡️',
  MANY_CITIES: '🏙️',
  TECH_LEVEL_10: '🔬',
  ALL_UNITS: '🎖️',
  AEGEAN_CAMPAIGN: '⚓',
  AI_VS_AI: '🤖',
  AI_VS_AI_SMALL: '🤖',
  AI_VS_AI_NAVAL: '🤖',
};

/** Icon prefix for a map option/summary label, e.g. "🤖", "🌍🗺️", or "". */
function mapTypeBadge(mapType: string): string {
  const icon = MAP_TYPE_ICONS[mapType] ?? '';
  const fixed = FIXED_MAP_TYPES.has(mapType) ? '🗺️' : '';
  return `${icon}${fixed}`;
}

type GameSetupModalProps = {
  show: boolean;
  onStart: (settings: {
    playerCivilization: number;
    difficulty: string;
    numberOfCivilizations: number;
    mapType: string;
    devMode: boolean;
    mapWidth?: number;
    mapHeight?: number;
    landMass: number;
    temperature: number;
    climate: number;
    age: number;
    gameMode?: 'single' | 'hotseat';
    humanPlayerIds?: number[];
    playerCivilizations?: (number | null)[];
    playerColors?: (string | null)[];
    playerSpawns?: (number | null)[];
    fixedAlliances?: boolean;
    teamAssignments?: number[];
  }) => void;
};

/**
 * One row of the setup lobby: who this seat is, in every way the player can
 * set it before the first turn. Slot 0 is "you".
 */
type SetupPlayer = {
  /** CIVILIZATIONS index, or `-1` for a random unused nation. */
  civIndex: number;
  isHuman: boolean;
  /** '' = the faction's own colour; otherwise a per-seat override. */
  color: string;
  /** Team index (only meaningful with fixed alliances on). */
  team: number;
  /** `-1` = Auto; otherwise the 0-based spawn-point index (west → east). */
  spawn: number;
};

/**
 * The war council — the fullscreen room where the player takes the seat
 * above the board before the first turn exists.
 *
 * Not a floating dialog: a fixed, full-viewport command screen (sky, map
 * table, sealed orders). The player is the mind above the board; this screen
 * is where they claim the chair.
 *
 * e2e contract (do not rename): the load-bearing strings ("Zivilisation 1",
 * "Choose Your Civilization" / "Fine-tune Your Challenge", "Your Setup",
 * "Next →" / "← Previous" / "🏛️ Start Game") live in the English dictionary
 * (`setup.*`), so with the default language the rendered text is identical.
 * Additionally: .setup-civ-card · .setup-footer · .setup-footer__selected-value
 * · .setup-summary · .setup-summary-title · LAST select.setup-setting__control
 * = map preset.
 */

function isStaticMapType(mapType: string): boolean {
  return FIXED_MAP_TYPES.has(mapType);
}

/**
 * Whether the world-shaping sliders (land mass, temperature, climate, age)
 * change the world for this map type.
 *
 * The engine has FOUR world generators, and only one of them reads those four
 * settings:
 *
 *  - `MapGenerator.generate()` — the 8-stage procedural one used by
 *    NORMAL_SKIRMISH, CLOSEUP_1V1, CLOSEUP_BEATUP, NO_SETTLERS, MANY_CITIES,
 *    TECH_LEVEL_10, ALL_UNITS and both AI-vs-AI procedural maps. All four
 *    sliders shape it (stages 1–6).
 *  - `MapGenerator.generateWaterOnly()` — NAVAL_CLOSEUP's all-ocean world. It
 *    writes one terrain and draws resources; every slider is inert.
 *  - `MapGenerator.generateFromStatic()` — the hand-authored maps (EARTH and
 *    both archipelago scenarios). The terrain is read from a JSON file. The
 *    only thing that varies is how many rivers `stage5_Rivers` draws, and that
 *    is a function of landMass + climate — a sprinkle, not a world setting.
 *
 * A slider that does nothing is a promise the engine does not keep, so the
 * dialog asks the generator's own trigger instead of imagining. Keep in sync
 * with the `staticMapType` list in `GameEngine` and the branch table in
 * `MapGenerator`.
 */
function worldShapingSettingsHaveEffect(mapType: string): boolean {
  return !FIXED_MAP_TYPES.has(mapType);
}

/**
 * Whether the Dev-Mode toggle has an effect. AI-vs-AI maps force it on (an
 * unwatchable spectator game is not a game), so the checkbox is a switch that
 * cannot be switched.
 */
function devModeSettingHasEffect(mapType: string): boolean {
  return !isAutoScenario(mapType);
}

/**
 * The map size chooser — a true-scale world preview plus a preset ladder,
 * sliders and live statistics.
 *
 * The preview measures its own stage (ResizeObserver) and renders every
 * world at one constant scale, so a 24×16 duel visibly is a tenth of a
 * 240×150 epic: what the player drags is what the engine generates. The
 * dashed ghost is the standard 80×50 world (or the preset under the
 * pointer), always at the same scale.
 */
type MapSizeToolProps = {
  width: number;
  height: number;
  /** Civilizations in play — the density stat divides the world by this. */
  civCount: number;
  onChange: (width: number, height: number) => void;
};

/** Stage size assumed until the ResizeObserver reports the real content box. */
const STAGE_FALLBACK_WIDTH = 296;
const STAGE_FALLBACK_HEIGHT = 168;

type MapSizeFieldProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (next: number) => void;
};

/**
 * One dimension row: a range for the sweep, a number box for the exact
 * figure. The box edits a draft string while focused and commits on blur or
 * Enter, so typing "50" is never interrupted by the controlled value
 * clamping an intermediate "5".
 */
function MapSizeField({ label, value, min, max, onCommit }: MapSizeFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);

  const commitDraft = () => {
    if (draft === null) return;
    const text = draft.trim();
    setDraft(null);
    if (text === '') return;
    onCommit(Number(text));
  };

  return (
    <label className="map-size-tool__field">
      <span className="map-size-tool__field-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onCommit(Number(e.currentTarget.value))}
        aria-label={label}
      />
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitDraft();
        }}
        className="map-size-tool__number"
        aria-label={label}
      />
    </label>
  );
}

function MapSizeTool({ width, height, civCount, onChange }: MapSizeToolProps) {
  const { t, formatNumber } = useTranslation();
  const [hoverPresetId, setHoverPresetId] = useState<string | null>(null);
  const [aspectLocked, setAspectLocked] = useState(false);
  const lockRatioRef = useRef(width / Math.max(1, height));
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageBox, setStageBox] = useState({
    width: STAGE_FALLBACK_WIDTH,
    height: STAGE_FALLBACK_HEIGHT,
  });

  // Measure the stage: one constant pixels-per-tile scale for the whole
  // tool, which is what makes two worlds comparable at a glance.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      setStageBox({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scale = Math.min(
    stageBox.width / MAP_DIM_MAX_WIDTH,
    stageBox.height / MAP_DIM_MAX_HEIGHT,
  );

  const commit = useCallback(
    (nextWidth: number, nextHeight: number) =>
      onChange(clampMapWidth(nextWidth), clampMapHeight(nextHeight)),
    [onChange],
  );

  const setWidth = (raw: number) => {
    const nextW = clampMapWidth(raw);
    commit(nextW, aspectLocked ? nextW / lockRatioRef.current : height);
  };

  const setHeight = (raw: number) => {
    const nextH = clampMapHeight(raw);
    commit(aspectLocked ? nextH * lockRatioRef.current : width, nextH);
  };

  const applyPreset = (preset: MapSizePreset) => {
    // A preset is a statement about both axes — it re-anchors the locked
    // ratio instead of being squeezed through the old one.
    lockRatioRef.current = preset.width / preset.height;
    setHoverPresetId(null);
    commit(preset.width, preset.height);
  };

  const toggleLock = () => {
    if (aspectLocked) {
      setAspectLocked(false);
      return;
    }
    lockRatioRef.current = width / Math.max(1, height);
    setAspectLocked(true);
  };

  const activePreset = presetForSize(width, height);
  const hoveredPreset = hoverPresetId
    ? MAP_SIZE_PRESETS.find((p) => p.id === hoverPresetId) ?? null
    : null;
  const ghost =
    hoveredPreset && (hoveredPreset.width !== width || hoveredPreset.height !== height)
      ? { kind: 'preset' as const, width: hoveredPreset.width, height: hoveredPreset.height }
      : !hoveredPreset && (width !== STANDARD_MAP_WIDTH || height !== STANDARD_MAP_HEIGHT)
        ? { kind: 'standard' as const, width: STANDARD_MAP_WIDTH, height: STANDARD_MAP_HEIGHT }
        : null;

  const tiles = mapTiles(width, height);
  const factorLabel = sizeFactorLabel(width, height);
  const perCiv = tilesPerCiv(width, height, civCount);

  return (
    <div
      className="map-size-tool"
      role="group"
      aria-label={t('setup.mapSizeTitle')}
    >
      <div className="map-size-tool__stage-col">
        <div className="map-size-tool__stage" ref={stageRef} aria-hidden="true">
          <div
            className="map-size-tool__map"
            style={{ width: width * scale, height: height * scale }}
          >
            <div className="map-size-tool__grid" />
            {ghost && (
              <div
                className={`map-size-tool__ghost map-size-tool__ghost--${ghost.kind}`}
                style={{ width: ghost.width * scale, height: ghost.height * scale }}
              />
            )}
          </div>
        </div>
        <div className="map-size-tool__stage-foot">
          <div className="map-size-tool__readout" aria-hidden="true">
            {width}
            <span className="map-size-tool__times">×</span>
            {height}
          </div>
          <p className="map-size-tool__legend">
            <span className="map-size-tool__legend-swatch" aria-hidden="true" />
            {t('setup.sizeLegend')}
          </p>
        </div>
      </div>

      <div className="map-size-tool__panel">
        <div
          className="map-size-tool__presets"
          role="group"
          aria-label={t('setup.sizePresets')}
        >
          {MAP_SIZE_PRESETS.map((preset) => {
            const isActive = activePreset?.id === preset.id;
            const preview = () => setHoverPresetId(preset.id);
            const unpreview = () =>
              setHoverPresetId((current) => (current === preset.id ? null : current));
            return (
              <button
                key={preset.id}
                type="button"
                className={`map-size-tool__chip${isActive ? ' is-active' : ''}`}
                aria-pressed={isActive}
                onClick={() => applyPreset(preset)}
                onMouseEnter={preview}
                onMouseLeave={unpreview}
                onFocus={preview}
                onBlur={unpreview}
              >
                <span className="map-size-tool__chip-name">{t(preset.labelKey)}</span>
                <span className="map-size-tool__chip-dims">
                  {preset.width}×{preset.height}
                </span>
              </button>
            );
          })}
        </div>

        <div className="map-size-tool__sliders">
          <MapSizeField
            label={t('setup.sizeWidth')}
            value={width}
            min={MAP_DIM_MIN_WIDTH}
            max={MAP_DIM_MAX_WIDTH}
            onCommit={setWidth}
          />
          <MapSizeField
            label={t('setup.sizeHeight')}
            value={height}
            min={MAP_DIM_MIN_HEIGHT}
            max={MAP_DIM_MAX_HEIGHT}
            onCommit={setHeight}
          />
          <button
            type="button"
            className="map-size-tool__lock"
            aria-pressed={aspectLocked}
            onClick={toggleLock}
          >
            {t('setup.sizeLock')}
          </button>
        </div>

        <div className="map-size-tool__stats">
          <span className="map-size-tool__stat">
            <strong>{formatNumber(tiles)}</strong>
            {t('setup.sizeTiles')}
          </span>
          <span className="map-size-tool__stat">
            <strong>{factorLabel}×</strong>
            {t('setup.sizeVsStandard')}
          </span>
          <span className="map-size-tool__stat">
            <strong>{formatNumber(perCiv)}</strong>
            {t('setup.sizePerCiv')}
          </span>
        </div>
      </div>
    </div>
  );
}

function GameSetupModal({ show, onStart }: GameSetupModalProps) {
  // Subscribes the whole wizard to language changes.
  const { t, language, setLanguage } = useTranslation();
  // Drag-to-scroll on empty areas of the war table (desktop convenience).
  const bodyRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const capturedRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; scrollTop: number; scrollLeft: number } | null>(null);

  const isInteractive = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return true;
    // Controls routinely wrap their label in spans, so look up the tree, not
    // just at the pressed tag.
    if (target.closest('button, select, input, textarea, a, label, option')) return true;
    return !!target.closest(
      '.setup-civ-card, .setup-summary, .setup-nameplate, .setup-footer, .setup-dossier',
    );
  }, []);

  const handleBodyPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isInteractive(e.target)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = bodyRef.current;
    if (!el) return;
    isPanningRef.current = true;
    capturedRef.current = true;
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
    };
    el.classList.add('is-panning');
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events — pan still works via container handlers */
    }
  }, [isInteractive]);

  const handleBodyPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current || !panStartRef.current) return;
    const el = bodyRef.current;
    if (!el) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    el.scrollTop = panStartRef.current.scrollTop - dy;
    el.scrollLeft = panStartRef.current.scrollLeft - dx;
  }, []);

  const handleBodyPointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capturedRef.current) {
      const el = bodyRef.current;
      el?.classList.remove('is-panning');
      try {
        el?.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    isPanningRef.current = false;
    capturedRef.current = false;
    panStartRef.current = null;
  }, []);

  const [currentStep, setCurrentStep] = useState(1);
  // The nation the wizard opens on follows the browser's own language, which
  // is the only thing that knows whether you are en-US or en-GB — the game
  // language has already thrown the region away. Unrouted browsers keep the
  // standing default.
  const [selectedCiv, setSelectedCiv] = useState(() => defaultNationIndexForBrowser());
  const [difficulty, setDifficulty] = useState('PRINCE');
  const [numCivilizations, setNumCivilizations] = useState(2);
  const [mapType, setMapType] = useState('NORMAL_SKIRMISH');
  const [devMode, setDevMode] = useState(false);
  const [landMass, setLandMass] = useState(1);
  const [temperature, setTemperature] = useState(1);
  const [climate, setClimate] = useState(1);
  const [age, setAge] = useState(1);
  const [mapWidth, setMapWidth] = useState(80);
  const [mapHeight, setMapHeight] = useState(50);
  // ── Players lobby ────────────────────────────────────────────────────
  // One row per civilization slot — the single place that decides who is
  // human, what faction they play, their colour, team and spawn (the C&C-style
  // lobby). Slot 0 is "you" and mirrors the step-1 banner.
  const [players, setPlayers] = useState<SetupPlayer[]>(() =>
    Array.from({ length: numCivilizations }, (_, slot) => ({
      civIndex: slot === 0 ? selectedCiv : -1,
      isHuman: slot === 0,
      color: '',
      team: slot % 2,
      spawn: -1,
    })),
  );

  // Fixed alliances (locked teams) — the game rule; it only decides whether
  // the Team column means anything. Team indices are per civilization SLOT.
  const [fixedAlliances, setFixedAlliances] = useState(false);
  const [teamCount, setTeamCount] = useState(2);
  const maxTeams = Math.max(2, Math.min(4, numCivilizations - 1));

  // Look-around: the war room is a CSS 3D box; the pointer shifts its
  // perspective origin a few degrees so the table and walls feel solid.
  // Pure transforms — no textures, no images. Skipped for reduced motion.
  const worldRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!show) return;
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const onMove = (event: PointerEvent) => {
      const el = worldRef.current;
      if (!el) return;
      const nx = event.clientX / window.innerWidth - 0.5;
      const ny = event.clientY / window.innerHeight - 0.5;
      el.style.setProperty('--setup-look-x', `${(nx * 4).toFixed(2)}deg`);
      el.style.setProperty('--setup-look-y', `${(-ny * 2.5).toFixed(2)}deg`);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [show]);

  // AI-vs-AI scenarios are unwatchable without Dev Mode — force it on.
  useEffect(() => {
    if (isAutoScenario(mapType)) setDevMode(true);

    // Preset sizes mirror GameEngine defaults. Custom dimensions are separate
    // (see DEFAULT_MAP_PRESETS) so changing a map type restores its own base.
    const presets: Record<string, [number, number]> = {
      NORMAL_SKIRMISH: [80, 50],
      EARTH: [180, 90],
      CLOSEUP_1V1: [20, 20],
      CLOSEUP_BEATUP: [20, 20],
      NAVAL_CLOSEUP: [20, 20],
      NO_SETTLERS: [80, 50],
      MANY_CITIES: [80, 50],
      TECH_LEVEL_10: [80, 50],
      ALL_UNITS: [80, 50],
      AI_VS_AI: [40, 40],
      AI_VS_AI_SMALL: [16, 26],
      AI_VS_AI_NAVAL: [96, 60],
      AEGEAN_CAMPAIGN: [96, 60],
    };
    const next = presets[mapType] ?? [80, 50];
    setMapWidth(next[0]);
    setMapHeight(next[1]);
  }, [mapType]);

  // Resize the roster when the number of civilizations changes. Existing rows
  // are kept exactly as the player left them; only new seats get defaults.
  useEffect(() => {
    setPlayers((prev) => {
      if (prev.length === numCivilizations) return prev;
      return Array.from({ length: numCivilizations }, (_, slot) => prev[slot] ?? {
        civIndex: slot === 0 ? selectedCiv : -1,
        isHuman: slot === 0,
        color: '',
        team: slot % 2,
        spawn: -1,
      });
    });
  }, [numCivilizations, selectedCiv]);

  // Seat 0's faction is the step-1 banner pick: mirror it into the roster so
  // the table and the dossier never disagree.
  useEffect(() => {
    setPlayers((prev) => {
      if (!prev[0] || prev[0].civIndex === selectedCiv) return prev;
      const next = [...prev];
      next[0] = { ...next[0], civIndex: selectedCiv };
      return next;
    });
  }, [selectedCiv]);

  // A fixed-alliance game needs at least three civs: with two there is no
  // third party to ally against, and every "team" would be a singleton.
  useEffect(() => {
    if (numCivilizations < 3 && fixedAlliances) setFixedAlliances(false);
  }, [numCivilizations, fixedAlliances]);

  // Keep the team count inside what the current civilization count can
  // support (at least one team must have two members).
  useEffect(() => {
    setTeamCount((count) => Math.min(count, maxTeams));
  }, [maxTeams]);

  // ── Derived ─────────────────────────────────────────────────────────
  const humanSeats = players.map((p, i) => (p.isHuman ? i : -1)).filter((i) => i >= 0);
  const derivedGameMode: 'single' | 'hotseat' = humanSeats.length > 1 ? 'hotseat' : 'single';
  const teamAssignments = players.map((p) => p.team);
  const teamValidation = validateTeamAssignments(
    teamAssignments.slice(0, numCivilizations),
    numCivilizations,
  );
  const teamSetupValid = !fixedAlliances || teamValidation.ok;
  const teamSizes = useMemo(() => {
    const sizes = new Array(Math.max(2, teamCount)).fill(0) as number[];
    for (let slot = 0; slot < players.length; slot++) {
      const team = players[slot]?.team ?? 0;
      if (team >= 0 && team < sizes.length) sizes[team] += 1;
    }
    return sizes;
  }, [players, teamCount]);

  // ── Roster editors ──────────────────────────────────────────────────
  const setPlayer = (slot: number, patch: Partial<SetupPlayer>) => {
    setPlayers((prev) => prev.map((p, i) => (i === slot ? { ...p, ...patch } : p)));
  };

  /** Lay every seat's team out evenly across `count` teams. */
  const balanceTeams = (count: number) => {
    setTeamCount(count);
    setPlayers((prev) => prev.map((p, slot) => ({ ...p, team: slot % count })));
  };

  /** Humans on one team, every AI on the other. */
  const humansVersusAi = () => {
    setTeamCount(2);
    setPlayers((prev) => prev.map((p) => ({ ...p, team: p.isHuman ? 0 : 1 })));
  };

  /**
   * Flip a seat between Human and AI. Seat 0 is "you" — always in the chair so
   * the step-1 banner, the summary and the fog of war agree on who the player
   * is. Any other seat may be a second human (hotseat) or an AI.
   */
  const toggleHuman = (slot: number) => {
    if (slot === 0) return;
    setPlayers((prev) => prev.map((p, i) => (i === slot ? { ...p, isHuman: !p.isHuman } : p)));
  };

  // Faction colour helpers. `<input type="color">` wants #rrggbb, but the
  // nation palette carries 8-digit hex — normalise so the picker opens right.
  const toColorInput = (color: string): string => {
    const hex = (color || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
    if (/^#[0-9a-fA-F]{8}$/.test(hex)) return hex.slice(0, 7);
    return '#888888';
  };
  const factionColor = (civIndex: number): string =>
    (civIndex >= 0 ? CIVILIZATIONS[civIndex]?.color : null) ?? '#888888';
  const rowColor = (p: SetupPlayer): string =>
    (p.color || '').trim() ? p.color : factionColor(p.civIndex);

  /** Grid template shared by the lobby header and rows (Player·Color·Faction·Team·Spawn). */
  const lobbyColumns = '1.15fr 5.4rem 1.95fr 7rem 7rem';

  const totalSteps = 2;
  const isFinalStep = currentStep === totalSteps;

  const difficultyOptions = useMemo<Array<{ id: string; label: string }>>(
    () => Object.entries(DIFFICULTY_LEVELS).map(([id, data]) => ({ id, label: data.name })),
    []
  );

  const civIcons = useMemo<Record<string, React.ReactNode>>(
    () =>
      CIVILIZATIONS.reduce(
        (acc, civ) => {
          let iconNode: React.ReactNode = civ.icon;
          if (typeof civ.icon === 'string') {
            const glyphCount = Array.from(civ.icon).length;
            const fontSize = glyphCount > 1 ? '24px' : '36px';
            iconNode = <span style={{ fontSize }}>{civ.icon}</span>;
          }
          if (civ.name === 'Egyptians') iconNode = <span className="civ-icon-egypt">{iconNode}</span>;
          if (civ.name === 'Russians') iconNode = <span className="civ-icon-russia">{iconNode}</span>;
          if (civ.name === 'Zulus') iconNode = <span className="civ-icon-zulu">{iconNode}</span>;
          acc[civ.name] = iconNode;
          return acc;
        },
        {} as Record<string, React.ReactNode>
      ),
    []
  );

  const sortedCivilizations = useMemo(() => [...CIVILIZATIONS].sort((a, b) => a.name.localeCompare(b.name)), []);

  const selectedCivData = CIVILIZATIONS[selectedCiv] ?? CIVILIZATIONS[0];
  const difficultyName = translateDynamic(
    `data.difficulty.${difficulty}`,
    undefined,
    DIFFICULTY_LEVELS[difficulty]?.name ?? difficulty,
  );
  const mapTypeLabel = translateDynamic(
    `setup.mapLabel.${mapType}`,
    undefined,
    MAP_TYPE_LABEL_KEYS[mapType] ? t(MAP_TYPE_LABEL_KEYS[mapType]) : mapType,
  );
  const mapTypeBadgePrefix = mapTypeBadge(mapType);
  const mapTypeLabelWithBadge = mapTypeBadgePrefix ? `${mapTypeBadgePrefix} ${mapTypeLabel}` : mapTypeLabel;
  const leaderPortrait = LEADER_PORTRAITS[selectedCivData.leader] ?? null;

  // Slider value words (long forms on the sliders, short forms in the summary).
  const landMassNames = [t('setup.landMass.0'), t('setup.landMass.1'), t('setup.landMass.2')];
  const temperatureNames = [t('setup.temperature.0'), t('setup.temperature.1'), t('setup.temperature.2')];
  const climateNames = [t('setup.climate.0'), t('setup.climate.1'), t('setup.climate.2')];
  const ageNames = [t('setup.age.0'), t('setup.age.1'), t('setup.age.2')];
  const landMassShort = [t('setup.landMassShort.0'), t('setup.landMassShort.1'), t('setup.landMassShort.2')];
  const temperatureShort = [t('setup.temperatureShort.0'), t('setup.temperatureShort.1'), t('setup.temperatureShort.2')];
  const climateShort = [t('setup.climateShort.0'), t('setup.climateShort.1'), t('setup.climateShort.2')];
  const ageShort = [t('setup.ageShort.0'), t('setup.ageShort.1'), t('setup.ageShort.2')];

  const stepCopy =
    currentStep === 1
      ? {
          eyebrow: t('setup.step1Eyebrow'),
          title: t('setup.step1Title'),
          lede: t('setup.step1Lede'),
        }
      : {
          eyebrow: t('setup.step2Eyebrow'),
          title: t('setup.step2Title'),
          lede: t('setup.step2Lede'),
        };

  const nextStep = () => {
    if (currentStep < totalSteps) setCurrentStep(currentStep + 1);
  };

  const prevStep = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  const handleStart = () => {
    // Everything the lobby decides, in slot order. `null` entries mean "the
    // engine picks" — a random unused faction, the nation's own colour, or an
    // auto spawn — so an untouched row behaves exactly like a plain game.
    const humanPlayerIds = humanSeats;
    const playerCivilizations = players.map((p) => (p.civIndex >= 0 ? p.civIndex : null));
    const playerColors = players.map((p) => ((p.color || '').trim() ? p.color : null));
    const playerSpawns = players.map((p) => (p.spawn >= 0 ? p.spawn : null));
    onStart({
      playerCivilization: selectedCiv,
      difficulty,
      numberOfCivilizations: numCivilizations,
      mapType,
      devMode,
      mapWidth,
      mapHeight,
      landMass,
      temperature,
      climate,
      age,
      gameMode: derivedGameMode,
      humanPlayerIds,
      playerCivilizations,
      playerColors,
      playerSpawns,
      fixedAlliances: fixedAlliances && teamValidation.ok,
      teamAssignments: fixedAlliances && teamValidation.ok
        ? teamAssignments.slice(0, numCivilizations)
        : undefined,
    });
  };

  if (!show) return null;

  return (
    <div className="setup-screen" role="dialog" aria-modal="true" aria-label={t('setup.ariaDialog')}>
      {/* Pure-CSS 3D war room: sky, receding walls, a tilted map table,
          floating candle orbs. No image assets — only transforms and light. */}
      <div className="setup-screen__world" ref={worldRef} aria-hidden="true">
        <div className="setup-screen__sky" />
        <div className="setup-screen__room">
          <div className="setup-screen__wall setup-screen__wall--left" />
          <div className="setup-screen__wall setup-screen__wall--right" />
          <div className="setup-screen__table">
            <span className="setup-screen__table-face" />
            <span className="setup-screen__table-grid setup-screen__table-grid--near" />
            <span className="setup-screen__table-grid setup-screen__table-grid--far" />
            <span className="setup-screen__table-sheen" />
          </div>
          <div className="setup-screen__candles">
            <i className="setup-candle setup-candle--a" />
            <i className="setup-candle setup-candle--b" />
            <i className="setup-candle setup-candle--c" />
          </div>
        </div>
        <div className="setup-screen__horizon" />
        <div className="setup-screen__glow" />
        <div className="setup-screen__veil" />
      </div>

      <div className="setup-screen__frame">
        {/* Nameplate — the seal of the room */}
        <header className="setup-nameplate">
          <h2 className="modal-title">🏛️ Zivilisation 1</h2>
          <div className="setup-nameplate__right">
            <LanguageSwitcher value={language} onChange={setLanguage} compact />
            <span className="setup-nameplate__tag">{t('setup.nameplateTag')}</span>
            <span className="setup-nameplate__steps" aria-hidden="true">
              <span className={`setup-nameplate__dot${currentStep >= 1 ? ' is-on' : ''}`} />
              <span className={`setup-nameplate__dot${currentStep >= 2 ? ' is-on' : ''}`} />
            </span>
          </div>
        </header>

        {/* Scrollable table surface */}
        <div
          className="setup-screen__scroll"
          ref={bodyRef}
          onPointerDown={handleBodyPointerDown}
          onPointerMove={handleBodyPointerMove}
          onPointerUp={handleBodyPointerEnd}
          onPointerCancel={handleBodyPointerEnd}
        >
          <header className="setup-hero">
            <div className="setup-hero__text">
              <div className="setup-hero__eyebrow">{stepCopy.eyebrow}</div>
              <h3
                className="setup-hero__title"
                id={currentStep === 1 ? 'setup-step-civilization' : 'setup-step-settings'}
              >
                {stepCopy.title}
              </h3>
              <p className="setup-hero__lede">{stepCopy.lede}</p>
            </div>
            <div className="setup-hero__rule" aria-hidden="true" />
          </header>

          <div className="setup-content">
            {/* ---- Step 1: banners ---- */}
            {currentStep === 1 && (
              <section className="setup-section setup-section--banners" aria-labelledby="setup-step-civilization">
                {/* Commander's dossier — who you are about to become */}
                <div className="setup-dossier" aria-live="polite">
                  <div className="setup-dossier__seal" aria-hidden="true">
                    {civIcons[selectedCivData.name] ?? selectedCivData.name.charAt(0)}
                  </div>
                  <div className="setup-dossier__body">
                    <span className="setup-dossier__kicker">{t('setup.yourBannerKicker')}</span>
                    <strong className="setup-dossier__name" style={{ color: selectedCivData.color }}>
                      {selectedCivData.name}
                    </strong>
                    <span className="setup-dossier__leader">
                      {t('setup.commanderInChief')} · <strong>{selectedCivData.leader}</strong>
                    </span>
                    <span className="setup-dossier__swatch" style={{ background: selectedCivData.color }} />
                  </div>
                  {/* Leader face, cropped to the head — the third of the portrait */}
                  <div className="setup-dossier__portrait" aria-hidden="true">
                    {leaderPortrait ? (
                      <LeaderPortrait
                        config={leaderPortrait}
                        mood="neutral"
                        size={110}
                        leaderName={selectedCivData.leader}
                      />
                    ) : (
                      <span className="setup-dossier__portrait-fallback">
                        {selectedCivData.leader.slice(0, 1)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="gm-section setup-peoples">
                  <div className="gm-section-title">{t('setup.raiseBanner')}</div>
                  <div className="setup-civ-list" role="list">
                    {sortedCivilizations.map((civ) => {
                      const originalIndex = CIVILIZATIONS.findIndex((orig) => orig.name === civ.name);
                      const isSelected = selectedCiv === originalIndex;
                      const icon = civIcons[civ.name] ?? civ.name.charAt(0);
                      return (
                        <button
                          key={civ.name}
                          type="button"
                          className={`setup-civ-card ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => {
                            if (originalIndex >= 0) setSelectedCiv(originalIndex);
                          }}
                          aria-pressed={isSelected}
                        >
                          <span className="setup-civ-card__seal" aria-hidden="true">
                            ✔
                          </span>
                          <span className="setup-civ-card__icons-row">
                            <span className="setup-civ-card__icon">{icon}</span>
                          </span>
                          <span className="setup-civ-card__name-row">
                            <span className="setup-civ-card__name" style={{ color: civ.color }}>
                              {civ.name}
                            </span>
                          </span>
                          <span className="setup-civ-card__leader-row">
                            <span className="setup-civ-card__leader">{civ.leader}</span>
                          </span>
                          <span className="setup-civ-card__swatch" style={{ background: civ.color }} aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            {/* ---- Step 2: terms of the campaign ---- */}
            {currentStep === 2 && (
              <section className="setup-section" aria-labelledby="setup-step-settings">
                <div className="gm-section">
                  <div className="gm-section-title">{t('setup.terms')}</div>
                  <div className="setup-settings-grid">
                    <div className="setup-setting">
                      <span className="setup-setting__label">{t('setup.difficulty')}</span>
                      <Form.Select
                        value={difficulty}
                        onChange={(e) => setDifficulty(e.target.value)}
                        className="setup-setting__control"
                        aria-label={t('setup.difficulty')}
                      >
                        {difficultyOptions.map(({ id, label }) => (
                          <option key={id} value={id}>
                            {translateDynamic(`data.difficulty.${id}`, undefined, label)}
                          </option>
                        ))}
                      </Form.Select>
                      <span className="setup-setting__hint">{t('setup.difficultyHint')}</span>
                    </div>

                    <div className="setup-setting">
                      <span className="setup-setting__label">
                        {t('setup.civsCount')} <span className="setup-setting__value">{numCivilizations}</span>
                      </span>
                      <Form.Range
                        min="2"
                        max="7"
                        value={numCivilizations}
                        onChange={(e) => {
                          setNumCivilizations(Number(e.target.value));
                        }}
                        className="setup-setting__control"
                        aria-label={t('setup.civsCount')}
                      />
                      <span className="setup-setting__hint">{t('setup.civsCountHint')}</span>
                    </div>
                  </div>
                </div>

                <div className="gm-section setup-lobby">
                  <div className="gm-section-title">{t('setup.players.title')}</div>
                  <p className="setup-setting__hint">{t('setup.players.lede')}</p>
                  <Form.Check
                    type="checkbox"
                    id="fixedAlliancesCheckbox"
                    label={t('setup.teams.enable')}
                    checked={fixedAlliances}
                    disabled={numCivilizations < 3}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setFixedAlliances(on);
                      if (on) balanceTeams(teamCount);
                    }}
                    className="setup-teams__check"
                  />
                  <p className="setup-setting__hint">
                    {numCivilizations < 3
                      ? t('setup.teams.needThreeCivs')
                      : t('setup.teams.hint')}
                  </p>

                  {fixedAlliances && (
                    <>
                      <div className="setup-teams__presets">
                        <button
                          type="button"
                          className="touch-btn touch-btn--ghost setup-teams__preset"
                          onClick={humansVersusAi}
                        >
                          {t('setup.teams.presetHumans')}
                        </button>
                        <button
                          type="button"
                          className="touch-btn touch-btn--ghost setup-teams__preset"
                          onClick={() => balanceTeams(2)}
                        >
                          {t('setup.teams.presetEven', { n: 2 })}
                        </button>
                        {maxTeams >= 3 && (
                          <button
                            type="button"
                            className="touch-btn touch-btn--ghost setup-teams__preset"
                            onClick={() => balanceTeams(3)}
                          >
                            {t('setup.teams.presetEven', { n: 3 })}
                          </button>
                        )}
                        {maxTeams >= 4 && (
                          <button
                            type="button"
                            className="touch-btn touch-btn--ghost setup-teams__preset"
                            onClick={() => balanceTeams(4)}
                          >
                            {t('setup.teams.presetEven', { n: 4 })}
                          </button>
                        )}
                        <button
                          type="button"
                          className="touch-btn touch-btn--ghost setup-teams__preset"
                          onClick={() => balanceTeams(teamCount)}
                        >
                          {t('setup.teams.autoBalance')}
                        </button>
                      </div>

                      <div className="setup-teams__toolbar">
                        <span className="setup-setting__label">{t('setup.teams.count')}</span>
                        <Form.Select
                          value={String(teamCount)}
                          onChange={(e) => balanceTeams(Number(e.target.value))}
                          className="setup-setting__control setup-teams__count"
                          aria-label={t('setup.teams.count')}
                        >
                          {Array.from({ length: maxTeams - 1 }, (_, i) => i + 2).map((count) => (
                            <option key={count} value={String(count)}>
                              {t('setup.teams.countValue', { n: count })}
                            </option>
                          ))}
                        </Form.Select>
                      </div>
                    </>
                  )}

                  {/* The lobby — every seat, every way the player sets it up.
                      Faction, colour, team and spawn are each live controls. */}
                  <div className="setup-lobby__table" role="table" aria-label={t('setup.players.title')}>
                    <div className="setup-lobby__head" role="row" style={{ gridTemplateColumns: lobbyColumns }}>
                      <span role="columnheader">{t('setup.lobby.colPlayer')}</span>
                      <span role="columnheader">{t('setup.lobby.colColor')}</span>
                      <span role="columnheader">{t('setup.lobby.colFaction')}</span>
                      <span role="columnheader">{t('setup.lobby.colTeam')}</span>
                      <span role="columnheader">{t('setup.lobby.colSpawn')}</span>
                    </div>
                    {players.map((p, slot) => {
                      const human = p.isHuman;
                      const teamColor = TEAM_COLORS[(p.team ?? 0) % TEAM_COLORS.length];
                      return (
                        <div
                          key={slot}
                          className="setup-lobby__row"
                          role="row"
                          style={{ gridTemplateColumns: lobbyColumns, borderLeftColor: fixedAlliances ? teamColor : 'transparent' }}
                        >
                          {/* Player + Human/AI */}
                          <span className="setup-lobby__cell setup-lobby__player" role="cell">
                            <span className="setup-lobby__seat">
                              {slot === 0 ? t('setup.lobby.you') : t('setup.lobby.playerN', { n: slot + 1 })}
                            </span>
                            <button
                              type="button"
                              className={`setup-lobby__type ${human ? 'is-human' : 'is-ai'}`}
                              onClick={() => toggleHuman(slot)}
                              disabled={slot === 0}
                              title={t('setup.lobby.typeHint')}
                            >
                              {human ? t('setup.lobby.human') : t('setup.lobby.ai')}
                            </button>
                          </span>

                          {/* Colour */}
                          <span className="setup-lobby__cell setup-lobby__color" role="cell">
                            <input
                              type="color"
                              className="setup-lobby__swatch"
                              value={toColorInput(rowColor(p))}
                              onChange={(e) => setPlayer(slot, { color: e.target.value })}
                              aria-label={t('setup.lobby.colColor')}
                            />
                            {p.color && (
                              <button
                                type="button"
                                className="setup-lobby__color-reset"
                                onClick={() => setPlayer(slot, { color: '' })}
                                title={t('setup.lobby.colorReset')}
                              >
                                ↺
                              </button>
                            )}
                          </span>

                          {/* Faction */}
                          <span className="setup-lobby__cell" role="cell">
                            <Form.Select
                              value={String(p.civIndex)}
                              onChange={(e) => {
                                const picked = Number(e.target.value);
                                if (slot === 0 && picked >= 0) setSelectedCiv(picked);
                                setPlayer(slot, { civIndex: picked });
                              }}
                              className="setup-setting__control setup-lobby__select"
                              aria-label={t('setup.lobby.colFaction')}
                              style={{ color: rowColor(p) }}
                            >
                              {slot !== 0 && <option value="-1">{t('setup.lobby.random')}</option>}
                              {sortedCivilizations.map((c) => {
                                const originalIndex = CIVILIZATIONS.findIndex((orig) => orig.name === c.name);
                                const takenByOther = players.some((q, i) => i !== slot && q.civIndex === originalIndex);
                                return (
                                  <option key={c.name} value={String(originalIndex)} disabled={takenByOther}>
                                    {civIcons[c.name] ?? ''} {c.name} — {c.leader}
                                  </option>
                                );
                              })}
                            </Form.Select>
                          </span>

                          {/* Team */}
                          <span className="setup-lobby__cell" role="cell">
                            {fixedAlliances ? (
                              <Form.Select
                                value={String(p.team ?? 0)}
                                onChange={(e) => setPlayer(slot, { team: Number(e.target.value) })}
                                className="setup-setting__control setup-lobby__select"
                                aria-label={t('setup.lobby.colTeam')}
                                style={{ borderColor: teamColor }}
                              >
                                {Array.from({ length: teamCount }, (_, teamIndex) => (
                                  <option key={teamIndex} value={String(teamIndex)}>
                                    {t('setup.teams.teamN', { n: teamIndex + 1 })}
                                  </option>
                                ))}
                              </Form.Select>
                            ) : (
                              <span className="setup-lobby__muted">—</span>
                            )}
                          </span>

                          {/* Spawn */}
                          <span className="setup-lobby__cell" role="cell">
                            <Form.Select
                              value={String(p.spawn)}
                              onChange={(e) => setPlayer(slot, { spawn: Number(e.target.value) })}
                              className="setup-setting__control setup-lobby__select"
                              aria-label={t('setup.lobby.colSpawn')}
                            >
                              <option value="-1">{t('setup.lobby.auto')}</option>
                              {Array.from({ length: numCivilizations }, (_, s) => (
                                <option key={s} value={String(s)}>{s + 1}</option>
                              ))}
                            </Form.Select>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="setup-setting__hint">{t('setup.lobby.spawnHint')}</p>

                  {fixedAlliances && (
                    <div className="setup-teams__sizes" aria-live="polite">
                      {teamSizes.map((size, index) => (
                        <span
                          key={index}
                          className="setup-teams__size"
                          style={{ borderColor: TEAM_COLORS[index % TEAM_COLORS.length] }}
                        >
                          {t('setup.teams.teamN', { n: index + 1 })}: {size}
                        </span>
                      ))}
                    </div>
                  )}

                  {fixedAlliances && !teamValidation.ok && (
                    <p className="setup-teams__error" role="alert">
                      {t('setup.teams.invalid')}
                    </p>
                  )}
                </div>

                <div className="gm-section">
                  <div className="gm-section-title">{t('setup.worldSection')}</div>
                  <div className="setup-settings-grid">
                    <div className="setup-setting">
                      <span className="setup-setting__label">{t('setup.mapType')}</span>
                      <Form.Select
                        value={mapType}
                        onChange={(e) => setMapType(e.target.value)}
                        className="setup-setting__control"
                        aria-label={t('setup.mapType')}
                      >
                        {MAP_TYPE_CATEGORIES.map((category) => (
                          <optgroup key={category.label} label={t(category.label)}>
                            {category.types.map((id) => {
                              const key = MAP_TYPE_OPTION_KEYS[id];
                              if (!key) return null;
                              const badge = mapTypeBadge(id);
                              return (
                                <option key={id} value={id}>
                                  {badge ? `${badge} ${t(key)}` : t(key)}
                                </option>
                              );
                            })}
                          </optgroup>
                        ))}
                      </Form.Select>
                      <span className="setup-setting__hint">{t('setup.mapTypeHint')}</span>
                      <span className="setup-setting__hint" aria-hidden="true">
                        {t('setup.mapIconLegend')}
                      </span>
                    </div>
                  </div>
                </div>

                {!isStaticMapType(mapType) && (
                  <div className="gm-section setup-map-size">
                    <div className="gm-section-title">{t('setup.mapSizeTitle')}</div>
                    <MapSizeTool
                      width={mapWidth}
                      height={mapHeight}
                      civCount={numCivilizations}
                      onChange={(w, h) => {
                        // The tool clamps to the engine-safe range itself.
                        setMapWidth(w);
                        setMapHeight(h);
                      }}
                    />
                    <span className="setup-setting__hint">{t('setup.mapSizeHint')}</span>
                  </div>
                )}

                {worldShapingSettingsHaveEffect(mapType) && (
                  <div className="gm-section">
                    <div className="gm-section-title">{t('setup.landSection')}</div>
                    <div className="setup-settings-grid setup-settings-grid--pairs">
                      <div className="setup-setting">
                        <span className="setup-setting__label">
                          {t('setup.landMass')}{' '}
                          <span className="setup-setting__value">{landMassNames[landMass]}</span>
                        </span>
                        <Form.Range
                          min="0"
                          max="2"
                          step="1"
                          value={landMass}
                          onChange={(e) => setLandMass(Number(e.target.value))}
                          className="setup-setting__control"
                          aria-label={t('setup.landMass')}
                        />
                        <span className="setup-setting__hint">{t('setup.landMassHint')}</span>
                      </div>

                      <div className="setup-setting">
                        <span className="setup-setting__label">
                          {t('setup.temperature')}{' '}
                          <span className="setup-setting__value">{temperatureNames[temperature]}</span>
                        </span>
                        <Form.Range
                          min="0"
                          max="2"
                          step="1"
                          value={temperature}
                          onChange={(e) => setTemperature(Number(e.target.value))}
                          className="setup-setting__control"
                          aria-label={t('setup.temperature')}
                        />
                        <span className="setup-setting__hint">{t('setup.temperatureHint')}</span>
                      </div>

                      <div className="setup-setting">
                        <span className="setup-setting__label">
                          {t('setup.climate')}{' '}
                          <span className="setup-setting__value">{climateNames[climate]}</span>
                        </span>
                        <Form.Range
                          min="0"
                          max="2"
                          step="1"
                          value={climate}
                          onChange={(e) => setClimate(Number(e.target.value))}
                          className="setup-setting__control"
                          aria-label={t('setup.climate')}
                        />
                        <span className="setup-setting__hint">{t('setup.climateHint')}</span>
                      </div>

                      <div className="setup-setting">
                        <span className="setup-setting__label">
                          {t('setup.age')} <span className="setup-setting__value">{ageNames[age]}</span>
                        </span>
                        <Form.Range
                          min="0"
                          max="2"
                          step="1"
                          value={age}
                          onChange={(e) => setAge(Number(e.target.value))}
                          className="setup-setting__control"
                          aria-label={t('setup.age')}
                        />
                        <span className="setup-setting__hint">{t('setup.ageHint')}</span>
                      </div>
                    </div>
                  </div>
                )}

                {!worldShapingSettingsHaveEffect(mapType) && (
                  <div className="gm-section">
                    <div className="gm-section-title">{t('setup.landSection')}</div>
                    <p className="gm-note">{t('setup.fixedWorldNote')}</p>
                  </div>
                )}

                {devModeSettingHasEffect(mapType) ? (
                  <div className="gm-section setup-dev">
                    <div className="gm-section-title">{t('setup.devSection')}</div>
                    <Form.Check
                      type="checkbox"
                      id="devModeCheckbox"
                      label={t('setup.devMode')}
                      checked={devMode}
                      onChange={(e) => setDevMode(e.target.checked)}
                      className="setup-dev__check"
                    />
                    <p className="gm-note">{t('setup.devNote')}</p>
                  </div>
                ) : (
                  <div className="gm-section setup-dev">
                    <div className="gm-section-title">{t('setup.devSection')}</div>
                    <p className="gm-note">{t('setup.devForcedNote')}</p>
                  </div>
                )}

                {/* Sealed orders — everything your people ride out under */}
                <div className="setup-summary" aria-label={t('setup.summaryTitle')}>
                  <div className="setup-summary-header">
                    <h4 className="setup-summary-title">{t('setup.summaryTitle')}</h4>
                    <span className="setup-summary-subtitle">{t('setup.summarySubtitle')}</span>
                  </div>
                  <div className="setup-summary-grid">
                    <div className="setup-summary-item">
                      <span className="label">{t('setup.summaryCiv')}</span>
                      <span className="value" style={{ color: selectedCivData.color }}>
                        {selectedCivData.name}
                      </span>
                    </div>
                    <div className="setup-summary-item">
                      <span className="label">{t('setup.summaryLeader')}</span>
                      <span className="value">{selectedCivData.leader}</span>
                    </div>
                    <div className="setup-summary-item">
                      <span className="label">{t('setup.difficulty')}</span>
                      <span className="value">{difficultyName}</span>
                    </div>
                    <div className="setup-summary-item">
                      <span className="label">{t('setup.summaryCivilizations')}</span>
                      <span className="value">{numCivilizations}</span>
                    </div>
                    {fixedAlliances && (
                      <div className="setup-summary-item">
                        <span className="label">{t('setup.teams.summary')}</span>
                        <span className="value">
                          {t('setup.teams.summaryValue', { teams: teamCount, civs: numCivilizations })}
                        </span>
                      </div>
                    )}
                    <div className="setup-summary-item">
                      <span className="label">{t('setup.mapType')}</span>
                      <span className="value">{mapTypeLabelWithBadge}</span>
                    </div>
                    {worldShapingSettingsHaveEffect(mapType) && (
                      <>
                        <div className="setup-summary-item">
                          <span className="label">{t('setup.landMass')}</span>
                          <span className="value">{landMassShort[landMass]}</span>
                        </div>
                        <div className="setup-summary-item">
                          <span className="label">{t('setup.temperature')}</span>
                          <span className="value">{temperatureShort[temperature]}</span>
                        </div>
                        <div className="setup-summary-item">
                          <span className="label">{t('setup.climate')}</span>
                          <span className="value">{climateShort[climate]}</span>
                        </div>
                        <div className="setup-summary-item">
                          <span className="label">{t('setup.age')}</span>
                          <span className="value">{ageShort[age]}</span>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="setup-summary-details">
                    <h5>{t('setup.ordersTitle')}</h5>
                    {mapType === 'NORMAL_SKIRMISH' && (
                      <ul>
                        <li>
                          {t('setup.o.map')}{' '}
                          <strong>{`${mapWidth}×${mapHeight} ${t('setup.sizeTiles')}`}</strong>
                        </li>
                        <li>
                          {t('setup.o.year')} <strong>{t('setup.v.year4000')}</strong>
                        </li>
                        <li>
                          {t('setup.o.units')} <strong>{t('setup.v.oneSettler')}</strong>
                        </li>
                        <li>
                          {t('setup.o.treasury')} <strong>{t('setup.v.gold50')}</strong>
                        </li>
                        <li>
                          {t('setup.o.tech')} <strong>{t('setup.v.startTechs')}</strong>
                        </li>
                        <li>
                          {t('setup.o.government')}{' '}
                          <strong>{tGovernmentName('despotism', 'Despotism')}</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'EARTH' && (
                      <ul>
                        <li>
                          {t('setup.o.map')} <strong>{t('setup.v.mapEarth')}</strong>
                        </li>
                        <li>
                          {t('setup.o.source')} <strong>{t('setup.v.earthSource')}</strong>
                        </li>
                        <li>
                          {t('setup.o.year')} <strong>{t('setup.v.year4000')}</strong>
                        </li>
                        <li>
                          {t('setup.o.units')} <strong>{t('setup.v.oneSettler')}</strong>
                        </li>
                        <li>
                          {t('setup.o.treasury')} <strong>{t('setup.v.gold50')}</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'CLOSEUP_1V1' && (
                      <ul>
                        <li>
                          {t('setup.o.map')}{' '}
                          <strong>{`${mapWidth}×${mapHeight} ${t('setup.sizeTiles')}`}</strong>
                        </li>
                        <li>
                          {t('setup.o.units')} <strong>{t('setup.v.oneSettler')}</strong>
                        </li>
                        <li>
                          {t('setup.o.treasury')} <strong>{t('setup.v.gold50')}</strong>
                        </li>
                        <li>
                          {t('setup.o.mode')} <strong>{t('setup.v.quickDuel')}</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'CLOSEUP_BEATUP' && (
                      <ul>
                        <li>
                          {t('setup.o.map')}{' '}
                          <strong>{`${mapWidth}×${mapHeight} ${t('setup.sizeTiles')}`}</strong>
                        </li>
                        <li>
                          {t('setup.o.units')} <strong>{t('setup.v.settlerAnd5')}</strong>
                        </li>
                        <li>
                          {t('setup.o.treasury')} <strong>{t('setup.v.gold50')}</strong>
                        </li>
                        <li>
                          {t('setup.o.mode')} <strong>{t('setup.v.combatFocused')}</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'NAVAL_CLOSEUP' && (
                      <ul>
                        <li>
                          {t('setup.o.map')} <strong>{t('setup.v.mapWater')}</strong>
                        </li>
                        <li>
                          {t('setup.o.units')} <strong>{t('setup.v.twoTriremes')}</strong>
                        </li>
                        <li>
                          {t('setup.o.resources')} <strong>{t('setup.v.fishAvailable')}</strong>
                        </li>
                        <li>
                          {t('setup.o.mode')} <strong>{t('setup.v.navalWarfare')}</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'NO_SETTLERS' && (
                      <ul>
                        <li>
                          {t('setup.o.map')}{' '}
                          <strong>{`${mapWidth}×${mapHeight} ${t('setup.sizeTiles')}`}</strong>
                        </li>
                        <li>
                          {t('setup.o.units')} <strong>{t('setup.v.noSettlersUnits')}</strong>
                        </li>
                        <li>
                          {t('setup.o.treasury')} <strong>{t('setup.v.gold50')}</strong>
                        </li>
                        <li>
                          {t('setup.o.mode')} <strong>{t('setup.v.pureCombat')}</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'MANY_CITIES' && (
                      <ul>
                        <li>
                          {t('setup.o.map')}{' '}
                          <strong>{`${mapWidth}×${mapHeight} ${t('setup.sizeTiles')}`}</strong>
                        </li>
                        <li>
                          {t('setup.o.cities')} <strong>{t('setup.v.fourCities')}</strong>
                        </li>
                        <li>
                          {t('setup.o.units')} <strong>{t('setup.v.twoWarriors')}</strong>
                        </li>
                        <li>
                          {t('setup.o.improvements')} <strong>{t('setup.v.roadsIrrigation')}</strong>
                        </li>
                        <li>
                          {t('setup.o.mode')} <strong>{t('setup.v.cityFocus')}</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'TECH_LEVEL_10' && (
                      <div className="map-type-description">
                        <span className="hint-icon">💡</span>
                        <span>{t('setup.v.techLevel10Hint')}</span>
                      </div>
                    )}
                    {mapType === 'ALL_UNITS' && (
                      <div className="map-type-description">
                        <span className="hint-icon">🎮</span>
                        <span>{t('setup.v.allUnitsHint')}</span>
                      </div>
                    )}
                    {mapType === 'AI_VS_AI' && (
                      <ul>
                        <li>
                          {t('setup.o.map')}{' '}
                          <strong>{`${mapWidth}×${mapHeight} ${t('setup.sizeTiles')}`}</strong>
                        </li>
                        <li>
                          {t('setup.o.players')} <strong>{t('setup.v.allAi')}</strong>
                        </li>
                        <li>
                          {t('setup.o.mode')} <strong>{t('setup.v.autoNoInput')}</strong>
                        </li>
                        <li>
                          {t('setup.o.log')} <strong>{t('setup.v.everyMoveLogged')}</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'AI_VS_AI_NAVAL' && (
                      <ul>
                        <li>
                          {t('setup.o.map')} <strong>{t('setup.v.mapNaval')}</strong>
                        </li>
                        <li>
                          {t('setup.o.players')} <strong>{t('setup.v.allAiOneIsland')}</strong>
                        </li>
                        <li>
                          {t('setup.o.mode')} <strong>{t('setup.v.autoNavalDuel')}</strong>
                        </li>
                        <li>
                          {t('setup.o.requires')} <strong>{t('setup.v.ferriesRequired')}</strong>
                        </li>
                        <li>
                          {t('setup.o.log')} <strong>{t('setup.v.everyMoveLogged')}</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'AEGEAN_CAMPAIGN' && (
                      <ul>
                        <li>
                          {t('setup.o.map')} <strong>{t('setup.v.mapAegean')}</strong>
                        </li>
                        <li>
                          {t('setup.o.players')} <strong>{t('setup.v.mixedHumanAi')}</strong>
                        </li>
                        <li>
                          {t('setup.o.mode')} <strong>{t('setup.v.navalCampaign')}</strong>
                        </li>
                        <li>
                          {t('setup.o.features')} <strong>{t('setup.v.aegeanFeatures')}</strong>
                        </li>
                        <li>
                          {t('setup.o.requires')} <strong>{t('setup.v.navalTechRequired')}</strong>
                        </li>
                        <li>
                          {t('setup.o.log')} <strong>{t('setup.v.everyMoveLogged')}</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'AI_VS_AI_SMALL' && (
                      <ul>
                        <li>
                          {t('setup.o.map')}{' '}
                          <strong>{`${mapWidth}×${mapHeight} ${t('setup.sizeTiles')}`}</strong>
                        </li>
                        <li>
                          {t('setup.o.players')} <strong>{t('setup.v.allAi')}</strong>
                        </li>
                        <li>
                          {t('setup.o.mode')} <strong>{t('setup.v.fastTightCombat')}</strong>
                        </li>
                        <li>
                          {t('setup.o.log')} <strong>{t('setup.v.everyMoveLogged')}</strong>
                        </li>
                      </ul>
                    )}
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>

        {/* Command bar — always reachable, thumb-friendly on phones */}
        <footer className="setup-footer">
          {currentStep === 1 && (
            <div className="setup-footer__selected">
              <span className="setup-footer__swatch" style={{ background: selectedCivData.color }} aria-hidden="true" />
              <span className="setup-footer__selected-label">{t('setup.yourBanner')}</span>
              <span className="setup-footer__selected-value" style={{ color: selectedCivData.color }}>
                {selectedCivData.name}
              </span>
              <span className="setup-footer__selected-leader">
                {t('setup.ledBy')} {selectedCivData.leader}
              </span>
            </div>
          )}

          <div className="setup-footer__nav">
            {currentStep > 1 && (
              <button type="button" onClick={prevStep} className="touch-btn touch-btn--ghost setup-footer__button">
                {t('setup.previous')}
              </button>
            )}

            {!isFinalStep ? (
              <button
                type="button"
                onClick={nextStep}
                className="touch-btn touch-btn--primary setup-footer__button setup-footer__button--primary"
              >
                {t('setup.next')}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                disabled={!teamSetupValid}
                title={!teamSetupValid ? t('setup.teams.invalid') : undefined}
                className="touch-btn touch-btn--success setup-footer__button setup-footer__button--success"
              >
                {t('setup.startGame')}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

export default GameSetupModal;
