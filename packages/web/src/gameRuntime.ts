import { useGameStore } from './stores/GameStore';
import { notify } from './utils/NotificationUtils';
import {
  registerGlide,
  removeGlide,
  resolveAnimationDuration,
  sleep,
  trackAIAnimation,
  awaitPendingAnimations,
} from './game/rendering/GlideAnimation';
import { awaitCameraGlide, isCameraGliding } from './game/rendering/CameraGlideGate';
import type { GameRuntime, NotificationKind, VisibilitySnapshot } from '@shared/ports/runtime';
import type { GlideRequest } from '@shared/types/game';

/**
 * Browser implementation of the engine's presentation port.
 *
 * Everything here was an engine import before the split; it now lives on the
 * web side of the boundary. The engine holds a reference to this object, so a
 * server room can run the identical simulation with `headlessRuntime` instead.
 */
export const webRuntime: GameRuntime = {
  gameSpeedStep: () => useGameStore.getState().settings.gameSpeedStep ?? 0,
  skipHotseatHandoff: () => !!useGameStore.getState().settings?.skipHotseatHandoff,
  visibility: (): VisibilitySnapshot => {
    const state = useGameStore.getState();
    return {
      units: state.units ?? [],
      width: state.map?.width ?? 0,
      visibility: state.map?.visibility ?? [],
      devMode: !!state.settings?.devMode,
    };
  },
  notify: (kind: NotificationKind, message: string, civId?: string | number) =>
    notify(kind, message, civId),

  resolveAnimationDuration,
  sleep,
  registerGlide: (request: GlideRequest) => registerGlide(request),
  removeGlide,
  trackAIAnimation,
  awaitPendingAnimations,
  awaitCameraGlide,
  isCameraGliding,
};
