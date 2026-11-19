import type { GlideRequest, Unit } from '../types/game';

/**
 * THE PRESENTATION PORT.
 *
 * The engine is a headless simulation. Anything that needs a canvas, a React
 * store, a toast, or wall-clock pacing crosses this interface instead of being
 * imported directly. The browser supplies `webRuntime`; the server and every
 * node test get `headlessRuntime`, whose methods are instant no-ops.
 *
 * This is deliberately a small port, not a general event bus. When the timers
 * become simulation ticks (split blocker 4), only the implementations change —
 * the engine call sites stay put. The runtime is per-`GameEngine` instance so a
 * server can host many rooms without sharing browser state.
 */
/** Base duration of one tile-step glide, shared by GoTo and the web animators. */
export const BASE_GLIDE_DURATION_MS = 250;

export interface VisibilitySnapshot {
  units: Unit[];
  width: number;
  visibility: ReadonlyArray<boolean>;
  devMode: boolean;
}

export type NotificationKind = 'success' | 'error' | 'info' | 'warning';

export interface GameRuntime {
  /** Current spectator speed rung (0 = full speed). */
  gameSpeedStep(): number;
  /** Whether hotseat handoff screens are disabled. */
  skipHotseatHandoff(): boolean;
  /** What the human can currently see — used for fog-of-war GoTo interrupts. */
  visibility(): VisibilitySnapshot;
  /** Route an engine-level toast to the right seat. */
  notify(kind: NotificationKind, message: string, civId?: string | number): void;

  /** Animation pacing. All no-ops in headless mode. */
  resolveAnimationDuration(baseMs: number): number;
  sleep(ms: number): Promise<void>;
  registerGlide(request: GlideRequest): string | null;
  removeGlide(id: string | null): void;
  trackAIAnimation(promise: Promise<void>): void;
  awaitPendingAnimations(maxWaitMs?: number): Promise<void>;
  awaitCameraGlide(maxWaitMs?: number): Promise<void>;
  isCameraGliding(): boolean;
}

/** The server / node-test implementation: no DOM, no timers, no waits. */
export const headlessRuntime: GameRuntime = {
  gameSpeedStep: () => 0,
  skipHotseatHandoff: () => true,
  visibility: () => ({ units: [], width: 0, visibility: [], devMode: false }),
  notify: () => undefined,

  resolveAnimationDuration: () => 0,
  sleep: async () => undefined,
  registerGlide: () => null,
  removeGlide: () => undefined,
  trackAIAnimation: () => undefined,
  awaitPendingAnimations: async () => undefined,
  awaitCameraGlide: async () => undefined,
  isCameraGliding: () => false,
};
