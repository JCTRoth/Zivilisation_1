import React, { useState } from 'react';
import { Modal, Button, Form, Row, Col } from 'react-bootstrap';
import { CIVILIZATIONS, DIFFICULTY_LEVELS } from '../../game/gameData';
import '../../styles/gameSetupModal.css';

function GameSetupModal({ show, onStart }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedCiv, setSelectedCiv] = useState(0);
  const [difficulty, setDifficulty] = useState('PRINCE');
  const [numCivilizations, setNumCivilizations] = useState(7);
  const [mapType, setMapType] = useState('EARTH');

  const totalSteps = 2;

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
          <h2 className="modal-title">🏛️ Zivilisation 1 - Game Setup</h2>
          <small className="modal-subtitle">Step {currentStep} of {totalSteps}</small>
        </Modal.Title>
      </Modal.Header>
      
      <Modal.Body className="modal-body-custom">
        <div className="modal-content">
        {/* Step 1: Civilization Selection */}
        {currentStep === 1 && (
          <>
        <div className="mb-4">
          <h4 className="step-title">
            Choose Your Civilization
          </h4>
          <Row className="mt-3">
            {CIVILIZATIONS.map((civ, idx) => (
              <Col key={idx} xs={6} md={4} lg={3} className="mb-3">
                <div
                  className="civ-card"
                  onClick={() => {
                    console.log(`[CLICK] GameSetup select civilization: ${CIVILIZATIONS[idx].name} (${idx})`);
                    setSelectedCiv(idx);
                  }}
                  style={{
                    border: selectedCiv === idx ? '3px solid #ffd700' : '2px solid #555',
                    backgroundColor: selectedCiv === idx ? '#3a3a3a' : '#333'
                  }}
                  onMouseEnter={(e) => {
                    if (selectedCiv !== idx) {
                      e.currentTarget.style.backgroundColor = '#3a3a3a';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedCiv !== idx) {
                      e.currentTarget.style.backgroundColor = '#333';
                    }
                  }}
                >
                  <div className="civ-icon-container">
                    {civ.name === 'Americans' && '🦅'}
                    {civ.name === 'Aztecs' && '🐆'}
                    {civ.name === 'Babylonians' && '🏺'}
                    {civ.name === 'Chinese' && '🐉'}
                    {civ.name === 'Germans' && '✠'}
                    {civ.name === 'Egyptians' && <span className="civ-icon-egypt">𓂀</span>}
                    {civ.name === 'English' && '🇬🇧'}
                    {civ.name === 'French' && '🇫🇷🥖'}
                    {civ.name === 'Greeks' && '🏛️'}
                    {civ.name === 'Indians' && '🇮🇳'}
                    {civ.name === 'Mongols' && '🏹🐎'}
                    {civ.name === 'Romans' && '⚔️'}
                    {civ.name === 'Russians' && <span className="civ-icon-russia">☭</span>}
                    {civ.name === 'Zulus' && <span className="civ-icon-zulu">🛡️</span>}
                  </div>
                  <div className="civ-name" style={{ color: civ.color }}>
                    {civ.name}
                  </div>
                  <div className="civ-leader">
                    {civ.leader}
                  </div>
                </div>
              </Col>
            ))}
          </Row>
        </div>

        {/* Selected Civilization Info */}
        {selectedCiv !== null && (
          <div className="p-2 selected-civ-display">
            <span className="selected-civ-name" style={{ color: CIVILIZATIONS[selectedCiv].color }}>
              {CIVILIZATIONS[selectedCiv].name}
            </span>
            <span className="selected-civ-leader">
              <strong>Leader:</strong> {CIVILIZATIONS[selectedCiv].leader}
            </span>
            <span className="selected-civ-color">
              <strong>Cities:</strong> {CIVILIZATIONS[selectedCiv].cityNames.slice(0, 3).join(', ')}...
            </span>
          </div>
        )}
        </>
        )}

        {/* Step 2: Game Settings & Summary */}
        {currentStep === 2 && (
          <>
        <div className="controls-container">
          {/* Difficulty Level */}
          <div>
            <h4 className="controls-title">
              Difficulty Level
            </h4>
            <Form.Select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className="mt-2 control-select"
            >
              <option value="CHIEFTAIN">Chieftain (Easiest)</option>
              <option value="WARLORD">Warlord (Easy)</option>
              <option value="PRINCE">Prince (Normal)</option>
              <option value="KING">King (Hard)</option>
              <option value="EMPEROR">Emperor (Very Hard)</option>
            </Form.Select>
            <small className="control-description">
              Difficulty affects AI advantages, barbarian frequency, and game balance
            </small>
          </div>

          {/* Number of Civilizations */}
          <div>
            <h4 className="controls-title">
              Number of Civilizations
            </h4>
            <div className="d-flex align-items-center gap-3 mt-2">
              <Form.Range
                min="2"
                max="7"
                value={numCivilizations}
                onChange={(e) => setNumCivilizations(parseInt(e.target.value))}
                style={{ flexGrow: 1 }}
              />
              <span style={{ fontSize: '22px', fontWeight: 'bold', minWidth: '30px' }}>
                {numCivilizations}
              </span>
            </div>
            <small style={{ color: '#aaa', fontSize: '14px', display: 'block', marginTop: '8px' }}>
              More civilizations = more competition and smaller territories
            </small>
          </div>

          {/* Map Type */}
          <div>
            <h4 className="controls-title">
              Map Type
            </h4>
            <Form.Select
              value={mapType}
              onChange={(e) => setMapType(e.target.value)}
              className="mt-2 control-select"
            >
              <option value="EARTH">Earth (Realistic)</option>
              <option value="RANDOM">Random (Procedural)</option>
              <option value="PANGAEA">Pangaea (One Landmass)</option>
              <option value="ARCHIPELAGO">Archipelago (Islands)</option>
            </Form.Select>
          </div>
        </div>

        {/* Game Summary */}
        <div className="p-3 game-summary">
          <h6 className="game-summary-title">Game Summary</h6>
          <Row>
            <Col md={6}>
              <p style={{ fontSize: '16px', marginBottom: '8px' }}>
                <strong>Civilization:</strong> {CIVILIZATIONS[selectedCiv].name}
              </p>
              <p style={{ fontSize: '16px', marginBottom: '8px' }}>
                <strong>Leader:</strong> {CIVILIZATIONS[selectedCiv].leader}
              </p>
              <p style={{ fontSize: '16px', marginBottom: '8px' }}>
                <strong>Difficulty:</strong> {difficulty}
              </p>
            </Col>
            <Col md={6}>
              <p style={{ fontSize: '16px', marginBottom: '8px' }}>
                <strong>Civilizations:</strong> {numCivilizations}
              </p>
              <p style={{ fontSize: '16px', marginBottom: '8px' }}>
                <strong>Map Type:</strong> {mapType}
              </p>
            </Col>
          </Row>
          <hr style={{ borderColor: '#444', margin: '16px 0' }} />
          <h6 style={{ color: '#ffd700', marginBottom: '8px', fontSize: '18px' }}>Starting Conditions</h6>
          <ul style={{ fontSize: '16px', marginBottom: 0, paddingLeft: '20px' }}>
            <li>Starting Year: <strong>4000 BC</strong></li>
            <li>Starting Units: <strong>1 Settler</strong></li>
            <li>Starting Treasury: <strong>50 Gold</strong></li>
            <li>Initial Technologies: <strong>Irrigation, Mining, Roads</strong></li>
            <li>Government: <strong>Despotism</strong></li>
          </ul>
        </div>
        </>
        )}
        
        </div>
      </Modal.Body>
      
      <Modal.Footer style={{ backgroundColor: '#1a1a1a', borderTop: '2px solid #ffd700', display: 'flex', justifyContent: currentStep === 1 ? 'flex-end' : 'space-between', padding: '20px 40px' }}>
        {currentStep > 1 && (
          <Button 
            variant="secondary" 
            size="lg"
            onClick={prevStep}
            style={{
              fontSize: '18px',
              fontWeight: 'bold',
              padding: '12px 40px'
            }}
          >
            ← Previous
          </Button>
        )}
        
        {currentStep < totalSteps ? (
          <Button 
            variant="primary" 
            size="lg"
            onClick={nextStep}
            style={{
              fontSize: '18px',
              fontWeight: 'bold',
              padding: '12px 40px',
              background: 'linear-gradient(180deg, #007bff 0%, #0056b3 100%)',
              border: 'none'
            }}
          >
            Next →
          </Button>
        ) : (
          <Button 
            variant="success" 
            size="lg"
            onClick={handleStart}
            style={{
              fontSize: '20px',
              fontWeight: 'bold',
              padding: '12px 40px',
              background: 'linear-gradient(180deg, #28a745 0%, #1e7e34 100%)',
              border: 'none'
            }}
          >
            🏛️ Start Game
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}

export default GameSetupModal;
