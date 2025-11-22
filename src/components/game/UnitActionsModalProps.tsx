import React from 'react';
import { TILE_SIZE } from '@/data/TerrainData';

export interface ContextMenuData {
  x: number;
  y: number;
  hex: { col: number; row: number };
  tile?: any;
  unit?: any;
  city?: any;
}

export interface UnitActionsModalProps {
  contextMenu: ContextMenuData | null;
  onExecuteAction: (action: string, data?: any) => void;
  onClose: () => void;
}