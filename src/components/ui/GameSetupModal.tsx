import React, { useMemo, useState } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';
import { CIVILIZATIONS, DIFFICULTY_LEVELS } from '../../game/gameData';
import '../../styles/gameSetupModal.css';

function GameSetupModal({ show, onStart }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedCiv, setSelectedCiv] = useState(0);
  const [difficulty, setDifficulty] = useState('PRINCE');
  const [numCivilizations, setNumCivilizations] = useState(7);
  const [mapType, setMapType] = useState('EARTH');

  const totalSteps = 2;
  const isFinalStep = currentStep === totalSteps;
  const steps = useMemo(() => (
    [
      { key: 1, label: 'Civilization' },
      { key: 2, label: 'Game Settings' }
    ]
  ), []);

  const difficultyOptions = useMemo<Array<{ id: string; label: string }>>(() => (
    Object.entries(DIFFICULTY_LEVELS).map(([id, data]) => ({ id, label: data.name }))
  ), []);

  const civIcons = useMemo<Record<string, React.ReactNode>>(() => ({
    Americans: '🦅',
    Aztecs: '🐆',
    Babylonians: '🏺',
    Chinese: '🐉',
    Germans: '✠',
    Egyptians: <span className="civ-icon-egypt">𓂀</span>,
    English: '🇬🇧',
    French: '🇫🇷',
    Greeks: '🏛️',
    Indians: '🇮🇳',
    Mongols: '🏹',
    Romans: '⚔️',
    Russians: <span className="civ-icon-russia">☭</span>,
    Zulus: <span className="civ-icon-zulu">🛡️</span>
  }), []);

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
      mapType: mapType
    };
    onStart(settings);
  };

  return (
    <Modal show={show} centered size="xl" backdrop="static" keyboard={false} fullscreen>
      <Modal.Header className="modal-header-custom">
        <Modal.Title className="w-100 text-center">
          <h2 className="modal-title">🏛️ Zivilisation 1</h2>
          <small className="modal-subtitle">Step {currentStep} of {totalSteps}</small>
        </Modal.Title>
      </Modal.Header>
      
      <Modal.Body className="modal-body-custom">
        <div className="setup-content">
          <div className="setup-progress" role="status" aria-live="polite">
            {steps.map(({ key, label }) => (
              <span
                key={key}
                className={`setup-progress-step ${currentStep === key ? 'is-active' : ''}`}
              >
                {label}
              </span>
            ))}
          </div>

          {/* Step 1: Civilization Selection */}
          {currentStep === 1 && (
            <section className="setup-section" aria-labelledby="setup-step-civilization">
              <div className="setup-section-header">
                <h3 id="setup-step-civilization" className="setup-section-heading">Choose Your Civilization</h3>
                <p className="setup-section-subheading">Tap a card to select your starting civilization. Each one comes with a distinct color palette and legendary leader.</p>
              </div>

              <div className="setup-civ-list" role="list">
                {CIVILIZATIONS.map((civ, idx) => {
                  const isSelected = selectedCiv === idx;
                  const icon = civIcons[civ.name] ?? civ.name.charAt(0);
                  return (
                    <button
                      key={civ.name}
                      type="button"
                      className={`setup-civ-card ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => {
                        console.log(`[CLICK] GameSetup select civilization: ${civ.name} (${idx})`);
                        setSelectedCiv(idx);
                      }}
                      aria-pressed={isSelected}
                    >
                      <div className="setup-civ-card__header">
                        <span className="setup-civ-card__icon">{icon}</span>
                        <span className="setup-civ-card__name" style={{ color: civ.color }}>
                          {civ.name}
                        </span>
                      </div>
                      <span className="setup-civ-card__leader">{civ.leader}</span>
                      <span className="setup-civ-card__cities">
                        {civ.cityNames.slice(0, 3).join(', ')}
                        {civ.cityNames.length > 3 ? '…' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>

              <aside className="setup-selected" aria-live="polite">
                <span className="setup-selected__label">Selected:</span>
                <span
                  className="setup-selected__value"
                  style={{ color: CIVILIZATIONS[selectedCiv].color }}
                >
                  {CIVILIZATIONS[selectedCiv].name}
                </span>
                <span className="setup-selected__leader">Lead by {CIVILIZATIONS[selectedCiv].leader}</span>
              </aside>
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
                    <span className="control-card__hint">Choose your world layout.</span>
                  </div>
                  <Form.Select
                    value={mapType}
                    onChange={(e) => setMapType(e.target.value)}
                    className="control-card__select"
                  >
                    <option value="EARTH">Earth · Real-world geography</option>
                    <option value="RANDOM">Random · Procedural generation</option>
                    <option value="PANGAEA">Pangaea · One massive landmass</option>
                    <option value="ARCHIPELAGO">Archipelago · Wide island chains</option>
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
                </div>
                <div className="setup-summary-details">
                  <h5>Starting Conditions</h5>
                  <ul>
                    <li>Year: <strong>4000 BC</strong></li>
                    <li>Units: <strong>1 Settler</strong></li>
                    <li>Treasury: <strong>50 Gold</strong></li>
                    <li>Tech: <strong>Irrigation, Mining, Roads</strong></li>
                    <li>Government: <strong>Despotism</strong></li>
                  </ul>
                </div>
              </div>
            </section>
          )}

        </div>
      </Modal.Body>
      
      <Modal.Footer className={`setup-footer ${isFinalStep ? 'setup-footer--center' : ''}`}>
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
