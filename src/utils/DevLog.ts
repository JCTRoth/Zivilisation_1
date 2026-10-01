/**
 * Debug logging for the turn / AI / production pipeline.
 *
 * These paths run thousands of times per second in AI-vs-AI games. Every
 * `console.log` serialises its arguments and wakes the devtools console; on the
 * 96x60 naval maps the turn pipeline produced tens of thousands of messages per
 * minute, which showed up as a real CPU cost in profiles (and made the console
 * useless). High-level lifecycle events are still logged unconditionally;
 * this gate covers the per-turn/per-unit chatter.
 *
 * Enable at runtime without a rebuild:
 *   localStorage.setItem('civ.debugLogs', '1')   // then reload
 * or in a specific scope (tests, a debugger session):
 *   globalThis.__civDebugLogs = true
 * Unset it with `localStorage.removeItem('civ.debugLogs')` / `delete globalThis.__civDebugLogs`.
 */
declare global {
  // eslint-disable-next-line no-var
  var __civDebugLogs: boolean | undefined;
}

let envEnabled: boolean | null = null;
const isEnvEnabled = (): boolean => {
  if (envEnabled !== null) return envEnabled;
  try {
    envEnabled =
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('civ.debugLogs') === '1';
  } catch {
    envEnabled = false;
  }
  return envEnabled;
};

/** Logs only when verbose pipeline logging is explicitly enabled. */
export const debugLog = (...args: unknown[]): void => {
  if (globalThis.__civDebugLogs ?? isEnvEnabled()) console.log(...args);
};
