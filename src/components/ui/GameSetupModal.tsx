import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';
import { CIVILIZATIONS, DIFFICULTY_LEVELS } from '@/data/GameData';
import '../../styles/gameSetupModal.css';

function GameSetupModal({ show, onStart }) {
  // Drag-to-scroll: when the user presses on an empty area of the page and
  // drags, scroll the body up/down (and left/right) instead of doing nothing.
  // Interactive elements (civ cards, buttons, selects, inputs) are left alone.
  const bodyRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const capturedRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; scrollTop: number; scrollLeft: number } | null>(null);
  const panDeltaRef = useRef(0);

  const isInteractive = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return true;
    const tag = target.tagName.toLowerCase();
    if (['button', 'select', 'input', 'textarea', 'a', 'label', 'option'].includes(tag)) return true;
    // Treat anything inside a civ card / summary / header as interactive
    return !!target.closest('.setup-civ-card, .setup-summary, .modal-header-custom, .setup-footer');
  }, []);

  const handleBodyPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only pan with primary mouse button / touch / pen, and only from empty areas
    if (isInteractive(e.target)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = bodyRef.current;
    if (!el) return;
    isPanningRef.current = true;
    panDeltaRef.current = 0;
    capturedRef.current = true;
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
    };
    // Capture immediately: the gesture started on empty space, so there is no
    // click to preserve — this keeps pointermove events flowing even when the
    // pointer leaves the container bounds while dragging.
    el.classList.add('is-panning');
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // No active pointer (e.g. synthetic events in tests) — pan still works
      // because the handlers are on the container itself.
    }
  }, [isInteractive]);

  const handleBodyPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current || !panStartRef.current) return;
    const el = bodyRef.current;
    if (!el) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    panDeltaRef.current = Math.max(panDeltaRef.current, Math.abs(dx), Math.abs(dy));
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
        // Ignore — no active pointer (e.g. synthetic events).
      }
    }
    isPanningRef.current = false;
    capturedRef.current = false;
    panStartRef.current = null;
  }, []);

  const [currentStep, setCurrentStep] = useState(1);
  // Default to Germans (find in original CIVILIZATIONS array)
  const defaultCivIndex = CIVILIZATIONS.findIndex(c => c.name === 'Germans');
  const [selectedCiv, setSelectedCiv] = useState(defaultCivIndex >= 0 ? defaultCivIndex : 0);
  const [difficulty, setDifficulty] = useState('PRINCE');
  const [numCivilizations, setNumCivilizations] = useState(2);
  const [mapType, setMapType] = useState('NORMAL_SKIRMISH');
  const [devMode, setDevMode] = useState(false);
  const [landMass, setLandMass] = useState(1);
  const [temperature, setTemperature] = useState(1);
  const [climate, setClimate] = useState(1);
  const [age, setAge] = useState(1);

  const totalSteps = 2;
  const isFinalStep = currentStep === totalSteps;

  const difficultyOptions = useMemo<Array<{ id: string; label: string }>>(() => (
    Object.entries(DIFFICULTY_LEVELS).map(([id, data]) => ({ id, label: data.name }))
  ), []);

  const civIcons = useMemo<Record<string, React.ReactNode>>(() =>
    CIVILIZATIONS.reduce((acc, civ) => {
      let iconNode: React.ReactNode = civ.icon;

      // If icon is a plain string (emoji/text), shrink it when it contains multiple glyphs
      if (typeof civ.icon === 'string') {
        // Array.from handles Unicode code points better than .length
        const glyphCount = Array.from(civ.icon).length;
        const fontSize = glyphCount > 1 ? '24px' : '36px';
        iconNode = <span style={{ fontSize }}>{civ.icon}</span>;
      }

      // Preserve existing special-case class wrappers (they may provide colors/styles)
      if (civ.name === 'Egyptians') iconNode = <span className="civ-icon-egypt">{iconNode}</span>;
      if (civ.name === 'Russians') iconNode = <span className="civ-icon-russia">{iconNode}</span>;
      if (civ.name === 'Zulus') iconNode = <span className="civ-icon-zulu">{iconNode}</span>;

      acc[civ.name] = iconNode;
      return acc;
    }, {} as Record<string, React.ReactNode>)
  , []);

  // Keep a sorted order for display (alphabetical by civilization name)
  const sortedCivilizations = useMemo(() => {
    return [...CIVILIZATIONS].sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const nextStep = () => {
    console.log(`[CLICK] GameSetup next step (${currentStep} -> ${currentStep + 1})`);
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    console.log(`[CLICK] GameSetup previous step (${currentStep} -> ${currentStep - 1})`);
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleStart = () => {
    console.log('[CLICK] GameSetup start game button');
    const settings = {
      playerCivilization: selectedCiv,
      difficulty: difficulty,
      numberOfCivilizations: numCivilizations,
      mapType: mapType,
      devMode: devMode,
      landMass: landMass,
      temperature: temperature,
      climate: climate,
      age: age,
    };
    onStart(settings);
  };

  return (
    <Modal
      show={show}
      centered
      size="xl"
      backdrop="static"
      keyboard={false}
      fullscreen="lg-down"
      dialogClassName="game-setup-dialog"
      backdropClassName="game-setup-backdrop"
    >
      <Modal.Header className="modal-header-custom">
        <Modal.Title className="w-100 text-center">
          <h2 className="modal-title">🏛️ Zivilisation 1</h2>
          <small className="modal-subtitle">Step {currentStep} of {totalSteps}</small>
          {currentStep === 1 && (
            <div className="modal-header-content">
              <h3 className="modal-civilization-heading">Choose Your Civilization</h3>
              <p className="modal-civilization-subheading">Tap a card to select your starting civilization. Each one comes with a distinct color palette and legendary leader.</p>
            </div>
          )}
        </Modal.Title>
      </Modal.Header>
      
      <Modal.Body
        className="modal-body-custom"
        ref={bodyRef}
        onPointerDown={handleBodyPointerDown}
        onPointerMove={handleBodyPointerMove}
        onPointerUp={handleBodyPointerEnd}
        onPointerCancel={handleBodyPointerEnd}
      >
        <div className="setup-content">

          {/* Step 1: Civilization Selection */}
          {currentStep === 1 && (
            <section className="setup-section" aria-labelledby="setup-step-civilization">
              <div className="setup-civ-list" role="list">
                {sortedCivilizations.map((civ, _idx) => {
                  // Map sorted item back to original index so selection maps to CIVILIZATIONS[] indexes
                  const originalIndex = CIVILIZATIONS.findIndex(orig => orig.name === civ.name);
                  const isSelected = selectedCiv === originalIndex;
                  const icon = civIcons[civ.name] ?? civ.name.charAt(0);
                  return (
                    <button
                      key={civ.name}
                      type="button"
                      className={`setup-civ-card ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => {
                        console.log(`[CLICK] GameSetup select civilization: ${civ.name} (original idx ${originalIndex})`);
                        if (originalIndex >= 0) setSelectedCiv(originalIndex);
                      }}
                      aria-pressed={isSelected}
                    >
                      {/* Row 1: Icons (one or more) */}
                      <div className="setup-civ-card__icons-row">
                        <span className="setup-civ-card__icon">{icon}</span>
                      </div>

                      {/* Row 2: Civilization name */}
                      <div className="setup-civ-card__name-row">
                        <span className="setup-civ-card__name" style={{ color: civ.color }}>
                          {civ.name}
                        </span>
                      </div>

                      {/* Row 3: Leader name */}
                      <div className="setup-civ-card__leader-row">
                        <span className="setup-civ-card__leader">{civ.leader}</span>
                      </div>

                      <span className="setup-civ-card__cities" aria-hidden />
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Step 2: Game Settings & Summary */}
          {currentStep === 2 && (
            <section className="setup-section" aria-labelledby="setup-step-settings">
              {/* ONE big box — all settings flat inside, no inner mini-boxes */}
              <div className="setup-settings-box">
                <div className="setup-settings-box__header">
                  <h3 id="setup-step-settings" className="setup-settings-box__title">Fine-tune Your Challenge</h3>
                  <span className="setup-settings-box__subtitle">Adjust the core settings before you embark on your campaign.</span>
                </div>

                <div className="setup-settings-box__grid">
                  <div className="setup-setting">
                    <span className="setup-setting__label">Difficulty</span>
                    <Form.Select
                      value={difficulty}
                      onChange={(e) => setDifficulty(e.target.value)}
                      className="setup-setting__control"
                    >
                      {difficultyOptions.map(({ id, label }) => (
                        <option key={id} value={id}>{label}</option>
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
                    />
                    <span className="setup-setting__hint">More rivals mean tight borders and faster discoveries.</span>
                  </div>

                  <div className="setup-setting">
                    <span className="setup-setting__label">Map Type</span>
                    <Form.Select
                      value={mapType}
                      onChange={(e) => setMapType(e.target.value)}
                      className="setup-setting__control"
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
                    </Form.Select>
                    <span className="setup-setting__hint">Choose your game mode.</span>
                  </div>

                  {mapType !== 'NAVAL_CLOSEUP' && (
                    <>
                      <div className="setup-setting">
                        <span className="setup-setting__label">
                          Land Mass <span className="setup-setting__value">{['Sparse Islands', 'Standard', 'Pangaea'][landMass]}</span>
                        </span>
                        <Form.Range
                          min="0" max="2" step="1"
                          value={landMass}
                          onChange={(e) => setLandMass(Number(e.target.value))}
                          className="setup-setting__control"
                        />
                        <span className="setup-setting__hint">How much land appears on the map.</span>
                      </div>

                      <div className="setup-setting">
                        <span className="setup-setting__label">
                          Temperature <span className="setup-setting__value">{['Hot (Desert)', 'Temperate', 'Cold (Arctic)'][temperature]}</span>
                        </span>
                        <Form.Range
                          min="0" max="2" step="1"
                          value={temperature}
                          onChange={(e) => setTemperature(Number(e.target.value))}
                          className="setup-setting__control"
                        />
                        <span className="setup-setting__hint">Shifts the latitude-based biome distribution.</span>
                      </div>

                      <div className="setup-setting">
                        <span className="setup-setting__label">
                          Climate <span className="setup-setting__value">{['Dry (Plains)', 'Moderate', 'Wet (Jungle)'][climate]}</span>
                        </span>
                        <Form.Range
                          min="0" max="2" step="1"
                          value={climate}
                          onChange={(e) => setClimate(Number(e.target.value))}
                          className="setup-setting__control"
                        />
                        <span className="setup-setting__hint">Controls moisture and vegetation density.</span>
                      </div>

                      <div className="setup-setting">
                        <span className="setup-setting__label">
                          Age <span className="setup-setting__value">{['Young (Flat)', 'Mature', 'Old (Mountains)'][age]}</span>
                        </span>
                        <Form.Range
                          min="0" max="2" step="1"
                          value={age}
                          onChange={(e) => setAge(Number(e.target.value))}
                          className="setup-setting__control"
                        />
                        <span className="setup-setting__hint">Older maps have more hills and mountains.</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="setup-summary" aria-label="Game summary">
                <div className="setup-summary-header">
                  <h4 className="setup-summary-title">Your Setup</h4>
                  <span className="setup-summary-subtitle">Review the essentials before launching.</span>
                </div>
                <div className="setup-summary-grid">
                  <div className="setup-summary-item">
                    <span className="label">Civilization</span>
                    <span className="value" style={{ color: CIVILIZATIONS[selectedCiv].color }}>
                      {CIVILIZATIONS[selectedCiv].name}
                    </span>
                  </div>
                  <div className="setup-summary-item">
                    <span className="label">Leader</span>
                    <span className="value">{CIVILIZATIONS[selectedCiv].leader}</span>
                  </div>
                  <div className="setup-summary-item">
                    <span className="label">Difficulty</span>
                    <span className="value">{difficulty}</span>
                  </div>
                  <div className="setup-summary-item">
                    <span className="label">Civilizations</span>
                    <span className="value">{numCivilizations}</span>
                  </div>
                  <div className="setup-summary-item">
                    <span className="label">Map Type</span>
                    <span className="value">{mapType}</span>
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
                  <div className="setup-summary-item">
                    <Form.Check
                      type="checkbox"
                      id="devModeCheckbox"
                      label="Dev Mode"
                      checked={devMode}
                      onChange={(e) => setDevMode(e.target.checked)}
                      style={{ margin: 0 }}
                    />
                  </div>
                </div>
                <div className="setup-summary-details">
                  <h5>Starting Conditions</h5>
                  {mapType === 'NORMAL_SKIRMISH' && (
                    <ul>
                      <li>Map: <strong>80x50 tiles</strong></li>
                      <li>Year: <strong>4000 BC</strong></li>
                      <li>Units: <strong>1 Settler</strong></li>
                      <li>Treasury: <strong>50 Gold</strong></li>
                      <li>Tech: <strong>Irrigation, Mining, Roads</strong></li>
                      <li>Government: <strong>Despotism</strong></li>
                    </ul>
                  )}
                  {mapType === 'EARTH' && (
                    <ul>
                      <li>Map: <strong>180x90 tiles (Static world map)</strong></li>
                      <li>Source: <strong>Earth 180x90 v1.4</strong></li>
                      <li>Year: <strong>4000 BC</strong></li>
                      <li>Units: <strong>1 Settler</strong></li>
                      <li>Treasury: <strong>50 Gold</strong></li>
                    </ul>
                  )}
                  {mapType === 'CLOSEUP_1V1' && (
                    <ul>
                      <li>Map: <strong>20x20 tiles (Small)</strong></li>
                      <li>Units: <strong>1 Settler</strong></li>
                      <li>Treasury: <strong>50 Gold</strong></li>
                      <li>Mode: <strong>Quick duel</strong></li>
                    </ul>
                  )}
                  {mapType === 'CLOSEUP_BEATUP' && (
                    <ul>
                      <li>Map: <strong>20x20 tiles (Small)</strong></li>
                      <li>Units: <strong>1 Settler + 5 Military Units</strong></li>
                      <li>Treasury: <strong>50 Gold</strong></li>
                      <li>Mode: <strong>Combat-focused</strong></li>
                    </ul>
                  )}
                  {mapType === 'NAVAL_CLOSEUP' && (
                    <ul>
                      <li>Map: <strong>20x20 tiles (Water only)</strong></li>
                      <li>Units: <strong>2 Triremes</strong></li>
                      <li>Resources: <strong>Fish available</strong></li>
                      <li>Mode: <strong>Naval warfare</strong></li>
                    </ul>
                  )}
                  {mapType === 'NO_SETTLERS' && (
                    <ul>
                      <li>Map: <strong>80x50 tiles</strong></li>
                      <li>Units: <strong>5 Military Units (No Settlers)</strong></li>
                      <li>Treasury: <strong>50 Gold</strong></li>
                      <li>Mode: <strong>Pure combat</strong></li>
                    </ul>
                  )}
                  {mapType === 'MANY_CITIES' && (
                    <ul>
                      <li>Map: <strong>80x50 tiles</strong></li>
                      <li>Cities: <strong>4 Cities with infrastructure</strong></li>
                      <li>Units: <strong>2 Warriors</strong></li>
                      <li>Improvements: <strong>Roads & Irrigation</strong></li>
                      <li>Mode: <strong>City management focus</strong></li>
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
                      <li>Map: <strong>40x40 tiles</strong></li>
                      <li>Players: <strong>All civilizations are AI</strong></li>
                      <li>Mode: <strong>Fully automatic — no human input</strong></li>
                      <li>Log: <strong>Every move is written to a log file</strong></li>
                    </ul>
                  )}
                  {mapType === 'AI_VS_AI_SMALL' && (
                    <ul>
                      <li>Map: <strong>16x26 tiles (Tall, narrow corridor)</strong></li>
                      <li>Players: <strong>All civilizations are AI</strong></li>
                      <li>Mode: <strong>Fully automatic — fast, tight combat</strong></li>
                      <li>Log: <strong>Every move is written to a log file</strong></li>
                    </ul>
                  )}
                </div>
              </div>
            </section>
          )}

        </div>
      </Modal.Body>
      
      <Modal.Footer className={`setup-footer ${(currentStep === 1 || isFinalStep) ? 'setup-footer--center' : ''}`}>
        {currentStep === 1 && (
          <div className="setup-footer__selected">
            <span className="setup-footer__selected-label">Selected:</span>
            <span
              className="setup-footer__selected-value"
              style={{ color: CIVILIZATIONS[selectedCiv].color }}
            >
              {CIVILIZATIONS[selectedCiv].name}
            </span>
            <span className="setup-footer__selected-leader">Lead by {CIVILIZATIONS[selectedCiv].leader}</span>
          </div>
        )}
        
        {currentStep > 1 && (
          <Button 
            variant="secondary" 
            size="lg"
            onClick={prevStep}
            className="setup-footer__button"
          >
            ← Previous
          </Button>
        )}
        
        {currentStep < totalSteps ? (
          <Button 
            variant="primary" 
            size="lg"
            onClick={nextStep}
            className="setup-footer__button setup-footer__button--primary"
          >
            Next →
          </Button>
        ) : (
          <Button 
            variant="success" 
            size="lg"
            onClick={handleStart}
            className="setup-footer__button setup-footer__button--success"
          >
            🏛️ Start Game
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}

export default GameSetupModal;