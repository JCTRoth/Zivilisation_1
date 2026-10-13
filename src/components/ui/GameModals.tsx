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
import AudienceModal from './gamemodals/AudienceModal';
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
import { useTranslation } from '@/i18n/useTranslation';
import { tBuildingName, tTechName, tUnitName } from '@/i18n/dataNames';
import type { TranslationKey } from '@/i18n';

const GameModals = ({ gameEngine }: { gameEngine?: GameEngine | null }) => {
  const { t } = useTranslation();
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
    `${prefix} · ${t('common.turn', { turn: gameState.currentTurn ?? 1 })} · ${GameUtils.formatYear(gameState.currentYear ?? -4000)}`;

  /** Just the turn/year part, for modals that carry their own eyebrow prefix. */
  const turnStamp = () =>
    `${t('common.turn', { turn: gameState.currentTurn ?? 1 })} · ${GameUtils.formatYear(gameState.currentYear ?? -4000)}`;

  const civilizations = useGameStore(state => state.civilizations);
  const incomingDiplomacyOffer = useGameStore(state => state.incomingDiplomacyOffer);
  const audienceNotice = useGameStore(state => state.audienceNotice);
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

  /** Localized display name for a production id (unit table first, then buildings). */
  const productionDataName = (id: string, fallback: string): string =>
    UNIT_PROPS[id] ? tUnitName(id, fallback) : BUILDING_PROPERTIES[id] ? tBuildingName(id, fallback) : fallback;

  const getProductionName = (item: string | { name?: string; type?: string; itemType?: string } | null | undefined): string => {
    if (!item) return t('gm.unknown' as TranslationKey);
    if (typeof item === 'string') {
      return productionDataName(item, UNIT_PROPS[item]?.name || BUILDING_PROPERTIES[item]?.name || capitalizeName(item));
    }
    if (item.name) return item.name;
    if (item.itemType) {
      return productionDataName(item.itemType, UNIT_PROPS[item.itemType]?.name || BUILDING_PROPERTIES[item.itemType]?.name || capitalizeName(item.itemType));
    }
    if (item.type) {
      return productionDataName(item.type, BUILDING_PROPERTIES[item.type]?.name || capitalizeName(item.type));
    }
    return t('gm.unknown' as TranslationKey);
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

  /** Empire colour of a civ — the banner a captured city lowers. */
  const civColor = (civId?: number) =>
    (civId === undefined ? null : civilizations.find(c => c.id === civId)?.color) ?? undefined;

  /** The civ's device/emoji, drawn on the banner. */
  const civIcon = (civId?: number) =>
    (civId === undefined ? null : civilizations.find(c => c.id === civId)?.icon) ?? undefined;

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
        notify('info', t('gm.research.locked' as TranslationKey));
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
          <button type="button" className="gm-close" onClick={handleCloseDialog} aria-label={t('common.close')}>
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
          <header className="gm-hero gm-hero--slim">
            <div className="gm-art gm-art--plain">
              <span className="gm-art-glyph" aria-hidden="true">💡</span>
              <span className="gm-art-tag">{t('gm.tech.artTag' as TranslationKey)}</span>
            </div>
            <div className="gm-heading">
              <div className="gm-eyebrow">{stamp(t('gm.research.eyebrow' as TranslationKey))}</div>
              <h2 className="gm-title">{t('gm.tech.title' as TranslationKey)}</h2>
              <p className="gm-lede">
                {t('gm.tech.lede' as TranslationKey)}
              </p>
            </div>
          </header>
          <div className="gm-content gm-content--fill">
            <React.Suspense fallback={<div className="gm-prose">{t('gm.tech.suspense' as TranslationKey)}</div>}>
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
        artLabel={t('gm.researchComplete.artLabel' as TranslationKey)}
        dialogClassName="research-complete-modal"
        eyebrow={stamp(t('gm.researchComplete.eyebrow' as TranslationKey))}
        title={tTechName(lastResearchedTech.id, lastResearchedTech.name)}
        lede={
          lastResearchedTech.description ||
          t('gm.researchComplete.lede' as TranslationKey)
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
              {t('gm.researchComplete.continueWith' as TranslationKey, { name: tTechName(nextTech.id, nextTech.name) })}
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
              {t('gm.researchComplete.chooseNew' as TranslationKey)}
            </button>
          )
        }
      >
        <div className="gm-section">
          <div className="gm-section-title">{t('gm.researchComplete.pathTitle' as TranslationKey)}</div>
          {nextTech ? (
            <p className="gm-prose">
              {t('gm.researchComplete.next.pre' as TranslationKey)}{' '}
              <strong>{tTechName(nextTech.id, nextTech.name)}</strong>
              {t('gm.researchComplete.next.post' as TranslationKey)}
            </p>
          ) : (
            <p className="gm-prose">
              {t('gm.researchComplete.exhausted' as TranslationKey)}
            </p>
          )}
        </div>
        <div className="gm-note">
          {t('gm.researchComplete.note' as TranslationKey)}
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
        ? t('gm.diplo.feed.offerAccepted' as TranslationKey, { civ: fromCiv?.name ?? t('gm.diplo.feed.them' as TranslationKey), term: offer.action.replace(/_/g, ' ') })
        : result.reason
          ? t('gm.diplo.feed.offerFailedReason' as TranslationKey, { reason: String(result.reason) })
          : t('gm.diplo.feed.offerFailed' as TranslationKey));
    } else {
      addDiploLog(t('gm.diplo.feed.offerDeclined' as TranslationKey, { civ: fromCiv?.name ?? t('gm.diplo.feed.them' as TranslationKey) }));
    }
    actions.clearIncomingDiplomacyOffer();
    // Tech swaps change what each civ knows — refresh the store mirror.
    if (accept && gameEngine?.civilizations) {
      actions.updateCivilizations([...gameEngine.civilizations]);
    }
  };

  /**
   * Answer the leader audience. A greeting has nothing to decide; an offer is
   * executed exactly as the AI wrote it — the player never chose the terms, so
   * there is nothing to re-negotiate here, only yes or no.
   */
  const handleAudienceDecision = (accept: boolean): void => {
    const notice = useGameStore.getState().audienceNotice;
    if (!notice) return;
    if (accept && notice.mode === 'offer' && gameEngine?.diplomacyManager) {
      const result = gameEngine.diplomacyManager.acceptOffer({
        fromCivId: notice.civId,
        toCivId: currentPlayer?.id ?? 0,
        action: notice.action as DiplomatAction,
        goldAmount: notice.goldAmount,
        techOffered: notice.techOffered,
        techRequested: notice.techRequested,
      });
      const civName = civilizations[notice.civId]?.name ?? t('gm.unknown' as TranslationKey);
      notify(
        result.accepted ? 'success' : 'warning',
        result.accepted
          ? t('gm.diplo.feed.offerAccepted' as TranslationKey, {
            civ: civName,
            term: (notice.action ?? '').replace(/_/g, ' '),
          })
          : result.reason
            ? t('gm.diplo.feed.offerFailedReason' as TranslationKey, { reason: String(result.reason) })
            : t('gm.diplo.feed.offerFailed' as TranslationKey),
      );
      // A tech swap changes what each civ knows — refresh the store mirror.
      if (gameEngine?.civilizations) {
        actions.updateCivilizations([...gameEngine.civilizations]);
      }
    } else if (!accept && notice.mode === 'offer') {
      const civName = civilizations[notice.civId]?.name ?? t('gm.unknown' as TranslationKey);
      notify('info', t('gm.diplo.feed.offerDeclined' as TranslationKey, { civ: civName }));
    }

    // The audience defers auto-end like every other decision screen, so
    // dismissing it re-checks whether the turn can now run out of moves.
    handleCloseDialog();
    actions.clearAudience();
  };

  /**
   * Close the audience without answering: same re-check as any other blocking
   * screen, just without a proposal to resolve.
   */
  const handleAudienceLeave = (): void => {
    handleCloseDialog();
    actions.clearAudience();
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
      friendly: { label: t('gm.diplo.attitude.friendly' as TranslationKey), color: '#4caf50' },
      neutral: { label: t('gm.diplo.attitude.neutral' as TranslationKey), color: '#9e9e9e' },
      annoyed: { label: t('gm.diplo.attitude.annoyed' as TranslationKey), color: '#ff9800' },
      hostile: { label: t('gm.diplo.attitude.hostile' as TranslationKey), color: '#f44336' },
    };

    const TREATY_LABELS: Record<string, { icon: string; label: string }> = {
      open_borders: { icon: '🚪', label: t('gm.diplo.treaty.openBorders' as TranslationKey) },
      trade_agreement: { icon: '📦', label: t('gm.diplo.treaty.tradeAgreement' as TranslationKey) },
      mutual_defense: { icon: '🛡️', label: t('gm.diplo.treaty.mutualDefense' as TranslationKey) },
      non_aggression: { icon: '🤚', label: t('gm.diplo.treaty.nonAggression' as TranslationKey) },
      embargo_target: { icon: '🚫', label: t('gm.diplo.treaty.embargo' as TranslationKey) },
    };

    // Reads an engine action ("propose_peace") as the term the court would
    // actually speak, so a proposal never shows up as snake_case jargon.
    const OFFER_LABELS: Record<string, string> = {
      propose_peace: t('gm.diplo.offer.peace' as TranslationKey),
      propose_ceasefire: t('gm.diplo.offer.ceasefire' as TranslationKey),
      propose_alliance: t('gm.diplo.offer.alliance' as TranslationKey),
      demand_tribute: t('gm.diplo.offer.tribute' as TranslationKey),
      offer_open_borders: t('gm.diplo.offer.openBorders' as TranslationKey),
      propose_trade_agreement: t('gm.diplo.offer.tradeAgreement' as TranslationKey),
      propose_mutual_defense: t('gm.diplo.offer.mutualDefense' as TranslationKey),
      propose_non_aggression: t('gm.diplo.offer.nonAggressionPact' as TranslationKey),
      propose_embargo: t('gm.diplo.offer.embargo' as TranslationKey),
      offer_tech_exchange: t('gm.diplo.offer.techExchange' as TranslationKey),
    };
    const STATUS_LABELS: Record<string, string> = {
      peace: t('gm.diplo.status.peace' as TranslationKey),
      war: t('gm.diplo.status.war' as TranslationKey),
      ceasefire: t('gm.diplo.status.ceasefire' as TranslationKey),
      alliance: t('gm.diplo.status.alliance' as TranslationKey),
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
          addDiploLog(t('gm.diplo.log.declaredWar' as TranslationKey, { civ: String(civilizations[targetId]?.name) }));
          break;
        case 'propose_peace':
          result = dm.processProposal({ fromCivId: playerId, toCivId: targetId, action: 'propose_peace' });
          if (result.counterProposal) {
            setCounterProposal(result.counterProposal);
            addDiploLog(t('gm.diplo.log.peaceCounterOffered' as TranslationKey, { civ: String(civilizations[targetId]?.name) }));
          } else {
            addDiploLog(result.accepted
              ? t('gm.diplo.log.peaceAccepted' as TranslationKey, { civ: String(civilizations[targetId]?.name) })
              : t('gm.diplo.log.peaceRejected' as TranslationKey, { civ: String(civilizations[targetId]?.name), reason: String(result.reason) }));
          }
          break;
        case 'propose_ceasefire':
          result = dm.processProposal({ fromCivId: playerId, toCivId: targetId, action: 'propose_ceasefire' });
          if (result.counterProposal) {
            setCounterProposal(result.counterProposal);
            addDiploLog(t('gm.diplo.log.ceasefireCounter' as TranslationKey, { civ: String(civilizations[targetId]?.name) }));
          } else {
            addDiploLog(result.accepted
              ? t('gm.diplo.log.ceasefireAgreed' as TranslationKey, { civ: String(civilizations[targetId]?.name) })
              : t('gm.diplo.log.ceasefireRejected' as TranslationKey, { civ: String(civilizations[targetId]?.name), reason: String(result.reason) }));
          }
          break;
        case 'propose_alliance':
          result = dm.processProposal({ fromCivId: playerId, toCivId: targetId, action: 'propose_alliance' });
          if (result.counterProposal) {
            setCounterProposal(result.counterProposal);
            addDiploLog(t('gm.diplo.log.allianceCounter' as TranslationKey, { civ: String(civilizations[targetId]?.name) }));
          } else {
            addDiploLog(result.accepted
              ? t('gm.diplo.log.allianceFormed' as TranslationKey, { civ: String(civilizations[targetId]?.name) })
              : t('gm.diplo.log.allianceRejected' as TranslationKey, { civ: String(civilizations[targetId]?.name), reason: String(result.reason) }));
          }
          break;
        case 'demand_tribute': {
          const demand = extra?.goldAmount ?? 50;
          result = dm.processProposal({ fromCivId: playerId, toCivId: targetId, action: 'demand_tribute', goldAmount: demand });
          if (result.counterProposal) {
            setCounterProposal(result.counterProposal);
            addDiploLog(t('gm.diplo.log.tributeCounter' as TranslationKey, { civ: String(civilizations[targetId]?.name) }));
          } else {
            addDiploLog(result.accepted
              ? t('gm.diplo.log.tributePaid' as TranslationKey, { civ: String(civilizations[targetId]?.name), gold: result.goldTransferred ?? demand })
              : t('gm.diplo.log.demandRefused' as TranslationKey, { civ: String(civilizations[targetId]?.name), reason: String(result.reason) }));
          }
          break;
        }
        case 'offer_open_borders':
          result = dm.processProposal({ fromCivId: playerId, toCivId: targetId, action: 'offer_open_borders' });
          addDiploLog(result.accepted
            ? t('gm.diplo.log.openBordersEstablished' as TranslationKey, { civ: String(civilizations[targetId]?.name) })
            : t('gm.diplo.log.openBordersRefused' as TranslationKey, { civ: String(civilizations[targetId]?.name) }));
          break;
        case 'propose_trade_agreement':
          result = dm.processProposal({ fromCivId: playerId, toCivId: targetId, action: 'propose_trade_agreement', goldAmount: 2 });
          addDiploLog(result.accepted
            ? t('gm.diplo.log.tradeSigned' as TranslationKey, { civ: String(civilizations[targetId]?.name) })
            : t('gm.diplo.log.tradeRefused' as TranslationKey, { civ: String(civilizations[targetId]?.name) }));
          break;
        case 'propose_mutual_defense':
          result = dm.processProposal({ fromCivId: playerId, toCivId: targetId, action: 'propose_mutual_defense' });
          addDiploLog(result.accepted
            ? t('gm.diplo.log.mutualDefensePact' as TranslationKey, { civ: String(civilizations[targetId]?.name) })
            : t('gm.diplo.log.defensePactRefused' as TranslationKey, { civ: String(civilizations[targetId]?.name) }));
          break;
        case 'propose_non_aggression':
          result = dm.processProposal({ fromCivId: playerId, toCivId: targetId, action: 'propose_non_aggression' });
          addDiploLog(result.accepted
            ? t('gm.diplo.log.nonAggressionSigned' as TranslationKey, { civ: String(civilizations[targetId]?.name) })
            : t('gm.diplo.log.pactRefused' as TranslationKey, { civ: String(civilizations[targetId]?.name) }));
          break;
        case 'propose_embargo':
          result = dm.processProposal({
            fromCivId: playerId,
            toCivId: targetId,
            action: 'propose_embargo',
            embargoTargetId: extra?.embargoTargetId,
          });
          addDiploLog(result.accepted
            ? t('gm.diplo.log.embargoAgreed' as TranslationKey, { civ: String(civilizations[targetId]?.name), target: civilizations[extra?.embargoTargetId ?? -1]?.name ?? t('gm.diplo.log.theTarget' as TranslationKey) })
            : t('gm.diplo.log.embargoRejected' as TranslationKey, { civ: String(civilizations[targetId]?.name), reason: String(result.reason) }));
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
            ? t('gm.diplo.log.techExchanged' as TranslationKey, { civ: String(civilizations[targetId]?.name) })
            : t('gm.diplo.log.exchangeRejected' as TranslationKey, { civ: String(civilizations[targetId]?.name), reason: String(result.reason) }));
          break;
        case 'cancel_treaty': {
          const treaty = extra?.treaty as TreatyType | undefined;
          if (treaty) {
            dm.cancelTreaty(playerId, targetId, treaty);
            addDiploLog(t('gm.diplo.log.treatyCancelled' as TranslationKey, { treaty: TREATY_LABELS[treaty]?.label || treaty, civ: String(civilizations[targetId]?.name) }));
          }
          break;
        }
        case 'accept_counter': {
          if (counterProposal) {
            const cpResult = dm.processProposal({ ...counterProposal, action: counterProposal.action as DiplomatAction });
            const cpAction = counterProposal.action.replace(/_/g, ' ');
            addDiploLog(cpResult.accepted
              ? t('gm.diplo.log.counterAccepted' as TranslationKey, { term: cpAction })
              : t('gm.diplo.log.counterFailed' as TranslationKey));
            setCounterProposal(null);
          }
          break;
        }
        case 'reject_counter':
          addDiploLog(t('gm.diplo.log.counterRejected' as TranslationKey));
          setCounterProposal(null);
          break;
      }
      // Force re-render by syncing state
      if (gameEngine?.units) actions.updateUnits?.([...gameEngine.units]);
      if (gameEngine?.civilizations) actions.updateCivilizations?.([...gameEngine.civilizations]);
    };

    const selectedCivData = selectedDiploCiv !== null ? civilizations[selectedDiploCiv] : null;
    const selectedStatus = selectedDiploCiv !== null ? (dm?.getStatus(playerId, selectedDiploCiv) ?? 'peace') : 'peace';
    /**
     * Whether a diplomatic channel exists with the selected court. Without an
     * embassy the rival is still listed — you have met them — but their ledgers
     * stay shut and no term can be tabled. This is what makes "Establish
     * Embassy" a decision rather than a formality.
     */
    const hasEmbassy = selectedDiploCiv !== null
      ? (typeof dm?.hasEmbassy === 'function' ? dm.hasEmbassy(playerId, selectedDiploCiv) : true)
      : false;
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
        artLabel={heroArt ? undefined : t('gm.diplo.artLabel' as TranslationKey)}
        artAlt={leaderName || t('gm.diplo.artLabel' as TranslationKey)}
        eyebrow={stamp(t('gm.diplo.eyebrow' as TranslationKey))}
        title={t('gm.diplo.title' as TranslationKey)}
        lede={t('gm.diplo.lede' as TranslationKey)}
        actions={
          <>
            <span className="gm-actions-spacer" />
            <button type="button" className="touch-btn touch-btn--ghost" onClick={closeDiplomacy}>
              {t('common.close')}
            </button>
          </>
        }
      >
          {/* Pending AI→player proposal awaiting an accept/reject decision */}
          {incomingDiplomacyOffer && (
            <div className="diplomacy-incoming-offer">
              <div className="gm-section-title">{t('gm.diplo.incoming.title' as TranslationKey)}</div>
              <div className="diplomacy-incoming-text">
                {t('gm.diplo.incoming.pre' as TranslationKey, { civ: civilizations[incomingDiplomacyOffer.fromCivId]?.name ?? t('gm.unknown' as TranslationKey) })} <strong>{offerTerm(incomingDiplomacyOffer.action)}</strong>
                {incomingDiplomacyOffer.goldAmount ? t('gm.diplo.incoming.goldSuffix' as TranslationKey, { gold: incomingDiplomacyOffer.goldAmount }) : ''}
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
                <button className="diplomacy-btn btn-peace" onClick={() => handleIncomingOffer(true)}>{t('gm.diplo.accept' as TranslationKey)}</button>
                <button className="diplomacy-btn btn-war" onClick={() => handleIncomingOffer(false)}>{t('gm.diplo.reject' as TranslationKey)}</button>
              </div>
            </div>
          )}
          {/* Outcome of the last few proposals — without this the buttons gave
              no feedback unless a counter-offer happened to come back. */}
          {diplomacyFeed.length > 0 && (
            <section className="gm-section">
              <div className="gm-section-title">{t('gm.diplo.feed.title' as TranslationKey)}</div>
              <div className="diplomacy-log diplomacy-feed">
                {diplomacyFeed.slice(0, 4).map((line, i) => (
                  <div key={i} className="diplomacy-log-entry">{line}</div>
                ))}
              </div>
            </section>
          )}
          {otherCivs.length === 0 ? (
            <section className="gm-section">
              <div className="gm-section-title">{t('gm.diplo.empty.title' as TranslationKey)}</div>
              <p className="gm-prose">{t('gm.diplo.empty.prose' as TranslationKey)}</p>
            </section>
          ) : (
            <div className="diplomacy-layout gm-section gm-section--flush">
              {/* Left: Civilization list */}
              <div className="diplomacy-civ-list">
                <div className="gm-section-title diplomacy-pane-title">{t('gm.diplo.knownCourts' as TranslationKey)}</div>
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
                        <div className="diplomacy-leader-name">{leaderName || t('gm.diplo.unknownLeader' as TranslationKey)}</div>
                        <div className="diplomacy-leader-title">
                          {portraitConfig?.title || t('gm.diplo.leaderTitle' as TranslationKey, { civ: selectedCivData.name })}
                        </div>
                        <div className="diplomacy-attitude-badge" style={{
                          color: ATTITUDE_LABELS[selectedAttitude]?.color || '#9e9e9e',
                          borderColor: ATTITUDE_LABELS[selectedAttitude]?.color || '#9e9e9e',
                        }}>
                          {ATTITUDE_LABELS[selectedAttitude]?.label || t('gm.unknown' as TranslationKey)}
                        </div>
                        {/* Whether a channel exists at all — the gate on every
                            term below. */}
                        <div className={`diplomacy-embassy-chip ${hasEmbassy ? 'is-established' : 'is-missing'}`}>
                          {hasEmbassy ? '🏛️ ' : '🔒 '}
                          {hasEmbassy
                            ? t('gm.diplo.embassy.est' as TranslationKey)
                            : t('gm.diplo.embassy.none' as TranslationKey)}
                        </div>
                        {/* Attitude meter: hostile ← → friendly. The scale is
                            clamped to ±40, the range the bands actually use. */}
                        <div
                          className="diplomacy-attitude-meter"
                          title={t('gm.diplo.attitudeScore' as TranslationKey, { score: `${selectedAttitudeScore > 0 ? '+' : ''}${Math.round(selectedAttitudeScore)}` })}
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
                          <span>{t('gm.diplo.attitude.hostile' as TranslationKey)}</span>
                          <span>{selectedAttitudeScore > 0 ? '+' : ''}{Math.round(selectedAttitudeScore)}</span>
                          <span>{t('gm.diplo.attitude.friendly' as TranslationKey)}</span>
                        </div>
                      </div>

                      {/* Status panel: the stance as a chip, the ledger below */}
                      <div className="diplomacy-status-panel">
                        <span className={`diplomacy-status-value status-${selectedStatus} gm-chip`}>
                          {STATUS_ICONS[selectedStatus]} {(STATUS_LABELS[selectedStatus] ?? selectedStatus).toUpperCase()}
                        </span>
                        {selectedRelation && (
                          /* Goodwill is the one number the whole model turns on,
                             so it leads; the rest of the ledger follows. Without
                             an embassy none of it is readable — an untrained
                             eye cannot tell courtesy from calculation. */
                          <div className="gm-kv-grid gm-kv-grid--stack diplomacy-facts">
                            {!hasEmbassy ? (
                              <div className="gm-kv diplomacy-locked-value">
                                {t('gm.diplo.embassy.hint' as TranslationKey)}
                              </div>
                            ) : (
                              <>
                                <div className="gm-kv">
                                  {t('gm.diplo.goodwill' as TranslationKey)}{' '}
                                  <b style={{ color: selectedGoodwill < 0 ? '#f44336' : selectedGoodwill > 0 ? '#4caf50' : '#9e9e9e' }}>
                                    {selectedGoodwill > 0 ? '+' : ''}{selectedGoodwill}
                                  </b>
                                </div>
                                {selectedTheirOpinion.grievance >= 10 && (
                                  <div className="gm-kv">
                                    {t('gm.diplo.grievance' as TranslationKey)} <b style={{ color: '#ff9800' }}>{Math.round(selectedTheirOpinion.grievance)}</b>
                                  </div>
                                )}
                                {selectedTheirOpinion.fear >= 20 && (
                                  <div className="gm-kv">
                                    {t('gm.diplo.fear' as TranslationKey)} <b style={{ color: '#ba68c8' }}>{Math.round(selectedTheirOpinion.fear)}</b>
                                  </div>
                                )}
                                <div className="gm-kv">
                                  {t('gm.diplo.sinceTurn' as TranslationKey)} <b style={{ color: '#aaa' }}>{selectedRelation.since}</b>
                                </div>
                              </>
                            )}
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
                      const strengthLabel = ratio > 2 ? t('gm.diplo.strength.supreme' as TranslationKey) : ratio > 1.3 ? t('gm.diplo.strength.superior' as TranslationKey) : ratio > 0.8 ? t('gm.diplo.strength.comparable' as TranslationKey) : ratio > 0.5 ? t('gm.diplo.strength.weaker' as TranslationKey) : t('gm.diplo.strength.inferior' as TranslationKey);
                      const strengthColor = ratio > 1.3 ? '#4caf50' : ratio > 0.8 ? '#9e9e9e' : '#f44336';
                      return (
                        <section className="gm-section">
                          <div className="gm-section-title">{t('gm.diplo.strength.title' as TranslationKey)}</div>
                          <div className="diplomacy-strength-section">
                            <span style={{ color: strengthColor, fontWeight: 'bold' }}>{strengthLabel}</span>
                            <div className="diplomacy-strength-bar-visual">
                              <div className="diplomacy-strength-fill-player" style={{ width: `${playerPct}%` }} />
                              <div className="diplomacy-strength-fill-enemy" style={{ width: `${100 - playerPct}%` }} />
                            </div>
                            <span className="diplomacy-strength-nums">{t('gm.diplo.strength.nums' as TranslationKey, { you: Math.round(playerStr), them: Math.round(theirStr) })}</span>
                          </div>
                        </section>
                      );
                    })()}

                    {/* Active treaties display */}
                    {activeTreaties.length > 0 && (
                      <section className="gm-section">
                        <div className="gm-section-title">{t('gm.diplo.treatiesInForce' as TranslationKey)}</div>
                        <div className="diplomacy-treaty-badges">
                          {activeTreaties.map((treaty: string) => (
                            <span key={treaty} className="diplomacy-treaty-badge">
                              {TREATY_LABELS[treaty]?.icon || '📜'} {TREATY_LABELS[treaty]?.label || treaty}
                              <button
                                className="diplomacy-treaty-cancel"
                                onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'cancel_treaty', { treaty })}
                                title={t('gm.diplo.cancelTreaty' as TranslationKey)}
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
                          {verdict.accepted ? t('gm.diplo.verdict.paid' as TranslationKey) : t('gm.diplo.verdict.refused' as TranslationKey)}
                        </span>
                        <span className="diplomacy-verdict-score">
                          {t('gm.diplo.verdict.score' as TranslationKey, { score: verdict.score, threshold: verdict.threshold })}
                        </span>
                        <span className="diplomacy-verdict-why">
                          {t('gm.diplo.verdict.decisive' as TranslationKey, { factor: verdict.decisiveFactor })}
                          {verdict.vetoed ? t('gm.diplo.verdict.vetoed' as TranslationKey) : ''}
                        </span>
                      </div>
                    )}

                    {/* What they remember, with the points it cost. This is the
                        "why do they hate me" list — the model records a reason
                        for every single thing that moved the number above. */}
                    {selectedReasons.length > 0 && (
                      <div className="diplomacy-reasons">
                        <div className="gm-section-title">{t('gm.diplo.remember.title' as TranslationKey)}</div>
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
                        <div className="gm-section-title">{t('gm.diplo.counter.title' as TranslationKey)}</div>
                        <div className="diplomacy-counter-text">
                          {t('gm.diplo.counter.pre' as TranslationKey, { civ: civilizations[selectedDiploCiv!]?.name ?? '' })} <strong>{offerTerm(counterProposal.action)}</strong>
                          {counterProposal.goldAmount ? t('gm.diplo.incoming.goldSuffix' as TranslationKey, { gold: counterProposal.goldAmount }) : ''}
                        </div>
                        <div className="diplomacy-counter-buttons">
                          <button className="diplomacy-btn btn-peace" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'accept_counter')}>
                            {t('gm.diplo.accept' as TranslationKey)}
                          </button>
                          <button className="diplomacy-btn btn-war" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'reject_counter')}>
                            {t('gm.diplo.reject' as TranslationKey)}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Negotiation buttons — locked until an embassy exists. */}
                    <section className="gm-section">
                      <div className="gm-section-title">{t('gm.diplo.terms' as TranslationKey)}</div>
                      {!hasEmbassy ? (
                        <div className="diplomacy-embassy-gate">
                          <span className="diplomacy-embassy-gate__badge">
                            🏛️ {t('gm.diplo.embassy.required' as TranslationKey)}
                          </span>
                          <p className="diplomacy-embassy-gate__hint">
                            {t('gm.diplo.embassy.hint' as TranslationKey)}
                          </p>
                        </div>
                      ) : (
                      <div className="diplomacy-actions">
                      {selectedStatus === 'war' && (
                        <>
                          <button className="diplomacy-btn btn-ceasefire" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'propose_ceasefire')}>
                            {t('gm.diplo.btn.proposeCeasefire' as TranslationKey)}
                          </button>
                          <button className="diplomacy-btn btn-peace" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'propose_peace')}>
                            {t('gm.diplo.btn.offerPeace' as TranslationKey)}
                          </button>
                        </>
                      )}
                      {selectedStatus === 'ceasefire' && (
                        <>
                          <button className="diplomacy-btn btn-peace" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'propose_peace')}>
                            {t('gm.diplo.btn.offerPeaceTreaty' as TranslationKey)}
                          </button>
                          <button className="diplomacy-btn btn-war" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'declare_war')}>
                            {t('gm.diplo.btn.declareWar' as TranslationKey)}
                          </button>
                        </>
                      )}
                      {selectedStatus === 'peace' && (
                        <>
                          <button className="diplomacy-btn btn-alliance" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'propose_alliance')}>
                            {t('gm.diplo.btn.proposeAlliance' as TranslationKey)}
                          </button>
                          <span className="diplomacy-tribute-group">
                            <input
                              type="number"
                              min={0}
                              step={10}
                              className="diplomacy-tribute-input"
                              value={tributeAmount}
                              onChange={(e) => setTributeAmount(Math.max(0, Number(e.target.value) || 0))}
                              title={t('gm.diplo.tributeTitle' as TranslationKey)}
                            />
                            <button
                              className="diplomacy-btn btn-tribute"
                              onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'demand_tribute', { goldAmount: tributeAmount })}
                            >
                              {t('gm.diplo.btn.demandTribute' as TranslationKey)}
                            </button>
                          </span>
                          <button className="diplomacy-btn btn-war" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'declare_war')}>
                            {t('gm.diplo.btn.declareWar' as TranslationKey)}
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
                              title={t('gm.diplo.tributeTitle' as TranslationKey)}
                            />
                            <button
                              className="diplomacy-btn btn-tribute"
                              onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'demand_tribute', { goldAmount: tributeAmount })}
                            >
                              {t('gm.diplo.btn.demandTribute' as TranslationKey)}
                            </button>
                          </span>
                          <button className="diplomacy-btn btn-war" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'declare_war')}>
                            {t('gm.diplo.btn.breakAlliance' as TranslationKey)}
                          </button>
                        </>
                      )}
                    </div>
                      )}

                    {/* Advanced treaties toggle */}
                    {selectedStatus !== 'war' && hasEmbassy && (
                      <>
                        <button
                          className="diplomacy-toggle-treaties"
                          onClick={() => setShowTreatyPanel(!showTreatyPanel)}
                        >
                          {showTreatyPanel ? '▾' : '▸'} {t('gm.diplo.advancedTreaties' as TranslationKey)}
                        </button>
                        {showTreatyPanel && (
                          <div className="diplomacy-actions diplomacy-treaty-actions">
                            {!activeTreaties.includes('open_borders') && (
                              <button className="diplomacy-btn btn-treaty" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'offer_open_borders')}>
                                {t('gm.diplo.btn.openBorders' as TranslationKey)}
                              </button>
                            )}
                            {!activeTreaties.includes('trade_agreement') && (
                              <button className="diplomacy-btn btn-treaty" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'propose_trade_agreement')}>
                                {t('gm.diplo.btn.tradeAgreement' as TranslationKey)}
                              </button>
                            )}
                            {!activeTreaties.includes('mutual_defense') && (
                              <button className="diplomacy-btn btn-treaty" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'propose_mutual_defense')}>
                                {t('gm.diplo.btn.mutualDefensePact' as TranslationKey)}
                              </button>
                            )}
                            {!activeTreaties.includes('non_aggression') && (
                              <button className="diplomacy-btn btn-treaty" onClick={() => handleDiplomacyAction(selectedDiploCiv!, 'propose_non_aggression')}>
                                {t('gm.diplo.btn.nonAggressionPact' as TranslationKey)}
                              </button>
                            )}

                            {/* Embargo a third party together */}
                            {otherCivs.filter((c: Civilization) => c.id !== selectedDiploCiv).length > 0 && (
                              <span className="diplomacy-treaty-group">
                                <select
                                  className="diplomacy-select"
                                  value={embargoTarget}
                                  onChange={(e) => setEmbargoTarget(e.target.value === '' ? '' : Number(e.target.value))}
                                  title={t('gm.diplo.embargoSelectTitle' as TranslationKey)}
                                >
                                  <option value="">{t('gm.diplo.embargoTarget' as TranslationKey)}</option>
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
                                  {t('gm.diplo.btn.embargo' as TranslationKey)}
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
                                    <span className="diplomacy-tech-exchange__title">{t('gm.diplo.exchange.title' as TranslationKey)}</span>
                                    <span className="diplomacy-tech-exchange__hint">
                                      {canTrade && !canTrade.ok
                                        ? canTrade.reason
                                        : t('gm.diplo.exchange.emptyHint' as TranslationKey)}
                                    </span>
                                  </div>
                                );
                              }
                              return (
                                <div className="diplomacy-tech-exchange">
                                  <span className="diplomacy-tech-exchange__title">{t('gm.diplo.exchange.title' as TranslationKey)}</span>
                                  <span className="diplomacy-tech-exchange__hint">
                                    {t('gm.diplo.exchange.hint' as TranslationKey)}
                                  </span>
                                  <div className="diplomacy-tech-exchange__cols">
                                    <label className="diplomacy-tech-exchange__col">
                                      <span className="diplomacy-tech-exchange__col-label">{t('gm.diplo.exchange.theyHave' as TranslationKey)}</span>
                                      <select
                                        className="diplomacy-select"
                                        value={techRequest}
                                        onChange={(e) => setTechRequest(e.target.value)}
                                      >
                                        <option value="">{t('gm.diplo.exchange.request' as TranslationKey)}</option>
                                        {trade.theyHaveWeLack.map((id: string) => (
                                          <option key={id} value={id}>{techName(id)}</option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="diplomacy-tech-exchange__col">
                                      <span className="diplomacy-tech-exchange__col-label">{t('gm.diplo.exchange.youHave' as TranslationKey)}</span>
                                      <select
                                        className="diplomacy-select"
                                        value={techOffer}
                                        onChange={(e) => setTechOffer(e.target.value)}
                                      >
                                        <option value="">{t('gm.diplo.exchange.offer' as TranslationKey)}</option>
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
                                    {t('gm.diplo.exchange.button' as TranslationKey)}
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
                          <div className="gm-section-title">{t('gm.diplo.record.title' as TranslationKey)}</div>
                          <div className="diplomacy-log">
                            {relevant.map((e, i: number) => {
                              const from = civilizations[e.fromCivId]?.name ?? t('gm.diplo.civFallback' as TranslationKey, { id: e.fromCivId });
                              const to = civilizations[e.toCivId]?.name ?? t('gm.diplo.civFallback' as TranslationKey, { id: e.toCivId });
                              const labels: Record<string, string> = {
                                war_declared: t('gm.diplo.record.warDeclared' as TranslationKey, { from, to }),
                                peace_made: t('gm.diplo.record.peaceMade' as TranslationKey, { from, to }),
                                ceasefire_signed: t('gm.diplo.record.ceasefireSigned' as TranslationKey, { from, to }),
                                alliance_formed: t('gm.diplo.record.allianceFormed' as TranslationKey, { from, to }),
                                alliance_broken: t('gm.diplo.record.allianceBroken' as TranslationKey, { from, to }),
                                tribute_paid: e.goldAmount
                                  ? t('gm.diplo.record.tributePaid' as TranslationKey, { from, to, gold: e.goldAmount })
                                  : t('gm.diplo.record.tributePaidPlain' as TranslationKey, { from, to }),
                                treaty_rejected: t('gm.diplo.record.treatyRejected' as TranslationKey, { from, to }),
                                unit_bribed: t('gm.diplo.record.unitBribed' as TranslationKey, { from }),
                                intelligence_gathered: t('gm.diplo.record.intelligence' as TranslationKey, { from, to }),
                                open_borders_signed: t('gm.diplo.record.openBorders' as TranslationKey, { from, to }),
                                trade_agreement_signed: t('gm.diplo.record.tradeDeal' as TranslationKey, { from, to }),
                                mutual_defense_signed: t('gm.diplo.record.defensePact' as TranslationKey, { from, to }),
                                non_aggression_signed: t('gm.diplo.record.nonAggression' as TranslationKey, { from, to }),
                                embargo_declared: t('gm.diplo.record.embargo' as TranslationKey, { from, to }),
                                treaty_cancelled: t('gm.diplo.record.treatyCancelled' as TranslationKey, { from }),
                                tech_exchanged: t('gm.diplo.record.techExchange' as TranslationKey, { from, to }),
                                counter_proposal: t('gm.diplo.record.counterProposal' as TranslationKey, { from }),
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
                      <div>{t('gm.diplo.placeholder' as TranslationKey)}</div>
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
      artLabel={t('gm.help.artLabel' as TranslationKey)}
      eyebrow={t('gm.help.eyebrow' as TranslationKey)}
      title={t('gm.help.title' as TranslationKey)}
      lede={t('gm.help.lede' as TranslationKey)}
      actions={
        <button type="button" className="touch-btn touch-btn--primary" onClick={handleCloseDialog}>
          {t('gm.help.backToMap' as TranslationKey)}
        </button>
      }
    >
      <Tabs defaultActiveKey="controls" className="mb-0 gm-help-tabs">
        <Tab eventKey="controls" title={t('gm.help.tabs.controls' as TranslationKey)}>
          <p className="gm-prose gm-help-intro">
            {t('gm.help.controls.intro' as TranslationKey)}
          </p>
          <h6>{t('gm.help.controls.mouseHeading' as TranslationKey)}</h6>
            <ListGroup variant="flush" className="mb-3">
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.leftClick.key' as TranslationKey)}</strong> {t('gm.help.controls.leftClick.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.rightClick.key' as TranslationKey)}</strong> {t('gm.help.controls.rightClick.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.drag.key' as TranslationKey)}</strong> {t('gm.help.controls.drag.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.scrollWheel.key' as TranslationKey)}</strong> {t('gm.help.controls.scrollWheel.desc' as TranslationKey)}
              </ListGroup.Item>
            </ListGroup>

            <h6>{t('gm.help.controls.unitHeading' as TranslationKey)}</h6>
            <ListGroup variant="flush" className="mb-3">
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.s.key' as TranslationKey)}</strong> {t('gm.help.controls.s.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.f.key' as TranslationKey)}</strong> {t('gm.help.controls.f.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.w.key' as TranslationKey)}</strong> {t('gm.help.controls.w.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.g.key' as TranslationKey)}</strong> {t('gm.help.controls.g.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.b.key' as TranslationKey)}</strong> {t('gm.help.controls.b.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.i.key' as TranslationKey)}</strong> {t('gm.help.controls.i.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.m.key' as TranslationKey)}</strong> {t('gm.help.controls.m.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.p.key' as TranslationKey)}</strong> {t('gm.help.controls.p.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.space.key' as TranslationKey)}</strong> {t('gm.help.controls.space.desc' as TranslationKey)}
              </ListGroup.Item>
            </ListGroup>

            <h6>{t('gm.help.controls.globalHeading' as TranslationKey)}</h6>
            <ListGroup variant="flush" className="mb-3">
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.enter.key' as TranslationKey)}</strong> {t('gm.help.controls.enter.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.d.key' as TranslationKey)}</strong> {t('gm.help.controls.d.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.r.key' as TranslationKey)}</strong> {t('gm.help.controls.r.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.c.key' as TranslationKey)}</strong> {t('gm.help.controls.c.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.t.key' as TranslationKey)}</strong> {t('gm.help.controls.t.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.gov.key' as TranslationKey)}</strong> {t('gm.help.controls.gov.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.escape.key' as TranslationKey)}</strong> {t('gm.help.controls.escape.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.zoom.key' as TranslationKey)}</strong> {t('gm.help.controls.zoom.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.arrows.key' as TranslationKey)}</strong> {t('gm.help.controls.arrows.desc' as TranslationKey)}
              </ListGroup.Item>
            </ListGroup>

            <h6>{t('gm.help.controls.functionHeading' as TranslationKey)}</h6>
            <ListGroup variant="flush" className="mb-3">
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.f1.key' as TranslationKey)}</strong> {t('menu.help')}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.f2.key' as TranslationKey)}</strong> {t('gm.help.controls.f2.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.f3.key' as TranslationKey)}</strong> {t('menu.settings')}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.f4.key' as TranslationKey)}</strong> {t('gm.help.controls.f4.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.f11.key' as TranslationKey)}</strong> {t('gm.help.controls.f11.desc' as TranslationKey)}
              </ListGroup.Item>
            </ListGroup>

            <h6>{t('gm.help.controls.ctrlHeading' as TranslationKey)}</h6>
            <ListGroup variant="flush">
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.ctrlS.key' as TranslationKey)}</strong> {t('gm.help.controls.ctrlS.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.ctrlL.key' as TranslationKey)}</strong> {t('gm.help.controls.ctrlL.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.ctrlP.key' as TranslationKey)}</strong> {t('menu.pause')}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.controls.ctrlNum.key' as TranslationKey)}</strong> {t('gm.help.controls.ctrlNum.desc' as TranslationKey)}
              </ListGroup.Item>
            </ListGroup>
          </Tab>

          <Tab eventKey="orders" title={t('gm.help.tabs.orders' as TranslationKey)}>
            <p className="gm-prose gm-help-intro">
              {t('gm.help.orders.intro' as TranslationKey)}
            </p>
            <h6>{t('gm.help.orders.heading' as TranslationKey)}</h6>
            <ListGroup variant="flush">
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.orders.buildCity.key' as TranslationKey)}</strong> {t('gm.help.orders.buildCity.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.orders.buildRoad.key' as TranslationKey)}</strong> {t('gm.help.orders.buildRoad.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.orders.irrigate.key' as TranslationKey)}</strong> {t('gm.help.orders.irrigate.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.orders.mine.key' as TranslationKey)}</strong> {t('gm.help.orders.mine.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.orders.fortify.key' as TranslationKey)}</strong> {t('gm.help.orders.fortify.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.orders.railroad.key' as TranslationKey)}</strong> {t('gm.help.orders.railroad.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.orders.cleanPollution.key' as TranslationKey)}</strong> {t('gm.help.orders.cleanPollution.desc' as TranslationKey)}
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>{t('gm.help.orders.fortress.key' as TranslationKey)}</strong> {t('gm.help.orders.fortress.desc' as TranslationKey)}
              </ListGroup.Item>
            </ListGroup>
          </Tab>

          <Tab eventKey="gameplay" title={t('gm.help.tabs.gameplay' as TranslationKey)}>
            <p className="gm-prose gm-help-intro">
              {t('gm.help.gameplay.intro' as TranslationKey)}
            </p>
            <h6>{t('gm.help.gameplay.gettingStartedHeading' as TranslationKey)}</h6>
            <ol>
              <li>{t('gm.help.gameplay.settler' as TranslationKey)}</li>
              <li>{t('gm.help.gameplay.found' as TranslationKey)}</li>
              <li>{t('gm.help.gameplay.explore' as TranslationKey)}</li>
              <li>{t('gm.help.gameplay.build' as TranslationKey)}</li>
              <li>{t('gm.help.gameplay.research' as TranslationKey)}</li>
              <li>{t('gm.help.gameplay.expand' as TranslationKey)}</li>
            </ol>

            <h6>{t('gm.help.gameplay.resourcesHeading' as TranslationKey)}</h6>
            <ul>
              <li><strong>{t('gm.help.gameplay.food.key' as TranslationKey)}</strong> {t('gm.help.gameplay.food.desc' as TranslationKey)}</li>
              <li><strong>{t('gm.help.gameplay.production.key' as TranslationKey)}</strong> {t('gm.help.gameplay.production.desc' as TranslationKey)}</li>
              <li><strong>{t('gm.help.gameplay.trade.key' as TranslationKey)}</strong> {t('gm.help.gameplay.trade.desc' as TranslationKey)}</li>
              <li><strong>{t('gm.help.gameplay.science.key' as TranslationKey)}</strong> {t('gm.help.gameplay.science.desc' as TranslationKey)}</li>
              <li><strong>{t('gm.help.gameplay.gold.key' as TranslationKey)}</strong> {t('gm.help.gameplay.gold.desc' as TranslationKey)}</li>
            </ul>

            <h6>{t('gm.help.gameplay.diplomacyHeading' as TranslationKey)}</h6>
            <ul>
              <li>{t('gm.help.gameplay.diploPress' as TranslationKey)} <strong>{t('gm.help.gameplay.diploD' as TranslationKey)}</strong> {t('gm.help.gameplay.diploOr' as TranslationKey)} <strong>{t('gm.help.gameplay.diploF4' as TranslationKey)}</strong> {t('gm.help.gameplay.diploView' as TranslationKey)}</li>
              <li>{t('gm.help.gameplay.diploTalks' as TranslationKey)}</li>
              <li>{t('gm.help.gameplay.diploStates' as TranslationKey)}</li>
              <li>{t('gm.help.gameplay.diploTreaties' as TranslationKey)}</li>
              <li>{t('gm.help.gameplay.diploBreaking' as TranslationKey)}</li>
            </ul>
          </Tab>

          <Tab eventKey="about" title={t('gm.help.tabs.about' as TranslationKey)}>
            <p className="gm-prose gm-help-intro">
              {t('gm.help.about.intro' as TranslationKey)}
            </p>
            <div className="gm-section">
              <div className="gm-section-title">{t('gm.help.about.reach' as TranslationKey)}</div>
              <p className="gm-prose mb-2">
                <a href="mailto:info@mailbase.info">{t('gm.help.about.email' as TranslationKey)}</a>
              </p>
              <p className="gm-prose mb-0">
                <a
                  href="https://github.com/JCTRoth/Zivilisation_1"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('gm.help.about.github' as TranslationKey)}
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
        message: t('gm.production.cannotQueue' as TranslationKey, { item: tUnitName(key, item.name), reason: productionFailureText(result.reason) }),
      });
      return;
    }
    // setCityProduction answers with a result object even on failure — reading
    // its truthiness reported bogus successes.
    if (result.command === 'SET_CITY_PRODUCTION') {
      if (result.production.success !== false) {
        actions.addNotification({ type: 'info', message: t('gm.production.addedToQueue' as TranslationKey, { item: tUnitName(key, item.name) }) });
      } else {
        actions.addNotification({
          type: 'warning',
          message: t('gm.production.cannotQueue' as TranslationKey, { item: tUnitName(key, item.name), reason: productionFailureText(result.production.reason) }),
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
      artLabel={t('gm.cityProduction.artLabel' as TranslationKey)}
      dialogClassName="city-production-modal"
      eyebrow={stamp(t('gm.cityProduction.title' as TranslationKey))}
      title={selectedCity?.name || t('gm.cityProduction.title' as TranslationKey)}
      lede={
        <>
          {t('gm.cityProduction.lede' as TranslationKey)}
        </>
      }
      actions={
        <button type="button" className="touch-btn touch-btn--primary" onClick={handleCloseDialog}>
          {t('gm.cityProduction.done' as TranslationKey)}
        </button>
      }
    >
      <div className="gm-note">
        {t('gm.cityProduction.note' as TranslationKey)}
      </div>
      {renderProductionContent()}
    </GameModal>
  );

  // Reusable production list content (used both in modal and city details tab)
  // Render production summary: current production and queued items
  const renderProductionContent = () => {
    if (!selectedCity) {
      return <div>{t('gm.production.noCity' as TranslationKey)}</div>;
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
          <h6>{t('gm.production.currentHeading' as TranslationKey)}</h6>
          {currentProductionItem ? (
            <div className="text-white p-2 rounded">
              <strong>{currentProductionName}</strong>
              <div className="small text-muted">
                {currentProductionCost > 0
                  ? t('gm.production.progress' as TranslationKey, { current: Math.round(clampedProgress), cost: currentProductionCost, percent: progressPercent })
                  : t('gm.production.progressShields' as TranslationKey, { current: Math.round(clampedProgress) })}
              </div>
              <div className="small text-muted">
                {t('gm.production.perTurn' as TranslationKey, { value: productionPerTurn })}
              </div>
              <div className="small text-muted">
                {t('gm.production.turnsRemaining' as TranslationKey, { value: formatTurns(turnsRemaining) })}
              </div>
            </div>
          ) : (
            <div className="text-muted">{t('gm.production.noActive' as TranslationKey)}</div>
          )}
        </div>

        <div className="production-queue-layout">
          {/* Production panel: selector + add-to-queue */}
          <div className="production-panel">
            <h6>{t('gm.production.heading' as TranslationKey)}</h6>
            <select
              className="form-select form-select-sm mb-2 production-select"
              value={selectedProductionKey ?? ''}
              // Picking an item only CHOOSES it — "Add" below appends it to the
              // queue. The current production is never replaced from here.
              onChange={(e) => setSelectedProductionKey(e.target.value)}
              disabled={!isPlayerCity}
              title={t('gm.production.selectTitle' as TranslationKey)}
            >
              <option value="" disabled>{t('gm.production.selectPlaceholder' as TranslationKey)}</option>
              {availableProductionKeys.map(key => {
                const unit = UNIT_PROPS[key];
                return (
                  <option key={key} value={key}>
                    {t('gm.production.optionCost' as TranslationKey, { name: tUnitName(key, unit.name), cost: unit.cost })}
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
                title={t('gm.production.addTitle' as TranslationKey)}
              >
                <i className="bi bi-plus-lg me-1"></i> {t('gm.production.add' as TranslationKey)}
              </Button>
            </div>
          </div>

          {/* Queue panel: items with move up/down/remove */}
          <div className="queue-panel">
            <h6>{t('gm.production.queueHeading' as TranslationKey)}</h6>
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
                          <div className="small">{queueItemCost > 0 ? t('gm.production.queuePos' as TranslationKey, { position: i + 1, cost: queueItemCost }) : t('gm.production.queuePosEmpty' as TranslationKey, { position: i + 1 })}</div>
                          <div className="small text-muted">{t('gm.production.turns' as TranslationKey, { value: formatTurns(queueTurns) })}</div>
                        </div>
                        <div className="queue-item-actions">
                          <button
                            type="button"
                            className="btn btn-outline-light btn-sm queue-action-btn"
                            title={t('gm.production.moveUp' as TranslationKey)}
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
                            title={t('gm.production.moveDown' as TranslationKey)}
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
                            title={t('gm.production.removeTitle' as TranslationKey)}
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
                                actions.addNotification({ type: 'warning', message: t('gm.production.removeFailed' as TranslationKey, { reason: res?.reason || t('gm.production.unknownReason' as TranslationKey) }) });
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
                <div className="text-white">{t('gm.production.queueEmpty' as TranslationKey)}</div>
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
      artLabel={t('gm.upkeep.artLabel' as TranslationKey)}
      eyebrow={stamp(t('gm.upkeep.eyebrow' as TranslationKey))}
      title={t('gm.upkeep.title' as TranslationKey)}
      lede={
        <>
          {t('gm.upkeep.lede.pre' as TranslationKey)}{' '}
          <strong>{disbandNotice?.unitName ?? t('gm.upkeep.unitFallback' as TranslationKey)}</strong>{' '}
          {t('gm.upkeep.lede.post' as TranslationKey)}
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
            <i className="bi bi-graph-up" aria-hidden="true" /> {t('gm.upkeep.openRates' as TranslationKey)}
          </button>
          <button type="button" className="touch-btn touch-btn--primary" onClick={handleCloseDialog}>
            {t('gm.upkeep.understood' as TranslationKey)}
          </button>
        </>
      }
    >
      <div className="gm-section">
        <div className="gm-section-title">{t('gm.upkeep.balanceTitle' as TranslationKey)}</div>
        <ul className="gm-list">
          <li>
            {t('gm.upkeep.bal1.pre' as TranslationKey)} <strong>{t('gm.upkeep.bal1.strong' as TranslationKey)}</strong>{' '}{t('gm.upkeep.bal1.post' as TranslationKey)}
          </li>
          <li>
            {t('gm.upkeep.bal2.pre' as TranslationKey)} <strong>{t('gm.upkeep.bal2.strong' as TranslationKey)}</strong>{' '}{t('gm.upkeep.bal2.post' as TranslationKey)}
          </li>
          <li>
            {t('gm.upkeep.bal3.pre' as TranslationKey)} <em>{t('gm.upkeep.bal3.em' as TranslationKey)}</em>{t('gm.upkeep.bal3.post' as TranslationKey)}
          </li>
          <li>
            {t('gm.upkeep.bal4.pre' as TranslationKey)} <strong>{t('gm.upkeep.bal4.strong1' as TranslationKey)}</strong> {t('gm.upkeep.bal4.mid' as TranslationKey)} <strong>{t('gm.upkeep.bal4.strong2' as TranslationKey)}</strong>{t('gm.upkeep.bal4.post' as TranslationKey)}
          </li>
          <li>
            {t('gm.upkeep.bal5' as TranslationKey)}
          </li>
        </ul>
      </div>
      <div className="gm-callout">
        <span className="gm-callout-title">{t('gm.upkeep.whyTitle' as TranslationKey)}</span>
        {t('gm.upkeep.whyBody' as TranslationKey)}
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
      artLabel={t('gm.starved.artLabel' as TranslationKey)}
      eyebrow={stamp(t('gm.starved.eyebrow' as TranslationKey))}
      title={t('gm.starved.title' as TranslationKey, { city: starvationNotice?.cityName ?? t('gm.starved.yourCity' as TranslationKey) })}
      lede={
        <>
          {t('gm.starved.lede.pre' as TranslationKey)}
          <strong>{' '}{starvationNotice?.cityName ?? t('gm.yourCityLower' as TranslationKey)}</strong>{' '}
          {t('gm.starved.lede.post' as TranslationKey)}
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
              {t('gm.starved.release' as TranslationKey)}
            </button>
          )}
          <button type="button" className="touch-btn touch-btn--ghost" onClick={handleCloseDialog}>
            {t('gm.starved.later' as TranslationKey)}
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
            {t('gm.goToCity' as TranslationKey)}
          </button>
        </>
      }
    >
      <div className="gm-section">
        <div className="gm-section-title">{t('gm.starved.happeningTitle' as TranslationKey)}</div>
        <p className="gm-prose">
          {t('gm.starved.happeningBody' as TranslationKey)}
        </p>
      </div>

      {starvationNotice?.blockingManualTiles && starvationNotice.blockingManualTiles.length > 0 && (
        <div className="gm-callout">
          <span className="gm-callout-title">{t('gm.starved.blockingTitle' as TranslationKey)}</span>
          {t('gm.starved.blockingBody' as TranslationKey)}
          <ul className="gm-list gm-list--tight">
            {starvationNotice.blockingManualTiles.map((t) => (
              <li key={`${t.col},${t.row}`}>
                ({t.col},{t.row}) — {t.food} 🍞
              </li>
            ))}
          </ul>
          {t('gm.starved.blockingRelease' as TranslationKey)}
        </div>
      )}

      <div className="gm-note">
        <strong>{t('gm.starved.noteStrong' as TranslationKey)}</strong>{' '}
        {t('gm.starved.notePost' as TranslationKey)}
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
        artLabel={t('gm.autoEnd.artLabel' as TranslationKey)}
        eyebrow={t('gm.autoEnd.eyebrow' as TranslationKey)}
        title={t('gm.autoEnd.title' as TranslationKey)}
        lede={
          <>
            {t('gm.autoEnd.lede.pre' as TranslationKey)} <strong>{t('gm.autoEnd.title' as TranslationKey)}</strong>{' '}
            {t('gm.autoEnd.lede.mid' as TranslationKey)} <strong>{t('gm.autoEnd.lede.strong2' as TranslationKey)}</strong>{' '}
            {t('gm.autoEnd.lede.post' as TranslationKey)}
          </>
        }
        actions={
          <>
            <span className="gm-actions-spacer" />
            <button type="button" className="touch-btn touch-btn--ghost" onClick={finish}>
              {t('gm.autoEnd.notNow' as TranslationKey)}
            </button>
            <button type="button" className="touch-btn touch-btn--success" onClick={finish}>
              {t('gm.autoEnd.gotIt' as TranslationKey)}
            </button>
          </>
        }
      >
        <div className="gm-section auto-end-offer-choice">
          <div className="gm-section-title">{t('gm.autoEnd.decideTitle' as TranslationKey)}</div>
          <Form.Check
            type="checkbox"
            id="auto-end-offer-toggle"
            className="auto-end-offer-toggle"
            checked={settings.autoEndTurn}
            onChange={(e) => actions.updateSettings?.({ autoEndTurn: e.target.checked })}
            label={
              <>
                <span className="auto-end-offer-choice-title">{t('gm.autoEnd.title' as TranslationKey)}</span>
                <span className="auto-end-offer-choice-hint">
                  {t('gm.autoEnd.hint' as TranslationKey)}
                </span>
              </>
            }
          />
        </div>
        <div className="gm-note">
          {t('gm.autoEnd.note' as TranslationKey)}
        </div>
      </GameModal>
    );
  };

  // City disorder — entering or leaving civil unrest
  const renderCityDisorder = () => {
    const entering = disorderNotice?.enteringDisorder ?? true;
    const cityName = disorderNotice?.cityName ?? t('gm.yourCityLower' as TranslationKey);
    return (
      <GameModal
        show={uiState.activeDialog === 'city-disorder'}
        onClose={handleCloseDialog}
        size="lg"
        tone={entering ? 'danger' : 'success'}
        icon={entering ? '🔥' : '🛡️'}
        artLabel={entering ? t('gm.disorder.artTorch' as TranslationKey) : t('gm.disorder.artWatch' as TranslationKey)}
        eyebrow={stamp(entering ? t('gm.disorder.eyebrowRevolt' as TranslationKey) : t('gm.disorder.eyebrowReport' as TranslationKey))}
        title={entering ? t('gm.disorder.titleRevolt' as TranslationKey, { city: cityName }) : t('gm.disorder.titleOrder' as TranslationKey, { city: cityName })}
        lede={
          entering ? (
            <>
              {t('gm.disorder.revolt.pre' as TranslationKey)} <strong>{cityName}</strong>{' '}
              {t('gm.disorder.revolt.post' as TranslationKey)}
            </>
          ) : (
            <>
              {t('gm.disorder.order.pre' as TranslationKey)} <strong>{cityName}</strong>{' '}
              {t('gm.disorder.order.post' as TranslationKey)}
            </>
          )
        }
        actions={
          <>
            <span className="gm-actions-spacer" />
            <button type="button" className="touch-btn touch-btn--ghost" onClick={handleCloseDialog}>
              {t('common.close')}
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
              {t('gm.goToCity' as TranslationKey)}
            </button>
          </>
        }
      >
        {entering ? (
          <>
            <div className="gm-section">
              <div className="gm-section-title">{t('gm.disorder.costTitle' as TranslationKey)}</div>
              <ul className="gm-list">
                <li>{t('gm.disorder.cost1' as TranslationKey, { city: cityName })}</li>
                <li>{t('gm.disorder.cost2' as TranslationKey)}</li>
                <li>{t('gm.disorder.cost3' as TranslationKey)}</li>
              </ul>
            </div>
            <div className="gm-callout">
              <span className="gm-callout-title">{t('gm.disorder.calmTitle' as TranslationKey)}</span>
              {t('gm.disorder.calmBody' as TranslationKey)}
            </div>
          </>
        ) : (
          <>
            <div className="gm-section">
              <div className="gm-section-title">{t('gm.disorder.backTitle' as TranslationKey)}</div>
              <ul className="gm-list">
                <li>{t('gm.disorder.back1' as TranslationKey)}</li>
                <li>{t('gm.disorder.back2' as TranslationKey)}</li>
                <li>{t('gm.disorder.back3' as TranslationKey)}</li>
              </ul>
            </div>
            <div className="gm-note">
              {t('gm.disorder.backNote' as TranslationKey)}
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
      artLabel={t('gm.tradeRoute.artLabel' as TranslationKey)}
      eyebrow={stamp(t('gm.tradeRoute.eyebrow' as TranslationKey))}
      title={t('gm.tradeRoute.title' as TranslationKey)}
      lede={
        tradeRouteResult ? (
          <>
            {t('gm.tradeRoute.lede.pre' as TranslationKey)} <strong>{tradeRouteResult.destCityName}</strong>{' '}
            {t('gm.tradeRoute.lede.mid' as TranslationKey, { home: tradeRouteResult.homeCityName, distance: tradeRouteResult.distance })}
          </>
        ) : (
          <>{t('gm.tradeRoute.lede.fallback' as TranslationKey)}</>
        )
      }
      actions={
        <button type="button" className="touch-btn touch-btn--primary" onClick={handleCloseDialog}>
          {t('gm.tradeRoute.excellent' as TranslationKey)}
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
              <span className="gm-stat-label">{t('gm.tradeRoute.goldLabel' as TranslationKey)}</span>
            </div>
            <div className="gm-stat gm-stat--accent">
              <span className="gm-stat-value">
                <span className="gm-stat-icon" aria-hidden="true">🔬</span>+{tradeRouteResult.science}
              </span>
              <span className="gm-stat-label">{t('gm.tradeRoute.scienceLabel' as TranslationKey)}</span>
            </div>
            <div className="gm-stat">
              <span className="gm-stat-value">
                <span className="gm-stat-icon" aria-hidden="true">↔️</span>
                {tradeRouteResult.distance}
              </span>
              <span className="gm-stat-label">{t('gm.tradeRoute.distanceLabel' as TranslationKey)}</span>
            </div>
          </div>

          {(tradeRouteResult.foreign || tradeRouteResult.intercontinental) && (
            <div className="gm-callout">
              <span className="gm-callout-title">{t('gm.tradeRoute.richerTitle' as TranslationKey)}</span>
              {tradeRouteResult.foreign && <>{t('gm.tradeRoute.foreign' as TranslationKey)}</>}
              {tradeRouteResult.intercontinental && <>{t('gm.tradeRoute.intercontinental' as TranslationKey)}</>}
              {t('gm.tradeRoute.richerBody' as TranslationKey)}
            </div>
          )}

          <div className="gm-section">
            <div className="gm-section-title">{t('gm.tradeRoute.roadTitle' as TranslationKey)}</div>
            <p className="gm-prose">
              {t('gm.tradeRoute.road.pre' as TranslationKey)} <strong>{t('gm.tradeRoute.road.strong' as TranslationKey)}</strong>{t('gm.tradeRoute.road.post' as TranslationKey)}
            </p>
          </div>
        </>
      ) : (
        <p className="gm-prose">{t('gm.tradeRoute.roadFallback' as TranslationKey)}</p>
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
      <AudienceModal
        show={uiState.activeDialog === 'audience'}
        notice={audienceNotice}
        gameEngine={gameEngine}
        onAccept={() => handleAudienceDecision(true)}
        onReject={() => handleAudienceDecision(false)}
        onLeave={handleAudienceLeave}
      />
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
        fromCivName={civName(cityEvent?.fromCivId)}
        fromCivColor={cityEvent?.fromCivId !== undefined ? civColor(cityEvent.fromCivId) : undefined}
        fromCivIcon={civIcon(cityEvent?.fromCivId)}
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
