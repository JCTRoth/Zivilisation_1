import React, { useEffect, useState, useCallback, useRef } from "react";
import { useGameStore } from "./stores/GameStore";
import { CIVILIZATIONS } from "@/data/GameData";
import { AUTO_END_TURN_OFFER_FLAG, isAutoScenario } from "@/data/GameConstants";
import { shouldOfferAutoEndTurn, shouldPromptForResearch } from "@/utils/ModalTriggers";
import GameEngine from "@/game/engine/GameEngine";
import GameCanvas from "./components/game/GameCanvas";
import SettingsModal from "./components/ui/SettingsModal";
import GameSetupModal from "./components/ui/GameSetupModal";
import EndTurnConfirmModal from "./components/ui/EndTurnConfirmModal";
import GameModals from "./components/ui/GameModals";
import GameResultOverlay from "./components/ui/GameResultOverlay";
import VictoryFireworks from "./components/ui/VictoryFireworks";
import PauseScreen from "./components/ui/PauseScreen";
import GameSpeedControls from "./components/ui/GameSpeedControls";
import TopBar from "./components/ui/TopBar";
import MobileBottomBar from "./components/ui/MobileBottomBar";
import NotificationCenter from "./components/ui/NotificationCenter";
import GameMenuSheet, {
  type GameMenuName,
} from "./components/ui/GameMenuSheet";
import ConfirmDialog from "./components/ui/ConfirmDialog";
import { useGameEngine } from "./hooks/UseGameEngine";
import SidePanel from "./components/ui/SidePanel";
import { GameUtils } from "@/utils/GameUtils";
import { DomUtils } from "@/utils/DomUtils";
import { enrichMapForExport } from "@/utils/MapExportUtils";
import { preloadAllUnitIcons } from "@/utils/UnitIconLoader";
import { centerCameraOnTile, getGameViewport, clampZoom } from "@/utils/CameraUtils";
import { gameLogger } from "@/utils/GameLogger";
import { gameProgression } from "@/utils/GameProgression";
import type { TerrainTileRenderInfo } from "@/game/rendering/MapRenderer";
import { debugLog } from '@/utils/DevLog';

declare global {
  interface Window {
    /** Dev-only test hook: exposed engine for Playwright/console driving. */
    __gameEngine?: GameEngine;
    __gameStore?: unknown;
    /** Dev-only test hook: progression recorder for CSV export. */
    __gameProgression?: { buildCompactCsv: (e: GameEngine | null) => Promise<string> };
  }
}

function App() {
  const gameState = useGameStore((state) => state.gameState);
  const actions = useGameStore((state) => state.actions);
  const settings = useGameStore((state) => state.settings);
  const camera = useGameStore((state) => state.camera);
  const gameResult = useGameStore((state) => state.gameState.gameResult);
  const setCamera = useGameStore((state) => state.actions.updateCamera);
  const uiState = useGameStore((state) => state.uiState);
  const [gameEngine, setGameEngine] = useState<GameEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeMenu, setActiveMenu] = useState<GameMenuName | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [showHexDetail, setShowHexDetail] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGameSetup, setShowGameSetup] = useState(true);
  const [showEndTurnConfirm, setShowEndTurnConfirm] = useState(false);
  const [confirmNewGame, setConfirmNewGame] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [isEndTurnAutomatic, setIsEndTurnAutomatic] = useState(false);
  const [, setDetailHex] = useState<{
    col: number;
    row: number;
  } | null>(null);
  const [, setTerrainData] = useState<TerrainTileRenderInfo | null>(
    null,
  );

  // Turn flash effect on top bar - direct DOM manipulation for reliability
  const turnFlashTrigger = useGameStore(
    (state) => state.uiState.turnFlashTrigger,
  );
  const topBarRef = useRef<HTMLDivElement>(null);
  // `?combatlab` — dev/test mode that pre-poses opposing units for combat.
  const combatLabRef = useRef(false);

  useEffect(() => {
    if (turnFlashTrigger === 0 || !topBarRef.current) return;

    debugLog("[App] Turn flash triggered, count:", turnFlashTrigger);
    const el = topBarRef.current;

    // Apply flash styles directly to DOM
    el.classList.add("flash");

    const timer = setTimeout(() => {
      el.classList.remove("flash");
    }, 400);

    return () => {
      clearTimeout(timer);
      el.classList.remove("flash");
    };
  }, [turnFlashTrigger]);

  // Simple toast notification (DOM-based for immediate feedback)
  const showToast = (
    message: string,
    type: "success" | "error" | "warning" = "success",
  ) => {
    try {
      const colors: Record<string, string> = {
        success: "var(--color-success)",
        error: "var(--color-danger)",
        warning: "var(--color-warning)",
      };
      const toast = document.createElement("div");
      toast.textContent = message;
      toast.className = "app-toast";
      toast.setAttribute("role", "status");
      toast.style.background = colors[type] || "#333";
      document.body.appendChild(toast);
      requestAnimationFrame(() => {
        toast.style.opacity = "1";
      });
      setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => {
          if (document.body.contains(toast)) document.body.removeChild(toast);
        }, 300);
      }, 3000);
    } catch (e) {
      console.warn("[App] showToast failed:", e);
    }
  };

  // Preload unit icons on mount
  useEffect(() => {
    preloadAllUnitIcons().catch((err) => {
      console.warn("Failed to preload some unit icons:", err);
    });
  }, []);

  // Connect game engine to React state management
  useGameEngine(gameEngine);

  // Handle game start with chosen settings
  const handleGameStart = useCallback(
    async (gameSettings) => {
      try {
        console.log("Starting new game with settings:", gameSettings);
        setShowGameSetup(false);

        // Start a named game-log session for every game. AI vs AI sessions get
        // a dedicated timestamped session id; others share a per-run id.
        const isAIVsAI = isAutoScenario(gameSettings.mapType);
        const logSessionId = isAIVsAI
          ? `aivsai-${new Date().toISOString().replace(/[:.]/g, "-")}`
          : `game-${Date.now()}`;
        gameLogger.setSession(logSessionId);
        gameLogger.log(
          "app",
          `Game started — mapType=${gameSettings.mapType}, civs=${gameSettings.numberOfCivilizations}, difficulty=${gameSettings.difficulty}`,
          gameSettings,
        );

        // Update devMode setting if provided
        if (typeof gameSettings.devMode === "boolean") {
          actions.updateSettings({ devMode: gameSettings.devMode });
          console.log("[App] Developer mode:", gameSettings.devMode);
        }

        // Every AI-vs-AI scenario is a spectator mode, so Dev Mode is FORCED
        // on: the whole map is observable, and nothing in the game ever waits
        // for a human. Covers all four scenario types, not just the duel.
        if (isAIVsAI) {
          gameSettings.devMode = true;
          actions.updateSettings({ devMode: true });
        }

        const engine = new GameEngine(actions);
        await engine.initialize(gameSettings);

        // Start the per-round progression tracker for this game session.
        gameProgression.startSession(engine, gameSettings);

        // Mark the game as started once engine state is ready in the store
        actions.startGame();
        actions.updateGameState({
          mapGenerated: true,
          currentTurn: engine.currentTurn,
          currentYear: engine.currentYear,
        });

        // `?combatlab` — pre-pose opposing units so the combat e2e spec has a
        // battlefield ready without playing through the setup wizard.
        if (combatLabRef.current) {
          engine.setupCombatScenario();
          actions.updateUnits(engine.getAllUnits());
        }

        setGameEngine(engine);

        // Dev-only test hook: expose the engine so Playwright/console can drive
        // and inspect game state (units, combat, movement). Mirrors __gameStore.
        if (import.meta.env.DEV && typeof window !== "undefined") {
          window.__gameEngine = engine;
          window.__gameProgression = gameProgression;
        }

        // Get player's starting settler position
        const playerSettler = engine.units.find(
          (u) => u.civilizationId === 0 && u.type === "settler",
        );

        console.log("Game started with units:", engine.units);
        console.log("Player settler at:", playerSettler);

        // Update visibility to apply dev mode fog of war settings
        if (typeof gameSettings.devMode === "boolean") {
          console.log("[App] Updating visibility after dev mode change");
          actions.updateVisibility();
        }

        // Focus camera on player's starting unit using the store action so the same
        // centering logic is used everywhere (keeps canvas and minimap in sync).
        if (playerSettler) {
          // This will select/focus the next unit for the active player and update camera
          actions.focusOnNextUnit();
        }
      } catch (error) {
        console.error("Game start error:", error);
        setError(error.message);
      }
    },
    [actions],
  );

  // Quick-start mode: when the URL contains `?quickstart`, skip the setup
  // modal and launch directly into a game with sensible defaults and
  // developer mode enabled.  Useful for rapid iteration during development.
  const quickstartRef = useRef(false);
  // Settings handed over by the URL (`?maptype=…&civs=…&seed=…`), read once.
  const urlSettingsRef = useRef<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);

    // `?maptype=…` (with optional `civs`, `difficulty`, `dev`, `seed`, `gold`)
    // launches that scenario straight into the game with no setup wizard. The
    // point is that an AI-vs-AI spectator game is then genuinely unattended:
    // open the URL and the map plays itself, with nothing to click and no
    // modal that can appear over the board. An AI-vs-AI mapType implies Dev
    // Mode, which `handleGameStart` forces anyway.
    const mapTypeParam = params.get("maptype");
    if (mapTypeParam) {
      const num = (key: string, fallback: number) => {
        const raw = params.get(key);
        const parsed = raw === null ? NaN : Number(raw);
        return Number.isFinite(parsed) ? parsed : fallback;
      };
      urlSettingsRef.current = {
        mapType: mapTypeParam.toUpperCase(),
        numberOfCivilizations: Math.max(2, Math.min(7, num("civs", 4))),
        difficulty: (params.get("difficulty") ?? "PRINCE").toUpperCase(),
        devMode: params.get("dev") !== "0" && params.get("dev") !== "false",
        startingGold: num("gold", 50),
        ...(params.has("seed") ? { mapSeed: num("seed", 0) } : {}),
      };
      window.history.replaceState(null, "", window.location.pathname);
    }

    if (params.has("quickstart")) {
      quickstartRef.current = true;
      // Clean up the URL so a page refresh doesn't loop.
      window.history.replaceState(null, "", window.location.pathname);
    }
    // `?combatlab` launches a small game with opposing units already posed for
    // combat (see `GameEngine.setupCombatScenario`). Used by e2e/combat.spec.ts
    // so the Playwright spec skips the setup wizard entirely.
    if (params.has("combatlab")) {
      combatLabRef.current = true;
      window.history.replaceState(null, "", window.location.pathname);
    }
    // `?noanim` disables all movement/combat/camera animations (instant). Used by
    // the e2e suite and tests to keep runs deterministic.
    if (params.has("noanim")) {
      actions.updateSettings({
        enableAnimations: false,
        animationSpeed: 0,
        enemyAnimationSpeed: 0,
        cameraGlideSpeed: 0,
      });
    }
  }, [actions]);

  useEffect(() => {
    const fromUrl = urlSettingsRef.current;
    if (
      (!quickstartRef.current && !combatLabRef.current && !fromUrl)
      || gameEngine
      || !showGameSetup
    ) return;
    const defaultCivIndex = CIVILIZATIONS.findIndex(
      (c) => c.name === "Germans",
    );
    if (fromUrl) {
      console.log("[App] URL scenario — launching game:", fromUrl);
      handleGameStart({
        playerCivilization: defaultCivIndex >= 0 ? defaultCivIndex : 0,
        landMass: 1,
        temperature: 1,
        climate: 1,
        age: 1,
        ...fromUrl,
      } as never);
      return;
    }
    const quickSettings = {
      playerCivilization: defaultCivIndex >= 0 ? defaultCivIndex : 0,
      difficulty: "PRINCE",
      numberOfCivilizations: 2,
      // The combat lab uses the smallest map so the prepared battlefield is
      // found and rendered quickly; quickstart keeps the normal skirmish map.
      mapType: combatLabRef.current ? "CLOSEUP_1V1" : "NORMAL_SKIRMISH",
      devMode: true,
      landMass: 1,
      temperature: 1,
      climate: 1,
      age: 1,
    };
    console.log(
      combatLabRef.current
        ? "[App] Combat-lab mode — launching game with defaults:"
        : "[App] Quick-start mode — launching game with defaults:",
      quickSettings,
    );
    handleGameStart(quickSettings);
  }, [gameEngine, showGameSetup, handleGameStart]);

  // Ask the player to pick a technology when the opening rounds are over and
  // still no research is selected. (Civilizations start with a few free techs,
  // so the old "no techs at all" condition never matched; and research only
  // starts after the first RESEARCH_UNLOCK_ROUND rounds.) Fires once per
  // game/engine instance. The decision itself lives in `shouldPromptForResearch`
  // so it can be unit-tested without a DOM.
  const researchPromptedRef = useRef<GameEngine | null>(null);
  useEffect(() => {
    if (!gameEngine) return;
    const civ = gameEngine.civilizations?.find((c) => c.isHuman);
    const shouldPrompt = shouldPromptForResearch({
      isGameStarted: gameState.isGameStarted,
      alreadyPrompted: researchPromptedRef.current === gameEngine,
      researchUnlocked:
        typeof gameEngine.isResearchUnlocked === "function" &&
        gameEngine.isResearchUnlocked(),
      hasHumanCiv: !!civ,
      hasCurrentResearch: !!civ?.currentResearch,
      hasResearchableTech:
        !!civ &&
        typeof gameEngine.hasResearchableTech === "function" &&
        gameEngine.hasResearchableTech(civ.id),
    });
    if (!shouldPrompt) return;

    researchPromptedRef.current = gameEngine;
    actions.addNotification({
      type: "info",
      message: "Choose a technology to research.",
    });
    // Short delay so the game board renders first. Opens the informational
    // "No Research Selected" modal — NOT the tech tree directly; the player
    // chooses there whether to pick a tech or continue without one.
    setTimeout(() => actions.showDialog("research-required"), 500);
  }, [gameEngine, gameState.isGameStarted, gameState.currentTurn, actions]);

  // Offer "Auto. turn ending" once, after AUTO_END_TURN_OFFER_TURN moves: by
  // then the player knows what ending a turn by hand costs. The offer informs
  // about the feature and carries the on/off checkbox itself, so it is
  // remembered per browser and never shown twice. The decision lives in
  // `shouldOfferAutoEndTurn` for unit testing.
  const autoEndOfferShownRef = useRef(false);
  useEffect(() => {
    let answeredInBrowser = false;
    try {
      answeredInBrowser = localStorage.getItem(AUTO_END_TURN_OFFER_FLAG) === '1';
    } catch {
      // Private mode / storage disabled: treat as "not answered" so the offer
      // can still be made once per session.
    }
    if (
      isAutoScenario(gameEngine?.gameSettings?.mapType) ||
      !shouldOfferAutoEndTurn({
        isGameStarted: gameState.isGameStarted,
        currentTurn: gameState.currentTurn,
        alreadyOffered: autoEndOfferShownRef.current,
        answeredInBrowser,
        autoEndTurnEnabled: useGameStore.getState().settings.autoEndTurn,
      })
    ) {
      return;
    }
    autoEndOfferShownRef.current = true;
    actions.showDialog('auto-end-offer');
  }, [gameState.isGameStarted, gameState.currentTurn, gameEngine, actions]);

  // End the human turn and, when it was auto-triggered, surface a recap of
  // what the engine auto-resolved (e.g. "2 units skipped"). Shared by the
  // confirmation-modal path and the immediate "skip confirmation" path so the
  // recap is always shown.
  const endTurnAndRecap = useCallback(
    (automatic: boolean) => {
      if (!gameEngine) {
        console.warn("[App] Cannot process turn - gameEngine is null");
        return;
      }
      // Read the auto-end summary *before* ending the turn — the turn-processing
      // pipeline may trigger further checks that overwrite it.
      if (automatic && typeof gameEngine.lastAutoEndSummary === "string") {
        const summary = gameEngine.lastAutoEndSummary;
        if (summary) {
          actions.addNotification({
            type: "info",
            message: `Auto-end: ${summary}`,
          });
        }
      }
      console.log("[App] Processing turn via gameEngine.processTurn()");
      gameEngine.processTurn();
    },
    [actions, gameEngine],
  );

  // Handle end turn confirmation
  const handleEndTurnConfirm = useCallback(() => {
    console.log("[App] End turn confirmed");
    const wasAutomatic = isEndTurnAutomatic;
    setShowEndTurnConfirm(false);
    setIsEndTurnAutomatic(false);

    // Always process the turn when confirmed
    endTurnAndRecap(wasAutomatic);
  }, [endTurnAndRecap, isEndTurnAutomatic]);

  // Shared end-turn decision. `automatic` is true when the engine routed an
  // end-turn request to the App (via `showEndTurnConfirmation`) vs. the player
  // pressing End Turn directly.
  //
  // `autoEndTurn` is the ONLY thing that causes a turn to end on its own — it
  // gates whether an engine-triggered request auto-ends the turn. When it is
  // OFF, an engine-triggered event is just an "all your units have moved"
  // prompt: it never auto-ends the turn, even if the confirmation is set to
  // skip (the player ends manually instead).
  //
  // `skipEndTurnConfirmation` only controls whether the confirmation modal is
  // shown when a turn IS ending — it never triggers ending on its own.
  const processEndTurn = useCallback(
    (automatic: boolean) => {
      setIsEndTurnAutomatic(automatic);
      const currentSettings = useGameStore.getState().settings;
      const skip = currentSettings.skipEndTurnConfirmation;

      if (!skip) {
        // Show the confirmation modal (manual end turn or auto-triggered prompt).
        setShowEndTurnConfirm(true);
      } else if (currentSettings.autoEndTurn || !automatic) {
        // End immediately: a manual End-Turn press, or a genuine auto-end
        // (autoEndTurn enabled + engine detected all units are done).
        console.log(
          "[App] Skipping end turn confirmation modal due to user preference",
        );
        endTurnAndRecap(automatic);
      }
      // else: engine-triggered prompt with autoEndTurn OFF + skip ON → do nothing.
      // The player ends the turn manually, so auto-end never fires unintentionally.
    },
    [endTurnAndRecap],
  );

  // Initialize game engine
  useEffect(() => {
    // Game initialization now happens in handleGameStart after setup modal
    // No auto-initialization

    // Listen for end turn confirmation requests (automatic from engine)
    const handleShowEndTurnConfirmation = () => {
      const s = useGameStore.getState().settings;
      console.log(
        `[AUTO-END] App received showEndTurnConfirmation event (autoEndTurn: ${s.autoEndTurn}, skipConfirm: ${s.skipEndTurnConfirmation}) — routing to processEndTurn`,
      );
      processEndTurn(true);
    };

    if (typeof window !== "undefined") {
      window.addEventListener(
        "showEndTurnConfirmation",
        handleShowEndTurnConfirmation,
      );
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener(
          "showEndTurnConfirmation",
          handleShowEndTurnConfirmation,
        );
      }
    };
  }, [handleEndTurnConfirm, processEndTurn]);

  // Handle menu actions
  const handleMenuClick = (
    menu: GameMenuName,
    event: React.MouseEvent<HTMLButtonElement, MouseEvent>,
  ) => {
    console.log(`[CLICK] Menu click: ${menu}`);
    if (activeMenu === menu) {
      setActiveMenu(null);
    } else {
      const rect = event.currentTarget.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom,
        left: rect.left,
      });
      setActiveMenu(menu);
    }
  };

  // Open a menu from the mobile bottom bar (position is irrelevant — CSS renders a bottom sheet)
  const handleMobileMenuOpen = (menu: GameMenuName) => {
    if (activeMenu === menu) {
      setActiveMenu(null);
    } else {
      setMenuPosition({ top: window.innerHeight, left: 0 });
      setActiveMenu(menu);
    }
  };

  const handleDownloadMap = () => {
    try {
      const map = useGameStore.getState().map;
      const gameStats = useGameStore.getState().gameStats;
      if (!map) {
        console.warn("No map data available to download");
        return;
      }

      const enriched = enrichMapForExport(map);
      const exportObj = {
        meta: {
          width: map.width,
          height: map.height,
          turn: gameStats?.turn ?? gameState.currentTurn,
        },
        map: enriched,
      };

      const text = JSON.stringify(exportObj, null, 2);
      const filename = `civ1-map-turn-${gameStats?.turn ?? gameState.currentTurn}.json`;
      DomUtils.downloadTextFile(text, filename);
    } catch (e) {
      console.error("handleDownloadMap error", e);
    }
  };

  // Download the game progression list (per-round snapshots + full game log)
  // for post-game analysis and AI improvement.
  const handleDownloadProgression = async () => {
    setActiveMenu(null);
    if (!gameEngine) {
      showToast("No active game to export", "warning");
      return;
    }
    try {
      await gameProgression.download(gameEngine);
      showToast("Game progression list downloaded", "success");
    } catch (e) {
      console.error("handleDownloadProgression error", e);
      showToast("Failed to download progression list", "error");
    }
  };

  // Download a strongly reduced CSV scoreboard (per-round key metrics only) —
  // a tiny file for cheap AI analysis when the full list would be too large.
  const handleDownloadProgressionCompact = async () => {
    setActiveMenu(null);
    if (!gameEngine) {
      showToast("No active game to export", "warning");
      return;
    }
    try {
      await gameProgression.downloadCompact(gameEngine);
      showToast("Compact progression downloaded", "success");
    } catch (e) {
      console.error("handleDownloadProgressionCompact error", e);
      showToast("Failed to download compact progression", "error");
    }
  };

  // Save game to a downloadable JSON file
  const handleSaveGame = () => {
    if (!gameEngine) {
      setActiveMenu(null);
      return;
    }
    try {
      // Get save JSON
      let json: string | null = null;
      if (typeof gameEngine.getSaveJSON === "function") {
        json = gameEngine.getSaveJSON();
      } else if (typeof gameEngine.saveGame === "function") {
        gameEngine.saveGame();
        json = localStorage.getItem("civ1_savegame");
      }
      if (!json) {
        showToast("Failed to generate save data", "error");
        setActiveMenu(null);
        return;
      }
      // Trigger file download
      const filename = `civ1-save-turn-${gameState.currentTurn}.json`;
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast(`Game saved to ${filename}`, "success");
    } catch (e) {
      console.error("[App] Save failed:", e);
      showToast("Save failed: " + (e as Error).message, "error");
    }
    setActiveMenu(null);
  };

  // Load game from a user-selected JSON file
  const handleLoadGame = () => {
    if (!gameEngine || typeof gameEngine.loadGame !== "function") {
      showToast("Load not available", "warning");
      setActiveMenu(null);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        setActiveMenu(null);
        return;
      }
      try {
        const text = await file.text();
        const saveData = JSON.parse(text);
        // Accept saved-state versions 1, 2 and 3 — the engine's `loadGame`
        // supports all three (3 adds multi-unit transport cargo), so the menu
        // Load Game must too.
        if (!saveData || (saveData.version !== 1 && saveData.version !== 2 && saveData.version !== 3)) {
          showToast("Invalid or incompatible save file.", "error");
          setActiveMenu(null);
          return;
        }
        localStorage.setItem("civ1_savegame", text);
        const success = await gameEngine.loadGame();
        if (success) {
          // Force a full store sync
          actions.updateMap(gameEngine.map);
          actions.updateUnits(gameEngine.getAllUnits());
          actions.updateCities(gameEngine.getAllCities());
          actions.updateCivilizations(gameEngine.civilizations);
          actions.updateTechnologies(gameEngine.technologies);
          actions.updateVisibility();
          showToast(`Game loaded from ${file.name}`, "success");
        } else {
          showToast("Failed to load game state.", "error");
        }
      } catch (e) {
        console.error("[App] Load failed:", e);
        showToast("Failed to read save file: " + (e as Error).message, "error");
      }
      setActiveMenu(null);
    };
    document.body.appendChild(input);
    input.click();
    setTimeout(() => {
      if (document.body.contains(input)) document.body.removeChild(input);
    }, 1000);
  };

  const handleResultClose = useCallback(() => {
    actions.clearGameResult();
  }, [actions]);

  const handleResultRestart = useCallback(async () => {
    if (!gameEngine) {
      return;
    }
    try {
      await gameEngine.restartCurrentGame();
      // A restarted game is a fresh game: ask for a research again.
      researchPromptedRef.current = null;
      // Restart the progression tracker for the fresh game.
      gameProgression.startSession(gameEngine, gameEngine.gameSettings);
      actions.clearGameResult();
      setActiveMenu(null);
      setShowHexDetail(false);
      setShowSettings(false);
      setShowEndTurnConfirm(false);
    } catch (err) {
      console.error("[App] Failed to restart game", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [actions, gameEngine]);

  // AI vs AI demo loop: when the automatic game concludes, let the result
  // overlay show briefly, then auto-restart into a fresh AI-vs-AI session.
  const lastAutoRestart = useRef(0);
  useEffect(() => {
    if (!gameResult) {
      return;
    }
    if (!isAutoScenario(gameEngine?.gameSettings?.mapType)) {
      return;
    }
    // Debounce: only restart once per concluded game (result timestamp changes).
    const stamp = gameResult.timestamp ?? 0;
    if (stamp === lastAutoRestart.current) {
      return;
    }
    lastAutoRestart.current = stamp;

    console.log("[App] AI-vs-AI game concluded; auto-restarting in ~8s");
    const timer = setTimeout(() => {
      handleResultRestart();
    }, 8_000);

    return () => clearTimeout(timer);
  }, [gameResult, gameEngine, handleResultRestart]);

  const handleResultQuit = useCallback(() => {
    if (gameEngine) {
      gameEngine.shutdownToMenu();
    }
    actions.clearGameResult();
    actions.resetGameState();
    setActiveMenu(null);
    setShowHexDetail(false);
    setShowSettings(false);
    setShowEndTurnConfirm(false);
    setIsEndTurnAutomatic(false);
    setGameEngine(null);
    setShowGameSetup(true);
  }, [actions, gameEngine]);

  // Handle hex examination (called from canvas)
  const handleExamineHex = (
    hex: { col: number; row: number },
    terrain: TerrainTileRenderInfo | null,
  ) => {
    setDetailHex(hex);
    setTerrainData(terrain);
    setShowHexDetail(true);
  };

  // Handle new game (opens accessible confirmation dialog)
  const handleNewGame = () => {
    console.log(`[CLICK] New game button clicked`);
    setActiveMenu(null);
    setConfirmNewGame(true);
  };

  const handleNewGameConfirmed = () => {
    console.log(`[CLICK] New game confirmed - reloading page`);
    setConfirmNewGame(false);
    window.location.reload();
  };

  // Handle quit to main menu (opens accessible confirmation dialog)
  const handleQuit = () => {
    setActiveMenu(null);
    setConfirmQuit(true);
  };

  const handleQuitConfirmed = () => {
    console.log("[App] Quit confirmed - returning to main menu");
    setConfirmQuit(false);
    if (gameEngine) {
      gameEngine.shutdownToMenu();
    }
    actions.resetGameState();
    setShowHexDetail(false);
    setShowSettings(false);
    setShowEndTurnConfirm(false);
    setIsEndTurnAutomatic(false);
    setGameEngine(null);
    setShowGameSetup(true);
  };

  // Pause / resume the game. While paused, turn processing / AI actions are
  // halted and end-turn is blocked, so nothing continues behind the overlay.
  //
  // `isGamePaused` is the real pause state; the pause SCREEN is a separate,
  // optional presentation of it. A player pausing their own game wants the
  // overlay, but an observer pausing a self-running AI duel wants to keep
  // looking at the board they paused to study, so that pause raises no dialog
  // and the floating speed bar stays on screen to resume from.
  const isPaused = uiState.isGamePaused;
  const pauseScreenVisible = uiState.activeDialog === "pause";

  const setGamePaused = useCallback(
    (paused: boolean, options?: { showPauseScreen?: boolean }) => {
      const withScreen = options?.showPauseScreen ?? true;
      console.log(`[App] ${paused ? "Pausing" : "Resuming"} game${withScreen ? "" : " (no overlay)"}`);
      if (paused) setActiveMenu(null);
      actions.setGamePaused(paused);
      if (withScreen) {
        if (paused) {
          actions.showDialog("pause");
        } else {
          actions.hideDialog();
        }
      }
      // Halt / restart the engine. Resuming also replays whatever the pause
      // interrupted, so the game picks up exactly where it stopped.
      if (gameEngine && typeof gameEngine.setPaused === "function") {
        gameEngine.setPaused(paused);
      }
    },
    [gameEngine, actions],
  );

  const handlePause = useCallback(() => {
    setGamePaused(true);
  }, [setGamePaused]);

  const handleResume = useCallback(() => {
    if (isPaused) setGamePaused(false);
  }, [isPaused, setGamePaused]);

  /** The spectator Play/Pause button: pauses a running game, resumes a paused one. */
  const handleTogglePause = useCallback(() => {
    setGamePaused(!isPaused, { showPauseScreen: false });
  }, [isPaused, setGamePaused]);

  // Handle end turn request - show modal (manual button click)
  const handleEndTurnRequest = useCallback(() => {
    // Ignore end-turn while the game is paused.
    if (useGameStore.getState().uiState.isGamePaused) {
      console.log("[App] End turn ignored — game is paused");
      return;
    }
    console.log(
      "[App] End turn requested manually - showing confirmation modal",
    );
    processEndTurn(false);
  }, [processEndTurn]);

  // Handle end turn cancellation
  const handleEndTurnCancel = () => {
    console.log("[App] End turn cancelled");
    setShowEndTurnConfirm(false);
    setIsEndTurnAutomatic(false);
    // Re-enable the turn button since the turn wasn't ended
    actions.setTurnButtonDisabled(false);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Don't handle shortcuts if user is typing in an input field
      if (
        event.target.tagName === "INPUT" ||
        event.target.tagName === "TEXTAREA" ||
        event.target.contentEditable === "true"
      ) {
        return;
      }

      const { key, shiftKey, ctrlKey, altKey } = event;

      // Prevent default browser behavior for navigation and specific shortcuts only
      // Unit action keys (i, m, b, f, s, g) are now handled in GameCanvas
      const shouldPreventDefault =
        [
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Enter",
          " ",
          "t",
          "Escape",
          "F1",
          "F2",
          "F3",
          "F4",
          "F11",
        ].includes(key) ||
        (ctrlKey &&
          [
            "1",
            "2",
            "3",
            "4",
            "5",
            "6",
            "7",
            "8",
            "9",
            "p",
            "s",
            "l",
            "z",
          ].includes(key)) ||
        key === "+" ||
        key === "-";

      if (shouldPreventDefault) {
        event.preventDefault();
      }

      // Move the selected unit one tile in the given direction (Arrow keys).
      // `moveUnit` is a typed GameEngine method — it validates passability,
      // movement points and combat, and no-ops (returns a result object) when
      // the move isn't possible, so it's safe to call on every keypress.
      const moveSelectedUnit = (dCol: number, dRow: number) => {
        const selId = gameState.selectedUnit;
        if (!gameEngine || !selId) return;
        const unit = gameEngine.units.find((u) => u.id === selId);
        if (!unit) return;
        gameEngine.moveUnit(selId, unit.col + dCol, unit.row + dRow);
      };

      // Navigation shortcuts
      if (!ctrlKey && !altKey) {
        switch (key) {
          case "ArrowUp":
            if (shiftKey) {
              // Shift + Arrow: Scroll map
              setCamera({ y: camera.y - 50 });
            } else {
              // Arrow Keys: Move unit
              moveSelectedUnit(0, -1);
            }
            break;
          case "ArrowDown":
            if (shiftKey) {
              setCamera({ y: camera.y + 50 });
            } else {
              moveSelectedUnit(0, 1);
            }
            break;
          case "ArrowLeft":
            if (shiftKey) {
              setCamera({ x: camera.x - 50 });
            } else {
              moveSelectedUnit(-1, 0);
            }
            break;
          case "ArrowRight":
            if (shiftKey) {
              setCamera({ x: camera.x + 50 });
            } else {
              moveSelectedUnit(1, 0);
            }
            break;
          case "+":
          case "=":
            // Zoom in
            setCamera({ zoom: clampZoom(camera.zoom * 1.2) });
            break;
          case "-":
            // Zoom out
            setCamera({ zoom: clampZoom(camera.zoom / 1.2) });
            break;
        }
      }

      // Action shortcuts
      if (!ctrlKey && !altKey && !shiftKey) {
        switch (key) {
          case "Enter":
            // End turn
            handleEndTurnRequest();
            break;
          case " ":
            // Cycle through units in a tile
            if (gameEngine && gameState.selectedUnit) {
              gameEngine.cycleUnitsInTile(gameState.selectedUnit);
            }
            break;

          // NOTE: Unit action keys (s, f, g, b, i, m) are now handled in GameCanvas.tsx
          // Keeping only the global UI shortcuts here

          /*
          case 's':
          case 'S':
            // Skip current unit's turn - NOW IN GAMECANVAS
            if (gameEngine && gameEngine.skipUnitTurn) {
              gameEngine.skipUnitTurn();
            }
            break;
          case 'f':
          case 'F':
            // Fortify selected unit - NOW IN GAMECANVAS
            if (gameEngine && gameEngine.fortifyUnit) {
              gameEngine.fortifyUnit();
            }
            break;
          */
          case "r":
          case "R":
            // Rush production in a city
            {
              const selCity = gameState.selectedCity;
              if (selCity && gameEngine) {
                gameEngine.rushCityProduction(selCity);
              }
            }
            break;
          case "c":
          case "C":
            // Center map on selected unit
            {
              const selUnitId = gameState.selectedUnit;
              if (selUnitId && gameEngine) {
                const selUnit = gameEngine.units.find(
                  (u) => u.id === selUnitId,
                );
                if (selUnit) {
                  const viewport = getGameViewport();
                  const { x, y } = centerCameraOnTile({
                    col: selUnit.col,
                    row: selUnit.row,
                    zoom: camera.zoom || 1,
                    viewportWidth: viewport.width,
                    viewportHeight: viewport.height,
                    mapWidth: gameEngine.map?.width ?? 80,
                    mapHeight: gameEngine.map?.height ?? 50,
                  });
                  setCamera({ x, y });
                }
              }
            }
            break;
          case "d":
          case "D":
            // Open Diplomatic Relations (full negotiation screen)
            actions.openDiplomacy(null);
            break;
          // 'a' key not bound
          case "w":
          case "W":
            // Wait (unit stays in place)
            if (gameEngine && gameEngine.waitUnit) {
              gameEngine.waitUnit();
            }
            break;
          /*
          case 'g':
          case 'G':
            // Move unit to specific location (enter goto mode) - NOW IN GAMECANVAS
            if (gameEngine && gameEngine.enterGotoMode) {
              gameEngine.enterGotoMode();
            }
            break;
          case 'b':
          case 'B':
            // Build road - NOW IN GAMECANVAS (handled via buildImprovement)
            if (gameEngine && gameEngine.buildRoad) {
              gameEngine.buildRoad();
            }
            break;
          case 'i':
          case 'I':
            // Irrigate - NOW IN GAMECANVAS (handled via buildImprovement)
            if (gameEngine && gameEngine.irrigage) {
              gameEngine.irrigage();
            }
            break;
          case 'm':
          case 'M':
            // Mine - NOW IN GAMECANVAS (handled via buildImprovement)
            if (gameEngine && gameEngine.mine) {
              gameEngine.mine();
            }
            break;
          */
          case "p":
          case "P":
            // Clean pollution with selected unit
            {
              const pUnitId = gameState.selectedUnit;
              if (pUnitId && gameEngine) {
                gameEngine.cleanPollution(pUnitId);
              }
            }
            break;
          case "t":
          case "T":
            // Open tax/science/luxury rate sliders
            actions.showDialog("rates");
            break;
          case "g":
          case "G":
            // Open government / revolution dialog
            actions.showDialog("government");
            break;
          case "Escape": {
            // Cancel action or close menus
            setActiveMenu(null);
            setShowHexDetail(false);
            setShowSettings(false);
            // If a modal/dialog is open, ESC is closing that dialog (its
            // onHide → hideDialog fires too) — so DON'T also clear the unit or
            // city selection underneath. Otherwise closing e.g. the city modal
            // would deselect the city.
            const store = useGameStore.getState();
            if (store.uiState.activeDialog != null) {
              break;
            }
            // A pending map action owns this ESC press: a citizen being carried
            // is put back and a group selection is dropped by GameCanvas's own
            // handlers. Deselecting on top of that would do two things at once.
            if (store.uiState.citizenReassign) break;
            if ((store.gameState.selectedUnitIds?.length ?? 0) > 0) break;
            // Nothing pending: ESC clears the map selection — the unit AND the
            // city. The city needs selectCity(null) too, because selectUnit
            // alone keeps the persistent "focused city" marker, which would
            // leave the city net and its worked tiles drawn on the map.
            if (actions && typeof actions.selectUnit === "function") {
              actions.selectUnit(null, "user");
            }
            if (actions && typeof actions.selectCity === "function") {
              actions.selectCity(null, "user");
            }
            if (actions && typeof actions.setSelectedUnitIds === "function") {
              actions.setSelectedUnitIds([]);
            }
            // Add more modal closures as needed
            break;
          }
          case "F1":
            // Open help
            actions.showDialog("help");
            break;
          case "F2":
            // Open tech tree
            actions.showDialog("tech");
            break;
          case "F3":
            // Open settings
            setShowSettings(true);
            break;
          case "F4":
            // Open Diplomatic Relations (full negotiation screen)
            actions.openDiplomacy(null);
            break;
          case "F11":
            // Toggle fullscreen
            if (document.fullscreenElement) {
              document.exitFullscreen();
            } else {
              document.documentElement.requestFullscreen();
            }
            break;
          // 'h' key not bound
        }
      }

      // Ctrl shortcuts
      if (ctrlKey && !altKey && !shiftKey) {
        switch (key) {
          case "1":
          case "2":
          case "3":
          case "4":
          case "5":
          case "6":
          case "7":
          case "8":
          case "9":
            // Select specific city
            {
              const cityIndex = parseInt(key) - 1;
              if (gameEngine && gameEngine.selectCityByIndex) {
                gameEngine.selectCityByIndex(cityIndex);
              }
            }
            break;
          case "s":
            // Save game
            if (gameEngine && gameEngine.saveGame) {
              gameEngine.saveGame();
            }
            break;
          case "l":
            // Load game
            if (gameEngine && gameEngine.loadGame) {
              gameEngine.loadGame();
            }
            break;
          case "p":
            // Pause / resume the game (Ctrl+P). Once the game is won, the
            // engine is frozen and the Resume button is removed — Ctrl+P
            // must not be able to unpause and resume AI processing.
            if (gameResult) {
              break; // game over — ignore
            }
            // Matches the on-screen button: a self-playing scenario pauses
            // without raising the overlay, so the board stays visible.
            handleTogglePause();
            break;
        }
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("keydown", handleKeyDown);
      }
    };
  }, [
    gameEngine,
    camera,
    setCamera,
    handleEndTurnRequest,
    activeMenu,
    showHexDetail,
    showSettings,
    isPaused,
    handlePause,
    handleResume,
    handleTogglePause,
    actions,
    gameResult,
    gameState.selectedCity,
    gameState.selectedUnit,
  ]);

  if (error) {
    return (
      <div
        id="gameContainer"
        className="vh-100 d-flex align-items-center justify-content-center text-white"
      >
        <div className="text-center">
          <h1>🚨 Game Error</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  // Show game setup modal before game engine is created
  if (!gameEngine && showGameSetup) {
    return (
      <div
        id="gameContainer"
        className="game-setup-screen vh-100 d-flex align-items-center justify-content-center text-white"
      >
        <GameSetupModal show={showGameSetup} onStart={handleGameStart} />
      </div>
    );
  }

  // Show loading only during actual initialization
  const isInitializing = !gameEngine && !showGameSetup;

  if (isInitializing) {
    return (
      <div
        id="gameContainer"
        className="vh-100 d-flex align-items-center justify-content-center text-white"
      >
        <div className="text-center">
          <div className="spinner-border mb-3"></div>
          <h2>🏛️ Loading Civilization...</h2>
        </div>
      </div>
    );
  }

  return (
    <div
      className="app-shell text-white"
      style={{
        fontSize: `${settings.uiScale}rem`,
      }}
    >
      {/* Top navigation bar (mobile-first) */}
      <TopBar
        topBarRef={topBarRef}
        activeMenu={activeMenu}
        onMenuClick={handleMenuClick}
        currentTurn={gameState.currentTurn}
        currentYear={GameUtils.formatYear(gameState.currentYear ?? -4000)}
        onEndTurn={handleEndTurnRequest}
        endTurnDisabled={uiState.turnButtonDisabled}
        gameEngine={gameEngine}
      />

      {/* Main Game Area */}
      <div className="app-main">
        {/* Info panel: static sidebar on desktop, slide-in drawer on mobile */}
        <div
          className={`side-panel-shell mobile-drawer ${!uiState.sidebarCollapsed ? "is-open" : ""}`}
        >
          <SidePanel gameEngine={gameEngine} />
        </div>
        {!uiState.sidebarCollapsed && (
          <div
            className="mobile-drawer-backdrop"
            onClick={() => actions.toggleUI("sidebarCollapsed")}
            aria-hidden="true"
          />
        )}

        {/* Main Map Area */}
        <div className="game-canvas flex-grow-1 position-relative">
          <GameCanvas onExamineHex={handleExamineHex} gameEngine={gameEngine} />
        </div>
      </div>

      {/* Game menus (anchored dropdown on desktop, bottom sheet on mobile) */}
      <GameMenuSheet
        activeMenu={activeMenu}
        position={menuPosition}
        onClose={() => setActiveMenu(null)}
        onNewGame={handleNewGame}
        onSaveGame={handleSaveGame}
        onLoadGame={handleLoadGame}
        onPause={handlePause}
        onOpenSettings={() => {
          setShowSettings(true);
          setActiveMenu(null);
        }}
        onOpenRates={() => {
          actions.showDialog("rates");
          setActiveMenu(null);
        }}
        onOpenGovernment={() => {
          actions.showDialog("government");
          setActiveMenu(null);
        }}
        onQuit={handleQuit}
        onDownloadMap={() => {
          handleDownloadMap();
          setActiveMenu(null);
        }}
        onDownloadProgression={handleDownloadProgression}
        onDownloadProgressionCompact={handleDownloadProgressionCompact}
        onHelp={() => {
          actions.showDialog("help");
          setActiveMenu(null);
        }}
        onDiplomacy={() => {
          actions.openDiplomacy(null);
          setActiveMenu(null);
        }}
        onTechTree={() => {
          actions.showDialog("tech");
          setActiveMenu(null);
        }}
        onStatistics={() => {
          actions.showDialog("statistics");
          setActiveMenu(null);
        }}
        onWonders={() => {
          actions.showDialog("wonders");
          setActiveMenu(null);
        }}
      />

      {/* Mobile primary action bar (thumb zone) */}
      <MobileBottomBar
        activeMenu={activeMenu}
        onOpenMenu={handleMobileMenuOpen}
        panelOpen={!uiState.sidebarCollapsed}
        onTogglePanel={() => actions.toggleUI("sidebarCollapsed")}
        onEndTurn={handleEndTurnRequest}
      />

      {/* Confirmation dialogs (replace native window.confirm for consistent mobile UX) */}
      <ConfirmDialog
        show={confirmNewGame}
        title="Start a New Game?"
        message="Are you sure you want to end the current game and start over?"
        detail="All progress will be lost."
        confirmLabel="New Game"
        variant="danger"
        onConfirm={handleNewGameConfirmed}
        onCancel={() => setConfirmNewGame(false)}
      />
      <ConfirmDialog
        show={confirmQuit}
        title="Quit to Main Menu?"
        message="Are you sure you want to quit the current game?"
        confirmLabel="Quit"
        variant="danger"
        onConfirm={handleQuitConfirmed}
        onCancel={() => setConfirmQuit(false)}
      />

      {/* Settings Modal */}
      <SettingsModal
        show={showSettings}
        onHide={() => setShowSettings(false)}
        isPaused={isPaused}
        onTogglePause={handleTogglePause}
      />

      {/* End Turn Confirmation Modal */}
      <EndTurnConfirmModal
        show={showEndTurnConfirm}
        onConfirm={handleEndTurnConfirm}
        onCancel={handleEndTurnCancel}
        currentTurn={gameState.currentTurn}
        currentYear={gameState.currentYear ?? -4000}
        isAutomatic={isEndTurnAutomatic}
      />

      {/* Game Modals */}
      <GameModals gameEngine={gameEngine} />

      {/* Store-driven toasts (combat results, auto-end recap, warnings, …) */}
      <NotificationCenter
        notifications={uiState.notifications}
        onDismiss={actions.removeNotification}
      />

      {/* Pause overlay. Only the pause SCREEN shows here — a spectator pause
          deliberately leaves it off so the board stays visible. */}
      <PauseScreen
        show={pauseScreenVisible || !!gameResult}
        onResume={handleResume}
        currentTurn={gameState.currentTurn}
        currentYear={
          gameState.currentYear != null
            ? GameUtils.formatYear(gameState.currentYear)
            : undefined
        }
        gameOver={!!gameResult}
      />

      {/* Self-playing scenarios get a speed bar that stays on screen while the
          game runs: full speed by default, one uniform step per click, and a
          play/pause that stops and restarts the duel without hiding the board.
          Hidden while the pause screen or the result overlay is up, since both
          offer their own resume/restart. */}
      {isAutoScenario(gameEngine?.gameSettings?.mapType) &&
        gameState.isGameStarted &&
        !gameResult &&
        !pauseScreenVisible && (
          <GameSpeedControls
            compact
            isPaused={isPaused}
            onTogglePause={handleTogglePause}
          />
        )}

      <GameResultOverlay
        result={gameResult}
        onClose={handleResultClose}
        onRestart={handleResultRestart}
        onQuit={handleResultQuit}
      />

      {/* Fireworks for victory — rendered above the overlay so they're visible */}
      <VictoryFireworks show={gameResult?.outcome === "victory"} />
    </div>
  );
}

export default App;
