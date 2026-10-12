import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Form } from 'react-bootstrap';
import { CIVILIZATIONS, DIFFICULTY_LEVELS } from '@/data/GameData';
import { LEADER_PORTRAITS } from '@/data/LeaderPortraits';
import LeaderPortrait from '@/components/ui/LeaderPortrait';
import { useTranslation } from '@/i18n/useTranslation';
import { translateDynamic, type TranslationKey } from '@/i18n';
import { tGovernmentName } from '@/i18n/dataNames';
import '../../styles/gameModalShell.css';
import '../../styles/gameSetupModal.css';
import { isAutoScenario } from '@/data/GameConstants';

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
  AI_VS_AI_NAVAL_TROPICAL: 'setup.mapLabel.AI_VS_AI_NAVAL_TROPICAL',
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
  AI_VS_AI_NAVAL_TROPICAL: 'setup.mapOption.AI_VS_AI_NAVAL_TROPICAL',
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
 * e2e contract (do not rename): the load-bearing strings ("Zivilisation 1",
 * "Choose Your Civilization" / "Fine-tune Your Challenge", "Your Setup",
 * "Next →" / "← Previous" / "🏛️ Start Game") live in the English dictionary
 * (`setup.*`), so with the default language the rendered text is identical.
 * Additionally: .setup-civ-card · .setup-footer · .setup-footer__selected-value
 * · .setup-summary · .setup-summary-title · LAST select.setup-setting__control
 * = map preset.
 */
function GameSetupModal({ show, onStart }: GameSetupModalProps) {
  // Subscribes the whole wizard to language changes.
  const { t } = useTranslation();
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
                        onChange={(e) => setNumCivilizations(Number(e.target.value))}
                        className="setup-setting__control"
                        aria-label={t('setup.civsCount')}
                      />
                      <span className="setup-setting__hint">{t('setup.civsCountHint')}</span>
                    </div>
                  </div>
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
                        {Object.entries(MAP_TYPE_OPTION_KEYS).map(([id, key]) => (
                          <option key={id} value={id}>
                            {t(key)}
                          </option>
                        ))}
                      </Form.Select>
                      <span className="setup-setting__hint">{t('setup.mapTypeHint')}</span>
                    </div>
                  </div>
                </div>

                {mapType !== 'NAVAL_CLOSEUP' && (
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
                    <div className="setup-summary-item">
                      <span className="label">{t('setup.mapType')}</span>
                      <span className="value">{mapTypeLabel}</span>
                    </div>
                    {mapType !== 'NAVAL_CLOSEUP' && (
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
                          {t('setup.o.map')} <strong>{t('setup.v.map80x50')}</strong>
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
                          {t('setup.o.map')} <strong>{t('setup.v.mapSmall')}</strong>
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
                          {t('setup.o.map')} <strong>{t('setup.v.mapSmall')}</strong>
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
                          {t('setup.o.map')} <strong>{t('setup.v.map80x50')}</strong>
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
                          {t('setup.o.map')} <strong>{t('setup.v.map80x50')}</strong>
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
                          {t('setup.o.map')} <strong>{t('setup.v.map40x40')}</strong>
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
                    {mapType === 'AI_VS_AI_NAVAL_TROPICAL' && (
                      <ul>
                        <li>
                          {t('setup.o.map')} <strong>{t('setup.v.mapTropical')}</strong>
                        </li>
                        <li>
                          {t('setup.o.players')} <strong>{t('setup.v.allAiOneIsland')}</strong>
                        </li>
                        <li>
                          {t('setup.o.mode')} <strong>{t('setup.v.autoNavalDuel')}</strong>
                        </li>
                        <li>
                          {t('setup.o.features')} <strong>{t('setup.v.tropicalFeatures')}</strong>
                        </li>
                        <li>
                          {t('setup.o.requires')} <strong>{t('setup.v.ferriesRequired')}</strong>
                        </li>
                        <li>
                          {t('setup.o.log')} <strong>{t('setup.v.everyMoveLogged')}</strong>
                        </li>
                      </ul>
                    )}
                    {mapType === 'AI_VS_AI_SMALL' && (
                      <ul>
                        <li>
                          {t('setup.o.map')} <strong>{t('setup.v.mapCorridor')}</strong>
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
