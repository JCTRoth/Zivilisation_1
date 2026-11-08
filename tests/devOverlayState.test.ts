import { beforeEach, describe, expect, it } from 'vitest';
import {
  AI_TARGET_MAX_MARKERS,
  AI_TARGET_TTL_MS,
  clearAiTargetMarkers,
  getAiTargetMarkers,
  recordAiTarget,
} from '@/utils/DevOverlayState';

/**
 * The dev panel's "AI targets" box draws whatever the engine recorded here.
 * Three properties keep that overlay cheap and readable:
 *
 *  1. one tile = one marker (a city being targeted by ten units is one fact),
 *  2. markers fade out on their own (the AI moves on every round),
 *  3. the buffer is capped (the AI fires this event per unit, per round).
 */
describe('Dev overlay — AI target markers', () => {
  beforeEach(() => clearAiTargetMarkers());

  it('refreshes a marker on the same tile instead of stacking duplicates', () => {
    recordAiTarget(3, 4, 'rgba(255,0,0,0.4)');
    recordAiTarget(3, 4, 'rgba(255,0,0,0.4)');

    expect(getAiTargetMarkers()).toHaveLength(1);
  });

  it('keeps distinct tiles apart', () => {
    recordAiTarget(3, 4, 'rgba(255,0,0,0.4)');
    recordAiTarget(5, 6, 'rgba(255,0,0,0.4)');

    expect(getAiTargetMarkers().map((m) => `${m.col},${m.row}`)).toEqual(['3,4', '5,6']);
  });

  it('drops a marker once it has faded out', () => {
    recordAiTarget(1, 1, 'rgba(255,0,0,0.4)');
    const [marker] = getAiTargetMarkers();
    expect(marker).toBeDefined();

    // Just inside the window it is still there…
    expect(getAiTargetMarkers(marker.atMs + AI_TARGET_TTL_MS - 1)).toHaveLength(1);
    // …and gone the moment it expires.
    expect(getAiTargetMarkers(marker.atMs + AI_TARGET_TTL_MS + 1)).toHaveLength(0);
  });

  it('caps the buffer so a long AI round cannot grow it without bound', () => {
    for (let i = 0; i < AI_TARGET_MAX_MARKERS * 3; i++) {
      recordAiTarget(i % 500, Math.floor(i / 500), 'rgba(255,0,0,0.4)');
    }

    expect(getAiTargetMarkers().length).toBeLessThanOrEqual(AI_TARGET_MAX_MARKERS);
  });

  it('clears everything for a new game', () => {
    recordAiTarget(1, 1, 'rgba(255,0,0,0.4)');
    clearAiTargetMarkers();

    expect(getAiTargetMarkers()).toHaveLength(0);
  });
});
