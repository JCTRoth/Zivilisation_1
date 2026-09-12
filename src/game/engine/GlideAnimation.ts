import { useGameStore } from '../../stores/GameStore';
import type { GlideRequest } from '../../../types/game';

/**
 * Base glide duration (ms) for a single tile step.
 *
 * Shared by `MoveAnimator` (human moves/attacks) and `GoToManager` (GoTo
 * execution, which also drives multi-turn automated movement) so every unit
 * move animates identically.
 */
export const BASE_GLIDE_DURATION_MS = 250;

/**
 * Resolve an animation duration from a base value and the current settings.
 *
 * Returns `0` when animations are disabled (`enableAnimations === false`) or set
 * to instant (`animationSpeed <= 0`). Callers must skip the animation entirely
 * in that case — headless tests and the `?noanim` e2e runs depend on it.
 */
export function resolveAnimationDuration(base: number): number {
  const settings = useGameStore.getState().settings;
  if (!settings.enableAnimations || settings.animationSpeed <= 0) return 0;
  return Math.round(base * settings.animationSpeed);
}

/** Sleep helper for the deferred-commit animators. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Register a unit glide in the store so the renderer interpolates the drawn
 * position from the old tile to the new one.
 *
 * @returns the animation id, or `null` when the request could not be registered
 * (duration <= 0, i.e. animations are disabled).
 */
export function registerGlide(request: GlideRequest): string | null {
  if (request.duration <= 0) return null;
  const prefix = request.idPrefix ?? 'glide';
  const id = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  useGameStore.getState().actions.addMovementAnimation({
    id,
    unitId: request.unitId,
    fromCol: request.fromCol,
    fromRow: request.fromRow,
    toCol: request.toCol,
    toRow: request.toRow,
    startTime: performance.now(),
    duration: request.duration,
  });
  return id;
}

/**
 * Remove a previously registered glide (best-effort).
 *
 * Call this immediately *after* committing the engine move so the unit never
 * snaps back to the tile it came from.
 */
export function removeGlide(id: string | null): void {
  if (!id) return;
  useGameStore.getState().actions.removeMovementAnimation(id);
}

/**
 * Pending *enemy* animation promises the AI turn should wait for before acting
 * with the next unit, so AI movement is actually visible instead of being
 * overwritten by the next unit's action in the same tick.
 */
const pendingAITimers = new Set<Promise<void>>();

/** Register an enemy animation (or its cleanup timer) with the AI gate. */
export function trackAIAnimation(promise: Promise<void>): void {
  const tracked = promise.catch(() => undefined).finally(() => {
    pendingAITimers.delete(tracked);
  });
  pendingAITimers.add(tracked);
}

/**
 * Wait for the enemy animations currently in flight.
 *
 * Bounded by `maxWaitMs` so a long animation can never stall (or time out) an AI
 * turn. Returns immediately when nothing is animating — which is always the case
 * when animations are disabled, so headless tests and `?noanim` are unaffected.
 */
export async function awaitPendingAnimations(maxWaitMs = 1500): Promise<void> {
  if (pendingAITimers.size === 0) return;
  await Promise.race([Promise.all([...pendingAITimers]), sleep(maxWaitMs)]);
}
