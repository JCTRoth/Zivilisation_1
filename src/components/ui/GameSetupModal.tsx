import React, { useMemo, useState } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';
import { CIVILIZATIONS, DIFFICULTY_LEVELS } from '@/data/GameData';
import '../../styles/gameSetupModal.css';

function GameSetupModal({ show, onStart }) {
  const [currentStep, setCurrentStep] = useState(1);
  // Default to Germans (find in original CIVILIZATIONS array)
  const defaultCivIndex = CIVILIZATIONS.findIndex(c => c.name === 'Germans');
  const [selectedCiv, setSelectedCiv] = useState(defaultCivIndex >= 0 ? defaultCivIndex : 0);
  const [difficulty, setDifficulty] = useState('PRINCE');
  const [numCivilizations, setNumCivilizations] = useState(2);
  const [mapType, setMapType] = useState('NORMAL_SKIRMISH');
  const [devMode, setDevMode] = useState(false);

  const totalSteps = 2;
  const isFinalStep = currentStep === totalSteps;
  // Keep step keys for internal logic but remove visible labels
  const steps = useMemo(() => (
    [
      { key: 1, label: '' },
      { key: 2, label: '' }
    ]
  ), []);

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
      devMode: devMode
    };
    onStart(settings);
  };

  return (
    <Modal show={show} centered size="xl" backdrop="static" keyboard={false} fullscreen>
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
      
      <Modal.Body className="modal-body-custom">
        <div className="setup-content">

          {/* Step 1: Civilization Selection */}
          {currentStep === 1 && (
            <section className="setup-section" aria-labelledby="setup-step-civilization">
              <div className="setup-civ-list" role="list">
                {sortedCivilizations.map((civ, idx) => {
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
              <div className="setup-section-header">
                <h3 id="setup-step-settings" className="setup-section-heading">Fine-tune Your Challenge</h3>
                <p className="setup-section-subheading">Adjust the core settings before you embark on your campaign.</p>
              </div>

              <div className="setup-controls">
                <div className="control-card">
                  <div className="control-card__header">
                    <span className="control-card__title">Difficulty</span>
                    <span className="control-card__hint">Affects AI bonuses and barbarian activity.</span>
                  </div>
                  <Form.Select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                    className="control-card__select"
                  >
                    {difficultyOptions.map(({ id, label }) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </Form.Select>
                </div>

                <div className="control-card">
                  <div className="control-card__header">
                    <span className="control-card__title">Civilizations in Play</span>
                    <span className="control-card__value">{numCivilizations}</span>
                  </div>
                  <Form.Range
                    min="2"
                    max="7"
                    value={numCivilizations}
                    onChange={(e) => setNumCivilizations(Number(e.target.value))}
                    className="control-card__range"
                  />
                  <span className="control-card__hint">More rivals mean tight borders and faster discoveries.</span>
                </div>

                <div className="control-card">
                  <div className="control-card__header">
                    <span className="control-card__title">Map Type</span>
                    <span className="control-card__hint">Choose your game mode.</span>
                  </div>
                  <Form.Select
                    value={mapType}
                    onChange={(e) => setMapType(e.target.value)}
                    className="control-card__select"
                  >
                    <option value="NORMAL_SKIRMISH">Normal Skirmish · Standard game setup</option>
                    <option value="CLOSEUP_1V1">Close up 1vs1 · 20x20 map duel</option>
                    <option value="CLOSEUP_BEATUP">Close up beat em up · 20x20 combat focus</option>
                    <option value="NAVAL_CLOSEUP">Naval close up · 20x20 water map with fish</option>
                    <option value="NO_SETTLERS">No Settlers · Start with military units</option>
                    <option value="MANY_CITIES">Many Cities · 4 cities with infrastructure</option>
                    <option value="TECH_LEVEL_10">Tech. Level 10 · All technologies researched</option>
                    <option value="ALL_UNITS">All Units Showcase · Every unit type on the board</option>
                  </Form.Select>
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
