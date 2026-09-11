import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Modal, Button, Tab, Tabs, Card, ListGroup } from 'react-bootstrap';
import TechTreeView from './TechTreeView';
import { getTechIcon } from '@/data/TechnologyIcons';
import { findPathToTech, firstResearchableInPath } from '@/utils/ResearchPath';
import CityModal from './gamemodals/CityModal';
import HexDetailModal from './gamemodals/HexDetailModal';
import RatesModal from './gamemodals/RatesModal';
import GovernmentModal from './gamemodals/GovernmentModal';
import StatisticsModal from './gamemodals/StatisticsModal';
import VillageModal from './gamemodals/VillageModal';
import ResearchRequiredModal from './ResearchRequiredModal';
import { useGameStore } from '@/stores/GameStore';
import { UNIT_PROPS } from '@/utils/Constants';
import { BUILDING_PROPERTIES } from '@/data/BuildingConstants';
import { DomUtils } from '@/utils/DomUtils';
import { enrichMapForExport } from '@/utils/MapExportUtils';
import { productionFailureText } from '@/utils/ProductionUtils';
import '../../styles/gameModals.css';
import '../../styles/diplomacyModal.css';
import LeaderPortrait from './LeaderPortrait';
import { LEADER_PORTRAITS, MOOD_COLORS } from '@/data/LeaderPortraits';
import type { City, Civilization } from '../../../types/game';
import GameEngine from '@/game/engine/GameEngine';
import type { DiplomatAction, TreatyType } from '@/game/engine/DiplomacyTypes';

const GameModals = ({ gameEngine }: { gameEngine?: GameEngine | null }) => {
  // console.log('[GameModals] Component rendering, gameEngine present:', !!gameEngine);
  const uiState = useGameStore(state => state.uiState);
  const actions = useGameStore(state => state.actions);
  const isGameStarted = useGameStore(state => state.gameState.isGameStarted);
  const selectedHex = useGameStore(state => state.gameState.selectedHex);
  const selectedCityId: string | null = useGameStore(state => state.gameState.selectedCity);
  const cities = useGameStore(state => state.cities);
  const technologies = useGameStore(state => state.technologies);
  const researchPath = useGameStore(state => state.researchPath);
  const techProgress = useGameStore(state => state.techProgress);
  const lastResearchedTech = useGameStore(state => state.lastResearchedTech);
  const currentPlayer = useGameStore(state => state.civilizations[state.gameState.activePlayer] || null);

  const units = useGameStore(state => state.units);
  const map = useGameStore(state => state.map);
  const gameStats = useGameStore(state => state.gameStats);

  const civilizations = useGameStore(state => state.civilizations);
  const incomingDiplomacyOffer = useGameStore(state => state.incomingDiplomacyOffer);
  const diplomacyFocusCivId = useGameStore(state => state.diplomacyFocusCivId);
  const disbandNotice = useGameStore(state => state.disbandNotice);
  const tradeRouteResult = useGameStore(state => state.tradeRouteResult);

  const selectedCity = cities.find(c => c.id === selectedCityId);

  // Check if the selected city belongs to the current player
  const isPlayerCity = selectedCity && currentPlayer && selectedCity.civilizationId === currentPlayer.id;

  // Always use fresh selectedCity from Zustand

  const capitalizeName = (value?: string | null) => {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
  };

  const getProductionPerTurn = (city: City | null | undefined): number => {
    if (!city) return 0;
    if (typeof city?.yields?.production === 'number') return city.yields.production;
    if (typeof city?.production === 'number') return city.production;
    if (typeof city?.output?.production === 'number') return city.output.production;
    return 0;
  };

  const getProductionCost = (item: string | number | { cost?: number; type?: string; name?: string; itemType?: string } | null | undefined): number => {
    if (!item) return 0;
    if (typeof item === 'number') return item;
    if (typeof item === 'string') {
      const unitDef = UNIT_PROPS[item];
      if (unitDef && typeof unitDef.cost === 'number') return unitDef.cost;
      const buildingDef = BUILDING_PROPERTIES[item];
      if (buildingDef && typeof buildingDef.cost === 'number') return buildingDef.cost;
      return 0;
    }
    if (typeof item.cost === 'number') return item.cost;
    if (item.itemType) {
      const unitDef = UNIT_PROPS[item.itemType];
      if (unitDef && typeof unitDef.cost === 'number') return unitDef.cost;
      const buildingDef = BUILDING_PROPERTIES[item.itemType];
      if (buildingDef && typeof buildingDef.cost === 'number') return buildingDef.cost;
    }
    if (item.type) {
      const buildingDef = BUILDING_PROPERTIES[item.type];
      if (buildingDef && typeof buildingDef.cost === 'number') return buildingDef.cost;
    }
    if (item.name && typeof item.name === 'string') {
      const normalizedName = item.name.toLowerCase().replace(/\s+/g, '_');
      const buildingDef = BUILDING_PROPERTIES[normalizedName];
      if (buildingDef && typeof buildingDef.cost === 'number') return buildingDef.cost;
    }
    return 0;
  };

  const getProductionName = (item: string | { name?: string; type?: string; itemType?: string } | null | undefined): string => {
    if (!item) return 'Unknown';
    if (typeof item === 'string') {
      return UNIT_PROPS[item]?.name || BUILDING_PROPERTIES[item]?.name || capitalizeName(item);
    }
    if (item.name) return item.name;
    if (item.itemType) {
      return UNIT_PROPS[item.itemType]?.name || BUILDING_PROPERTIES[item.itemType]?.name || capitalizeName(item.itemType);
    }
    if (item.type) {
      return BUILDING_PROPERTIES[item.type]?.name || capitalizeName(item.type);
    }
    return 'Unknown';
  };

  // Dialogs that do NOT defer auto-end while open (they never block it), so
  // closing them must not trigger a re-check. Everything else defers auto-end
  // while open (see EngineEventHandlers.isDecisionScreenOpen) and MUST re-check
  // on close — otherwise auto-end silently stops after closing a rates /
  // government / statistics / diplomacy / village modal.
  const NON_BLOCKING_DIALOGS = ['game-menu', 'help', 'tech', 'hex-details'];

  const handleCloseDialog = () => {
    const closing = useGameStore.getState().uiState.activeDialog;
    actions.hideDialog();
    // The "No Research Selected" prompt and the tech tree defer auto-end while
    // no research is selected, so closing them IS a decision point: with a
    // research chosen the turn may proceed, with an empty one the auto-end gate
    // keeps deferring. Other non-blocking dialogs (WORLD menu, help, hex
    // details) never defer auto-end, so closing them must not trigger a
    // re-check.
    const blocking = !NON_BLOCKING_DIALOGS.includes(closing) || closing === 'tech' || closing === 'research-required';
    console.log(`[AUTO-END] Dialog "${closing ?? 'none'}" closed — ${blocking ? 're-checking auto-end' : 'non-blocking, no re-check'}`);
    // Re-check auto-end after any screen that defers it closes (city
    // management, diplomacy, rates, government, statistics, village, …). Once
    // closed, end the turn if every unit is done and auto-end is enabled.
    if (blocking &&
        gameEngine && typeof gameEngine.checkAndEndTurnIfNoMoves === 'function') {
      gameEngine.checkAndEndTurnIfNoMoves('dialog-closed');
    }
  };

  /**
   * Close the village-result message: clear the store state (the hut itself
   * already disappeared the moment it was triggered). Auto-end is re-checked
   * like any other blocking decision screen, so the deferred end-turn prompt
   * fires once the message is dismissed.
   */
  const handleVillageClose = () => {
    // Hide first so handleCloseDialog still sees the 'village' dialog and
    // re-checks auto-end (deferred while the message was open).
    handleCloseDialog();
    actions.clearVillageResult();
  };

  const handleNewGame = () => {
    console.log('[CLICK] New Game button');
    if (gameEngine) {
      gameEngine.newGame();
    }
    handleCloseDialog();
  };

  const handleDownloadMap = () => {
    console.log('[CLICK] Download Map button');
    try {
      if (!map || !map.tiles || map.tiles.length === 0) {
        console.warn('[GameModals] handleDownloadMap: no map data available');
        handleCloseDialog();
        return;
      }

      const enriched = enrichMapForExport(map);
      const exportObj = {
        meta: {
          width: map.width,
          height: map.height,
          turn: gameStats?.turn ?? 'unknown'
        },
        map: enriched
      };

      const text = JSON.stringify(exportObj, null, 2);
      const filename = `civ1-map-turn-${gameStats?.turn ?? 'unknown'}.json`;
      DomUtils.downloadTextFile(text, filename);
    } catch (e) {
      console.error('[GameModals] handleDownloadMap error', e);
    }
    handleCloseDialog();
  };

  const handleSaveGame = () => {
    console.log('[CLICK] Save Game button');
    try {
      if (!gameEngine) {
        console.warn('[GameModals] handleSaveGame: no gameEngine');
        actions.addNotification({ type: 'warning', message: 'Save not available.' });
        handleCloseDialog();
        return;
      }

      // Build save data from engine state
      let json: string | null = null;
      if (typeof gameEngine.getSaveJSON === 'function') {
        json = gameEngine.getSaveJSON();
        console.log('[GameModals] handleSaveGame: got JSON via getSaveJSON(), length:', json?.length);
      } else if (typeof gameEngine.saveGame === 'function') {
        gameEngine.saveGame();
        json = localStorage.getItem('civ1_savegame');
        console.log('[GameModals] handleSaveGame: got JSON via saveGame(), length:', json?.length);
      }

      if (!json) {
        console.error('[GameModals] handleSaveGame: no JSON produced');
        actions.addNotification({ type: 'error', message: 'Failed to generate save data.' });
        handleCloseDialog();
        return;
      }

      // Trigger file download
      const turn = gameStats?.turn ?? 'unknown';
      const filename = `civ1-save-turn-${turn}.json`;

      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      console.log('[GameModals] handleSaveGame: download triggered for', filename);
      actions.addNotification({ type: 'success', message: `Game saved to ${filename}` });
    } catch (e) {
      console.error('[GameModals] handleSaveGame error:', e);
      actions.addNotification({ type: 'error', message: 'Save failed: ' + (e as Error).message });
    }
    handleCloseDialog();
  };

  const handleLoadGame = () => {
    console.log('[CLICK] Load Game button');
    if (!gameEngine || typeof gameEngine.loadGame !== 'function') {
      console.warn('[GameModals] handleLoadGame: engine or loadGame not available');
      actions.addNotification({ type: 'warning', message: 'Load not available.' });
      handleCloseDialog();
      return;
    }
    // Create hidden file input to let user pick a save file
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        console.log('[GameModals] handleLoadGame: no file selected');
        handleCloseDialog();
        return;
      }
      console.log('[GameModals] handleLoadGame: selected file', file.name);
      try {
        const text = await file.text();
        console.log('[GameModals] handleLoadGame: read file, length:', text.length);
        // Validate it's a valid save file
        const saveData = JSON.parse(text);
        if (!saveData || (saveData.version !== 1 && saveData.version !== 2)) {
          console.warn('[GameModals] handleLoadGame: invalid save data, version:', saveData?.version);
          actions.addNotification({ type: 'error', message: 'Invalid or incompatible save file.' });
          handleCloseDialog();
          return;
        }
        // Store in localStorage so engine.loadGame() can read it
        localStorage.setItem('civ1_savegame', text);
        // Let the engine restore state
        const success = await gameEngine.loadGame();
        console.log('[GameModals] handleLoadGame: engine.loadGame returned', success);
        if (success) {
          // Force a full store sync after loading
          actions.updateMap(gameEngine.map);
          actions.updateUnits(gameEngine.getAllUnits());
          actions.updateCities(gameEngine.getAllCities());
          actions.updateCivilizations(gameEngine.civilizations);
          actions.updateTechnologies(gameEngine.technologies);
          actions.updateVisibility();
          actions.addNotification({ type: 'success', message: `Game loaded from ${file.name}` });
        } else {
          actions.addNotification({ type: 'error', message: 'Failed to load game state.' });
        }
      } catch (e) {
        console.error('[GameModals] handleLoadGame error:', e);
        actions.addNotification({ type: 'error', message: 'Failed to read save file: ' + (e as Error).message });
      }
      handleCloseDialog();
    };
    document.body.appendChild(input);
    input.click();
    // Clean up: remove the input after a short delay (after file picker opened)
    setTimeout(() => {
      if (document.body.contains(input)) document.body.removeChild(input);
    }, 1000);
  };

  // handleResearchTechnology removed (unused)

  // Game Menu Modal
  const renderGameMenu = () => (
    <Modal show={uiState.activeDialog === 'game-menu'} onHide={handleCloseDialog} centered>
      <Modal.Header closeButton className="bg-dark text-white">
        <Modal.Title>
          <i className="bi bi-gear"></i> Game Menu
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="bg-dark text-white">
        <div className="d-grid gap-2">
          <Button variant="primary" size="lg" onClick={handleNewGame}>
            <i className="bi bi-plus-circle"></i> New Game
          </Button>
          
          <Button variant="info" size="lg" onClick={handleSaveGame}>
            <i className="bi bi-download"></i> Save Game
          </Button>
          
          {isGameStarted && (
            <Button variant="success" size="lg" onClick={handleDownloadMap}>
              <i className="bi bi-map"></i> Download Map
            </Button>
          )}
          
          <Button variant="warning" size="lg" onClick={handleLoadGame}>
            <i className="bi bi-upload"></i> Load Game
          </Button>
          
          <Button variant="secondary" size="lg" onClick={() => console.log('[CLICK] Settings button (not implemented)')}>
            <i className="bi bi-gear"></i> Settings
          </Button>
          
          <Button 
            variant="outline-light" 
            size="lg"
            onClick={() => {
              console.log('[CLICK] Help button');
              actions.showDialog('help');
            }}
          >
            <i className="bi bi-question-circle"></i> Help
          </Button>
        </div>
      </Modal.Body>
    </Modal>
  );

  /**
   * Player picked a tech in the tree: remember the selected path, save the
   * progress of the currently-researched tech, and start the first available
   * tech in the new path (restoring its saved progress).
   */
  const handleSelectTech = (techId: string) => {
    const ge = gameEngine;
    if (!ge) return;
    const civ = ge.civilizations?.[0];
    if (!civ) return;
    const techs = technologies.length > 0 ? technologies : ge.technologies;
    const path = findPathToTech(techs, techId) ?? [techId];

    // Save the current research's progress before switching away from it.
    const currentId = civ.currentResearch
      ? (typeof civ.currentResearch === 'object' ? (civ.currentResearch as { id?: string }).id : civ.currentResearch)
      : null;
    if (currentId && (civ.researchProgress || 0) > 0) {
      actions.saveTechProgress(currentId, civ.researchProgress || 0);
    }

    actions.setResearchPath(path);

    // Start researching the first tech in the path that THIS civ hasn't
    // researched yet and whose prerequisites it actually owns. The shared
    // tree's `researched`/`available` flags are the union across all civs
    // (coloring only) — gating on them made every tech an AI had discovered
    // first silently unselectable for the player.
    const civTechs = new Set<string>((civ.technologies ?? []).map(String));
    const firstResearchable = firstResearchableInPath(techs, path, civTechs);
    if (firstResearchable) {
      const saved = useGameStore.getState().techProgress[firstResearchable] ?? 0;
      ge.setResearch(0, firstResearchable, saved);
      actions.updateCivilizations([...(ge.civilizations || [])]);
    }
  };

  // Technology Tree Modal
  const renderTechTree = () => {
    const civ = gameEngine?.civilizations?.[0];
    const currentTechId = civ?.currentResearch
      ? (typeof civ.currentResearch === 'object' ? (civ.currentResearch as { id?: string }).id : civ.currentResearch)
      : null;
    // Effective (map/difficulty/tech-count scaled) cost of the tech currently
    // being researched — the value research actually completes at.
    let currentTechCost: number | null = null;
    if (civ && currentTechId && gameEngine?.researchManager) {
      const tech = (gameEngine.technologies ?? []).find((t) => t.id === currentTechId);
      if (tech) currentTechCost = gameEngine.researchManager.effectiveTechCost(civ, tech);
    }
    return (
      <Modal 
        show={uiState.activeDialog === 'tech'} 
        onHide={handleCloseDialog} 
        fullscreen
        dialogClassName="tech-tree-modal"
      >
        <Modal.Header closeButton className="bg-dark text-white">
          <Modal.Title>
            <i className="bi bi-lightbulb"></i> Technology Tree
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="bg-dark text-white tech-tree-modal-body">
          <React.Suspense fallback={<div className="text-white p-3">Loading tree...</div>}>
            <TechTreeView
              technologies={technologies}
              width={Math.max(window.innerWidth - 32, 320)}
              researchPath={researchPath}
              currentResearchId={currentTechId}
              researchProgress={civ?.researchProgress ?? 0}
              currentTechCost={currentTechCost}
              playerResearchedIds={new Set((currentPlayer?.technologies ?? []).map(String))}
              onSelectTech={handleSelectTech}
            />
          </React.Suspense>
        </Modal.Body>
      </Modal>
    );
  };

  /**
   * Notification shown when a technology is finished: emoji/icon + description,
   * plus a "continue researching" button (path has more techs) or a "choose a
   * new research path" button (path exhausted).
   */
  const renderResearchComplete = () => {
    if (!lastResearchedTech) return null;
    const remainingPath = researchPath.filter(id => {
      const t = technologies.find(x => x.id === id);
      return t && !t.researched;
    });
    const nextTechId = remainingPath.length > 0 ? remainingPath[0] : null;
    const nextTech = nextTechId ? technologies.find(t => t.id === nextTechId) : null;
    return (
      <Modal show onHide={actions.dismissTechNotification} dialogClassName="research-complete-modal">
        <Modal.Header closeButton className="bg-dark text-white">
          <Modal.Title>🔬 Research Complete</Modal.Title>
        </Modal.Header>
        <Modal.Body className="bg-dark text-white">
          <div className="text-center research-complete-icon">{getTechIcon(lastResearchedTech.id)}</div>
          <h4 className="text-center mt-2">{lastResearchedTech.name}</h4>
          <p className="text-center text-muted mb-0">
            {lastResearchedTech.description || 'A new technology has been unlocked.'}
          </p>
          <div className="d-grid gap-2 mt-3">
            {nextTech && nextTechId ? (
              <Button
                variant="success"
                onClick={() => {
                  if (gameEngine) {
                    const saved = techProgress[nextTechId] ?? 0;
                    gameEngine.setResearch(0, nextTechId, saved);
                    actions.updateCivilizations([...(gameEngine.civilizations || [])]);
                  }
                  actions.dismissTechNotification();
                }}
              >
                Continue Researching: {nextTech.name}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => {
                  actions.dismissTechNotification();
                  actions.showDialog('tech');
                }}
              >
                Choose New Research Path
              </Button>
            )}
          </div>
        </Modal.Body>
      </Modal>
    );
  }

  // Diplomacy Modal — Civ I–style negotiation interface with leader portraits
  const [selectedDiploCiv, setSelectedDiploCiv] = useState<number | null>(null);
  const [diplomacyLog, setDiplomacyLog] = useState<string[]>([]);
  const [showTreatyPanel, setShowTreatyPanel] = useState(false);
  const [counterProposal, setCounterProposal] = useState<{ fromCivId: number; toCivId: number; action: string; goldAmount?: number } | null>(null);

  const addDiploLog = (msg: string): void => {
    setDiplomacyLog(prev => [msg, ...prev].slice(0, 20));
  };

  // When the diplomacy screen opens with a focus civ (diplomat contact or an
  // AI-initiated offer), pre-select that civ in the negotiation list, then
  // consume the focus hint so it only applies once.
  useEffect(() => {
    if (uiState.activeDialog === 'diplomacy' && diplomacyFocusCivId != null) {
      setSelectedDiploCiv(diplomacyFocusCivId);
      setShowTreatyPanel(false);
      setCounterProposal(null);
      actions.clearDiplomacyFocus();
    }
  }, [uiState.activeDialog, diplomacyFocusCivId, actions]);

  // Accept or reject the AI's pending proposal shown in the incoming-offer
  // banner. Accepting executes the proposal directly (no willingness roll —
  // the player's choice is the answer).
  const handleIncomingOffer = (accept: boolean): void => {
    const offer = useGameStore.getState().incomingDiplomacyOffer;
    if (!offer) return;
    const fromCiv = civilizations[offer.fromCivId];
    if (accept && gameEngine?.diplomacyManager) {
      const result = gameEngine.diplomacyManager.acceptOffer({
        fromCivId: offer.fromCivId,
        toCivId: currentPlayer?.id ?? 0,
        action: offer.action as unknown as DiplomatAction,
        goldAmount: offer.goldAmount,
      });
      addDiploLog(result.accepted
        ? `You accepted ${fromCiv?.name ?? 'their'} proposal (${offer.action.replace(/_/g, ' ')}).`
        : `The proposal could not be completed.`);
    } else {
      addDiploLog(`You declined ${fromCiv?.name ?? 'their'} proposal.`);
    }
    actions.clearIncomingDiplomacyOffer();
  };

  const renderDiplomacy = () => {
    const dm = gameEngine?.diplomacyManager;
    const playerId = currentPlayer?.id ?? 0;
    const otherCivs = civilizations.filter((c: Civilization) => c.id !== playerId && c.isAlive !== false);

    const STATUS_ICONS: Record<string, string> = {
      peace: '🕊️',
      war: '⚔️',
      ceasefire: '🏳️',
      alliance: '🤝',
    };

    const ATTITUDE_LABELS: Record<string, { label: string; color: string }> = {
      friendly: { label: 'Friendly', color: '#4caf50' },
      neutral: { label: 'Neutral', color: '#9e9e9e' },
      annoyed: { label: 'Annoyed', color: '#ff9800' },
      hostile: { label: 'Hostile', color: '#f44336' },
    };

    const TREATY_LABELS: Record<string, { icon: string; label: string }> = {
      open_borders: { icon: '🚪', label: 'Open Borders' },
      trade_agreement: { icon: '📦', label: 'Trade Agreement' },
      mutual_defense: { icon: '🛡️', label: 'Mutual Defense' },
      non_aggression: { icon: '🤚', label: 'Non-Aggression' },
      embargo_target: { icon: '🚫', label: 'Embargo' },
    };

    const handleDiplomacyAction = (targetId: number, action: string, extra?: { treaty?: string }) => {
      if (!dm) return;
      let result: { accepted?: boolean; counterProposal?: typeof counterProposal; reason?: string; goldTransferred?: number } | null = null;
      switch (action) {
        case 'declare_war':
          dm.declareWar(playerId, targetId);
          gameEngine?.onStateChange?.('WAR_DECLARED', { aggressorId: playerId, targetId });
          addDiploLog(`You declared war on ${civilizations[targetId]?.name}!`);
          break;
        case 'propose_peace':
          result = dm.processProposal({ fromCivId: playerId, toCivId: targetId, action: 'propose_peace' });
          if (result.counterProposal) {
            setCounterProposal(result.counterProposal);
            addDiploLog(`${civilizations[targetId]?.name} rejected peace but made a counter-offer.`);
          } else {
            addDiploLog(result.accepted
              ? `${civilizations[targetId]?.name} accepted your peace proposal.`
              : `${civilizations[targetId]?.name} rejected peace: "${result.reason}"`);
          }
          break;
        case 'propose_ceasefire':
          result = dm.processProposal({ fromCivId: playerId, toCivId: targetId, action: 'propose_ceasefire' });
          if (result.counterProposal) {
            setCounterProposal(result.counterProposal);
            addDiploLog(`${civilizations[targetId]?.name} counter-proposes instead.`);
          } else {
            addDiploLog(result.accepted
              ? `Ceasefire agreed with ${civilizations[targetId]?.name}.`
              : `${civilizations[targetId]?.name} rejected ceasefire: "${result.reason}"`);
          }
          break;
        case 'propose_alliance':
          result = dm.processProposal({ fromCivId: playerId, toCivId: targetId, action: 'propose_alliance' });
          if (result.counterProposal) {
            setCounterProposal(result.counterProposal);
            addDiploLog(`${civilizations[targetId]?.name} declines alliance but offers an alternative.`);
          } else {
            addDiploLog(result.accepted
              ? `Alliance formed with ${civilizations[targetId]?.name}!`
              : `${civilizations[targetId]?.name} rejected alliance: "${result.reason}"`);
          }
          break;
        case 'demand_tribute': {
          const demand = 50;
          result = dm.processProposal({ fromCivId: playerId, toCivId: targetId, action: 'demand_tribute', goldAmount: demand });
          if (result.counterProposal) {
            setCounterProposal(result.counterProposal);
            addDiploLog(`${civilizations[targetId]?.name} refuses tribute but offers a deal.`);
          } else {
            addDiploLog(result.accepted
              ? `${civilizations[targetId]?.name} paid ${result.goldTransferred ?? demand} gold in tribute.`
              : `${civilizations[targetId]?.name} refused your demand: "${result.reason}"`);
          }
          break;
        }
        case 'offer_open_borders':
          result = dm.processProposal({ fromCivId: playerId, toCivId: targetId, action: 'offer_open_borders' });
          addDiploLog(result.accepted
            ? `Open borders established with ${civilizations[targetId]?.name}.`
            : `${civilizations[targetId]?.name} refused open borders.`);
          break;
        case 'propose_trade_agreement':
          result = dm.processProposal({ fromCivId: playerId, toCivId: targetId, action: 'propose_trade_agreement', goldAmount: 2 });
          addDiploLog(result.accepted
            ? `Trade agreement signed with ${civilizations[targetId]?.name}! (+2 gold/turn)`
            : `${civilizations[targetId]?.name} refused trade.`);
          break;
        case 'propose_mutual_defense':
          result = dm.processProposal({ fromCivId: playerId, toCivId: targetId, action: 'propose_mutual_defense' });
          addDiploLog(result.accepted
            ? `Mutual defense pact with ${civilizations[targetId]?.name}!`
            : `${civilizations[targetId]?.name} refused the defense pact.`);
          break;
        case 'propose_non_aggression':
          result = dm.processProposal({ fromCivId: playerId, toCivId: targetId, action: 'propose_non_aggression' });
          addDiploLog(result.accepted
            ? `Non-aggression pact signed with ${civilizations[targetId]?.name}.`
            : `${civilizations[targetId]?.name} refused the pact.`);
          break;
        case 'cancel_treaty': {
          const treaty = extra?.treaty as TreatyType | undefined;
          if (treaty) {
            dm.cancelTreaty(playerId, targetId, treaty);
            addDiploLog(`You cancelled ${TREATY_LABELS[treaty]?.label || treaty} with ${civilizations[targetId]?.name}.`);
          }
          break;
        }
        case 'accept_counter': {
          if (counterProposal) {
            const cpResult = dm.processProposal({ ...counterProposal, action: counterProposal.action as DiplomatAction });
            const cpAction = counterProposal.action.replace(/_/g, ' ');
            addDiploLog(cpResult.accepted
              ? `You accepted their counter-proposal: ${cpAction}.`
              : `Counter-proposal could not be executed.`);
            setCounterProposal(null);
          }
          break;
        }
        case 'reject_counter':
          addDiploLog('You rejected their counter-proposal.');
          setCounterProposal(null);
          break;
      }
      // Force re-render by syncing state
      if (gameEngine?.units) actions.updateUnits?.([...gameEngine.units]);
      if (gameEngine?.civilizations) actions.updateCivilizations?.([...gameEngine.civilizations]);
    };

    const selectedCivData = selectedDiploCiv !== null ? civilizations[selectedDiploCiv] : null;
    const selectedStatus = selectedDiploCiv !== null ? (dm?.getStatus(playerId, selectedDiploCiv) ?? 'peace') : 'peace';
    const selectedAttitude = selectedDiploCiv !== null ? (dm?.getAttitude(playerId, selectedDiploCiv) ?? 'neutral') : 'neutral';
    const selectedRelation = selectedDiploCiv !== null ? dm?.getRelation(playerId, selectedDiploCiv) : null;

    // Leader portrait lookup
    const leaderName = selectedCivData?.leader || selectedCivData?.leaderName || '';
    const portraitConfig = LEADER_PORTRAITS[leaderName] || null;
    const moodColors = MOOD_COLORS[selectedAttitude] || MOOD_COLORS.neutral;
    const activeTreaties: string[] = selectedDiploCiv !== null ? (dm?.getActiveTreaties?.(playerId, selectedDiploCiv) ?? []) : [];

    return (
      <Modal 
        show={uiState.activeDialog === 'diplomacy'} 
        onHide={() => { handleCloseDialog(); setSelectedDiploCiv(null); setDiplomacyLog([]); setShowTreatyPanel(false); setCounterProposal(null); actions.clearIncomingDiplomacyOffer(); actions.clearDiplomacyFocus(); }} 
        centered
        size="xl"
        fullscreen="lg-down"
        dialogClassName="diplomacy-modal"
      >
        <Modal.Header closeButton className="diplomacy-header">
          <Modal.Title>
            ⚖️ Diplomatic Relations
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="diplomacy-body">
          {/* Pending AI→player proposal awaiting an accept/reject decision */}
          {incomingDiplomacyOffer && (
            <div className="diplomacy-incoming-offer">
              <div className="diplomacy-incoming-title">📨 Incoming Proposal</div>
              <div className="diplomacy-incoming-text">
                {civilizations[incomingDiplomacyOffer.fromCivId]?.name ?? 'Unknown'} proposes: <strong>{incomingDiplomacyOffer.action.replace(/_/g, ' ')}</strong>
                {incomingDiplomacyOffer.goldAmount ? ` (${incomingDiplomacyOffer.goldAmount} gold)` : ''}
              </div>
              <div className="diplomacy-incoming-buttons">
                <button className="diplomacy-btn btn-peace" onClick={() => handleIncomingOffer(true)}>✓ Accept</button>
                <button className="diplomacy-btn btn-war" onClick={() => handleIncomingOffer(false)}>✗ Reject</button>
              </div>
            </div>
          )}
          {otherCivs.length === 0 ? (
            <p className="text-muted text-center py-4">No other civilizations discovered yet.</p>
          ) : (
            <div className="diplomacy-layout">
              {/* Left: Civilization list */}
              <div className="diplomacy-civ-list">
                <div className="diplomacy-section-label">CIVILIZATIONS</div>
                {otherCivs.map((civ: Civilization) => {
                  const status = dm?.getStatus(playerId, civ.id) ?? 'peace';
                  const treaties = dm?.getActiveTreaties?.(playerId, civ.id) ?? [];
                  const isSelected = selectedDiploCiv === civ.id;
                  return (
                    <button
                      key={civ.id}
                      className={`diplomacy-civ-row ${isSelected ? 'selected' : ''}`}
                      onClick={() => { setSelectedDiploCiv(civ.id); setShowTreatyPanel(false); setCounterProposal(null); }}
                    >
                      <span className="diplomacy-civ-icon" style={{ color: civ.color || '#fff' }}>
                        {civ.icon || '👤'}
                      </span>
                      <span className="diplomacy-civ-name">
                        {civ.name}
                        {treaties.length > 0 && <span className="diplomacy-treaty-count">+{treaties.length}</span>}
                      </span>
                      <span className="diplomacy-status-icon">{STATUS_ICONS[status] || '❓'}</span>
                    </button>
                  );
                })}
              </div>

              {/* Right: Negotiation panel with portrait */}
              <div className="diplomacy-negotiation" style={{ background: moodColors.bg, borderLeft: `2px solid ${moodColors.border}` }}>
                {selectedCivData ? (
                  <>
                    {/* Portrait & leader info section */}
                    <div className="diplomacy-audience" style={{ boxShadow: `inset 0 0 40px ${moodColors.glow}` }}>
                      {/* Leader portrait slot */}
                      <div className="diplomacy-portrait-slot" style={{ borderColor: moodColors.border }}>
                        {portraitConfig ? (
                          <LeaderPortrait config={portraitConfig} mood={selectedAttitude as 'friendly' | 'neutral' | 'annoyed' | 'hostile'} size={110} leaderName={leaderName} />
                        ) : (
                          <div className="diplomacy-portrait-placeholder" style={{ color: selectedCivData.color || '#fff' }}>
                            <span className="diplomacy-portrait-icon">{selectedCivData.icon || '👤'}</span>
                          </div>
                        )}
                      </div>

                      {/* Leader name & title */}
                      <div className="diplomacy-leader-info">
                        <div className="diplomacy-leader-name">{leaderName || 'Unknown Leader'}</div>
                        <div className="diplomacy-leader-title">
                          {portraitConfig?.title || `Leader of the ${selectedCivData.name}`}
                        </div>
                        <div className="diplomacy-attitude-badge" style={{
                          color: ATTITUDE_LABELS[selectedAttitude]?.color || '#9e9e9e',
                          borderColor: ATTITUDE_LABELS[selectedAttitude]?.color || '#9e9e9e',
                        }}>
                          {ATTITUDE_LABELS[selectedAttitude]?.label || 'Unknown'}
                        </div>
                      </div>

                      {/* Status panel */}
                      <div className="diplomacy-status-panel">
                        <div className="diplomacy-status-chip">
                          <span className={`diplomacy-status-value status-${selectedStatus}`}>
                            {STATUS_ICONS[selectedStatus]} {selectedStatus.toUpperCase()}
                          </span>
                        </div>
                        {selectedRelation && (
                          <>
                            <div className="diplomacy-stat">
                              <span className="diplomacy-stat-label">Reputation</span>
                              <span style={{ color: selectedRelation.reputationModifier < 0 ? '#f44336' : selectedRelation.reputationModifier > 0 ? '#4caf50' : '#9e9e9e' }}>
                                {selectedRelation.reputationModifier > 0 ? '+' : ''}{selectedRelation.reputationModifier}
                              </span>
                            </div>
                            <div className="diplomacy-stat">
                              <span className="diplomacy-stat-label">Since turn</span>
                              <span style={{ color: '#aaa' }}>{selectedRelation.since}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Military strength comparison */}
                    {(() => {
                      const playerStr = dm?.estimateMilitaryStrength?.(playerId) ?? 0;
                      const theirStr = dm?.estimateMilitaryStrength?.(selectedDiploCiv!) ?? 0;
                      const total = Math.max(playerStr + theirStr, 1);
                      const playerPct = (playerStr / total) * 100;
                      const ratio = theirStr > 0 ? playerStr / theirStr : playerStr > 0 ? 99 : 1;
                      const strengthLabel = ratio > 2 ? 'Supreme' : ratio > 1.3 ? 'Superior' : ratio > 0.8 ? 'Comparable' : ratio > 0.5 ? 'Weaker' : 'Inferior';
                      const strengthColor = ratio > 1.3 ? '#4caf50' : ratio > 0.8 ? '#9e9e9e' : '#f44336';
                      return (
                        <div className="diplomacy-strength-section">
                          <span className="diplomacy-label">Military Strength:</span>
                          <span style={{ color: strengthColor, fontWeight: 'bold' }}>{strengthLabel}</span>
                          <div className="diplomacy-strength-bar-visual">
                            <div className="diplomacy-strength-fill-player" style={{ width: `${playerPct}%` }} />
                            <div className="diplomacy-strength-fill-enemy" style={{ width: `${100 - playerPct}%` }} />
                          </div>
                          <span className="diplomacy-strength-nums">You: {Math.round(playerStr)} | Them: {Math.round(theirStr)}</span>
                        </div>
                      );
                    })()}

                    {/* Active treaties display */}
                    {activeTreaties.length > 0 && (
                      <div className="diplomacy-treaties-row">
                        <span className="diplomacy-label">Active Treaties:</span>
                        <div className="diplomacy-treaty-badges">
                          {activeTreaties.map((t: string) => (
                            <span key={t} className="diplomacy-treaty-badge">
                              {TREATY_LABELS[t]?.icon || '📜'} {TREATY_LABELS[t]?.label || t}
                              <button
                                className="diplomacy-treaty-cancel"
                                onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'cancel_treaty', { treaty: t })}
                                title="Cancel treaty"
                              >×</button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Treaty broken warning */}
                    {selectedRelation && (selectedRelation.treatiesBrokenByA > 0 || selectedRelation.treatiesBrokenByB > 0) && (
                      <div className="diplomacy-warning">
                        ⚠️ Treaties broken: {(selectedRelation.treatiesBrokenByA || 0) + (selectedRelation.treatiesBrokenByB || 0)}
                      </div>
                    )}

                    {/* Counter-proposal banner */}
                    {counterProposal && (
                      <div className="diplomacy-counter-proposal">
                        <div className="diplomacy-counter-title">📜 Counter-Proposal</div>
                        <div className="diplomacy-counter-text">
                          {civilizations[selectedDiploCiv!]?.name} suggests: <strong>{counterProposal.action.replace(/_/g, ' ')}</strong>
                          {counterProposal.goldAmount ? ` (${counterProposal.goldAmount} gold)` : ''}
                        </div>
                        <div className="diplomacy-counter-buttons">
                          <button className="diplomacy-btn btn-peace" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'accept_counter')}>
                            ✓ Accept
                          </button>
                          <button className="diplomacy-btn btn-war" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'reject_counter')}>
                            ✗ Reject
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Negotiation buttons */}
                    <div className="diplomacy-section-label">NEGOTIATIONS</div>
                    <div className="diplomacy-actions">
                      {selectedStatus === 'war' && (
                        <>
                          <button className="diplomacy-btn btn-ceasefire" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'propose_ceasefire')}>
                            🏳️ Propose Ceasefire
                          </button>
                          <button className="diplomacy-btn btn-peace" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'propose_peace')}>
                            🕊️ Offer Peace
                          </button>
                        </>
                      )}
                      {selectedStatus === 'ceasefire' && (
                        <>
                          <button className="diplomacy-btn btn-peace" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'propose_peace')}>
                            🕊️ Offer Peace Treaty
                          </button>
                          <button className="diplomacy-btn btn-war" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'declare_war')}>
                            ⚔️ Declare War
                          </button>
                        </>
                      )}
                      {selectedStatus === 'peace' && (
                        <>
                          <button className="diplomacy-btn btn-alliance" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'propose_alliance')}>
                            🤝 Propose Alliance
                          </button>
                          <button className="diplomacy-btn btn-tribute" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'demand_tribute')}>
                            💰 Demand Tribute
                          </button>
                          <button className="diplomacy-btn btn-war" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'declare_war')}>
                            ⚔️ Declare War
                          </button>
                        </>
                      )}
                      {selectedStatus === 'alliance' && (
                        <>
                          <button className="diplomacy-btn btn-tribute" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'demand_tribute')}>
                            💰 Demand Tribute
                          </button>
                          <button className="diplomacy-btn btn-war" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'declare_war')}>
                            ⚔️ Break Alliance &amp; Declare War
                          </button>
                        </>
                      )}
                    </div>

                    {/* Advanced treaties toggle */}
                    {selectedStatus !== 'war' && (
                      <>
                        <button
                          className="diplomacy-toggle-treaties"
                          onClick={() => setShowTreatyPanel(!showTreatyPanel)}
                        >
                          {showTreatyPanel ? '▾' : '▸'} Advanced Treaties
                        </button>
                        {showTreatyPanel && (
                          <div className="diplomacy-actions diplomacy-treaty-actions">
                            {!activeTreaties.includes('open_borders') && (
                              <button className="diplomacy-btn btn-treaty" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'offer_open_borders')}>
                                🚪 Open Borders
                              </button>
                            )}
                            {!activeTreaties.includes('trade_agreement') && (
                              <button className="diplomacy-btn btn-treaty" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'propose_trade_agreement')}>
                                📦 Trade Agreement
                              </button>
                            )}
                            {!activeTreaties.includes('mutual_defense') && (
                              <button className="diplomacy-btn btn-treaty" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'propose_mutual_defense')}>
                                🛡️ Mutual Defense Pact
                              </button>
                            )}
                            {!activeTreaties.includes('non_aggression') && (
                              <button className="diplomacy-btn btn-treaty" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'propose_non_aggression')}>
                                🤚 Non-Aggression Pact
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    )}

                    {/* Diplomacy event log (session) */}
                    {diplomacyLog.length > 0 && (
                      <>
                        <div className="diplomacy-section-label">RECENT EVENTS</div>
                        <div className="diplomacy-log">
                          {diplomacyLog.map((msg, i) => (
                            <div key={i} className="diplomacy-log-entry">{msg}</div>
                          ))}
                        </div>
                      </>
                    )}

                    {/* Global diplomacy history from DiplomacyManager */}
                    {(() => {
                      const events: Array<{ type: string; fromCivId: number; toCivId: number; goldAmount?: number; details?: string }> = dm?.getEventLog?.() ?? [];
                      const relevant = events.filter(
                        (e) => e.fromCivId === selectedDiploCiv || e.toCivId === selectedDiploCiv
                          || e.fromCivId === playerId || e.toCivId === playerId
                      ).slice(0, 8);
                      if (relevant.length === 0) return null;
                      return (
                        <>
                          <div className="diplomacy-section-label">HISTORY</div>
                          <div className="diplomacy-log">
                            {relevant.map((e, i: number) => {
                              const from = civilizations[e.fromCivId]?.name ?? `Civ ${e.fromCivId}`;
                              const to = civilizations[e.toCivId]?.name ?? `Civ ${e.toCivId}`;
                              const labels: Record<string, string> = {
                                war_declared: `⚔️ ${from} declared war on ${to}`,
                                peace_made: `🕊️ Peace between ${from} and ${to}`,
                                ceasefire_signed: `🏳️ Ceasefire between ${from} and ${to}`,
                                alliance_formed: `🤝 Alliance between ${from} and ${to}`,
                                alliance_broken: `💔 ${from} broke the alliance with ${to}`,
                                tribute_paid: `💰 ${from} paid tribute to ${to}${e.goldAmount ? ` (${e.goldAmount}g)` : ''}`,
                                treaty_rejected: `❌ ${to} rejected ${from}'s proposal`,
                                unit_bribed: `🎭 ${from} bribed a unit`,
                                intelligence_gathered: `🔍 ${from} spied on ${to}`,
                                open_borders_signed: `🚪 Open borders: ${from} ↔ ${to}`,
                                trade_agreement_signed: `📦 Trade deal: ${from} ↔ ${to}`,
                                mutual_defense_signed: `🛡️ Defense pact: ${from} ↔ ${to}`,
                                non_aggression_signed: `🤚 Non-aggression: ${from} ↔ ${to}`,
                                embargo_declared: `🚫 Embargo declared by ${from} & ${to}`,
                                treaty_cancelled: `📜 Treaty cancelled by ${from}`,
                                tech_exchanged: `🔬 Tech exchange: ${from} ↔ ${to}`,
                                counter_proposal: `📜 Counter-proposal from ${from}`,
                              };
                              return (
                                <div key={i} className="diplomacy-log-entry">
                                  {labels[e.type] ?? `${e.type}: ${e.details ?? ''}`}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                  </>
                ) : (
                  <div className="diplomacy-placeholder">
                    <div className="diplomacy-placeholder-scene">
                      <div className="diplomacy-placeholder-icon">⚖️</div>
                      <div>Select a civilization to begin negotiations.</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </Modal.Body>
      </Modal>
    );
  };

  // Diplomacy Report — read-only overview of current diplomatic state (Civ I Foreign Advisor style)
  const renderDiplomacyReport = (): React.ReactNode => {
    const dm = gameEngine?.diplomacyManager;
    const playerId = currentPlayer?.id ?? 0;
    const otherCivs = civilizations.filter((c: Civilization) => c.id !== playerId && c.isAlive !== false);

    const STATUS_ICONS: Record<string, string> = {
      peace: '🕊️',
      war: '⚔️',
      ceasefire: '🏳️',
      alliance: '🤝',
    };

    const ATTITUDE_LABELS: Record<string, { label: string; color: string }> = {
      friendly: { label: 'Friendly', color: '#4caf50' },
      neutral: { label: 'Neutral', color: '#9e9e9e' },
      annoyed: { label: 'Annoyed', color: '#ff9800' },
      hostile: { label: 'Hostile', color: '#f44336' },
    };

    const TREATY_LABELS: Record<string, { icon: string; label: string }> = {
      open_borders: { icon: '🚪', label: 'Open Borders' },
      trade_agreement: { icon: '📦', label: 'Trade Agreement' },
      mutual_defense: { icon: '🛡️', label: 'Mutual Defense' },
      non_aggression: { icon: '🤚', label: 'Non-Aggression' },
      embargo_target: { icon: '🚫', label: 'Embargo' },
    };

    return (
      <Modal
        show={uiState.activeDialog === 'diplomacy-report'}
        onHide={handleCloseDialog}
        centered
        size="lg"
        fullscreen="lg-down"
        dialogClassName="diplomacy-modal"
      >
        <Modal.Header closeButton className="diplomacy-header">
          <Modal.Title>Diplomacy Report</Modal.Title>
        </Modal.Header>
        <Modal.Body className="diplomacy-body">
          <div className="diplomacy-report-actions">
            <button
              className="diplomacy-btn btn-peace"
              onClick={() => actions.openDiplomacy(null)}
              title="Open the full negotiation screen for this civilization"
            >
              ⚖️ Open Negotiations
            </button>
          </div>
          {otherCivs.length === 0 ? (
            <p className="text-muted text-center py-4">No other civilizations discovered yet.</p>
          ) : (
            <div className="diplomacy-report-list">
              {otherCivs.map((civ: Civilization) => {
                const status = dm?.getStatus(playerId, civ.id) ?? 'peace';
                const attitude = dm?.getAttitude(playerId, civ.id) ?? 'neutral';
                const relation = dm?.getRelation?.(playerId, civ.id);
                const treaties: string[] = dm?.getActiveTreaties?.(playerId, civ.id) ?? [];
                const attLabel = ATTITUDE_LABELS[attitude] || ATTITUDE_LABELS.neutral;
                const leaderName = civ.leader || civ.leaderName || '';
                const portraitConfig = LEADER_PORTRAITS[leaderName] || null;

                return (
                  <div key={civ.id} className="diplomacy-report-row" style={{ borderLeftColor: civ.color || '#555' }}>
                    <div className="diplomacy-report-portrait">
                      {portraitConfig ? (
                        <LeaderPortrait config={portraitConfig} mood={attitude as 'friendly' | 'neutral' | 'annoyed' | 'hostile'} size={60} leaderName={leaderName} />
                      ) : (
                        <span className="diplomacy-report-icon" style={{ color: civ.color || '#fff' }}>
                          {civ.icon || '👤'}
                        </span>
                      )}
                    </div>
                    <div className="diplomacy-report-info">
                      <div className="diplomacy-report-name">
                        {civ.name}
                        {leaderName && <span className="diplomacy-report-leader"> — {leaderName}</span>}
                      </div>
                      <div className="diplomacy-report-status-row">
                        <span className={`diplomacy-report-status status-${status}`}>
                          {STATUS_ICONS[status]} {status.charAt(0).toUpperCase() + status.slice(1)}
                        </span>
                        <span className="diplomacy-report-attitude" style={{ color: attLabel.color }}>
                          {attLabel.label}
                        </span>
                        {relation && (
                          <span className="diplomacy-report-rep" style={{ color: relation.reputationModifier < 0 ? '#f44336' : relation.reputationModifier > 0 ? '#4caf50' : '#9e9e9e' }}>
                            Rep: {relation.reputationModifier > 0 ? '+' : ''}{relation.reputationModifier}
                          </span>
                        )}
                      </div>
                      {treaties.length > 0 && (
                        <div className="diplomacy-report-treaties">
                          {treaties.map((t: string) => (
                            <span key={t} className="diplomacy-treaty-badge">
                              {TREATY_LABELS[t]?.icon || '📜'} {TREATY_LABELS[t]?.label || t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Global diplomacy history */}
              {(() => {
                const events: Array<{ type: string; fromCivId: number; toCivId: number; goldAmount?: number; details?: string }> = dm?.getEventLog?.() ?? [];
                const recent = events.slice(0, 12);
                if (recent.length === 0) return null;
                return (
                  <>
                    <div className="diplomacy-section-label" style={{ marginTop: '16px' }}>RECENT HISTORY</div>
                    <div className="diplomacy-log">
                      {recent.map((e, i: number) => {
                        const from = civilizations[e.fromCivId]?.name ?? `Civ ${e.fromCivId}`;
                        const to = civilizations[e.toCivId]?.name ?? `Civ ${e.toCivId}`;
                        const labels: Record<string, string> = {
                          war_declared: `⚔️ ${from} declared war on ${to}`,
                          peace_made: `🕊️ Peace between ${from} and ${to}`,
                          ceasefire_signed: `🏳️ Ceasefire between ${from} and ${to}`,
                          alliance_formed: `🤝 Alliance between ${from} and ${to}`,
                          alliance_broken: `💔 ${from} broke the alliance with ${to}`,
                          tribute_paid: `💰 ${from} paid tribute to ${to}${e.goldAmount ? ` (${e.goldAmount}g)` : ''}`,
                          treaty_rejected: `❌ ${to} rejected ${from}'s proposal`,
                          open_borders_signed: `🚪 Open borders: ${from} ↔ ${to}`,
                          trade_agreement_signed: `📦 Trade deal: ${from} ↔ ${to}`,
                          mutual_defense_signed: `🛡️ Defense pact: ${from} ↔ ${to}`,
                          non_aggression_signed: `🤚 Non-aggression: ${from} ↔ ${to}`,
                          embargo_declared: `🚫 Embargo declared by ${from} & ${to}`,
                          treaty_cancelled: `📜 Treaty cancelled by ${from}`,
                        };
                        return (
                          <div key={i} className="diplomacy-log-entry">
                            {labels[e.type] ?? `${e.type}: ${e.details ?? ''}`}
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </Modal.Body>
      </Modal>
    );
  };

  // Help Modal
  const renderHelp = () => (
    <Modal 
      show={uiState.activeDialog === 'help'} 
      onHide={handleCloseDialog} 
      centered
      size="lg"
    >
      <Modal.Header closeButton className="bg-dark text-white">
        <Modal.Title>
          <i className="bi bi-question-circle"></i> Help & Controls
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="bg-dark text-white city-detail-modal-body">
        <Tabs defaultActiveKey="controls" className="mb-3">
          <Tab eventKey="controls" title="Controls">
            <h6>Mouse Controls:</h6>
            <ListGroup variant="flush" className="mb-3">
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Left Click:</strong> Select units, cities, or tiles
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Right Click:</strong> Unit context menu
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Drag:</strong> Pan the camera around the map
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Scroll Wheel:</strong> Zoom in and out
              </ListGroup.Item>
            </ListGroup>

            <h6>Unit Actions (when unit selected):</h6>
            <ListGroup variant="flush" className="mb-3">
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>S:</strong> Skip unit's turn
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>F:</strong> Fortify unit
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>W:</strong> Wait (move unit to end of queue)
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>G:</strong> Go To (click destination)
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>B:</strong> Build road
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>I:</strong> Irrigate
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>M:</strong> Build mine
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>P:</strong> Clean pollution
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Space:</strong> Cycle units on same tile
              </ListGroup.Item>
            </ListGroup>

            <h6>Global Shortcuts:</h6>
            <ListGroup variant="flush" className="mb-3">
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Enter:</strong> End turn
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>D:</strong> Diplomacy report
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>R:</strong> Rush city production (when city selected)
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>C:</strong> Center map on selected unit
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>T:</strong> Open settings
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Escape:</strong> Close dialogs / deselect
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>+/−:</strong> Zoom in / out
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Arrow Keys:</strong> Move unit / Shift+Arrow: Scroll map
              </ListGroup.Item>
            </ListGroup>

            <h6>Function Keys:</h6>
            <ListGroup variant="flush" className="mb-3">
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>F1:</strong> Help
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>F2:</strong> Tech Tree
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>F3:</strong> Settings
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>F4:</strong> Diplomacy report
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>F11:</strong> Toggle fullscreen
              </ListGroup.Item>
            </ListGroup>

            <h6>Ctrl Shortcuts:</h6>
            <ListGroup variant="flush">
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Ctrl+S:</strong> Save game
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Ctrl+L:</strong> Load game
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Ctrl+1–9:</strong> Select city by number
              </ListGroup.Item>
            </ListGroup>
          </Tab>
          
          <Tab eventKey="orders" title="Orders Menu">
            <h6>Tile Improvements (via ORDERS menu):</h6>
            <ListGroup variant="flush">
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Build City:</strong> Settler founds a new city
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Build Road:</strong> +1 trade on grassland/plains/desert, 1/3 movement (1 turn)
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Irrigate:</strong> +1 food on grassland/plains/desert; converts jungle/swamp to grassland (2 turns)
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Mine:</strong> +1 production on mountains, +3 on hills; converts jungle/swamp to forest, clears forest to plains (5 turns)
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Fortify:</strong> Defensive bonus for military units
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Railroad:</strong> Upgrades road — +0.5 food/prod/trade, free movement (requires Railroad tech)
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Clean Pollution:</strong> Removes pollution from tile (2 turns)
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Fortress:</strong> +100% defense, applied last (6 turns, requires Construction tech)
              </ListGroup.Item>
            </ListGroup>
          </Tab>

          <Tab eventKey="gameplay" title="Gameplay">
            <h6>Getting Started:</h6>
            <ol>
              <li>Move your settler to a good location near water and resources</li>
              <li>Found your first city by selecting the settler and clicking "Found City"</li>
              <li>Explore with your warrior to find other civilizations and resources</li>
              <li>Build more units and buildings in your cities</li>
              <li>Research technologies to unlock new capabilities</li>
              <li>Expand your civilization and compete with others!</li>
            </ol>

            <h6>Resources:</h6>
            <ul>
              <li><strong>Food:</strong> Grows city population</li>
              <li><strong>Production:</strong> Builds units and structures</li>
              <li><strong>Trade:</strong> Generates gold and science</li>
              <li><strong>Science:</strong> Researches new technologies</li>
              <li><strong>Gold:</strong> Maintains units and buildings</li>
            </ul>

            <h6>Diplomacy:</h6>
            <ul>
              <li>Press <strong>D</strong> or <strong>F4</strong> to view diplomatic relations</li>
              <li>Diplomatic talks are initiated through in-game events (contact with foreign units)</li>
              <li>States: Peace, Ceasefire, Alliance, War</li>
              <li>Treaties: Open Borders, Trade Agreement, Mutual Defense, Non-Aggression</li>
              <li>Breaking treaties damages your reputation with all civilizations</li>
            </ul>
          </Tab>
          
          <Tab eventKey="about" title="About">
            <h5>Civilization Browser</h5>
            <p>A browser-based recreation inspired by the classic Civilization (1991).</p>
            
            <h6>Features:</h6>
            <ul>
              <li>Square grid map with fog of war</li>
              <li>Turn-based gameplay with AI opponents</li>
              <li>City building, management, and production</li>
              <li>Unit movement, combat, and fortification</li>
              <li>Technology research tree</li>
              <li>Diplomacy system with treaties and negotiations</li>
              <li>Tile improvements (roads, irrigation, mines, and more)</li>
              <li>Save and load game support</li>
            </ul>

            <p className="mt-3">
              <small className="text-muted">
                Fan-made recreation for educational purposes.
                Original Civilization © MicroProse/Firaxis Games
              </small>
            </p>
          </Tab>
        </Tabs>
      </Modal.Body>
    </Modal>
  );

  // handleStartProduction removed (unused)

  // handleQueueProduction removed (unused)

  // New: track a single selected production item for the select box
  const [selectedProductionKey, setSelectedProductionKey] = useState<string | null>(null);
  // Track selected index in the queue (for removal)
  const [selectedQueueIndex, setSelectedQueueIndex] = useState<number | null>(null);

  // Helper function to check if a city is coastal (has water tiles adjacent or on its position)
  const checkIfCityIsCoastal = useCallback((city: City | null | undefined, gameEngine: GameEngine | null | undefined): boolean => {
    if (!gameEngine || !city) return false;
    
    const directions = [
      { col: 0, row: 0 }, // city tile itself
      { col: -1, row: -1 }, { col: 0, row: -1 }, { col: 1, row: -1 },
      { col: -1, row: 0 }, { col: 1, row: 0 },
      { col: -1, row: 1 }, { col: 0, row: 1 }, { col: 1, row: 1 }
    ];
    
    for (const dir of directions) {
      const tile = gameEngine.getTileAt(city.col + dir.col, city.row + dir.row);
      if (tile && tile.terrain === 'ocean') {
        return true;
      }
    }
    return false;
  }, []);

  // Build available items list (filtered) using same logic as render list
  const availableProductionKeys = useMemo(() => {
    return Object.keys(UNIT_PROPS).filter((key) => {
      const u = UNIT_PROPS[key];
      const req = (u as { requires?: string | string[] }).requires || null;
      if (req && currentPlayer && Array.isArray(currentPlayer.technologies)) {
        // Handle both single requirement and array of requirements
        const requirements = Array.isArray(req) ? req : [req];
        const hasAllRequiredTechs = requirements.every((tech: string) => currentPlayer.technologies.includes(tech));
        if (!hasAllRequiredTechs) return false;
      }

      if (u.naval && selectedCity) {
        // Check if city has harbor or is coastal (tile or adjacent tiles are water)
        const hasHarbor = selectedCity.buildings && selectedCity.buildings.includes('harbor');
        if (!hasHarbor) {
          const isCoastal = checkIfCityIsCoastal(selectedCity, gameEngine);
          if (!isCoastal) return false;
        }
      }

      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPlayer, selectedCity, checkIfCityIsCoastal]);

  // Ensure there is a default selection when modal opens or available list changes
  useEffect(() => {
    if (!selectedProductionKey && availableProductionKeys && availableProductionKeys.length > 0) {
      setSelectedProductionKey(availableProductionKeys[0]);
    }
    // Clear selection if nothing available
    if (availableProductionKeys.length === 0) setSelectedProductionKey(null);
    // Log available production options for debugging
    // console.log('[GameModals] availableProductionKeys', availableProductionKeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableProductionKeys]);

  // Reset queue selection when the selected city changes
  useEffect(() => {
    setSelectedQueueIndex(null);
    if (selectedCity) console.log('[GameModals] selectedCity changed', { id: selectedCity.id, name: selectedCity.name, buildQueue: selectedCity.buildQueue });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCityId]);

  // Keep the build queue scrolled to its bottom so a freshly added item is
  // always visible without manual scrolling.
  const productionQueueBoxRef = useRef<HTMLDivElement | null>(null);
  const productionQueueLength = selectedCity?.buildQueue?.length ?? 0;
  useEffect(() => {
    const el = productionQueueBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [productionQueueLength]);

  /**
   * Send the item picked in the Production dropdown to the engine.
   * `queue = true` appends ONE entry for it to the bottom of the build queue;
   * the current production is never touched (picking from the dropdown only
   * chooses the item). Failures (missing tech, duplicate building, …) are
   * reported instead of silently doing nothing.
   */
  const submitProduction = (itemKey?: string): void => {
    const key = itemKey ?? selectedProductionKey;
    if (!selectedCity || !key || !gameEngine) return;
    const unitDef = UNIT_PROPS[key];
    if (!unitDef) return;
    const item = { type: 'unit', itemType: key, name: unitDef.name, cost: unitDef.cost };
    const engine = gameEngine as GameEngine & { setCityProduction?: (cityId: string, item: Record<string, unknown>, queue: boolean) => { success?: boolean; reason?: string } | null };
    let result: { success?: boolean; reason?: string } | null = null;
    try {
      if (typeof engine.setCityProduction === 'function') result = engine.setCityProduction(selectedCity.id, item, true);
    } catch (e) {
      console.error('[GameModals] submitProduction: setCityProduction exception', e);
    }
    if (typeof gameEngine.getAllCities === 'function') actions.updateCities(gameEngine.getAllCities());
    // setCityProduction answers with a result object even on failure — reading
    // its truthiness reported bogus successes.
    if (result && result.success !== false) {
      actions.addNotification({ type: 'info', message: `Added to queue: ${item.name}` });
    } else {
      actions.addNotification({ type: 'warning', message: `Cannot queue ${item.name}: ${productionFailureText(result?.reason)}` });
    }
  };

  const renderCityProduction = () => (
    <Modal
      show={uiState.activeDialog === 'city-production'}
      onHide={handleCloseDialog}
      centered
      size="lg"
      dialogClassName="city-production-modal"
    >
      <Modal.Header closeButton className="bg-dark text-white">
        <Modal.Title>
          <i className="bi bi-gear"></i> {selectedCity?.name || 'City Production'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="bg-dark text-white">
        <div className="row">
          <div className="col-md-12 mb-2">
            <p>Select a unit to produce in this city. Production cost is shown in shields.</p>
          </div>
        </div>
        {renderProductionContent()}
      </Modal.Body>
    </Modal>
  );

  // Reusable production list content (used both in modal and city details tab)
  // Render production summary: current production and queued items
  const renderProductionContent = () => {
    if (!selectedCity) {
      return <div>No city selected</div>;
    }

    const productionPerTurn = getProductionPerTurn(selectedCity);
    // Always use productionStored for current production progress
    const productionProgressValue = typeof selectedCity.productionStored === 'number'
      ? selectedCity.productionStored
      : 0;
    const currentProductionItem = selectedCity.currentProduction;
    const currentProductionCost = getProductionCost(currentProductionItem);
    const currentProductionName = getProductionName(currentProductionItem);
    const clampedProgress = currentProductionCost > 0
      ? Math.min(Math.max(productionProgressValue, 0), currentProductionCost)
      : Math.max(productionProgressValue, 0);
    const progressPercent = currentProductionCost > 0
      ? Math.min(100, Math.round((clampedProgress / currentProductionCost) * 100))
      : 0;
    const remainingShields = currentProductionCost > 0
      ? Math.max(0, currentProductionCost - productionProgressValue)
      : 0;
    const turnsRemaining = currentProductionItem && currentProductionCost > 0 && productionPerTurn > 0
      ? Math.max(0, Math.ceil(remainingShields / productionPerTurn))
      : null;
    const formatTurns = (value: number | null) => {
      if (value === null) return '—';
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
      return value;
    };
    const hasQueueItems = Array.isArray(selectedCity.buildQueue) && selectedCity.buildQueue.length > 0;

    return (
      <div>
        <div className="mb-3">
          <h6>Current Production</h6>
          {currentProductionItem ? (
            <div className="text-white p-2 rounded">
              <strong>{currentProductionName}</strong>
              <div className="small text-muted">
                {currentProductionCost > 0
                  ? `Progress: ${Math.round(clampedProgress)} / ${currentProductionCost} (${progressPercent}%)`
                  : `Progress: ${Math.round(clampedProgress)} shields`}
              </div>
              <div className="small text-muted">
                Production per turn: {productionPerTurn}
              </div>
              <div className="small text-muted">
                Turns remaining: {formatTurns(turnsRemaining)}
              </div>
            </div>
          ) : (
            <div className="text-muted">No active production</div>
          )}
        </div>

        <div className="production-queue-layout">
          {/* Production panel: selector + add-to-queue */}
          <div className="production-panel">
            <h6>Production</h6>
            <select
              className="form-select form-select-sm mb-2 production-select"
              value={selectedProductionKey ?? ''}
              // Picking an item only CHOOSES it — "Add" below appends it to the
              // queue. The current production is never replaced from here.
              onChange={(e) => setSelectedProductionKey(e.target.value)}
              disabled={!isPlayerCity}
              title="Choose the unit to add to the build queue"
            >
              <option value="" disabled>Select production…</option>
              {availableProductionKeys.map(key => {
                const unit = UNIT_PROPS[key];
                return (
                  <option key={key} value={key}>
                    {unit.name} ({unit.cost} shields)
                  </option>
                );
              })}
            </select>
            <div className="production-btn-row">
              <Button
                className="production-add-btn"
                variant="secondary"
                disabled={!selectedProductionKey || !gameEngine || !selectedCity || !isPlayerCity}
                onClick={() => submitProduction()}
                title="Append one entry to the bottom of the build queue"
              >
                <i className="bi bi-plus-lg me-1"></i> Add
              </Button>
            </div>
          </div>

          {/* Queue panel: items with move up/down/remove */}
          <div className="queue-panel">
            <h6>Queue</h6>
            <div className="queue-box bg-dark border border-secondary rounded p-2" ref={productionQueueBoxRef} style={{maxHeight: '240px', overflowY: 'auto'}}>
              {hasQueueItems ? (
                selectedCity.buildQueue.map((q: { name?: string; type?: string; itemType?: string; cost?: number }, i: number) => {
                  const queueItemName = getProductionName(q);
                  const queueItemCost = getProductionCost(q);
                  const queueTurns = productionPerTurn > 0 && queueItemCost > 0
                    ? Math.max(0, Math.ceil(queueItemCost / productionPerTurn))
                    : null;

                  return (
                    <div
                      key={i}
                      className={`queue-item p-2 mb-1 rounded ${selectedQueueIndex === i ? 'text-white' : 'text-white'}`}
                      onClick={() => setSelectedQueueIndex(i)}
                    >
                      <div className="d-flex justify-content-between align-items-center gap-2">
                        <div className="flex-grow-1">
                          <div><strong>{queueItemName}</strong></div>
                          <div className="small">#{i + 1} in queue · {queueItemCost > 0 ? `${queueItemCost} shields` : '—'}</div>
                          <div className="small text-muted">Turns: {formatTurns(queueTurns)}</div>
                        </div>
                        <div className="queue-item-actions">
                          <button
                            type="button"
                            className="btn btn-outline-light btn-sm queue-action-btn"
                            title="Move up in queue"
                            disabled={i === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              const queue = [...selectedCity.buildQueue];
                              [queue[i - 1], queue[i]] = [queue[i], queue[i - 1]];
                              if (gameEngine && typeof (gameEngine as GameEngine & { setCityQueue?: (cityId: string, queue: unknown[]) => void }).setCityQueue === 'function') {
                                (gameEngine as GameEngine & { setCityQueue: (cityId: string, queue: unknown[]) => void }).setCityQueue(selectedCity.id, queue);
                              } else {
                                selectedCity.buildQueue = queue;
                              }
                              actions.updateCities(cities.map(c => c.id === selectedCity.id ? {...c, buildQueue: queue} : c));
                              setSelectedQueueIndex(i - 1);
                            }}
                          >
                            <i className="bi bi-arrow-up"></i>
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-light btn-sm queue-action-btn"
                            title="Move down in queue"
                            disabled={i === selectedCity.buildQueue.length - 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              const queue = [...selectedCity.buildQueue];
                              [queue[i + 1], queue[i]] = [queue[i], queue[i + 1]];
                              if (gameEngine && typeof (gameEngine as GameEngine & { setCityQueue?: (cityId: string, queue: unknown[]) => void }).setCityQueue === 'function') {
                                (gameEngine as GameEngine & { setCityQueue: (cityId: string, queue: unknown[]) => void }).setCityQueue(selectedCity.id, queue);
                              } else {
                                selectedCity.buildQueue = queue;
                              }
                              actions.updateCities(cities.map(c => c.id === selectedCity.id ? {...c, buildQueue: queue} : c));
                              setSelectedQueueIndex(i + 1);
                            }}
                          >
                            <i className="bi bi-arrow-down"></i>
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-danger btn-sm queue-action-btn"
                            title="Remove from queue"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!gameEngine) return;
                              const engine = gameEngine as GameEngine & { removeCityQueueItem?: (cityId: string, index: number) => { success?: boolean; removed?: { name?: string }; reason?: string } | null };
                              if (typeof engine.removeCityQueueItem !== 'function') return;
                              const res = engine.removeCityQueueItem(selectedCity.id, i);
                              if (res && res.success) {
                                if (typeof gameEngine.getAllCities === 'function') actions.updateCities(gameEngine.getAllCities());
                                setSelectedQueueIndex(null);
                              } else {
                                actions.addNotification({ type: 'warning', message: `Failed to remove: ${res?.reason || 'unknown'}` });
                              }
                            }}
                          >
                            <i className="bi bi-trash"></i>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-white">Queue is empty</div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // City Purchase Modal (Buy Now)
  const handleBuyNow = (unitKey: string) => {
    if (!selectedCity) return;
    const unitDef = UNIT_PROPS[unitKey];
    if (!unitDef) return;

    const item = { type: 'unit', itemType: unitKey, name: unitDef.name, cost: unitDef.cost };
    const engine = gameEngine as GameEngine & { purchaseCityProduction?: (cityId: string, item: Record<string, unknown>, civId?: number) => { success?: boolean; reason?: string } | null };
    if (gameEngine && typeof engine.purchaseCityProduction === 'function') {
      const res = engine.purchaseCityProduction(selectedCity.id, item);
      if (res && res.success) {
        actions.addNotification({ type: 'success', message: `Purchased ${item.name}` });
        actions.updateCities(gameEngine.getAllCities());
        actions.updateUnits(gameEngine.getAllUnits());
      } else {
        actions.addNotification({ type: 'warning', message: `Purchase failed: ${res?.reason || 'unknown'}` });
      }
    }

    actions.hideDialog();
  };

  const renderCityPurchase = () => (
    <Modal
      show={uiState.activeDialog === 'city-purchase'}
      onHide={handleCloseDialog}
      centered
      size="lg"
      dialogClassName="city-purchase-modal"
    >
      <Modal.Header closeButton className="bg-dark text-white">
        <Modal.Title>
          <i className="bi bi-cart"></i> Purchase in {selectedCity?.name || 'City'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="bg-dark text-white">
        <div className="mb-2">Your gold: {currentPlayer?.resources?.gold ?? 0}</div>
        {renderPurchaseContent()}
      </Modal.Body>
    </Modal>
  );

  // Reusable purchase list content (used in purchase modal and city details tab)
  const renderPurchaseContent = () => (
    <div>
      <div className="mb-2">Your gold: {currentPlayer?.resources?.gold ?? 0}</div>
      <div className="row">
        {Object.keys(UNIT_PROPS).filter(k => {
          const u = UNIT_PROPS[k];
          const req = (u as { requires?: string }).requires || null;
          if (req && currentPlayer && Array.isArray(currentPlayer.technologies)) {
            if (!currentPlayer.technologies.includes(req)) return false;
          }
          return true;
        }).map(k => {
          const u = UNIT_PROPS[k];
          return (
            <div key={k} className="col-12 col-sm-6 col-md-4 mb-2">
              <Card className="bg-secondary text-white h-100">
                <Card.Body className="d-flex justify-content-between align-items-center">
                  <div>
                    <div className="h6 mb-0">{u.name} <small className="text-muted">({u.type})</small></div>
                    <small className="text-muted">Cost: {u.cost} gold</small>
                  </div>
                  <div>
                    <Button size="sm" variant="success" onClick={() => handleBuyNow(k)} disabled={(currentPlayer?.resources?.gold || 0) < u.cost}>
                      Buy Now
                    </Button>
                  </div>
                </Card.Body>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );

  // Upkeep-disbanded notice: a unit was scrapped because the treasury could
  // not cover its upkeep. Inform the player and point at how to balance the
  // budget.
  const renderUpkeepDisbanded = () => (
    <Modal
      show={uiState.activeDialog === 'upkeep-disbanded'}
      onHide={handleCloseDialog}
      centered
      size="lg"
    >
      <Modal.Header closeButton className="bg-dark text-white">
        <Modal.Title>
          <i className="bi bi-exclamation-triangle-fill text-warning"></i> Unit disbanded — upkeep not covered
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="bg-dark text-white">
        <p className="mb-2">
          <strong>{disbandNotice ? disbandNotice.unitName : 'A unit'}</strong> was disbanded because
          your treasury could not pay its upkeep (gold ran out).
        </p>
        <p className="mb-1"><strong>To balance your budget you can:</strong></p>
        <ul className="mb-0">
          <li>Raise the <strong>tax rate</strong> (📊 Rates) to earn more gold per turn.</li>
          <li>Lower <strong>luxury</strong> spending — keep only what your cities need to avoid disorder.</li>
          <li>Disband units you don't need: right-click a unit → <em>Disband</em>.</li>
          <li>Build <strong>Marketplace</strong> / <strong>Bank</strong> in your cities for more trade &amp; gold.</li>
          <li>Build fewer expensive units — each unit costs upkeep every turn.</li>
        </ul>
      </Modal.Body>
      <Modal.Footer className="bg-dark">
        <Button variant="outline-warning" onClick={() => actions.showDialog('rates')}>
          <i className="bi bi-graph-up"></i> Open Rates
        </Button>
        <Button variant="primary" onClick={handleCloseDialog}>OK</Button>
      </Modal.Footer>
    </Modal>
  );

  // Trade-route result: a Caravan delivered — lump-sum gold + science now,
  // plus a permanent per-turn route between the two cities.
  const renderTradeRouteResult = () => (
    <Modal
      show={uiState.activeDialog === 'trade-route-result'}
      onHide={handleCloseDialog}
      centered
      size="lg"
    >
      <Modal.Header closeButton className="bg-dark text-white">
        <Modal.Title>
          <i className="bi bi-arrow-left-right text-success"></i> Trade Route Established
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="bg-dark text-white">
        {tradeRouteResult ? (
          <>
            <p className="mb-2">
              Your Caravan delivered to <strong>{tradeRouteResult.destCityName}</strong> from{' '}
              {tradeRouteResult.homeCityName} ({tradeRouteResult.distance} tiles away).
            </p>
            <div className="mb-2 fs-5">
              <span className="text-warning me-4">🪙 +{tradeRouteResult.gold} Gold</span>
              <span className="text-info">🔬 +{tradeRouteResult.science} Science</span>
            </div>
            {tradeRouteResult.foreign && (
              <div className="text-success"><small>Foreign city — bonus doubled.</small></div>
            )}
            {tradeRouteResult.intercontinental && (
              <div className="text-info"><small>Intercontinental (across water) — bonus doubled.</small></div>
            )}
            <p className="mb-0 mt-2 text-muted">
              <small>Both cities now share a permanent trade route, adding trade every turn (up to 3 routes per city; a better route replaces a weaker one).</small>
            </p>
          </>
        ) : (
          <p>Your Caravan established a trade route!</p>
        )}
      </Modal.Body>
      <Modal.Footer className="bg-dark">
        <Button variant="primary" onClick={handleCloseDialog}>OK</Button>
      </Modal.Footer>
    </Modal>
  );

  return (
    <>
      {renderGameMenu()}
      {renderTechTree()}
      <ResearchRequiredModal
        show={uiState.activeDialog === 'research-required'}
        onHide={handleCloseDialog}
        onChooseResearch={() => actions.showDialog('tech')}
      />
      {renderResearchComplete()}
      {renderDiplomacy()}
      {renderDiplomacyReport()}
      {renderHelp()}
      <CityModal show={uiState.activeDialog === 'city-details'} onHide={handleCloseDialog} selectedCity={selectedCity} gameEngine={gameEngine} actions={actions} currentPlayer={currentPlayer} isPlayerCity={isPlayerCity} />
      <HexDetailModal show={uiState.activeDialog === 'hex-details'} onHide={handleCloseDialog} selectedHex={selectedHex} map={map} units={units} cities={cities} />
      <RatesModal show={uiState.activeDialog === 'rates'} onHide={handleCloseDialog} gameEngine={gameEngine} />
      <GovernmentModal show={uiState.activeDialog === 'government'} onHide={handleCloseDialog} gameEngine={gameEngine} />
      <StatisticsModal show={uiState.activeDialog === 'statistics'} onHide={handleCloseDialog} />
      <VillageModal show={uiState.activeDialog === 'village'} onHide={handleVillageClose} />
      {renderUpkeepDisbanded()}
      {renderTradeRouteResult()}
      {renderCityProduction()}
      {renderCityPurchase()}
    </>
  );
};

export default GameModals;
