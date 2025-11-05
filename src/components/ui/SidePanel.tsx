import React from 'react';
import { Button } from 'react-bootstrap';
import { useGameStore } from '../../stores/gameStore';
import { CIVILIZATIONS } from '../../game/gameData';
import MiniMap from './MiniMap';

// New side panel matching the provided mockup image
const SidePanel: React.FC<{ gameEngine?: any }> = ({ gameEngine }) => {
  const currentPlayer = useGameStore((s) => s.currentPlayer);
  const civilizations = useGameStore((s) => s.civilizations);
  const playerUnits = useGameStore((s) => s.playerUnits);
  const playerCities = useGameStore((s) => s.playerCities);
  const selectedUnit = useGameStore((s) => s.selectedUnit);
  const selectedCityId: string | null = useGameStore((s) => s.gameState.selectedCity);
  const cities = useGameStore((s) => s.cities);
  const playerResources = useGameStore((s) => s.playerResources);
  const uiState = useGameStore((s) => s.uiState);
  const actions = useGameStore((s) => s.actions);

  const selectedCity = cities.find(c => c.id === selectedCityId);

  // Compute a display player so the panel renders meaningful placeholders
  const displayPlayer = currentPlayer || (civilizations && civilizations.length > 0 ? civilizations[0] : {
    id: -1,
    name: 'Name Of Player',
    leader: 'Name of Civilisation',
    color: '#4b8b3b'
  });

  // Find the static civilization data to get the icon
  const staticCiv = CIVILIZATIONS.find(civ => civ.name === displayPlayer.name);

  // Inline styles chosen to closely match the screenshot (dark pane, white text, left column)
  const panelStyle: React.CSSProperties = {
    width: '100%',
    background: '#222831',
    color: '#ffffff',
    minHeight: '100vh',
    boxSizing: 'border-box',
    paddingTop: 6,
    display: 'grid',
    gridTemplateRows: 'auto 1fr 1fr'
  };

  const headerStyle: React.CSSProperties = {
    padding: '10px 12px',
    borderBottom: '2px solid rgba(255,255,255,0.06)'
  };

  const sectionStyle: React.CSSProperties = {
    padding: '12px',
    borderBottom: '2px solid rgba(255,255,255,0.04)',
    minHeight: 120
  };

  const smallMuted: React.CSSProperties = { color: 'rgba(255,255,255,0.7)', fontSize: 12 };

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={`mobile-menu-backdrop ${!uiState.sidebarCollapsed ? 'show' : ''} d-md-none`}
        onClick={() => actions.toggleUI('sidebarCollapsed')}
      />


        {uiState.showMinimap && (
          <div style={{ width: '100%' }}>
            <MiniMap gameEngine={gameEngine} />
          </div>
        )}

      <aside className={`game-side-panel ${!uiState.sidebarCollapsed ? 'show' : ''}`} style={panelStyle}>
        <div style={headerStyle}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 6,
                background: displayPlayer.color || '#4b8b3b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 0 4px rgba(0,0,0,0.6) inset'
              }}
            >
              <span style={{ fontSize: 22 }}>{staticCiv?.icon ?? '🏛️'}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{displayPlayer.name}</div>
              <div style={{ ...smallMuted, marginTop: 2 }}>{(displayPlayer as any)?.civilizationName || displayPlayer.leader || 'Unknown Civilization'}</div>
              <div style={{ marginTop: 8 }}>
                <strong style={{ color: '#9be6a8', fontSize: 15 }}>{(playerResources.gold ?? 0)} €</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Middle: selected unit/building summary */}
        <div style={{ ...sectionStyle, minHeight: 140 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}> {selectedUnit || selectedCity ? 'Selected' : 'No Selection'}</div>

          {selectedUnit ? (
            <div>
              <div style={{ fontWeight: 700 }}>{selectedUnit.name}</div>
              <div style={smallMuted}>{selectedUnit.type}</div>
              <div style={{ marginTop: 8, ...smallMuted }}>
                HP: {selectedUnit.health ?? 100} • Moves: {selectedUnit.movesRemaining ?? 0}
              </div>
              <div style={{ marginTop: 4, ...smallMuted }}>
                Attack: {(selectedUnit as any)?.attack ?? 0} • Defense: {(selectedUnit as any)?.defense ?? 0}
              </div>
            </div>
          ) : selectedCity ? (
            <div>
              <div style={{ fontWeight: 700 }}>{selectedCity.name}</div>
              <div style={smallMuted}>Population: {selectedCity.population ?? 1}</div>
              <div style={{ marginTop: 8, ...smallMuted }}>Production: {selectedCity.yields?.production ?? 0}</div>
            </div>
          ) : (
            <div style={smallMuted}>
              <div>Units: {playerUnits?.length ?? 0}</div>
              <div>Cities: {playerCities?.length ?? 0}</div>
              <div style={{ marginTop: 8 }}>
                Food: {playerResources?.food ?? 0} • Production: {playerResources?.production ?? 0}
              </div>
              <div>Trade: {playerResources?.trade ?? 0} • Science: {playerResources?.science ?? 0}</div>
            </div>
          )}
        </div>

        {/* Bottom: Large detail box (big, mostly empty in screenshot) */}
        <div style={{ ...sectionStyle, minHeight: 340 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Details</div>

          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14 }}>
            {/* Use selected unit/city for details when available, otherwise show player summary */}
            {selectedUnit ? (
              <>
                <div style={{ marginBottom: 6 }}><strong>{selectedUnit.name}</strong> — {selectedUnit.type}</div>
                <div style={smallMuted}>Location: {selectedUnit.col}, {selectedUnit.row}</div>
                <div style={{ marginTop: 8 }}>
                  <div>Health: {selectedUnit.health ?? 100}/100</div>
                  <div>Moves: {selectedUnit.movesRemaining ?? 0}/{(selectedUnit as any)?.maxMoves ?? 1}</div>
                  <div>Attack: {(selectedUnit as any)?.attack ?? 0}</div>
                  <div>Defense: {(selectedUnit as any)?.defense ?? 0}</div>
                </div>
              </>
            ) : selectedCity ? (
              <>
                <div style={{ marginBottom: 6 }}><strong>{selectedCity.name}</strong></div>
                <div style={smallMuted}>Location: {selectedCity.col}, {selectedCity.row}</div>
                <div style={{ marginTop: 8 }}>
                  <div>Population: {selectedCity.population ?? 1}</div>
                  <div>Food: {selectedCity.yields?.food ?? 0}</div>
                  <div>Production: {selectedCity.yields?.production ?? 0}</div>
                  <div>Trade: {selectedCity.yields?.trade ?? 0}</div>
                  <div>Science: {selectedCity.science ?? 0}</div>
                  <div>Gold: {selectedCity.gold ?? 0}</div>
                </div>
              </>
            ) : (
              <>
                <div style={{ marginBottom: 6 }}>Player Summary</div>
                <div style={smallMuted}>
                  <div>Units: {playerUnits?.length ?? 0}</div>
                  <div>Cities: {playerCities?.length ?? 0}</div>
                  <div style={{ marginTop: 8 }}>Resources:</div>
                  <div>Gold: {playerResources?.gold ?? 0}</div>
                  <div>Food: {playerResources?.food ?? 0}</div>
                  <div>Production: {playerResources?.production ?? 0}</div>
                  <div>Trade: {playerResources?.trade ?? 0}</div>
                  <div>Science: {playerResources?.science ?? 0}</div>
                </div>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};

export default SidePanel;