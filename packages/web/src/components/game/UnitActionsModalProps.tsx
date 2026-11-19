import type { Unit, City } from '../../../types/game';
import GameEngine from '@/game/engine/GameEngine';

type MapTile = { terrain?: string; type?: string; resource?: string; improvement?: string | Record<string, unknown>; village?: boolean; visible?: boolean; explored?: boolean; col?: number; row?: number };

interface ContextMenuData {
  x: number;
  y: number;
  hex: { col: number; row: number };
  tile?: MapTile | null;
  unit?: Unit | null;
  city?: City | null;
}

export interface UnitActionsModalProps {
  contextMenu: ContextMenuData | null;
  onExecuteAction: (action: string, data?: Record<string, unknown>) => void;
  onClose: () => void;
  gameEngine?: GameEngine;
  /** Whether the SidePanel drawer is open — styles the toggle's active state. */
  panelOpen?: boolean;
  /** Toggles the SidePanel. The one control that survived the old mobile
   *  bottom bar: it now lives at the far left of the orders bar. */
  onTogglePanel?: () => void;
}