/**
 * Development-mode overlay scratch state.
 *
 * The AI announces the tile it is heading for with an `AI_TARGET_HIGHLIGHT`
 * event for every unit it moves — hundreds of them in a single round. Routing
 * that through the React store would re-render the whole tree once per event,
 * so the markers live here instead: the engine writes them, the dev overlay
 * reads them straight from the canvas loop, and each marker fades away on its
 * own. Nothing here runs unless the dev panel's "AI targets" box is ticked.
 */

/** One fading "the AI aims here" marker. */
export interface AiTargetMarker {
  col: number;
  row: number;
  /** Fill colour the AI asked for (kept verbatim so the caller's intent shows). */
  color: string;
  /** `performance.now()` of the recording — drives the fade-out. */
  atMs: number;
}

/** Age at which a marker has faded out completely. */
export const AI_TARGET_TTL_MS = 6000;

/** Hard cap: a long AI round must never grow this without bound. */
export const AI_TARGET_MAX_MARKERS = 160;

const markers: AiTargetMarker[] = [];

/** Monotonic clock that also works where `performance` is missing (tests). */
const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/**
 * Remember a tile the AI picked as a target. Several units aiming at the same
 * tile is one fact, not many — an existing marker for that tile is refreshed
 * instead of stacked, so a swarm converging on one city reads as a single
 * pulsing marker rather than a solid red block.
 */
export function recordAiTarget(col: number, row: number, color: string): void {
  const atMs = now();
  const existing = markers.find((m) => m.col === col && m.row === row);
  if (existing) {
    existing.atMs = atMs;
    existing.color = color;
    return;
  }
  markers.push({ col, row, color, atMs });
  if (markers.length > AI_TARGET_MAX_MARKERS) {
    markers.splice(0, markers.length - AI_TARGET_MAX_MARKERS);
  }
}

/**
 * Every marker still on screen, oldest first; expired ones are dropped as a
 * side effect. Returns the live array (the canvas only ever reads it) — do not
 * mutate it from a caller.
 */
export function getAiTargetMarkers(currentTime: number = now()): AiTargetMarker[] {
  const oldestKept = currentTime - AI_TARGET_TTL_MS;
  for (let i = markers.length - 1; i >= 0; i--) {
    if (markers[i].atMs < oldestKept) markers.splice(i, 1);
  }
  return markers;
}

/** Drop every marker (new game / leaving dev mode). */
export function clearAiTargetMarkers(): void {
  markers.length = 0;
}
