import React from 'react';
import { Button } from 'react-bootstrap';
import { useGameStore } from '../../stores/gameStore';
import MiniMap from './MiniMap';

// New side panel matching the provided mockup image
const SidePanel: React.FC<{ gameEngine?: any }> = ({ gameEngine }) => {
  const currentPlayer = useGameStore((s) => s.currentPlayer);
  const civilizations = useGameStore((s) => s.civilizations);
  const playerUnits = useGameStore((s) => s.playerUnits);
  const playerCities = useGameStore((s) => s.playerCities);
  const selectedUnit = useGameStore((s) => s.selectedUnit);
  const selectedCity = useGameStore((s) => s.selectedCity);
  const playerResources = useGameStore((s) => s.playerResources);
  const uiState = useGameStore((s) => s.uiState);
  const actions = useGameStore((s) => s.actions);

  // Compute a display player so the panel renders meaningful placeholders
  const displayPlayer = currentPlayer || (civilizations && civilizations.length > 0 ? civilizations[0] : {
    id: -1,
    name: 'Name Of Player',
    leader: 'Name of Civilisation',
    color: '#4b8b3b'
  });

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
              <span style={{ fontSize: 22 }}>{(displayPlayer as any)?.icon ?? '🏛️'}</span>
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
            </div>
          ) : selectedCity ? (
            <div>
              <div style={{ fontWeight: 700 }}>{selectedCity.name}</div>
              <div style={smallMuted}>Population: {selectedCity.population ?? 1}</div>
              <div style={{ marginTop: 8, ...smallMuted }}>Production: {selectedCity.yields?.production ?? 0}</div>
            </div>
          ) : (
            <div style={smallMuted}>
              Type of currently selected unit or building*
              <br />
              *Multiple / Stats / of / the / Unit*
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
                <div style={{ marginTop: 8 }}>{(selectedUnit as any)?.description || 'No additional info available.'}</div>
              </>
            ) : selectedCity ? (
              <>
                <div style={{ marginBottom: 6 }}><strong>{selectedCity.name}</strong></div>
                <div style={smallMuted}>Pop: {selectedCity.population}</div>
                <div style={{ marginTop: 8 }}>{(selectedCity as any)?.description || 'City details will appear here.'}</div>
              </>
            ) : (
              <>
                <div style={{ marginBottom: 6 }}>Type of currently selected unit or Building*</div>
                <div style={smallMuted}>*Multiple / Stats / of / the / Unit*</div>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};

export default SidePanel;