import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FOLLOW_SWITCH_COOLDOWN_MS,
  resetFollowCameraOwner,
  useGameStore,
} from '@/stores/GameStore';
import {
  EDGE_FOLLOW_MARGIN_TILES,
  clampCameraToMap,
  nudgeCameraToKeepPointInView,
} from '@/utils/CameraUtils';
import { TILE_SIZE } from '@/data/TerrainData';
import type { Unit } from '../types/game';

/**
 * Edge-follow: a unit that moves past the viewport edge drags the camera
 * along by just the overrun, in the unit's direction. The camera must never
 * re-center, never overshoot, never leave the map, never chase movement the
 * player cannot see (hidden AI units, AI-vs-AI runs, autoCamera off), and only
 * one moving unit owns it at a time — a second unit waits for the 3 s switch
 * cooldown before the camera turns to it.
 */
describe('unit edge-follow camera', () => {
  const VIEW_W = 800;
  const VIEW_H = 600;
  const ZOOM = 2;
  const MAP_W = 40;
  const MAP_H = 30;
  // In the node environment `getGameViewport()` falls back to 800×600.
  const MARGIN_PX = EDGE_FOLLOW_MARGIN_TILES * TILE_SIZE * ZOOM;

  const cameraScreenPos = (
    worldX: number,
    worldY: number,
    cameraX: number,
    cameraY: number,
  ) => ({ x: (worldX - cameraX) * ZOOM, y: (worldY - cameraY) * ZOOM });

  describe('nudgeCameraToKeepPointInView', () => {
    const base = {
      cameraX: 0,
      cameraY: 0,
      zoom: ZOOM,
      viewportWidth: VIEW_W,
      viewportHeight: VIEW_H,
      mapWidth: MAP_W,
      mapHeight: MAP_H,
    };

    it('leaves the camera alone while the point is inside the edge margin', () => {
      // World (200,150) sits in the middle of the view.
      expect(nudgeCameraToKeepPointInView({ ...base, targetWorldX: 200, targetWorldY: 150 })).toBeNull();
    });

    it('nudges right by exactly the overrun when the point crosses the right edge', () => {
      const targetWorldX = 395; // screen x = 790, margin ends at 768
      const next = nudgeCameraToKeepPointInView({ ...base, targetWorldX, targetWorldY: 150 });

      expect(next).not.toBeNull();
      // 22 screen px of overrun → 11 world px of camera travel.
      expect(next!.x).toBeCloseTo(11, 5);
      expect(next!.y).toBe(0);
      // The point now sits exactly at the margin — no overshoot, no re-center.
      expect(cameraScreenPos(targetWorldX, 150, next!.x, next!.y).x).toBeCloseTo(VIEW_W - MARGIN_PX, 5);
    });

    it('nudges left/up when the point crosses the top-left edge', () => {
      const next = nudgeCameraToKeepPointInView({
        ...base,
        cameraX: 500,
        cameraY: 400,
        targetWorldX: 502, // screen x = 4 → 28 px inside the left margin
        targetWorldY: 402, // screen y = 4
      });

      expect(next).not.toBeNull();
      expect(next!.x).toBeCloseTo(486, 5);
      expect(next!.y).toBeCloseTo(386, 5);
      const screen = cameraScreenPos(502, 402, next!.x, next!.y);
      expect(screen.x).toBeCloseTo(MARGIN_PX, 5);
      expect(screen.y).toBeCloseTo(MARGIN_PX, 5);
    });

    it('nudges both axes when the point leaves through a corner', () => {
      const next = nudgeCameraToKeepPointInView({
        ...base,
        targetWorldX: 395, // right overrun
        targetWorldY: 295, // bottom overrun (screen y = 590)
      });

      expect(next).not.toBeNull();
      expect(next!.x).toBeGreaterThan(0);
      expect(next!.y).toBeGreaterThan(0);
      const screen = cameraScreenPos(395, 295, next!.x, next!.y);
      expect(screen.x).toBeCloseTo(VIEW_W - MARGIN_PX, 5);
      expect(screen.y).toBeCloseTo(VIEW_H - MARGIN_PX, 5);
    });

    it('is idempotent: a second pass after the nudge asks for nothing', () => {
      const targetWorldX = 395;
      const next = nudgeCameraToKeepPointInView({ ...base, targetWorldX, targetWorldY: 150 });
      expect(next).not.toBeNull();

      const again = nudgeCameraToKeepPointInView({
        ...base,
        cameraX: next!.x,
        cameraY: next!.y,
        targetWorldX,
        targetWorldY: 150,
      });
      expect(again).toBeNull();
    });

    it('cannot nudge past the map edge and reports no movement instead', () => {
      // Camera pinned at the right map edge; a point further right cannot be
      // brought back without showing off-map space.
      const maxCameraX = MAP_W * TILE_SIZE - VIEW_W / ZOOM; // 1280 − 400
      const next = nudgeCameraToKeepPointInView({
        ...base,
        cameraX: maxCameraX,
        targetWorldX: 1275,
        targetWorldY: 150,
      });
      expect(next).toBeNull();
    });

    it('never lets the margin eat more than half the viewport', () => {
      // A tiny viewport with a huge margin still converges instead of
      // flip-flopping between edges.
      const next = nudgeCameraToKeepPointInView({
        ...base,
        viewportWidth: 40,
        viewportHeight: 40,
        zoom: 1,
        marginTiles: 100,
        targetWorldX: 400,
        targetWorldY: 150,
      });
      expect(next === null || Number.isFinite(next.x)).toBe(true);
      if (next) {
        // zoom 1 here, so the point must land half a viewport (20 px) in.
        expect((400 - next.x) * 1).toBeCloseTo(20, 5);
      }
    });
  });

  describe('clampCameraToMap', () => {
    it('centers the view when the map is smaller than the viewport', () => {
      const clamped = clampCameraToMap(123, 456, 2, VIEW_W, VIEW_H, 5, 4);
      expect(clamped.x).toBeCloseTo((5 * TILE_SIZE - VIEW_W / 2) / 2, 5);
      expect(clamped.y).toBeCloseTo((4 * TILE_SIZE - VIEW_H / 2) / 2, 5);
    });
  });

  describe('store action followMovingUnit', () => {
    const makeUnit = (overrides: Partial<Unit>): Unit => ({
      id: 'unit_1',
      type: 'warrior',
      civilizationId: 0,
      col: 20,
      row: 15,
      movesRemaining: 1,
      health: 100,
      icon: 'warrior',
      ...overrides,
    });

    const setup = (opts: {
      units: Unit[];
      visibility?: boolean;
      autoCamera?: boolean;
      human?: boolean;
      devMode?: boolean;
    }) => {
      const visibility = new Array(MAP_W * MAP_H).fill(false);
      for (const unit of opts.units) {
        visibility[unit.row * MAP_W + unit.col] = opts.visibility !== false;
      }
      useGameStore.setState((state) => ({
        ...state,
        camera: { ...state.camera, x: 0, y: 0, zoom: ZOOM },
        cameraPanRequest: null,
        units: opts.units,
        civilizations: [{ id: 0, isHuman: opts.human !== false } as never],
        map: {
          width: MAP_W,
          height: MAP_H,
          tiles: [],
          visibility,
          revealed: visibility,
        },
        settings: {
          ...state.settings,
          autoCamera: opts.autoCamera !== false,
          devMode: opts.devMode === true,
        },
      }));
    };

    beforeEach(() => {
      resetFollowCameraOwner();
      setup({ units: [makeUnit({})] });
    });

    it('follows the human unit when it glides past the right/bottom edge', () => {
      const unit = makeUnit({});
      setup({ units: [unit] });

      // Display tile (20,15) → centre world (656, 496) → screen (1312, 992),
      // far outside the 800×600 view. Follow it back to the margin.
      useGameStore.getState().actions.followMovingUnit(unit.id, 20, 15);

      const camera = useGameStore.getState().camera;
      expect(camera.x).toBeCloseTo(272, 5);
      expect(camera.y).toBeCloseTo(212, 5);
    });

    it('leaves the camera untouched while the unit is on screen', () => {
      const unit = makeUnit({});
      setup({ units: [unit] });

      useGameStore.getState().actions.followMovingUnit(unit.id, 5, 4);

      const camera = useGameStore.getState().camera;
      expect(camera.x).toBe(0);
      expect(camera.y).toBe(0);
    });

    it('never trails a hidden AI unit', () => {
      const unit = makeUnit({ civilizationId: 1 });
      setup({ units: [unit], visibility: false });

      useGameStore.getState().actions.followMovingUnit(unit.id, 20, 15);

      const camera = useGameStore.getState().camera;
      expect(camera.x).toBe(0);
      expect(camera.y).toBe(0);
    });

    it('follows a foreign unit the human can see', () => {
      const unit = makeUnit({ civilizationId: 1 });
      setup({ units: [unit], visibility: true });

      useGameStore.getState().actions.followMovingUnit(unit.id, 20, 15);

      expect(useGameStore.getState().camera.x).toBeGreaterThan(0);
    });

    it('honors the autoCamera setting', () => {
      const unit = makeUnit({});
      setup({ units: [unit], autoCamera: false });

      useGameStore.getState().actions.followMovingUnit(unit.id, 20, 15);

      const camera = useGameStore.getState().camera;
      expect(camera.x).toBe(0);
      expect(camera.y).toBe(0);
    });

    it('does not pan in an AI-vs-AI run (no human civilization)', () => {
      const unit = makeUnit({});
      setup({ units: [unit], human: false });

      useGameStore.getState().actions.followMovingUnit(unit.id, 20, 15);

      const camera = useGameStore.getState().camera;
      expect(camera.x).toBe(0);
      expect(camera.y).toBe(0);
    });

    it('does nothing for an unknown unit id', () => {
      const unit = makeUnit({});
      setup({ units: [unit] });

      useGameStore.getState().actions.followMovingUnit('missing', 20, 15);

      expect(useGameStore.getState().camera.x).toBe(0);
    });

    it('waits 3 seconds before a second moving unit takes the camera over', () => {
      let clock = 50_000;
      const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock);

      try {
        const first = makeUnit({ id: 'unit_a' });
        const second = makeUnit({ id: 'unit_b', col: 25, row: 18 });
        setup({ units: [first, second] });

        // First unit claims the camera (it is far outside the view).
        useGameStore.getState().actions.followMovingUnit(first.id, 20, 15);
        expect(useGameStore.getState().camera.x).toBeCloseTo(272, 5);

        // A second GoTo unit needs the camera immediately after — it must wait.
        useGameStore.getState().actions.followMovingUnit(second.id, 25, 18);
        expect(useGameStore.getState().camera.x).toBeCloseTo(272, 5);

        clock += FOLLOW_SWITCH_COOLDOWN_MS - 1;
        useGameStore.getState().actions.followMovingUnit(second.id, 25, 18);
        expect(useGameStore.getState().camera.x).toBeCloseTo(272, 5);

        // Cooldown elapsed: the second unit may take over now.
        clock += 2;
        useGameStore.getState().actions.followMovingUnit(second.id, 25, 18);
        expect(useGameStore.getState().camera.x).toBeGreaterThan(272);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('keeps following the same unit without any switch delay', () => {
      let clock = 50_000;
      const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock);

      try {
        const unit = makeUnit({});
        setup({ units: [unit] });

        useGameStore.getState().actions.followMovingUnit(unit.id, 20, 15);
        expect(useGameStore.getState().camera.x).toBeCloseTo(272, 5);

        clock += 100; // far below the switch cooldown
        useGameStore.getState().actions.followMovingUnit(unit.id, 24, 15);
        expect(useGameStore.getState().camera.x).toBeGreaterThan(272);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('does not reserve the camera for a unit that needs no nudge', () => {
      const first = makeUnit({ id: 'unit_a' });
      const second = makeUnit({ id: 'unit_b', col: 25, row: 18 });
      setup({ units: [first, second] });

      // The first unit is mid-screen: no camera movement, no ownership.
      useGameStore.getState().actions.followMovingUnit(first.id, 5, 4);
      useGameStore.getState().actions.followMovingUnit(second.id, 25, 18);

      expect(useGameStore.getState().camera.x).toBeGreaterThan(0);
    });
  });
});
