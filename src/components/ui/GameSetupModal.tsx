import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Form } from 'react-bootstrap';
import { CIVILIZATIONS, DIFFICULTY_LEVELS } from '@/data/GameData';
import { LEADER_PORTRAITS } from '@/data/LeaderPortraits';
import LeaderPortrait from '@/components/ui/LeaderPortrait';
import '../../styles/gameModalShell.css';
import '../../styles/gameSetupModal.css';
import { isAutoScenario } from '@/data/GameConstants';

/** Readable names for the map presets — the raw ids are for the engine. */
const MAP_TYPE_LABELS: Record<string, string> = {
  NORMAL_SKIRMISH: 'Normal Skirmish',
  EARTH: 'Earth',
  CLOSEUP_1V1: 'Close up 1vs1',
  CLOSEUP_BEATUP: 'Close up beat em up',
  NAVAL_CLOSEUP: 'Naval close up',
  NO_SETTLERS: 'No Settlers',
  MANY_CITIES: 'Many Cities',
  TECH_LEVEL_10: 'Tech. Level 10',
  ALL_UNITS: 'All Units Showcase',
  AI_VS_AI: 'Computer vs Computer',
  AI_VS_AI_SMALL: 'Computer vs Computer (Small)',
  AI_VS_AI_NAVAL: 'Computer vs Computer · Naval',
  AI_VS_AI_NAVAL_TROPICAL: 'Computer vs Computer · Tropical',
};

type GameSetupModalProps = {
  show: boolean;
  onStart: (settings: {
    playerCivilization: number;
    difficulty: string;
    numberOfCivilizations: number;
    mapType: string;
    devMode: boolean;
    landMass: number;
    temperature: number;
    climate: number;
    age: number;
  }) => void;
};

/**
 * The war council — the fullscreen room where the player takes the seat
 * above the board before the first turn exists.
 *
 * Not a floating dialog: a fixed, full-viewport command screen (sky, map
 * table, sealed orders). The player is the mind above the board; this screen
 * is where they claim the chair.
 *
 * e2e contract (do not rename):
 *   h2.modal-title ⊃ "Zivilisation 1" · "Choose Your Civilization" /
 *   "Fine-tune Your Challenge" · .setup-civ-card · .setup-footer ·
 *   .setup-footer__selected-value · .setup-summary · .setup-summary-title
 *   ("Your Setup") · LAST select.setup-setting__control = map preset ·
 *   buttons "Next →" / "← Previous" / "🏛️ Start Game"
 */
function GameSetupModal({ show, onStart }: GameSetupModalProps) {
  // Drag-to-scroll on empty areas of the war table (desktop convenience).
  const bodyRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const capturedRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; scrollTop: number; scrollLeft: number } | null>(null);

  const isInteractive = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return true;
    const tag = target.tagName.toLowerCase();
    if (['button', 'select', 'input', 'textarea', 'a', 'label', 'option'].includes(tag)) return true;
    return !!target.closest('.setup-civ-card, .setup-summary, .setup-nameplate, .setup-footer, .setup-dossier');
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
  const defaultCivIndex = CIVILIZATIONS.findIndex((c) => c.name === 'Germans');
  const [selectedCiv, setSelectedCiv] = useState(defaultCivIndex >= 0 ? defaultCivIndex : 0);
  const [difficulty, setDifficulty] = useState('PRINCE');
  const [numCivilizations, setNumCivilizations] = useState(2);
  const [mapType, setMapType] = useState('NORMAL_SKIRMISH');
  const [devMode, setDevMode] = useState(false);
  const [landMass, setLandMass] = useState(1);
  const [temperature, setTemperature] = useState(1);
  const [climate, setClimate] = useState(1);
  const [age, setAge] = useState(1);

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
  }, [mapType]);

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
  const difficultyName = DIFFICULTY_LEVELS[difficulty]?.name ?? difficulty;
  const mapTypeLabel = MAP_TYPE_LABELS[mapType] ?? mapType;
  const leaderPortrait = LEADER_PORTRAITS[selectedCivData.leader] ?? null;

  const stepCopy =
    currentStep === 1
      ? {
          eyebrow: 'The War Council · I',
          title: 'Choose Your Civilization',
          lede: 'You are the mind above the board — not a piece on it. Every order you give will be carried out by thousands. Choose the people who will carry your will through the ages.',
        }
      : {
          eyebrow: 'The War Council · II',
          title: 'Fine-tune Your Challenge',
          lede: 'The table is laid with the known world. Set the rivals, the land, and the weight of history — then give the first order.',
        };

  const nextStep = () => {
    if (currentStep < totalSteps) setCurrentStep(currentStep + 1);
  };

  const prevStep = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  const handleStart = () => {
    onStart({
      playerCivilization: selectedCiv,
      difficulty,
      numberOfCivilizations: numCivilizations,
      mapType,
      devMode,
      landMass,
      temperature,
      climate,
      age,
    });
  };

  if (!show) return null;

  return (
    <div className="setup-screen" role="dialog" aria-modal="true" aria-label="Game setup">
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
            <span className="setup-nameplate__tag">War Council</span>
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
                    <span className="setup-dossier__kicker">Your banner</span>
                    <strong className="setup-dossier__name" style={{ color: selectedCivData.color }}>
                      {selectedCivData.name}
                    </strong>
                    <span className="setup-dossier__leader">
                      Commander-in-chief · <strong>{selectedCivData.leader}</strong>
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
                  <div className="gm-section-title">Raise Your Banner</div>
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
                  <div className="gm-section-title">Terms of Engagement</div>
                  <div className="setup-settings-grid">
                    <div className="setup-setting">
                      <span className="setup-setting__label">Difficulty</span>
                      <Form.Select
                        value={difficulty}
                        onChange={(e) => setDifficulty(e.target.value)}
                        className="setup-setting__control"
                        aria-label="Difficulty"
                      >
                        {difficultyOptions.map(({ id, label }) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </Form.Select>
                      <span className="setup-setting__hint">Affects AI bonuses and barbarian activity.</span>
                    </div>

                    <div className="setup-setting">
                      <span className="setup-setting__label">
                        Civilizations in Play <span className="setup-setting__value">{numCivilizations}</span>
                      </span>
                      <Form.Range
                        min="2"
                        max="7"
                        value={numCivilizations}
                        onChange={(e) => setNumCivilizations(Number(e.target.value))}
                        className="setup-setting__control"
                        aria-label="Civilizations in play"
                      />
                      <span className="setup-setting__hint">More rivals mean tight borders and faster discoveries.</span>
                    </div>
                  </div>
                </div>

                <div className="gm-section">
                  <div className="gm-section-title">The World You Will Claim</div>
                  <div className="setup-settings-grid">
                    <div className="setup-setting">
                      <span className="setup-setting__label">Map Type</span>
                      <Form.Select
                        value={mapType}
                        onChange={(e) => setMapType(e.target.value)}
                        className="setup-setting__control"
                        aria-label="Map type"
                      >
                        <option value="NORMAL_SKIRMISH">Normal Skirmish · Standard game setup</option>
                        <option value="EARTH">Earth · 180×90 real-world geography</option>
                        <option value="CLOSEUP_1V1">Close up 1vs1 · 20x20 map duel</option>
                        <option value="CLOSEUP_BEATUP">Close up beat em up · 20x20 combat focus</option>
                        <option value="NAVAL_CLOSEUP">Naval close up · 20x20 water map with fish</option>
                        <option value="NO_SETTLERS">No Settlers · Start with military units</option>
                        <option value="MANY_CITIES">Many Cities · 4 cities with infrastructure</option>
                        <option value="TECH_LEVEL_10">Tech. Level 10 · All technologies researched</option>
                        <option value="ALL_UNITS">All Units Showcase · Every unit type on the board</option>
                        <option value="AI_VS_AI">Computer vs Computer · Auto-playing AI duel</option>
                        <option value="AI_VS_AI_SMALL">Computer vs Computer (Small) · Tall narrow corridor</option>
                        <option value="AI_VS_AI_NAVAL">Computer vs Computer · Naval Archipelago (8 islands, ferries)</option>
                        <option value="AI_VS_AI_NAVAL_TROPICAL">
                          Computer vs Computer · Tropical Archipelago (8 islands, jungle, mountain)
                        </option>
                      </Form.Select>
                      <span className="setup-setting__hint">Choose your game mode.</span>
                    </div>
                  </div>
                </div>

                {mapType !== 'NAVAL_CLOSEUP' && (
                  <div className="gm-section">
                    <div className="gm-section-title">The Shape of the Land</div>
                    <div className="setup-settings-grid setup-settings-grid--pairs">
                      <div className="setup-setting">
                        <span className="setup-setting__label">
                          Land Mass{' '}
                          <span className="setup-setting__value">
                            {['Sparse Islands', 'Standard', 'Pangaea'][landMass]}
                          </span>
                        </span>
                        <Form.Range
                          min="0"
                          max="2"
                          step="1"
                          value={landMass}
                          onChange={(e) => setLandMass(Number(e.target.value))}
                          className="setup-setting__control"
                          aria-label="Land mass"
                        />
                        <span className="setup-setting__hint">How much land appears on the map.</span>
                      </div>

                      <div className="setup-setting">
                        <span className="setup-setting__label">
                          Temperature{' '}
                          <span className="setup-setting__value">
                            {['Hot (Desert)', 'Temperate', 'Cold (Arctic)'][temperature]}
                          </span>
                        </span>
                        <Form.Range
                          min="0"
                          max="2"
                          step="1"
                          value={temperature}
                          onChange={(e) => setTemperature(Number(e.target.value))}
                          className="setup-setting__control"
                          aria-label="Temperature"
                        />
                        <span className="setup-setting__hint">Shifts the latitude-based biome distribution.</span>
                      </div>

                      <div className="setup-setting">
                        <span className="setup-setting__label">
                          Climate{' '}
                          <span className="setup-setting__value">
                            {['Dry (Plains)', 'Moderate', 'Wet (Jungle)'][climate]}
                          </span>
                        </span>
                        <Form.Range
                          min="0"
                          max="2"
                          step="1"
                          value={climate}
                          onChange={(e) => setClimate(Number(e.target.value))}
                          className="setup-setting__control"
                          aria-label="Climate"
                        />
                        <span className="setup-setting__hint">Controls moisture and vegetation density.</span>
                      </div>

                      <div className="setup-setting">
                        <span className="setup-setting__label">
                          Age <span className="setup-setting__value">{['Young (Flat)', 'Mature', 'Old (Mountains)'][age]}</span>
                        </span>
                        <Form.Range
                          min="0"
                          max="2"
                          step="1"
                          value={age}
                          onChange={(e) => setAge(Number(e.target.value))}
                          className="setup-setting__control"
                          aria-label="Age"
                        />
                        <span className="setup-setting__hint">Older maps have more hills and mountains.</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="gm-section setup-dev">
                  <div className="gm-section-title">For the Architects</div>
                  <Form.Check
                    type="checkbox"
                    id="devModeCheckbox"
                    label="Dev Mode"
                    checked={devMode}
                    onChange={(e) => setDevMode(e.target.checked)}
                    className="setup-dev__check"
                  />
                  <p className="gm-note">
                    Lifts the fog and reveals what the map hides. Forced on for the computer-versus-computer
                    scenarios, where somebody has to be able to watch.
                  </p>
                </div>

                {/* Sealed orders — everything your people ride out under */}
                <div className="setup-summary" aria-label="Game summary">
                  <div className="setup-summary-header">
                    <h4 className="setup-summary-title">Your Setup</h4>
                    <span className="setup-summary-subtitle">
                      Read the orders back once — your people ride out under them.
                    </span>
                  </div>
                  <div className="setup-summary-grid">
                    <div className="setup-summary-item">
                      <span className="label">Civilization</span>
                      <span className="value" style={{ color: selectedCivData.color }}>
                        {selectedCivData.name}
                      </span>
                    </div>
                    <div className="setup-summary-item">
                      <span className="label">Leader</span>
                      <span className="value">{selectedCivData.leader}</span>
                    </div>
                    <div className="setup-summary-item">
                      <span className="label">Difficulty</span>
                      <span className="value">{difficultyName}</span>
                    </div>
                    <div className="setup-summary-item">
                      <span className="label">Civilizations</span>
                      <span className="value">{numCivilizations}</span>
                    </div>
                    <div className="setup-summary-item">
                      <span className="label">Map Type</span>
                      <span className="value">{mapTypeLabel}</span>
                    </div>
                    {mapType !== 'NAVAL_CLOSEUP' && (
                      <>
                        <div className="setup-summary-item">
                          <span className="label">Land Mass</span>
                          <span className="value">{['Sparse', 'Standard', 'Pangaea'][landMass]}</span>
                        </div>
                        <div className="setup-summary-item">
                          <span className="label">Temperature</span>
                          <span className="value">{['Hot', 'Temperate', 'Cold'][temperature]}</span>
                        </div>
                        <div className="setup-summary-item">
                          <span className="label">Climate</span>
                          <span className="value">{['Dry', 'Moderate', 'Wet'][climate]}</span>
                        </div>
                        <div className="setup-summary-item">
                          <span className="label">Age</span>
                          <span className="value">{['Young', 'Mature', 'Old'][age]}</span>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="setup-summary-details">
                    <h5>Orders for the First Turn</h5>
                    {mapType === 'NORMAL_SKIRMISH' && (
                      <ul>
                        <li>
                          Map: <strong>80x50 tiles</strong>
                        </li>
                        <li>
                          Year: <strong>4000 BC</strong>
                        </li>
                        <li>
                          Units: <strong>1 Settler</strong>
                        </li>
                        <li>
                          Treasury: <strong>50 Gold</strong>
                        </li>
                        <li>
                          Tech: <strong>Irrigation, Mining, Roads</strong>
                        </li>
                        <li>
                          Government: <strong>Despotism</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'EARTH' && (
                      <ul>
                        <li>
                          Map: <strong>180x90 tiles (Static world map)</strong>
                        </li>
                        <li>
                          Source: <strong>Earth 180x90 v1.4</strong>
                        </li>
                        <li>
                          Year: <strong>4000 BC</strong>
                        </li>
                        <li>
                          Units: <strong>1 Settler</strong>
                        </li>
                        <li>
                          Treasury: <strong>50 Gold</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'CLOSEUP_1V1' && (
                      <ul>
                        <li>
                          Map: <strong>20x20 tiles (Small)</strong>
                        </li>
                        <li>
                          Units: <strong>1 Settler</strong>
                        </li>
                        <li>
                          Treasury: <strong>50 Gold</strong>
                        </li>
                        <li>
                          Mode: <strong>Quick duel</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'CLOSEUP_BEATUP' && (
                      <ul>
                        <li>
                          Map: <strong>20x20 tiles (Small)</strong>
                        </li>
                        <li>
                          Units: <strong>1 Settler + 5 Military Units</strong>
                        </li>
                        <li>
                          Treasury: <strong>50 Gold</strong>
                        </li>
                        <li>
                          Mode: <strong>Combat-focused</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'NAVAL_CLOSEUP' && (
                      <ul>
                        <li>
                          Map: <strong>20x20 tiles (Water only)</strong>
                        </li>
                        <li>
                          Units: <strong>2 Triremes</strong>
                        </li>
                        <li>
                          Resources: <strong>Fish available</strong>
                        </li>
                        <li>
                          Mode: <strong>Naval warfare</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'NO_SETTLERS' && (
                      <ul>
                        <li>
                          Map: <strong>80x50 tiles</strong>
                        </li>
                        <li>
                          Units: <strong>5 Military Units (No Settlers)</strong>
                        </li>
                        <li>
                          Treasury: <strong>50 Gold</strong>
                        </li>
                        <li>
                          Mode: <strong>Pure combat</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'MANY_CITIES' && (
                      <ul>
                        <li>
                          Map: <strong>80x50 tiles</strong>
                        </li>
                        <li>
                          Cities: <strong>4 Cities with infrastructure</strong>
                        </li>
                        <li>
                          Units: <strong>2 Warriors</strong>
                        </li>
                        <li>
                          Improvements: <strong>Roads &amp; Irrigation</strong>
                        </li>
                        <li>
                          Mode: <strong>City management focus</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'TECH_LEVEL_10' && (
                      <div className="map-type-description">
                        <span className="hint-icon">💡</span>
                        <span>Start with all technologies researched. Best for testing advanced units.</span>
                      </div>
                    )}
                    {mapType === 'ALL_UNITS' && (
                      <div className="map-type-description">
                        <span className="hint-icon">🎮</span>
                        <span>Every single unit type spawned on the board. Perfect for testing and showcasing all units.</span>
                      </div>
                    )}
                    {mapType === 'AI_VS_AI' && (
                      <ul>
                        <li>
                          Map: <strong>40x40 tiles</strong>
                        </li>
                        <li>
                          Players: <strong>All civilizations are AI</strong>
                        </li>
                        <li>
                          Mode: <strong>Fully automatic — no human input</strong>
                        </li>
                        <li>
                          Log: <strong>Every move is written to a log file</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'AI_VS_AI_NAVAL' && (
                      <ul>
                        <li>
                          Map: <strong>96x60 tiles — 8 hand-tuned islands</strong>
                        </li>
                        <li>
                          Players: <strong>All civilizations are AI, one island each</strong>
                        </li>
                        <li>
                          Mode: <strong>Fully automatic naval duel</strong>
                        </li>
                        <li>
                          Requires: <strong>ferries — nobody can walk to the enemy</strong>
                        </li>
                        <li>
                          Log: <strong>Every move is written to a log file</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'AI_VS_AI_NAVAL_TROPICAL' && (
                      <ul>
                        <li>
                          Map: <strong>96x60 tiles — 8 islands with tropical biomes</strong>
                        </li>
                        <li>
                          Players: <strong>All civilizations are AI, one island each</strong>
                        </li>
                        <li>
                          Mode: <strong>Fully automatic naval duel</strong>
                        </li>
                        <li>
                          Features: <strong>jungle, swamp, and a mountain-rich Dragon Island</strong>
                        </li>
                        <li>
                          Requires: <strong>ferries — nobody can walk to the enemy</strong>
                        </li>
                        <li>
                          Log: <strong>Every move is written to a log file</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'AI_VS_AI_SMALL' && (
                      <ul>
                        <li>
                          Map: <strong>16x26 tiles (Tall, narrow corridor)</strong>
                        </li>
                        <li>
                          Players: <strong>All civilizations are AI</strong>
                        </li>
                        <li>
                          Mode: <strong>Fully automatic — fast, tight combat</strong>
                        </li>
                        <li>
                          Log: <strong>Every move is written to a log file</strong>
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
              <span className="setup-footer__selected-label">Your banner:</span>
              <span className="setup-footer__selected-value" style={{ color: selectedCivData.color }}>
                {selectedCivData.name}
              </span>
              <span className="setup-footer__selected-leader">led by {selectedCivData.leader}</span>
            </div>
          )}

          <div className="setup-footer__nav">
            {currentStep > 1 && (
              <button type="button" onClick={prevStep} className="touch-btn touch-btn--ghost setup-footer__button">
                ← Previous
              </button>
            )}

            {!isFinalStep ? (
              <button
                type="button"
                onClick={nextStep}
                className="touch-btn touch-btn--primary setup-footer__button setup-footer__button--primary"
              >
                Next →
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                className="touch-btn touch-btn--success setup-footer__button setup-footer__button--success"
              >
                🏛️ Start Game
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

export default GameSetupModal;
