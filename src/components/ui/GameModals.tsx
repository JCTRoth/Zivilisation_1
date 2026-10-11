import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Modal, Button, Tab, Tabs, ListGroup, Form } from 'react-bootstrap';
import TechTreeView from './TechTreeView';
import { getTechIcon } from '@/data/TechnologyIcons';
import { findPathToTech, firstResearchableInPath } from '@/utils/ResearchPath';
import CityModal from './gamemodals/CityModal';
import RatesModal from './gamemodals/RatesModal';
import GovernmentModal from './gamemodals/GovernmentModal';
import StatisticsModal from './gamemodals/StatisticsModal';
import WonderCompletedModal from './gamemodals/WonderCompletedModal';
import WonderConflictModal from './gamemodals/WonderConflictModal';
import WondersOverviewModal from './gamemodals/WondersOverview';
import VillageModal from './gamemodals/VillageModal';
import CombatReportModal from './gamemodals/CombatReportModal';
import CityEventModal from './gamemodals/CityEventModal';
import ResearchRequiredModal from './ResearchRequiredModal';
import GameModal from './gamemodals/ModalShell';
import { useGameStore } from '@/stores/GameStore';
import { AUTO_END_TURN_OFFER_FLAG } from '@/data/GameConstants';
import { UNIT_PROPS } from '@/utils/Constants';
import { BUILDING_PROPERTIES } from '@/data/BuildingConstants';
import { productionFailureText } from '@/utils/ProductionUtils';
import { sendCommand, isCommandRejection } from '@/utils/session';
import { notify } from '@/utils/NotificationUtils';
import { GameUtils } from '@/utils/GameUtils';
import '../../styles/gameModals.css';
import '../../styles/diplomacyModal.css';
import LeaderPortrait from './LeaderPortrait';
import { LEADER_PORTRAITS, MOOD_COLORS } from '@/data/LeaderPortraits';
import type { City, Civilization } from '../../../types/game';
import GameEngine from '@/game/engine/GameEngine';
import type { DiplomatAction, TreatyType } from '@/game/engine/DiplomacyTypes';
import { attitudeFromScore } from '@/game/engine/DiplomacyTypes';

const GameModals = ({ gameEngine }: { gameEngine?: GameEngine | null }) => {
  // console.log('[GameModals] Component rendering, gameEngine present:', !!gameEngine);
  const uiState = useGameStore(state => state.uiState);
  const actions = useGameStore(state => state.actions);
  const settings = useGameStore(state => state.settings);
  const selectedCityId: string | null = useGameStore(state => state.gameState.selectedCity);
  const cities = useGameStore(state => state.cities);
  const technologies = useGameStore(state => state.technologies);
  const researchPath = useGameStore(state => state.researchPath);
  const techProgress = useGameStore(state => state.techProgress);
  const lastResearchedTech = useGameStore(state => state.lastResearchedTech);
  const currentPlayer = useGameStore(state => state.civilizations[state.gameState.activePlayer] || null);

  const gameState = useGameStore(state => state.gameState);

  /** Shared eyebrow stamp: "Germans · Turn 12 · 3960 BC". */
  const stamp = (prefix: string) =>
    `${prefix} · Turn ${gameState.currentTurn ?? 1} · ${GameUtils.formatYear(gameState.currentYear ?? -4000)}`;

  /** Just the turn/year part, for modals that carry their own eyebrow prefix. */
  const turnStamp = () =>
    `Turn ${gameState.currentTurn ?? 1} · ${GameUtils.formatYear(gameState.currentYear ?? -4000)}`;

  const civilizations = useGameStore(state => state.civilizations);
  const incomingDiplomacyOffer = useGameStore(state => state.incomingDiplomacyOffer);
  const diplomacyFocusCivId = useGameStore(state => state.diplomacyFocusCivId);
  const disbandNotice = useGameStore(state => state.disbandNotice);
  const starvationNotice = useGameStore(state => state.starvationNotice);
  const disorderNotice = useGameStore(state => state.disorderNotice);
  const tradeRouteResult = useGameStore(state => state.tradeRouteResult);
  const wonderDialogQueue = useGameStore(state => state.wonderDialogQueue);
  const combatReportQueue = useGameStore(state => state.combatReportQueue);
  const cityEventQueue = useGameStore(state => state.cityEventQueue);
  const map = useGameStore(state => state.map);

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
  const NON_BLOCKING_DIALOGS = ['help', 'tech'];

  const handleCloseDialog = () => {
    const closing = useGameStore.getState().uiState.activeDialog;
    actions.hideDialog();
    // Clear modal-specific data when closing
    if (closing === 'city-starved') {
      actions.clearCityStarved();
    }
    if (closing === 'city-disorder') {
      actions.clearCityDisorder();
    }
    // A governor change is only *marked* while the city screen is open so the
    // map never reshuffles under the player's eyes — now that it is closed,
    // run the governor for that city.
    if (closing === 'city-details' && selectedCity && gameEngine) {
      if (selectedCity.governorDirty) {
        gameEngine.applyCityGovernor?.(selectedCity.id);
        selectedCity.governorDirty = false;
      }
    }
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

  // ── World wonder dialogs ────────────────────────────────────────────────
  const wonderNotice = wonderDialogQueue[0] ?? null;
  const completedWonderNotice = wonderNotice?.kind === 'completed' ? wonderNotice : null;
  const conflictWonderNotice = wonderNotice?.kind === 'conflict' ? wonderNotice : null;

  /**
   * Dismiss the current wonder dialog. With more wonders finished in the same
   * turn the NEXT entry opens immediately; on the last one the dialog closes
   * like any other blocking screen (auto-end is re-checked).
   */
  const handleWonderContinue = () => {
    const queue = useGameStore.getState().wonderDialogQueue;
    if (queue.length > 1) {
      actions.dequeueWonderDialog();
      return;
    }
    handleCloseDialog();
    actions.clearWonderDialogs();
  };

  /** Conflict modal — "Go to City": close, then center + open the idle city. */
  const handleWonderGoToCity = (cityId: string) => {
    handleCloseDialog();
    actions.clearWonderDialogs();
    const city = cities.find(c => c.id === cityId);
    if (city) {
      actions.selectCity(cityId, 'user');
      actions.focusCameraOnTile(city.col, city.row);
      actions.showDialog('city-details');
    }
  };

  // ── Battle reports & city events (queued like the wonder dialogs) ──────
  const combatReport = combatReportQueue[0] ?? null;
  const cityEvent = cityEventQueue[0] ?? null;
  const playerCivId = civilizations.find(c => c.isHuman)?.id ?? currentPlayer?.id ?? 0;

  const civName = (civId?: number) =>
    (civId === undefined ? null : civilizations.find(c => c.id === civId)?.name) ?? undefined;

  const terrainAt = (col?: number, row?: number) => {
    if (col === undefined || row === undefined || !map?.tiles) return undefined;
    return map.tiles[row * map.width + col]?.type ?? undefined;
  };

  /** Next queued battle report, or a clean close on the last one. */
  const handleCombatReportContinue = () => {
    const queue = useGameStore.getState().combatReportQueue;
    if (queue.length > 1) {
      actions.dequeueCombatReport();
      return;
    }
    handleCloseDialog();
    actions.clearCombatReports();
  };

  const handleCombatReportCentre = () => {
    if (combatReport) {
      actions.focusCameraOnTile(combatReport.col, combatReport.row, true, true);
    }
  };

  /** Next queued city event, or a clean close on the last one. */
  const handleCityEventContinue = () => {
    const queue = useGameStore.getState().cityEventQueue;
    if (queue.length > 1) {
      actions.dequeueCityEvent();
      return;
    }
    handleCloseDialog();
    actions.clearCityEvents();
  };

  /** "Open City" — close the notice, then select + open the city screen. */
  const handleCityEventGoToCity = () => {
    const cityId = cityEvent?.cityId;
    handleCityEventContinue();
    const city = cityId ? cities.find(c => c.id === cityId) : undefined;
    if (city) {
      actions.selectCity(city.id, 'user');
      actions.focusCameraOnTile(city.col, city.row, true, true);
      actions.showDialog('city-details');
    }
  };

  // handleResearchTechnology removed (unused)

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
      // The engine owns the opening-round lock and says no while it is closed.
      if (!ge.setResearch(0, firstResearchable, saved)) {
        notify('info', 'Research only starts once the opening rounds are over.');
      }
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
        className="gm"
        dialogClassName="tech-tree-modal"
        contentClassName="gm-modal"
      >
        <Modal.Body className="gm-body" data-tone="solemn">
          <button type="button" className="gm-close" onClick={handleCloseDialog} aria-label="Close">
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
          <header className="gm-hero gm-hero--slim">
            <div className="gm-art gm-art--plain">
              <span className="gm-art-glyph" aria-hidden="true">💡</span>
              <span className="gm-art-tag">the road ahead</span>
            </div>
            <div className="gm-heading">
              <div className="gm-eyebrow">{stamp('Research')}</div>
              <h2 className="gm-title">Technology Tree</h2>
              <p className="gm-lede">
                Every science your people can still reach. Follow a path and your academies will
                walk it without further orders.
              </p>
            </div>
          </header>
          <div className="gm-content gm-content--fill">
            <React.Suspense fallback={<div className="gm-prose">Unrolling the charts…</div>}>
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
          </div>
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
      <GameModal
        show
        onClose={actions.dismissTechNotification}
        tone="success"
        icon={getTechIcon(lastResearchedTech.id)}
        artLabel="the academy"
        dialogClassName="research-complete-modal"
        eyebrow={stamp('Research Complete')}
        title={lastResearchedTech.name}
        lede={
          lastResearchedTech.description ||
          'Another secret of the world has given up its knowledge to your people.'
        }
        actions={
          nextTech && nextTechId ? (
            <button
              type="button"
              className="touch-btn touch-btn--primary"
              onClick={() => {
                if (gameEngine) {
                  const saved = techProgress[nextTechId] ?? 0;
                  gameEngine.setResearch(0, nextTechId, saved);
                  actions.updateCivilizations([...(gameEngine.civilizations || [])]);
                }
                actions.dismissTechNotification();
              }}
            >
              Continue with {nextTech.name}
            </button>
          ) : (
            <button
              type="button"
              className="touch-btn touch-btn--primary"
              onClick={() => {
                actions.dismissTechNotification();
                actions.showDialog('tech');
              }}
            >
              Choose New Research Path
            </button>
          )
        }
      >
        <div className="gm-section">
          <div className="gm-section-title">Where the path leads</div>
          {nextTech ? (
            <p className="gm-prose">
              Your researchers are already reaching for the next rung of your path:{' '}
              <strong>{nextTech.name}</strong>. Take it now, or open the technology tree and
              strike out in another direction — nothing your people have learned is ever lost.
            </p>
          ) : (
            <p className="gm-prose">
              This branch of learning is exhausted — there is nothing left on your current path
              that your scholars do not already know. Open the technology tree and set them a new
              road, or let them wander on their own.
            </p>
          )}
        </div>
        <div className="gm-note">
          Research only moves while something is selected. Leave it empty and the turn will end
          with your academies idle.
        </div>
      </GameModal>
    );
  }

  // Diplomacy Modal — Civ I–style negotiation interface with leader portraits
  const [selectedDiploCiv, setSelectedDiploCiv] = useState<number | null>(null);
  // Outcome feed for proposals the player sends from this screen. Previously
  // this state was written and thrown away, so a rejected proposal produced no
  // visible feedback at all.
  const [diplomacyFeed, setDiplomacyLog] = useState<string[]>([]);
  const [showTreatyPanel, setShowTreatyPanel] = useState(false);
  const [counterProposal, setCounterProposal] = useState<{ fromCivId: number; toCivId: number; action: string; goldAmount?: number } | null>(null);
  // Advanced-negotiation inputs: how much tribute to demand, which met civ to
  // embargo, and the tech exchange terms.
  const [tributeAmount, setTributeAmount] = useState<number>(50);
  const [embargoTarget, setEmbargoTarget] = useState<number | ''>('');
  const [techOffer, setTechOffer] = useState<string>('');
  const [techRequest, setTechRequest] = useState<string>('');

  const addDiploLog = (msg: string): void => {
    setDiplomacyLog(prev => [msg, ...prev].slice(0, 20));
  };

  // When the diplomacy screen opens:
  //  - With a focus civ (diplomat contact or AI-initiated offer) → pre-select that civ.
  //  - Without a focus civ → auto-select the first discovered civ so the
  //    right panel is never empty on open.
  useEffect(() => {
    if (uiState.activeDialog !== 'diplomacy') return;
    if (diplomacyFocusCivId != null) {
      setSelectedDiploCiv(diplomacyFocusCivId);
      setShowTreatyPanel(false);
      setCounterProposal(null);
      actions.clearDiplomacyFocus();
    } else if (selectedDiploCiv === null) {
      const first = civilizations.find((c: Civilization) =>
        c.id !== (currentPlayer?.id ?? 0) &&
        c.isAlive !== false &&
        (typeof gameEngine?.diplomacyManager?.hasContacted === 'function'
          ? gameEngine.diplomacyManager.hasContacted(currentPlayer?.id ?? 0, c.id)
          : true),
      );
      if (first) {
        setSelectedDiploCiv(first.id);
        setShowTreatyPanel(false);
        setCounterProposal(null);
      }
    }
  }, [uiState.activeDialog, diplomacyFocusCivId, selectedDiploCiv, civilizations, currentPlayer, actions, gameEngine]);

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
        techOffered: offer.techOffered,
        techRequested: offer.techRequested,
      });
      addDiploLog(result.accepted
        ? `You accepted ${fromCiv?.name ?? 'their'} proposal (${offer.action.replace(/_/g, ' ')}).`
        : `The proposal could not be completed${result.reason ? `: ${result.reason}` : ''}.`);
    } else {
      addDiploLog(`You declined ${fromCiv?.name ?? 'their'} proposal.`);
    }
    actions.clearIncomingDiplomacyOffer();
    // Tech swaps change what each civ knows — refresh the store mirror.
    if (accept && gameEngine?.civilizations) {
      actions.updateCivilizations([...gameEngine.civilizations]);
    }
  };

  const renderDiplomacy = () => {
    const dm = gameEngine?.diplomacyManager;
    const playerId = currentPlayer?.id ?? 0;
    // Only civilizations the player has actually met may be negotiated with —
    // rivals are discovered by scouting, not handed over on turn 1.
    const metCivIds = typeof dm?.getMetCivs === 'function' ? new Set(dm.getMetCivs(playerId)) : null;
    const otherCivs = civilizations.filter((c: Civilization) =>
      c.id !== playerId &&
      c.isAlive !== false &&
      (metCivIds === null || metCivIds.has(c.id)),
    );

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

    // Reads an engine action ("propose_peace") as the term the court would
    // actually speak, so a proposal never shows up as snake_case jargon.
    const OFFER_LABELS: Record<string, string> = {
      propose_peace: 'Peace',
      propose_ceasefire: 'Ceasefire',
      propose_alliance: 'Alliance',
      demand_tribute: 'Tribute',
      offer_open_borders: 'Open Borders',
      propose_trade_agreement: 'Trade Agreement',
      propose_mutual_defense: 'Mutual Defense',
      propose_non_aggression: 'Non-Aggression Pact',
      propose_embargo: 'Embargo',
      offer_tech_exchange: 'Tech Exchange',
    };
    const offerTerm = (action: string): string =>
      OFFER_LABELS[action] ?? action.replace(/_/g, ' ');

    const handleDiplomacyAction = (
      targetId: number,
      action: string,
      extra?: { treaty?: string; goldAmount?: number; embargoTargetId?: number; techOffered?: string; techRequested?: string },
    ) => {
      if (!dm) return;
      let result: { accepted?: boolean; counterProposal?: typeof counterProposal; reason?: string; goldTransferred?: number } | null = null;
      switch (action) {
        case 'declare_war':
          // declareWar emits WAR_DECLARED itself — re-emitting here duplicated
          // the player's war toast.
          dm.declareWar(playerId, targetId);
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
          const demand = extra?.goldAmount ?? 50;
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
        case 'propose_embargo':
          result = dm.processProposal({
            fromCivId: playerId,
            toCivId: targetId,
            action: 'propose_embargo',
            embargoTargetId: extra?.embargoTargetId,
          });
          addDiploLog(result.accepted
            ? `Embargo agreed with ${civilizations[targetId]?.name} against ${civilizations[extra?.embargoTargetId ?? -1]?.name ?? 'the target'}.`
            : `${civilizations[targetId]?.name} rejected the embargo: "${result.reason}"`);
          break;
        case 'offer_tech_exchange':
          result = dm.processProposal({
            fromCivId: playerId,
            toCivId: targetId,
            action: 'offer_tech_exchange',
            techOffered: extra?.techOffered,
            techRequested: extra?.techRequested,
          });
          addDiploLog(result.accepted
            ? `Technology exchanged with ${civilizations[targetId]?.name}!`
            : `${civilizations[targetId]?.name} rejected the exchange: "${result.reason}"`);
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
    // Raw score drives both the tier (via the engine's shared bands) and the
    // meter, so the bar and the word can never disagree.
    const selectedAttitudeScore = selectedDiploCiv !== null ? (dm?.getAttitudeScore?.(playerId, selectedDiploCiv) ?? 0) : 0;
    const selectedAttitude = attitudeFromScore(selectedAttitudeScore);
    const selectedRelation = selectedDiploCiv !== null ? dm?.getRelation(playerId, selectedDiploCiv) : null;
    // The three readouts the new model adds: the raw goodwill points, the
    // opinion THEY hold of us (which is what a proposal is judged against),
    // and the reason list behind it.
    const selectedGoodwill = selectedDiploCiv !== null ? (dm?.getAttitudeScore?.(playerId, selectedDiploCiv) ?? 0) : 0;
    const selectedTheirOpinion = selectedDiploCiv !== null
      ? (dm?.getTheirOpinion?.(playerId, selectedDiploCiv) ?? { goodwill: 0, grievance: 0, fear: 0, respect: 0, offersRefused: 0, lastOfferRound: -1, reasons: [] })
      : { goodwill: 0, grievance: 0, fear: 0, respect: 0, offersRefused: 0, lastOfferRound: -1, reasons: [] };
    const selectedReasons = selectedTheirOpinion.reasons ?? [];
    // A preview of the terms currently in the input boxes, so the player can
    // see the engine's own arithmetic before committing to a deal. Exchange
    // of Knowledge uses the two selected techs; everything else previews the
    // tribute demand.
    const verdict = selectedDiploCiv !== null && dm
      ? dm.previewProposal?.(
        techOffer && techRequest
          ? {
            fromCivId: playerId,
            toCivId: selectedDiploCiv,
            action: 'offer_tech_exchange',
            techOffered: techOffer,
            techRequested: techRequest,
          }
          : {
            fromCivId: playerId,
            toCivId: selectedDiploCiv,
            action: 'demand_tribute',
            goldAmount: Number.isFinite(tributeAmount) ? tributeAmount : 50,
          },
      )
      : null;

    // Leader portrait lookup
    const leaderName = selectedCivData?.leader || selectedCivData?.leaderName || '';
    const portraitConfig = LEADER_PORTRAITS[leaderName] || null;
    const moodColors = MOOD_COLORS[selectedAttitude] || MOOD_COLORS.neutral;
    const activeTreaties: string[] = selectedDiploCiv !== null ? (dm?.getActiveTreaties?.(playerId, selectedDiploCiv) ?? []) : [];

    const closeDiplomacy = (): void => {
      handleCloseDialog();
      setSelectedDiploCiv(null);
      setDiplomacyLog([]);
      setShowTreatyPanel(false);
      setCounterProposal(null);
      actions.clearIncomingDiplomacyOffer();
      actions.clearDiplomacyFocus();
    };

    // The hero artwork is the face across the table: the same procedural
    // portrait the audience panel uses, so the hall shows who you are dealing
    // with before it shows a single number. Nobody selected → the placeholder
    // slot, captioned for the picture that belongs there.
    const heroArt = portraitConfig ? (
      <span className="diplomacy-hero-art">
        <LeaderPortrait
          config={portraitConfig}
          mood={selectedAttitude as 'friendly' | 'neutral' | 'annoyed' | 'hostile'}
          size={56}
          leaderName={leaderName}
        />
      </span>
    ) : null;

    return (
      <GameModal
        show={uiState.activeDialog === 'diplomacy'}
        onClose={closeDiplomacy}
        tone="gold"
        size="xl"
        dialogClassName="diplomacy-modal"
        icon={heroArt ?? '⚖️'}
        artSize="lg"
        artLabel={heroArt ? undefined : 'Divide et impera'}
        artAlt={leaderName || 'Divide et impera'}
        eyebrow={stamp('Your Court')}
        title="Diplomatic Relations"
        lede="Every court on earth is a door — opened with a gift, a treaty, or an army at the gate. Choose a rival, read the temper of their ruler, and speak: what you promise in this hall your people will be held to."
        actions={
          <>
            <span className="gm-actions-spacer" />
            <button type="button" className="touch-btn touch-btn--ghost" onClick={closeDiplomacy}>
              Close
            </button>
          </>
        }
      >
          {/* Pending AI→player proposal awaiting an accept/reject decision */}
          {incomingDiplomacyOffer && (
            <div className="diplomacy-incoming-offer">
              <div className="gm-section-title">📨 An envoy is waiting</div>
              <div className="diplomacy-incoming-text">
                {civilizations[incomingDiplomacyOffer.fromCivId]?.name ?? 'Unknown'} proposes: <strong>{offerTerm(incomingDiplomacyOffer.action)}</strong>
                {incomingDiplomacyOffer.goldAmount ? ` (${incomingDiplomacyOffer.goldAmount} gold)` : ''}
                {incomingDiplomacyOffer.techOffered && incomingDiplomacyOffer.techRequested && (
                  <>
                    {': '}
                    <strong>
                      {technologies.find((t) => t.id === incomingDiplomacyOffer.techOffered)?.name
                        ?? incomingDiplomacyOffer.techOffered}
                    </strong>
                    {' ↔ '}
                    <strong>
                      {technologies.find((t) => t.id === incomingDiplomacyOffer.techRequested)?.name
                        ?? incomingDiplomacyOffer.techRequested}
                    </strong>
                  </>
                )}
              </div>
              <div className="diplomacy-incoming-buttons">
                <button className="diplomacy-btn btn-peace" onClick={() => handleIncomingOffer(true)}>✓ Accept</button>
                <button className="diplomacy-btn btn-war" onClick={() => handleIncomingOffer(false)}>✗ Reject</button>
              </div>
            </div>
          )}
          {/* Outcome of the last few proposals — without this the buttons gave
              no feedback unless a counter-offer happened to come back. */}
          {diplomacyFeed.length > 0 && (
            <section className="gm-section">
              <div className="gm-section-title">What the court has heard</div>
              <div className="diplomacy-log diplomacy-feed">
                {diplomacyFeed.slice(0, 4).map((line, i) => (
                  <div key={i} className="diplomacy-log-entry">{line}</div>
                ))}
              </div>
            </section>
          )}
          {otherCivs.length === 0 ? (
            <section className="gm-section">
              <div className="gm-section-title">No one has come to the table</div>
              <p className="gm-prose">No other civilizations discovered yet.</p>
            </section>
          ) : (
            <div className="diplomacy-layout gm-section gm-section--flush">
              {/* Left: Civilization list */}
              <div className="diplomacy-civ-list">
                <div className="gm-section-title diplomacy-pane-title">Known courts</div>
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
                        {/* Attitude meter: hostile ← → friendly. The scale is
                            clamped to ±40, the range the bands actually use. */}
                        <div
                          className="diplomacy-attitude-meter"
                          title={`Attitude score: ${selectedAttitudeScore > 0 ? '+' : ''}${Math.round(selectedAttitudeScore)}`}
                        >
                          <div
                            className="diplomacy-attitude-marker"
                            style={{
                              left: `${((Math.max(-40, Math.min(40, selectedAttitudeScore)) + 40) / 80) * 100}%`,
                              background: ATTITUDE_LABELS[selectedAttitude]?.color || '#9e9e9e',
                            }}
                          />
                        </div>
                        <div className="diplomacy-attitude-scale">
                          <span>Hostile</span>
                          <span>{selectedAttitudeScore > 0 ? '+' : ''}{Math.round(selectedAttitudeScore)}</span>
                          <span>Friendly</span>
                        </div>
                      </div>

                      {/* Status panel: the stance as a chip, the ledger below */}
                      <div className="diplomacy-status-panel">
                        <span className={`diplomacy-status-value status-${selectedStatus} gm-chip`}>
                          {STATUS_ICONS[selectedStatus]} {selectedStatus.toUpperCase()}
                        </span>
                        {selectedRelation && (
                          /* Goodwill is the one number the whole model turns on,
                             so it leads; the rest of the ledger follows. */
                          <div className="gm-kv-grid gm-kv-grid--stack diplomacy-facts">
                            <div className="gm-kv">
                              Goodwill:{' '}
                              <b style={{ color: selectedGoodwill < 0 ? '#f44336' : selectedGoodwill > 0 ? '#4caf50' : '#9e9e9e' }}>
                                {selectedGoodwill > 0 ? '+' : ''}{selectedGoodwill}
                              </b>
                            </div>
                            {selectedTheirOpinion.grievance >= 10 && (
                              <div className="gm-kv">
                                Grievance: <b style={{ color: '#ff9800' }}>{Math.round(selectedTheirOpinion.grievance)}</b>
                              </div>
                            )}
                            {selectedTheirOpinion.fear >= 20 && (
                              <div className="gm-kv">
                                Their fear of you: <b style={{ color: '#ba68c8' }}>{Math.round(selectedTheirOpinion.fear)}</b>
                              </div>
                            )}
                            <div className="gm-kv">
                              Since turn: <b style={{ color: '#aaa' }}>{selectedRelation.since}</b>
                            </div>
                          </div>
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
                        <section className="gm-section">
                          <div className="gm-section-title">Where the steel lies</div>
                          <div className="diplomacy-strength-section">
                            <span style={{ color: strengthColor, fontWeight: 'bold' }}>{strengthLabel}</span>
                            <div className="diplomacy-strength-bar-visual">
                              <div className="diplomacy-strength-fill-player" style={{ width: `${playerPct}%` }} />
                              <div className="diplomacy-strength-fill-enemy" style={{ width: `${100 - playerPct}%` }} />
                            </div>
                            <span className="diplomacy-strength-nums">You: {Math.round(playerStr)} | Them: {Math.round(theirStr)}</span>
                          </div>
                        </section>
                      );
                    })()}

                    {/* Active treaties display */}
                    {activeTreaties.length > 0 && (
                      <section className="gm-section">
                        <div className="gm-section-title">Treaties in force</div>
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
                      </section>
                    )}

                    {/* The engine's own arithmetic for the demand currently in
                        the box. Same function the AI uses to decide, so this is
                        a forecast rather than a hint. */}
                    {verdict && selectedStatus !== 'war' && (
                      <div className={`diplomacy-verdict ${verdict.accepted ? 'likely' : 'unlikely'}`}>
                        <span className="diplomacy-verdict-headline">
                          {verdict.accepted ? 'Likely to be paid' : 'Likely to be refused'}
                        </span>
                        <span className="diplomacy-verdict-score">
                          {verdict.score} vs {verdict.threshold}
                        </span>
                        <span className="diplomacy-verdict-why">
                          decisive: {verdict.decisiveFactor}
                          {verdict.vetoed ? ' · pride forbids it' : ''}
                        </span>
                      </div>
                    )}

                    {/* What they remember, with the points it cost. This is the
                        "why do they hate me" list — the model records a reason
                        for every single thing that moved the number above. */}
                    {selectedReasons.length > 0 && (
                      <div className="diplomacy-reasons">
                        <div className="gm-section-title">What they remember</div>
                        {selectedReasons.map((r, i) => (
                          <div key={`${r.event}-${r.round}-${i}`} className="diplomacy-reason-row">
                            <span className={`diplomacy-reason-delta ${r.delta >= 0 ? 'good' : 'bad'}`}>
                              {r.delta >= 0 ? '+' : ''}{r.delta}
                            </span>
                            <span className="diplomacy-reason-text">
                              {dm?.impactLabel?.(r.event) ?? r.event}
                              {r.detail ? <em> — {r.detail}</em> : null}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Counter-proposal banner */}
                    {counterProposal && (
                      <div className="diplomacy-counter-proposal">
                        <div className="gm-section-title">📜 Counter-Proposal</div>
                        <div className="diplomacy-counter-text">
                          {civilizations[selectedDiploCiv!]?.name} suggests: <strong>{offerTerm(counterProposal.action)}</strong>
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
                    <section className="gm-section">
                      <div className="gm-section-title">Terms you may put to them</div>
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
                          <span className="diplomacy-tribute-group">
                            <input
                              type="number"
                              min={0}
                              step={10}
                              className="diplomacy-tribute-input"
                              value={tributeAmount}
                              onChange={(e) => setTributeAmount(Math.max(0, Number(e.target.value) || 0))}
                              title="How much gold to demand"
                            />
                            <button
                              className="diplomacy-btn btn-tribute"
                              onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'demand_tribute', { goldAmount: tributeAmount })}
                            >
                              💰 Demand Tribute
                            </button>
                          </span>
                          <button className="diplomacy-btn btn-war" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'declare_war')}>
                            ⚔️ Declare War
                          </button>
                        </>
                      )}
                      {selectedStatus === 'alliance' && (
                        <>
                          <span className="diplomacy-tribute-group">
                            <input
                              type="number"
                              min={0}
                              step={10}
                              className="diplomacy-tribute-input"
                              value={tributeAmount}
                              onChange={(e) => setTributeAmount(Math.max(0, Number(e.target.value) || 0))}
                              title="How much gold to demand"
                            />
                            <button
                              className="diplomacy-btn btn-tribute"
                              onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'demand_tribute', { goldAmount: tributeAmount })}
                            >
                              💰 Demand Tribute
                            </button>
                          </span>
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

                            {/* Embargo a third party together */}
                            {otherCivs.filter((c: Civilization) => c.id !== selectedDiploCiv).length > 0 && (
                              <span className="diplomacy-treaty-group">
                                <select
                                  className="diplomacy-select"
                                  value={embargoTarget}
                                  onChange={(e) => setEmbargoTarget(e.target.value === '' ? '' : Number(e.target.value))}
                                  title="Which civilization to embargo"
                                >
                                  <option value="">Embargo target…</option>
                                  {otherCivs
                                    .filter((c: Civilization) => c.id !== selectedDiploCiv)
                                    .map((c: Civilization) => (
                                      <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                                <button
                                  className="diplomacy-btn btn-treaty"
                                  disabled={embargoTarget === ''}
                                  onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'propose_embargo', { embargoTargetId: Number(embargoTarget) })}
                                >
                                  🚫 Embargo
                                </button>
                              </span>
                            )}

                            {/* Exchange of Knowledge (Civ I): two lists of the
                                real tech diffs — what they know that we lack,
                                and what we know that they lack. */}
                            {(() => {
                              const trade = dm?.getTechTradeOptions?.(playerId, selectedDiploCiv!);
                              const canTrade = dm?.canTradeTechs?.(playerId, selectedDiploCiv!);
                              const techName = (id: string) =>
                                technologies.find((t) => t.id === id)?.name ?? id;
                              if (!trade || (trade.theyHaveWeLack.length === 0 && trade.weHaveTheyLack.length === 0)) {
                                return (
                                  <div className="diplomacy-tech-exchange diplomacy-tech-exchange--empty">
                                    <span className="diplomacy-tech-exchange__title">Exchange of Knowledge</span>
                                    <span className="diplomacy-tech-exchange__hint">
                                      {canTrade && !canTrade.ok
                                        ? canTrade.reason
                                        : 'You already share every technology — there is nothing left to swap.'}
                                    </span>
                                  </div>
                                );
                              }
                              return (
                                <div className="diplomacy-tech-exchange">
                                  <span className="diplomacy-tech-exchange__title">Exchange of Knowledge</span>
                                  <span className="diplomacy-tech-exchange__hint">
                                    One technology each way. They refuse unfair swaps and will not trade while at war.
                                  </span>
                                  <div className="diplomacy-tech-exchange__cols">
                                    <label className="diplomacy-tech-exchange__col">
                                      <span className="diplomacy-tech-exchange__col-label">They have · you lack</span>
                                      <select
                                        className="diplomacy-select"
                                        value={techRequest}
                                        onChange={(e) => setTechRequest(e.target.value)}
                                      >
                                        <option value="">Request a technology…</option>
                                        {trade.theyHaveWeLack.map((id: string) => (
                                          <option key={id} value={id}>{techName(id)}</option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="diplomacy-tech-exchange__col">
                                      <span className="diplomacy-tech-exchange__col-label">You have · they lack</span>
                                      <select
                                        className="diplomacy-select"
                                        value={techOffer}
                                        onChange={(e) => setTechOffer(e.target.value)}
                                      >
                                        <option value="">Offer a technology…</option>
                                        {trade.weHaveTheyLack.map((id: string) => (
                                          <option key={id} value={id}>{techName(id)}</option>
                                        ))}
                                      </select>
                                    </label>
                                  </div>
                                  <button
                                    className="diplomacy-btn btn-treaty"
                                    disabled={!techOffer || !techRequest}
                                    onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'offer_tech_exchange', {
                                      techOffered: techOffer,
                                      techRequested: techRequest,
                                    })}
                                  >
                                    🔬 Exchange of Knowledge
                                  </button>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </>
                    )}
                    </section>

                    {/* Global diplomacy history from DiplomacyManager */}
                    {(() => {
                      const events: Array<{ type: string; fromCivId: number; toCivId: number; goldAmount?: number; details?: string }> = dm?.getEventLog?.() ?? [];
                      const relevant = events.filter(
                        (e) => e.fromCivId === selectedDiploCiv || e.toCivId === selectedDiploCiv
                          || e.fromCivId === playerId || e.toCivId === playerId
                      ).slice(0, 8);
                      if (relevant.length === 0) return null;
                      return (
                        <section className="gm-section">
                          <div className="gm-section-title">The record of your dealings</div>
                          <div className="diplomacy-log">
                            {relevant.map((e, i: number) => {
                              const from = civilizations[e.fromCivId]?.name ?? `Civ ${e.fromCivId}`;
                              const to = civilizations[e.toCivId]?.name ?? `Civ ${e.toCivId}`;
                              const labels: Record<string, string> = {
                                war_declared: `⚔️ ${from} declared war on ${to}`,
                                peace_made: `🕊️ Peace between ${from} and ${to}`,
                                ceasefire_signed: `🏳️ Ceasefire between ${from} and ${to}`,
                                alliance_formed: `🤝 Alliance between ${from} and ${to}`,
                                alliance_broken: `⛓️‍💥 ${from} broke the alliance with ${to}`,
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
                        </section>
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
      </GameModal>
    );
  };

  // Help Modal
  const renderHelp = () => (
    <GameModal
      show={uiState.activeDialog === 'help'}
      onClose={handleCloseDialog}
      size="lg"
      tone="info"
      icon="📖"
      artLabel="the steward's handbook"
      eyebrow="At Your Service"
      title="Help & Controls"
      lede="Everything your steward can tell you about ruling this world: the keys under your hand, the orders you may give on the map, and the shape of the game itself."
      actions={
        <button type="button" className="touch-btn touch-btn--primary" onClick={handleCloseDialog}>
          Back to the Map
        </button>
      }
    >
      <Tabs defaultActiveKey="controls" className="mb-0 gm-help-tabs">
        <Tab eventKey="controls" title="Controls">
          <p className="gm-prose gm-help-intro">
            The whole world answers to your mouse and a handful of keys. Learn these and you will
            never have to hunt for a button again.
          </p>
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
                <strong>Enter:</strong> End the turn
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>D:</strong> Diplomatic relations
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>R:</strong> Rush city production (with a city selected)
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>C:</strong> Centre the map on the selected unit
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>T:</strong> Tax, science &amp; luxury rates
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>G:</strong> Government
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
                <strong>F2:</strong> Tech tree
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>F3:</strong> Settings
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>F4:</strong> Diplomatic relations
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
                <strong>Ctrl+P:</strong> Pause
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Ctrl+1–9:</strong> Select city by number
              </ListGroup.Item>
            </ListGroup>
          </Tab>
          
          <Tab eventKey="orders" title="Orders Menu">
            <p className="gm-prose gm-help-intro">
              Right-click a unit (or open the ORDERS menu) and these are the commands you may give.
              Every one of them costs time — some a single turn, some many.
            </p>
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
            <p className="gm-prose gm-help-intro">
              A civilisation is not won by the sword alone. Feed your people, keep the treasury
              honest, and let your scholars run ahead of your rivals.
            </p>
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
            <p className="gm-prose gm-help-intro">
              This world is a work in progress, built in the open. Words, ideas and bug reports
              are all welcome.
            </p>
            <div className="gm-section">
              <div className="gm-section-title">Reach the maker</div>
              <p className="gm-prose mb-2">
                <a href="mailto:info@mailbase.info">info@mailbase.info</a>
              </p>
              <p className="gm-prose mb-0">
                <a
                  href="https://github.com/JCTRoth/Zivilisation_1"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub — JCTRoth/Zivilisation_1
                </a>
              </p>
            </div>
          </Tab>
        </Tabs>
      </GameModal>
  );

  // handleStartProduction removed (unused)

  // handleQueueProduction removed (unused)

  // New: track a single selected production item for the select box
  const [selectedProductionKey, setSelectedProductionKey] = useState<string | null>(null);
  // Track selected index in the queue (for removal)
  const [selectedQueueIndex, setSelectedQueueIndex] = useState<number | null>(null);

  // Build available items list (filtered). Delegates to the engine so the UI
  // and the auto-end "idle city" gate share one tech/naval rule.
  const availableProductionKeys = useMemo(() => {
    if (!selectedCity || !gameEngine?.productionManager) return [];
    return gameEngine.productionManager.getBuildableUnitTypes(selectedCity.id);
  }, [selectedCity, gameEngine]);

  // Ensure there is a default selection when modal opens or available list changes
  useEffect(() => {
    if (!selectedProductionKey && availableProductionKeys && availableProductionKeys.length > 0) {
      setSelectedProductionKey(availableProductionKeys[0]);
    }
    // Clear selection if nothing available
    if (availableProductionKeys.length === 0) setSelectedProductionKey(null);
  }, [availableProductionKeys, selectedProductionKey]);

  // Reset queue selection when the selected city changes
  useEffect(() => {
    setSelectedQueueIndex(null);
    if (selectedCity) console.log('[GameModals] selectedCity changed', { id: selectedCity.id, name: selectedCity.name, buildQueue: selectedCity.buildQueue });
  }, [selectedCity, selectedCityId]);

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
   * chooses the item). The command goes through the session, so the engine
   * also checks that the selected city belongs to the acting seat. Failures
   * (missing tech, duplicate building, …) are reported instead of silently
   * doing nothing.
   */
  const submitProduction = async (itemKey?: string): Promise<void> => {
    const key = itemKey ?? selectedProductionKey;
    if (!selectedCity || !key || !gameEngine) return;
    const unitDef = UNIT_PROPS[key];
    if (!unitDef) return;
    const item = { type: 'unit', itemType: key, name: unitDef.name, cost: unitDef.cost };
    const result = await sendCommand({
      type: 'SET_CITY_PRODUCTION',
      cityId: selectedCity.id,
      item,
      queue: true,
    });
    if (typeof gameEngine.getAllCities === 'function') actions.updateCities(gameEngine.getAllCities());
    if (isCommandRejection(result)) {
      actions.addNotification({
        type: 'warning',
        message: `Cannot queue ${item.name}: ${productionFailureText(result.reason)}`,
      });
      return;
    }
    // setCityProduction answers with a result object even on failure — reading
    // its truthiness reported bogus successes.
    if (result.command === 'SET_CITY_PRODUCTION') {
      if (result.production.success !== false) {
        actions.addNotification({ type: 'info', message: `Added to queue: ${item.name}` });
      } else {
        actions.addNotification({
          type: 'warning',
          message: `Cannot queue ${item.name}: ${productionFailureText(result.production.reason)}`,
        });
      }
    }
  };

  const renderCityProduction = () => (
    <GameModal
      show={uiState.activeDialog === 'city-production'}
      onClose={handleCloseDialog}
      size="lg"
      tone="info"
      icon="⚒️"
      artLabel="the building yards"
      dialogClassName="city-production-modal"
      eyebrow={stamp('City Production')}
      title={selectedCity?.name || 'City Production'}
      lede={
        <>
          Give this city its next order. Everything it builds is paid for in shields — the more
          workshops it works, the faster the shields arrive.
        </>
      }
      actions={
        <button type="button" className="touch-btn touch-btn--primary" onClick={handleCloseDialog}>
          Done
        </button>
      }
    >
      <div className="gm-note">
        Pick a unit, building or wonder below. Its cost is shown in shields, and the queue takes
        them in the order you set.
      </div>
      {renderProductionContent()}
    </GameModal>
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

  // Upkeep-disbanded notice: a unit was scrapped because the treasury could
  // not cover its upkeep. Inform the player and point at how to balance the
  // budget.
  const renderUpkeepDisbanded = () => (
    <GameModal
      show={uiState.activeDialog === 'upkeep-disbanded'}
      onClose={handleCloseDialog}
      size="lg"
      tone="danger"
      icon="🪙"
      artLabel="an empty treasury"
      eyebrow={stamp('Treasury Report')}
      title="A unit has been disbanded"
      lede={
        <>
          The gold ran out, and the <strong>{disbandNotice?.unitName ?? 'unit'}</strong> could no
          longer be paid. Your generals sent it home before the mutiny started.
        </>
      }
      actions={
        <>
          <span className="gm-actions-spacer" />
          <button
            type="button"
            className="touch-btn touch-btn--ghost"
            onClick={() => actions.showDialog('rates')}
          >
            <i className="bi bi-graph-up" aria-hidden="true" /> Open Rates
          </button>
          <button type="button" className="touch-btn touch-btn--primary" onClick={handleCloseDialog}>
            Understood
          </button>
        </>
      }
    >
      <div className="gm-section">
        <div className="gm-section-title">Balance the books</div>
        <ul className="gm-list">
          <li>
            Raise the <strong>tax rate</strong> 📊 — every point turns trade into gold each turn.
          </li>
          <li>
            Trim <strong>luxury</strong> spending to what your cities truly need to stay quiet.
          </li>
          <li>
            Disband units you no longer need: right-click a unit → <em>Disband</em>.
          </li>
          <li>
            Raise a <strong>Marketplace</strong> or <strong>Bank</strong> — trade becomes coin.
          </li>
          <li>
            Field fewer expensive units: every one of them is paid from the treasury each turn.
          </li>
        </ul>
      </div>
      <div className="gm-callout">
        <span className="gm-callout-title">Why this happened</span>
        Your treasury held less gold than the upkeep of your army cost this turn. Units are only
        disbanded as a last resort — a treasury in the red cannot keep a single soldier fed.
      </div>
    </GameModal>
  );

  // City starved: population decreased due to food shortage.
  const renderCityStarved = () => (
    <GameModal
      show={uiState.activeDialog === 'city-starved'}
      onClose={handleCloseDialog}
      size="lg"
      tone="danger"
      icon="🌾"
      artLabel="barren fields"
      eyebrow={stamp('Famine Warning')}
      title={`${starvationNotice?.cityName ?? 'Your city'} is starving`}
      lede={
        <>
          The granaries are empty and the bread queues grow longer every day. Unless food reaches
          <strong> {starvationNotice?.cityName ?? 'your city'}</strong> before the next harvest,
          people will die — and the city will shrink.
        </>
      }
      actions={
        <>
          <span className="gm-actions-spacer" />
          {starvationNotice?.blockingManualTiles && starvationNotice.blockingManualTiles.length > 0 && (
            <button
              type="button"
              className="touch-btn touch-btn--primary"
              onClick={() => {
                if (starvationNotice.cityId) {
                  gameEngine?.releaseManualAllocations?.(starvationNotice.cityId);
                }
                handleCloseDialog();
              }}
            >
              🔓 Release &amp; Rebalance
            </button>
          )}
          <button type="button" className="touch-btn touch-btn--ghost" onClick={handleCloseDialog}>
            Later
          </button>
          <button
            type="button"
            className="touch-btn touch-btn--danger"
            onClick={() => {
              if (starvationNotice?.cityId) {
                actions.selectCity(starvationNotice.cityId, 'user');
                const city = cities.find(c => c.id === starvationNotice.cityId);
                if (city) {
                  actions.focusCameraOnTile(city.col, city.row, true, true);
                }
                actions.showDialog('city-details');
              }
              handleCloseDialog();
            }}
          >
            📍 Go to City
          </button>
        </>
      }
    >
      <div className="gm-section">
        <div className="gm-section-title">What is happening</div>
        <p className="gm-prose">
          Food is the first law of a city. When the store runs dry the weakest go first, the
          workshops stand idle, and the governor's hands are tied until grain arrives or a
          citizen is freed to work the fields.
        </p>
      </div>

      {starvationNotice?.blockingManualTiles && starvationNotice.blockingManualTiles.length > 0 && (
        <div className="gm-callout">
          <span className="gm-callout-title">Your hand-picked tiles are blocking the fix</span>
          You placed citizens on these tiles yourself, so the governor will not move them — not
          even to stop a famine. Some of them yield less food than land sitting idle in this
          city's radius:
          <ul className="gm-list gm-list--tight">
            {starvationNotice.blockingManualTiles.map((t) => (
              <li key={`${t.col},${t.row}`}>
                ({t.col},{t.row}) — {t.food} 🍞
              </li>
            ))}
          </ul>
          Release them and let the governor rebalance the city.
        </div>
      )}

      <div className="gm-note">
        <strong>Act this turn.</strong> A starving city loses population at the end of the turn —
        and every citizen lost is a worker, a tax payer and a defender gone with them.
      </div>
    </GameModal>
  );

  // "Auto. turn ending" — offered once, mid-game. It informs what the feature
  // does and carries the actual on/off checkbox, so the player can decide
  // right here (answering either way marks the offer as seen for this browser).
  const renderAutoEndOffer = () => {
    const finish = () => {
      try {
        localStorage.setItem(AUTO_END_TURN_OFFER_FLAG, '1');
      } catch {
        // Private mode / storage disabled: the offer simply shows again later.
      }
      handleCloseDialog();
    };

    return (
      <GameModal
        show={uiState.activeDialog === 'auto-end-offer'}
        onClose={finish}
        className="auto-end-offer-modal"
        tone="success"
        icon="⏩"
        artLabel="the turn wheel"
        eyebrow="A Habit Worth Forming"
        title="Auto. turn ending"
        lede={
          <>
            With <strong>Auto. turn ending</strong> the turn hands over{' '}
            <strong>the moment your units run out of moves</strong> — fortified and sleeping
            units included, so your garrisons never hold it up. You stay in control until then,
            and can switch it off again at any time.
          </>
        }
        actions={
          <>
            <span className="gm-actions-spacer" />
            <button type="button" className="touch-btn touch-btn--ghost" onClick={finish}>
              Not now
            </button>
            <button type="button" className="touch-btn touch-btn--success" onClick={finish}>
              Got it
            </button>
          </>
        }
      >
        <div className="gm-section auto-end-offer-choice">
          <div className="gm-section-title">Decide here, right now</div>
          <Form.Check
            type="checkbox"
            id="auto-end-offer-toggle"
            className="auto-end-offer-toggle"
            checked={settings.autoEndTurn}
            onChange={(e) => actions.updateSettings?.({ autoEndTurn: e.target.checked })}
            label={
              <>
                <span className="auto-end-offer-choice-title">Auto. turn ending</span>
                <span className="auto-end-offer-choice-hint">
                  End my turn automatically once every unit is done
                </span>
              </>
            }
          />
        </div>
        <div className="gm-note">
          Asked once. You can switch it off again at any time in the side panel, right under your
          gold — or in Settings.
        </div>
      </GameModal>
    );
  };

  // City disorder — entering or leaving civil unrest
  const renderCityDisorder = () => {
    const entering = disorderNotice?.enteringDisorder ?? true;
    const cityName = disorderNotice?.cityName ?? 'your city';
    return (
      <GameModal
        show={uiState.activeDialog === 'city-disorder'}
        onClose={handleCloseDialog}
        size="lg"
        tone={entering ? 'danger' : 'success'}
        icon={entering ? '🔥' : '🛡️'}
        artLabel={entering ? 'torchlit streets' : 'the watch returning'}
        eyebrow={stamp(entering ? 'City in Revolt' : 'City Report')}
        title={entering ? `${cityName} rises in revolt` : `Order returns to ${cityName}`}
        lede={
          entering ? (
            <>
              Sire, the citizens of <strong>{cityName}</strong> have taken to the streets. The
              workshops are silent, the tax collectors are turned away, and the city answers to
              nobody.
            </>
          ) : (
            <>
              Sire, the crowds in <strong>{cityName}</strong> have gone home. The looms are
              running again and your collectors are back at the gates.
            </>
          )
        }
        actions={
          <>
            <span className="gm-actions-spacer" />
            <button type="button" className="touch-btn touch-btn--ghost" onClick={handleCloseDialog}>
              Close
            </button>
            <button
              type="button"
              className="touch-btn touch-btn--primary"
              onClick={() => {
                if (disorderNotice?.cityId) {
                  actions.selectCity(disorderNotice.cityId, 'user');
                  const city = cities.find(c => c.id === disorderNotice.cityId);
                  if (city) {
                    actions.focusCameraOnTile(city.col, city.row, true, true);
                  }
                  actions.showDialog('city-details');
                }
                handleCloseDialog();
              }}
            >
              📍 Go to City
            </button>
          </>
        }
      >
        {entering ? (
          <>
            <div className="gm-section">
              <div className="gm-section-title">What it costs you</div>
              <ul className="gm-list">
                <li>Production in {cityName} has ground to a halt — nothing is being built.</li>
                <li>No taxes can be collected from the city while the streets are held.</li>
                <li>Whatever garrison you keep there is busy holding the gates, not the borders.</li>
              </ul>
            </div>
            <div className="gm-callout">
              <span className="gm-callout-title">Calm it down</span>
              Contented cities do not riot. Ease the tax burden, keep the granaries full and let
              the governor work the best land — order usually returns on its own once the people
              are fed and entertained.
            </div>
          </>
        ) : (
          <>
            <div className="gm-section">
              <div className="gm-section-title">Back to work</div>
              <ul className="gm-list">
                <li>The riots have ended and the citizens have returned to their trades.</li>
                <li>Production and tax collection have resumed as normal.</li>
                <li>The city counts as peaceful again — no penalty carries over into next turn.</li>
              </ul>
            </div>
            <div className="gm-note">
              Keep an eye on what drove them to the streets: the same pressure will build again
              if the balance of tax, food and luxury stays where it is.
            </div>
          </>
        )}
      </GameModal>
    );
  };

  // Trade-route result: a Caravan delivered — lump-sum gold + science now,
  // plus a permanent per-turn route between the two cities.
  const renderTradeRouteResult = () => (
    <GameModal
      show={uiState.activeDialog === 'trade-route-result'}
      onClose={handleCloseDialog}
      size="lg"
      tone="gold"
      icon="🐫"
      artLabel="the caravan road"
      eyebrow={stamp('Caravan Report')}
      title="Trade Route Established"
      lede={
        tradeRouteResult ? (
          <>
            Your caravan has delivered its cargo to <strong>{tradeRouteResult.destCityName}</strong>{' '}
            from {tradeRouteResult.homeCityName}, {tradeRouteResult.distance} tiles from home. The
            merchants are back on the road — and the road now pays.
          </>
        ) : (
          <>Your caravan delivered its cargo and the merchants have opened a road of trade.</>
        )
      }
      actions={
        <button type="button" className="touch-btn touch-btn--primary" onClick={handleCloseDialog}>
          Excellent
        </button>
      }
    >
      {tradeRouteResult ? (
        <>
          <div className="gm-stat-grid">
            <div className="gm-stat gm-stat--accent">
              <span className="gm-stat-value">
                <span className="gm-stat-icon" aria-hidden="true">🪙</span>+{tradeRouteResult.gold}
              </span>
              <span className="gm-stat-label">Gold, paid now</span>
            </div>
            <div className="gm-stat gm-stat--accent">
              <span className="gm-stat-value">
                <span className="gm-stat-icon" aria-hidden="true">🔬</span>+{tradeRouteResult.science}
              </span>
              <span className="gm-stat-label">Science, paid now</span>
            </div>
            <div className="gm-stat">
              <span className="gm-stat-value">
                <span className="gm-stat-icon" aria-hidden="true">↔️</span>
                {tradeRouteResult.distance}
              </span>
              <span className="gm-stat-label">Tiles between the two</span>
            </div>
          </div>

          {(tradeRouteResult.foreign || tradeRouteResult.intercontinental) && (
            <div className="gm-callout">
              <span className="gm-callout-title">A richer delivery</span>
              {tradeRouteResult.foreign && <>Foreign city — the bonus is doubled. </>}
              {tradeRouteResult.intercontinental && <>Across the water — the bonus is doubled. </>}
              Dealing with strangers pays better than dealing with your own.
            </div>
          )}

          <div className="gm-section">
            <div className="gm-section-title">The road stays open</div>
            <p className="gm-prose">
              Both cities now share a <strong>permanent trade route</strong>, adding trade every
              single turn from now on. A city keeps up to three routes, and a better road always
              replaces a weaker one.
            </p>
          </div>
        </>
      ) : (
        <p className="gm-prose">Your caravan established a trade route.</p>
      )}
    </GameModal>
  );

  return (
    <>
      {renderTechTree()}
      <ResearchRequiredModal
        show={uiState.activeDialog === 'research-required'}
        onHide={handleCloseDialog}
        onChooseResearch={() => actions.showDialog('tech')}
      />
      {renderResearchComplete()}
      {renderDiplomacy()}
      {renderHelp()}
      <CityModal show={uiState.activeDialog === 'city-details'} onHide={handleCloseDialog} selectedCity={selectedCity} gameEngine={gameEngine} actions={actions} currentPlayer={currentPlayer} isPlayerCity={isPlayerCity} />
      <RatesModal show={uiState.activeDialog === 'rates'} onHide={handleCloseDialog} gameEngine={gameEngine} />
      <GovernmentModal show={uiState.activeDialog === 'government'} onHide={handleCloseDialog} gameEngine={gameEngine} />
      <StatisticsModal show={uiState.activeDialog === 'statistics'} onHide={handleCloseDialog} />
      <WondersOverviewModal show={uiState.activeDialog === 'wonders'} onHide={handleCloseDialog} />
      <WonderCompletedModal
        show={uiState.activeDialog === 'wonder-completed'}
        notice={completedWonderNotice}
        onContinue={handleWonderContinue}
      />
      <WonderConflictModal
        show={uiState.activeDialog === 'wonder-conflict'}
        notice={conflictWonderNotice}
        onGoToCity={handleWonderGoToCity}
        onClose={handleWonderContinue}
      />
      <VillageModal show={uiState.activeDialog === 'village'} onHide={handleVillageClose} />
      <CombatReportModal
        show={uiState.activeDialog === 'combat-report'}
        notice={combatReport}
        stampLabel={turnStamp()}
        attackerCivName={civName(combatReport?.attackerCivId)}
        defenderCivName={civName(combatReport?.defenderCivId)}
        terrainName={terrainAt(combatReport?.col, combatReport?.row)}
        humanWon={combatReport?.kind === 'victory'}
        onContinue={handleCombatReportContinue}
        onCentre={handleCombatReportCentre}
      />
      <CityEventModal
        show={uiState.activeDialog === 'city-founded' || uiState.activeDialog === 'city-lost'}
        notice={cityEvent}
        stampLabel={turnStamp()}
        byCivName={civName(cityEvent?.byCivId)}
        terrainName={terrainAt(cityEvent?.col, cityEvent?.row)}
        playerCivId={playerCivId}
        onContinue={handleCityEventContinue}
        onGoToCity={handleCityEventGoToCity}
      />
      {renderUpkeepDisbanded()}
      {renderCityStarved()}
      {renderCityDisorder()}
      {renderAutoEndOffer()}
      {renderTradeRouteResult()}
      {renderCityProduction()}
    </>
  );
};

export default GameModals;
