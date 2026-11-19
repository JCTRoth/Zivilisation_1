import type { VisibilitySnapshot } from '@civ1/shared';

/** An event the engine emitted, addressed to the room before per-seat filtering. */
export interface OutboundEvent {
  type: string;
  payload: unknown;
  /** Set by the event classifier when the event is seat-specific. */
  civId?: number;
}

/**
 * Per-connection visibility filtering. The real implementation classifies
 * engine events (universal vs. seat-scoped) and drops anything outside a
 * seat's fog; for now a pass-through keeps the transport wireable.
 */
export interface VisibilityFilter {
  isVisible(event: OutboundEvent, civId: number, snapshot: VisibilitySnapshot): boolean;
}

export const passAllFilter: VisibilityFilter = {
  isVisible: () => true,
};
