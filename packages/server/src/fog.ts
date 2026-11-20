import type GameEngine from '@civ1/shared/game/engine/GameEngine';

/** An engine event the room emitted, before per-seat filtering. */
export interface OutboundEvent {
  type: string;
  payload: unknown;
  /** Owning seat, when the event is about one civilization. */
  civId?: number;
  /** Location of the subject, when the event happens on the map. */
  col?: number;
  row?: number;
  /** Never broadcast beyond the owning seat. */
  seatOnly?: boolean;
}

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
      if (event.seatOnly) return event.civId === seat;
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
