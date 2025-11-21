import React from 'react';
import './unitContextMenu.css';

interface ContextMenuPosition {
  x: number;
  y: number;
}

interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  enabled: boolean;
  onClick: () => void;
  color?: string;
}

interface UnitContextMenuProps {
  position: ContextMenuPosition | null;
  menuItems: MenuItem[];
  onClose: () => void;
}

/**
 * Context menu for unit actions
 * Displays when right-clicking on a friendly unit
 */
const UnitContextMenu: React.FC<UnitContextMenuProps> = ({ position, menuItems, onClose }) => {
  if (!position) return null;

  return (
    <>
      {/* Invisible backdrop to close menu on click */}
      <div 
        className="context-menu-backdrop"
        onClick={onClose}
      />

      {/* Context menu */}
      <div 
        className="unit-context-menu"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`
        }}
      >
        {menuItems.map((item) => (
          <button
            key={item.id}
            className={`context-menu-item ${!item.enabled ? 'disabled' : ''}`}
            disabled={!item.enabled}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            style={item.color ? { borderLeftColor: item.color } : undefined}
          >
            {item.icon && <span className="menu-icon">{item.icon}</span>}
            <span className="menu-label">{item.label}</span>
          </button>
        ))}
      </div>
    </>
  );
};

export default UnitContextMenu;
