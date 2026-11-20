import type GameEngine from '@civ1/shared/game/engine/GameEngine';
import type { OutboundEvent } from '@civ1/shared/types/events';

export type { OutboundEvent } from '@civ1/shared/types/events';

/**
 * Per-connection visibility filtering. The server classifies every engine
 * event, then asks the filter before writing it to a seat's socket.
 */
export interface VisibilityFilter {
  isVisible(event: OutboundEvent, seat: number): boolean;
}

/** Filter backed by the room engine's own fog-of-war state. */
export function engineFogFilter(engine: GameEngine): VisibilityFilter {
  return {
    isVisible: (event, seat) => {
      if (event.scope === 'universal') return true;
      if (event.seatOnly || event.scope === 'seat') return event.civId === seat;
      if (event.civId !== undefined && event.civId !== seat) return false;
      if (event.col !== undefined && event.row !== undefined) {
        return engine.isVisibleToPlayer(seat, event.col, event.row);
      }
      return true;
    },
  };
}

/** Development fallback: every event reaches every seat. */
export const passAllFilter: VisibilityFilter = {
  isVisible: () => true,
};
