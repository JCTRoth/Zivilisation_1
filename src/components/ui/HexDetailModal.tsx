import React from 'react';
import { Modal } from 'react-bootstrap';
import { TERRAIN_TYPES } from '@/data/TerrainData';

const HexDetailModal = ({ show, onHide, hex, terrain}) => {
  if (!hex || !terrain) return null;

  const centerTile = terrain[hex.row]?.[hex.col];
  if (!centerTile) return null;

  const terrainInfo = TERRAIN_TYPES[centerTile.type];

  // Get adjacent hexes (6 neighbors in hexagonal grid)
  const getAdjacentHexes = () => {
    const isOddRow = hex.row % 2 === 1;
    const offsets = isOddRow ? [
      { col: 0, row: -1, label: 'Ocean' },     // Top
      { col: 1, row: -1, label: 'Plains' },    // Top-right
      { col: 1, row: 0, label: 'Desert' },     // Right
      { col: 1, row: 1, label: 'Ocean' },      // Bottom-right
      { col: 0, row: 1, label: 'Ocean' },      // Bottom
      { col: -1, row: 0, label: 'Plains' },    // Left
    ] : [
      { col: 0, row: -1, label: 'Ocean' },     // Top
      { col: 1, row: 0, label: 'Plains' },     // Top-right
      { col: 1, row: 1, label: 'Desert' },     // Right
      { col: 0, row: 1, label: 'Ocean' },      // Bottom-right
      { col: -1, row: 1, label: 'Ocean' },     // Bottom
      { col: -1, row: 0, label: 'Plains' },    // Left
    ];

    return offsets.map(offset => {
      const adjRow = hex.row + offset.row;
      const adjCol = hex.col + offset.col;
      const tile = terrain[adjRow]?.[adjCol];
      return {
        ...offset,
        tile: tile,
        terrainType: tile ? TERRAIN_TYPES[tile.type] : null
      };
    });
  };

  const adjacentHexes = getAdjacentHexes();

  // Hex positions for visual layout
  const hexPositions = [
    { top: '20%', left: '50%', index: 0 },   // Top
    { top: '35%', left: '70%', index: 1 },   // Top-right
    { top: '65%', left: '70%', index: 2 },   // Bottom-right
    { top: '80%', left: '50%', index: 3 },   // Bottom
    { top: '65%', left: '30%', index: 4 },   // Bottom-left
    { top: '35%', left: '30%', index: 5 },   // Top-left
  ];

  return (
    <Modal 
      show={show} 
      onHide={onHide} 
      centered
      size="lg"
      className="hex-detail-modal"
    >
      <Modal.Header closeButton className="bg-dark text-white border-light">
        <Modal.Title style={{ fontFamily: 'monospace', fontSize: '16px' }}>
          <div className="d-flex justify-content-between align-items-center w-100">
            <span>TERRAIN VIEW</span>
            <div style={{ fontSize: '12px' }}>
              <span className="badge bg-secondary me-2">Hex: {hex.col}, {hex.row}</span>
              <span className="badge bg-info">{terrainInfo.name}</span>
            </div>
          </div>
        </Modal.Title>
      </Modal.Header>
      
      <Modal.Body 
        className="bg-dark text-white p-0"
        style={{ 
          height: '500px',
          fontFamily: 'monospace',
          backgroundColor: '#000'
        }}
      >
        <div className="d-flex h-100">
          {/* Left Info Panel */}
          <div 
            className="border-end border-light p-2"
            style={{ 
              width: '180px',
              backgroundColor: '#87CEEB',
              color: '#000',
              fontSize: '10px',
              lineHeight: '1.3'
            }}
          >
            <div className="mb-2" style={{ fontSize: '11px' }}>
              <strong>4000 BC ?</strong><br/>
              <strong>540 0.5.5</strong><br/>
              <strong>Indian</strong><br/>
              <span>Settler: 0</span><br/>
              <strong>HOME</strong><br/>
              <strong>{terrainInfo.name}</strong>
            </div>

            <div className="border-top border-dark pt-2 mt-2" style={{ fontSize: '9px' }}>
              {centerTile.unit && (
                <>
                  <div className="mb-2">
                    <strong style={{ fontSize: '10px' }}>Active Unit</strong><br/>
                    <span>{centerTile.unit.type}</span><br/>
                    <span>Moves: {centerTile.unit.moves}/1</span>
                  </div>
                  <div className="border-top border-dark pt-1 mt-1"></div>
                </>
              )}
              
              <div className="mt-1">
                <strong>Movement:</strong> 1/3 MP<br/>
                <strong>Defense:</strong> +50%<br/>
              </div>
              
              <div className="mt-2">
                <strong>Resources:</strong><br/>
                <span>Food: 2 🌾</span><br/>
                <span>Prod: 1 ⚒️</span><br/>
                <span>Trade: 1 💰</span>
              </div>
            </div>

            <div className="border-top border-dark pt-2 mt-2" style={{ fontSize: '9px' }}>
              <strong>Features:</strong><br/>
              {centerTile.hasRiver && <span>• River<br/></span>}
              {centerTile.hasRoad && <span>• Road<br/></span>}
              {centerTile.improvement && <span>• {centerTile.improvement}<br/></span>}
              {!centerTile.hasRiver && !centerTile.hasRoad && !centerTile.improvement && <span>• None<br/></span>}
            </div>

            {centerTile.city && (
              <div className="border-top border-dark pt-2 mt-2" style={{ fontSize: '9px' }}>
                <strong>City:</strong><br/>
                <span>{centerTile.city.name}</span><br/>
                <span>Size: {centerTile.city.population || 1}</span>
              </div>
            )}
          </div>

          {/* Center Hex Display */}
          <div 
            className="flex-grow-1 position-relative"
            style={{ backgroundColor: '#000' }}
          >
            {/* Title Bar */}
            <div 
              className="d-flex justify-content-between align-items-center border-bottom border-light px-3 py-1"
              style={{ 
                backgroundColor: '#4682B4',
                fontSize: '11px',
                fontWeight: 'bold',
                color: '#FFF'
              }}
            >
              <span>☰ Menu Bar</span>
              <span>🗺️ Map Window</span>
            </div>

            {/* Hex Grid Visual */}
            <div className="position-relative h-100">
              {/* Center hex */}
              <div
                className="position-absolute"
                style={{
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '120px',
                  height: '120px',
                }}
              >
                <div
                  className="d-flex align-items-center justify-content-center"
                  style={{
                    width: '100%',
                    height: '100%',
                    backgroundColor: terrainInfo.color,
                    border: '3px solid #FFF',
                    clipPath: 'polygon(30% 0%, 70% 0%, 100% 50%, 70% 100%, 30% 100%, 0% 50%)',
                    fontSize: '48px'
                  }}
                >
                  {terrainInfo.char}
                </div>
                {centerTile.unit && (
                  <div 
                    className="position-absolute text-center text-white"
                    style={{ 
                      fontSize: '10px', 
                      fontWeight: 'bold',
                      bottom: '-40px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      backgroundColor: 'rgba(0,0,0,0.7)',
                      padding: '4px 8px',
                      borderRadius: '3px',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Active Unit
                  </div>
                )}
              </div>

              {/* Adjacent hexes */}
              {hexPositions.map((pos, idx) => {
                const adjHex = adjacentHexes[pos.index];
                if (!adjHex || !adjHex.terrainType) return null;

                return (
                  <div
                    key={idx}
                    className="position-absolute"
                    style={{
                      top: pos.top,
                      left: pos.left,
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    <div
                      className="d-flex align-items-center justify-content-center"
                      style={{
                        width: '80px',
                        height: '80px',
                        backgroundColor: adjHex.terrainType.color,
                        border: '2px solid #888',
                        clipPath: 'polygon(30% 0%, 70% 0%, 100% 50%, 70% 100%, 30% 100%, 0% 50%)',
                        fontSize: '24px',
                        opacity: 0.9
                      }}
                    >
                      {adjHex.terrainType.char}
                    </div>
                    <div 
                      className="text-center mt-1"
                      style={{ 
                        fontSize: '10px',
                        backgroundColor: 'rgba(0,0,0,0.7)',
                        color: '#FFF',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {adjHex.terrainType.name}
                    </div>
                  </div>
                );
              })}

              {/* Connection lines */}
              <svg 
                className="position-absolute"
                style={{ 
                  top: 0, 
                  left: 0, 
                  width: '100%', 
                  height: '100%',
                  pointerEvents: 'none'
                }}
              >
                {hexPositions.map((pos, idx) => (
                  <line
                    key={idx}
                    x1="50%"
                    y1="50%"
                    x2={pos.left}
                    y2={pos.top}
                    stroke="#555"
                    strokeWidth="1"
                    strokeDasharray="5,5"
                  />
                ))}
              </svg>
            </div>
          </div>
        </div>
      </Modal.Body>
      
      <Modal.Footer className="bg-dark border-light">
        <button className="btn btn-secondary btn-sm" onClick={() => {
          console.log('[CLICK] HexDetailModal close button');
          onHide();
        }}>
          Close
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => console.log('[CLICK] HexDetailModal center view button (not implemented)')}>
          Center View
        </button>
        <button className="btn btn-info btn-sm" onClick={() => console.log('[CLICK] HexDetailModal move unit here button (not implemented)')}>
          Move Unit Here
        </button>
      </Modal.Footer>
    </Modal>
  );
};

export default HexDetailModal;