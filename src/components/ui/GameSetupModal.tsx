import React, { useState } from 'react';
import { Modal, Button, Form, Row, Col } from 'react-bootstrap';
import { CIVILIZATIONS, DIFFICULTY_LEVELS } from '../../game/gameData';

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
      <Modal.Header style={{ backgroundColor: '#1a1a1a', color: 'white', borderBottom: '2px solid #ffd700' }}>
        <Modal.Title className="w-100 text-center">
          <h2 style={{ fontSize: '32px', marginBottom: '8px' }}>🏛️ Zivilisation 1 - Game Setup</h2>
          <small style={{ fontSize: '18px', color: '#aaa' }}>Step {currentStep} of {totalSteps}</small>
        </Modal.Title>
      </Modal.Header>
      
      <Modal.Body style={{ 
        backgroundColor: '#2a2a2a', 
        color: 'white', 
        padding: '0',
        display: 'grid',
        gridTemplateRows: '1fr',
        overflow: 'auto'
      }}>
        <div style={{ 
          maxWidth: '1400px', 
          width: '100%', 
          margin: '0 auto',
          padding: '40px',
          display: 'grid',
          gridTemplateRows: 'auto',
          alignContent: 'start'
        }}>
        {/* Step 1: Civilization Selection */}
        {currentStep === 1 && (
          <>
        <div className="mb-4">
          <h4 style={{ color: '#ffd700', borderBottom: '1px solid #444', paddingBottom: '8px', fontSize: '24px', marginTop: '-30px' }}>
            Choose Your Civilization
          </h4>
          <Row className="mt-3">
            {CIVILIZATIONS.map((civ, idx) => (
              <Col key={idx} xs={6} md={4} lg={3} className="mb-3">
                <div
                  onClick={() => {
                    console.log(`[CLICK] GameSetup select civilization: ${CIVILIZATIONS[idx].name} (${idx})`);
                    setSelectedCiv(idx);
                  }}
                  style={{
                    padding: '12px',
                    border: selectedCiv === idx ? '3px solid #ffd700' : '2px solid #555',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    backgroundColor: selectedCiv === idx ? '#3a3a3a' : '#333',
                    transition: 'all 0.2s',
                    textAlign: 'center'
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
                  <div style={{ fontSize: '28px', marginBottom: '4px', minHeight: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {civ.name === 'Americans' && '🦅'}
                    {civ.name === 'Aztecs' && '🐆'}
                    {civ.name === 'Babylonians' && '🏺'}
                    {civ.name === 'Chinese' && '🐉'}
                    {civ.name === 'Germans' && '✠'}
                    {civ.name === 'Egyptians' && <span style={{ fontSize: '36px', color: '#FFD700' }}>𓂀</span>}
                    {civ.name === 'English' && '🇬🇧'}
                    {civ.name === 'French' && '🇫🇷🥖'}
                    {civ.name === 'Greeks' && '🏛️'}
                    {civ.name === 'Indians' && '🇮🇳'}
                    {civ.name === 'Mongols' && '🏹🐎'}
                    {civ.name === 'Romans' && '⚔️'}
                    {civ.name === 'Russians' && <span style={{ fontSize: '36px', color: '#DC143C' }}>☭</span>}
                    {civ.name === 'Zulus' && <span style={{ fontSize: '32px' }}>🛡️</span>}
                  </div>
                  <div style={{ fontWeight: 'bold', fontSize: '16px', color: civ.color }}>
                    {civ.name}
                  </div>
                  <div style={{ fontSize: '14px', color: '#aaa' }}>
                    {civ.leader}
                  </div>
                </div>
              </Col>
            ))}
          </Row>
        </div>

        {/* Selected Civilization Info */}
        {selectedCiv !== null && (
          <div className="p-2" style={{ backgroundColor: '#1a1a1a', borderRadius: '8px', border: '1px solid #444' }}>
            <span style={{ color: CIVILIZATIONS[selectedCiv].color, fontSize: '16px', fontWeight: 'bold' }}>
              {CIVILIZATIONS[selectedCiv].name}
            </span>
            <span style={{ fontSize: '14px', marginLeft: '12px' }}>
              <strong>Leader:</strong> {CIVILIZATIONS[selectedCiv].leader}
            </span>
            <span style={{ fontSize: '14px', color: '#aaa', marginLeft: '12px' }}>
              <strong>Cities:</strong> {CIVILIZATIONS[selectedCiv].cityNames.slice(0, 3).join(', ')}...
            </span>
          </div>
        )}
        </>
        )}

        {/* Step 2: Game Settings & Summary */}
        {currentStep === 2 && (
          <>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(3, 1fr)', 
          gap: '30px',
          marginBottom: '30px'
        }}>
          {/* Difficulty Level */}
          <div>
            <h4 style={{ color: '#ffd700', borderBottom: '1px solid #444', paddingBottom: '8px', fontSize: '24px', marginTop: '0' }}>
              Difficulty Level
            </h4>
            <Form.Select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              style={{ backgroundColor: '#333', color: 'white', border: '1px solid #555', fontSize: '16px', padding: '10px' }}
              className="mt-2"
            >
              <option value="CHIEFTAIN">Chieftain (Easiest)</option>
              <option value="WARLORD">Warlord (Easy)</option>
              <option value="PRINCE">Prince (Normal)</option>
              <option value="KING">King (Hard)</option>
              <option value="EMPEROR">Emperor (Very Hard)</option>
            </Form.Select>
            <small style={{ color: '#aaa', fontSize: '14px', display: 'block', marginTop: '8px' }}>
              Difficulty affects AI advantages, barbarian frequency, and game balance
            </small>
          </div>

          {/* Number of Civilizations */}
          <div>
            <h4 style={{ color: '#ffd700', borderBottom: '1px solid #444', paddingBottom: '8px', fontSize: '24px', marginTop: '0' }}>
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
            <h4 style={{ color: '#ffd700', borderBottom: '1px solid #444', paddingBottom: '8px', fontSize: '24px', marginTop: '0' }}>
              Map Type
            </h4>
            <Form.Select
              value={mapType}
              onChange={(e) => setMapType(e.target.value)}
              style={{ backgroundColor: '#333', color: 'white', border: '1px solid #555', fontSize: '16px', padding: '10px' }}
              className="mt-2"
            >
              <option value="EARTH">Earth (Realistic)</option>
              <option value="RANDOM">Random (Procedural)</option>
              <option value="PANGAEA">Pangaea (One Landmass)</option>
              <option value="ARCHIPELAGO">Archipelago (Islands)</option>
            </Form.Select>
          </div>
        </div>

        {/* Game Summary */}
        <div className="p-3" style={{ backgroundColor: '#1a1a1a', borderRadius: '8px', border: '1px solid #444' }}>
          <h6 style={{ color: '#ffd700', marginBottom: '12px', fontSize: '20px' }}>Game Summary</h6>
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
