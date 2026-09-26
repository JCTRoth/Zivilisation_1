/**
 * Awaitable camera glide.
 *
 * The camera is owned by `GameCanvas` (a React component): a pan request in the
 * store is turned into a `cameraTweenRef` tween and stepped inside the single
 * `requestAnimationFrame` loop. Nothing outside React could tell when the camera
 * had arrived, so the engine used to start unit animations while the camera was
 * still travelling (an AI unit moved before you could see where).
 *
 * This module is the missing signal, deliberately free of imports so neither the
 * store nor the engine has to know about the renderer:
 *
 *   store action  → beginCameraGlide()   (a pan was requested)
 *   GameCanvas    → finishCameraGlide()  (tween finished, was cancelled, or the
 *                                        camera was committed instantly)
 *   engine        → await awaitCameraGlide()   before starting any animation
 *
 * `awaitCameraGlide` always resolves: immediately when no pan is in flight (the
 * common case for the human player's own moves and for headless tests), and
 * after `maxWaitMs` at the latest so a missing renderer can never deadlock the
 * game loop.
 */

let pending = 0;
const waiters = new Set<() => void>();

/** Announce that a camera pan is in flight (idempotent: only one tween exists). */
export function beginCameraGlide(): void {
  pending = 1;
}

/** Announce that the camera has arrived / stopped moving. Releases all waiters. */
export function finishCameraGlide(): void {
  pending = 0;
  if (waiters.size === 0) return;
  const toResolve = [...waiters];
  waiters.clear();
  for (const resolve of toResolve) resolve();
}

/** Whether a camera pan is currently tracked as in flight. */
export function isCameraGliding(): boolean {
  return pending > 0;
}

/**
 * Resolve once the camera is idle, or after `maxWaitMs` (never rejects).
 *
 * Callers that must stay synchronous when nothing is animating should guard
 * with `isCameraGliding()` first: `await`ing an already-resolved promise still
 * yields to the microtask queue.
 */
export async function awaitCameraGlide(maxWaitMs = 900): Promise<void> {
  if (pending === 0) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      waiters.delete(done);
      resolve();
    };
    // Timeout is a safety net only: `done` is idempotent, so a late fire after
    // `finishCameraGlide()` already resolved the waiters is a no-op.
    setTimeout(done, maxWaitMs);
    waiters.add(done);
  });
}
