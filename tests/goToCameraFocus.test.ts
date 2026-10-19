import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '@/stores/GameStore';
import {
  BLACK_COVERAGE_REFOCUS_THRESHOLD,
  computeViewportBlackCoverage,
} from '@/utils/ViewportBlackCoverage';

/**
 * GoTo camera rule: after a route has been assigned to a unit, the camera
 * comes back to that unit ONLY when the screen is more than 80% black at that
 * moment (the player scrolled out into unexplored space to plot the route and
 * is now staring at a black screen). A view with real map content — the drawn
 * route, the destination, own territory — must stay where the player put it.
 *
 * "Black" is exactly what the renderer paints black: unexplored tiles plus
 * off-map space. Explored-but-fogged tiles are dimmed, not black, and are
 * therefore not counted.
 */
describe('GoTo camera rule — refocus on the routed unit when the screen is black', () => {
  const MAP_WIDTH = 40;
  const MAP_HEIGHT = 30;

  // In the node test environment `getGameViewport()` falls back to 800×600.
  const VIEW_W = 800;
  const VIEW_H = 600;

  const revealedMask = (exploredTiles: (tileIndex: number, col: number, row: number) => boolean): boolean[] =>
    Array.from({ length: MAP_WIDTH * MAP_HEIGHT }, (_, idx) =>
      exploredTiles(idx, idx % MAP_WIDTH, Math.floor(idx / MAP_WIDTH)),
    );

  describe('computeViewportBlackCoverage', () => {
    it('is 1 when the whole viewport is unexplored', () => {
      const coverage = computeViewportBlackCoverage({
        camera: { x: 0, y: 0, zoom: 2 },
        viewportWidth: VIEW_W,
        viewportHeight: VIEW_H,
        mapWidth: MAP_WIDTH,
        mapHeight: MAP_HEIGHT,
        revealed: new Array(MAP_WIDTH * MAP_HEIGHT).fill(false),
      });
      expect(coverage).toBe(1);
    });

    it('is 0 when every tile on screen is explored', () => {
      const coverage = computeViewportBlackCoverage({
        camera: { x: 0, y: 0, zoom: 2 },
        viewportWidth: VIEW_W,
        viewportHeight: VIEW_H,
        mapWidth: MAP_WIDTH,
        mapHeight: MAP_HEIGHT,
        revealed: new Array(MAP_WIDTH * MAP_HEIGHT).fill(true),
      });
      expect(coverage).toBe(0);
    });

    it('counts only the unexplored share of a half-revealed viewport', () => {
      // Zoom 2 → the 800×600 viewport shows world (0,0)–(400,300), i.e. tiles
      // cols 0–12, rows 0–9. Reveal the left half (cols 0–5, 192 px) → 48% of
      // the viewport is explored, so 52% renders black.
      const coverage = computeViewportBlackCoverage({
        camera: { x: 0, y: 0, zoom: 2 },
        viewportWidth: VIEW_W,
        viewportHeight: VIEW_H,
        mapWidth: MAP_WIDTH,
        mapHeight: MAP_HEIGHT,
        revealed: revealedMask((_idx, col) => col <= 5),
      });
      expect(coverage).toBeCloseTo(1 - (192 * 300) / (400 * 300), 5);
    });

    it('counts off-map space shown past the edge as black', () => {
      // Camera at x = −100 shows 100 px of empty space left of the map. With
      // every on-map tile explored, a quarter of the viewport is still black.
      const coverage = computeViewportBlackCoverage({
        camera: { x: -100, y: 0, zoom: 2 },
        viewportWidth: VIEW_W,
        viewportHeight: VIEW_H,
        mapWidth: MAP_WIDTH,
        mapHeight: MAP_HEIGHT,
        revealed: new Array(MAP_WIDTH * MAP_HEIGHT).fill(true),
      });
      expect(coverage).toBeCloseTo(100 / 400, 5);
    });

    it('falls back to per-tile explored flags when revealed is missing', () => {
      const tiles = Array.from({ length: MAP_WIDTH * MAP_HEIGHT }, () => ({ explored: true }));
      expect(
        computeViewportBlackCoverage({
          camera: { x: 0, y: 0, zoom: 2 },
          viewportWidth: VIEW_W,
          viewportHeight: VIEW_H,
          mapWidth: MAP_WIDTH,
          mapHeight: MAP_HEIGHT,
          tiles,
        }),
      ).toBe(0);

      // …and missing data counts as black, never as explored.
      expect(
        computeViewportBlackCoverage({
          camera: { x: 0, y: 0, zoom: 2 },
          viewportWidth: VIEW_W,
          viewportHeight: VIEW_H,
          mapWidth: MAP_WIDTH,
          mapHeight: MAP_HEIGHT,
        }),
      ).toBe(1);
    });

    it('threshold sits at 80% black', () => {
      expect(BLACK_COVERAGE_REFOCUS_THRESHOLD).toBe(0.8);
    });
  });

  describe('store action focusGoToUnitIfBlind', () => {
    const setup = (opts: { revealed: boolean[]; autoCamera?: boolean }) => {
      useGameStore.setState((state) => ({
        ...state,
        camera: { ...state.camera, x: 0, y: 0, zoom: 2 },
        cameraPanRequest: null,
        map: {
          width: MAP_WIDTH,
          height: MAP_HEIGHT,
          tiles: [],
          visibility: opts.revealed.slice(),
          revealed: opts.revealed,
        },
        settings: { ...state.settings, autoCamera: opts.autoCamera !== false },
      }));
    };

    const black = () => new Array(MAP_WIDTH * MAP_HEIGHT).fill(false);
    const explored = () => new Array(MAP_WIDTH * MAP_HEIGHT).fill(true);

    beforeEach(() => {
      setup({ revealed: explored() });
    });

    it('pans back to the routed unit when the screen is (almost) all black', () => {
      setup({ revealed: black() });

      useGameStore.getState().actions.focusGoToUnitIfBlind(20, 15);

      expect(useGameStore.getState().cameraPanRequest).toMatchObject({ col: 20, row: 15 });
    });

    it('pans when the screen is just over the 80% threshold', () => {
      // Explore only the leftmost two columns (64 px of 400) → 84% black.
      setup({ revealed: revealedMask((_idx, col) => col <= 1) });

      useGameStore.getState().actions.focusGoToUnitIfBlind(20, 15);

      expect(useGameStore.getState().cameraPanRequest).toMatchObject({ col: 20, row: 15 });
    });

    it('leaves the camera alone when the view has real map content', () => {
      // 20% black — comfortably below the threshold.
      setup({ revealed: revealedMask((_idx, col) => col <= 9) });

      useGameStore.getState().actions.focusGoToUnitIfBlind(20, 15);

      expect(useGameStore.getState().cameraPanRequest).toBeNull();
    });

    it('never pans when the player disabled autoCamera', () => {
      setup({ revealed: black(), autoCamera: false });

      useGameStore.getState().actions.focusGoToUnitIfBlind(20, 15);

      expect(useGameStore.getState().cameraPanRequest).toBeNull();
    });
  });
});
