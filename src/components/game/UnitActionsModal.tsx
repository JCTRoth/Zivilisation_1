import React from 'react';
import { TILE_SIZE } from '@/data/TerrainData';
import { UnitActionsModalProps, ContextMenuData } from './UnitActionsModalProps';

const UnitActionsModal: React.FC<UnitActionsModalProps> = ({
  contextMenu,
  onExecuteAction,
  onClose
}) => {
  if (!contextMenu) return null;

  const handleAction = (action: string) => {
    onExecuteAction(action);
    onClose();
  };

  return (
    <div
      className="position-fixed bg-dark border border-light text-white"
      style={{
        left: `${Math.min(contextMenu.x, window.innerWidth - 250)}px`,
        top: `${Math.min(contextMenu.y, window.innerHeight - 400)}px`,
        zIndex: 1000,
        minWidth: '180px',
        fontSize: '12px',
        fontFamily: 'monospace'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="bg-secondary p-2 border-bottom border-light">
        <strong>
          {contextMenu.unit ? `${contextMenu.unit.type}` :
           contextMenu.city ? `${contextMenu.city.name}` :
           'Menu'}
        </strong>
        <div className="context-menu-coords" style={{ fontSize: '10px', color: '#aaa' }}>
          ({contextMenu.hex.col}, {contextMenu.hex.row})
        </div>
      </div>

      {/* Unit Actions */}
      {contextMenu.unit && (
        <>
          <button
            className="btn btn-sm w-100 text-start border-0 rounded-0 context-menu-button btn-dark text-white"
            onClick={() => handleAction('sleep')}
          >
            {contextMenu.unit.isSleeping ? '🌅 Wake Up' : '😴 Sleep'}
          </button>

          {(contextMenu.unit.type === 'warriors' || contextMenu.unit.type === 'archer' || contextMenu.unit.type === 'chariot') && (
            <button
              className={`btn btn-sm w-100 text-start border-0 rounded-0 context-menu-button ${
                (contextMenu.unit.movesRemaining || 0) > 0 ? 'btn-dark text-white' : 'btn-secondary text-muted'
              }`}
              disabled={(contextMenu.unit.movesRemaining || 0) <= 0}
              onClick={() => handleAction('fortify')}
            >
              🛡️ Fortify
            </button>
          )}

          {contextMenu.unit.type === 'settler' && (
            <>
              <button
                className={`btn btn-sm w-100 text-start border-0 rounded-0 context-menu-button ${
                  (contextMenu.unit.movesRemaining || 0) > 0 ? 'btn-dark text-white' : 'btn-secondary text-muted'
                }`}
                disabled={(contextMenu.unit.movesRemaining || 0) <= 0}
                onClick={() => handleAction('found_city')}
              >
                🏛️ Found City
              </button>

              <button
                className={`btn btn-sm w-100 text-start border-0 rounded-0 context-menu-button ${
                  (contextMenu.unit.movesRemaining || 0) > 0 ? 'btn-dark text-white' : 'btn-secondary text-muted'
                }`}
                disabled={(contextMenu.unit.movesRemaining || 0) <= 0}
                onClick={() => handleAction('build_road')}
              >
                🛣️ Build Road
              </button>
            </>
          )}

          {/* ORDERS separator */}
          <hr style={{ margin: '4px 0', borderColor: '#555' }} />

          {/* ORDERS Menu */}
          <div style={{ fontSize: '11px', color: '#aaa', padding: '4px 8px', fontWeight: 'bold' }}>
            ORDERS
          </div>

          <button
            className="btn btn-sm w-100 text-start border-0 rounded-0 context-menu-button btn-dark text-white"
            onClick={() => handleAction('patrol')}
          >
            🔄 Patrol
          </button>

          <button
              className="btn btn-sm w-100 text-start border-0 rounded-0 context-menu-button btn-dark text-white"
              onClick={() => handleAction('goto')}
          >
            <i className="bi bi-geo-alt-fill">Go to</i>
          </button>

          <hr style={{margin: '4px 0', borderColor: '#555' }} />

          <button
            className="btn btn-sm w-100 text-start border-0 rounded-0 context-menu-button btn-dark text-white"
            onClick={() => handleAction('skip_turn')}
          >
            ⏭️ Skip Turn
          </button>
        </>
      )}

      {/* City Actions */}
      {contextMenu.city && (
        <>
          <button
            className="btn btn-sm w-100 text-start border-0 rounded-0 context-menu-button btn-dark text-white"
            onClick={() => handleAction('viewProduction')}
          >
            🏭 View Production
          </button>
          <button
            className="btn btn-sm w-100 text-start border-0 rounded-0 context-menu-button btn-dark text-white"
            onClick={() => handleAction('cityInfo')}
          >
            📊 City Info
          </button>
        </>
      )}

      {/* General Actions */}
      <hr style={{ margin: '4px 0', borderColor: '#555' }} />
      <button
        className="btn btn-sm w-100 text-start border-0 rounded-0 context-menu-button btn-dark text-white"
        onClick={() => handleAction('centerView')}
      >
        📍 Center View
      </button>
      <button
        className="btn btn-sm w-100 text-start border-0 rounded-0 context-menu-button btn-dark text-white"
        onClick={() => handleAction('examineHex')}
      >
        🔍 Examine
      </button>
    </div>
  );
};

export default UnitActionsModal;
