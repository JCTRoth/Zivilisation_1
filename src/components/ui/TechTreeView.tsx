import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Technology } from '../../../types/game';
import { TECHNOLOGIES_DATA } from '@/data/TechnologyData';
import '../../styles/TechTreeView.css';

// Very small, dependency-free tree renderer using SVG.
// It lays out nodes in levels based on prerequisite depth and draws straight links.

type Props = {
  technologies: Technology[];
  width?: number;
  nodeWidth?: number;
  nodeHeight?: number;
  verticalSpacing?: number;
  horizontalSpacing?: number;
  /** The player's selected research path (persisted in the store). */
  researchPath?: string[] | null;
  /** Tech id currently being researched — its node is highlighted. */
  currentResearchId?: string | null;
  /** Current research progress (absolute science points). */
  researchProgress?: number;
  /** Effective (scaled) cost of the tech currently being researched. */
  currentTechCost?: number | null;
  /** IDs of techs researched by the current player (for coloring). */
  playerResearchedIds?: Set<string>;
  /** Called when the player picks a tech to research. */
  onSelectTech?: (techId: string) => void;
};

const TechTreeView: React.FC<Props> = ({ technologies = [], width = 800, nodeWidth = 200, nodeHeight = 56, verticalSpacing = 80, horizontalSpacing = 40, researchPath = null, currentResearchId = null, researchProgress = 0, currentTechCost = null, playerResearchedIds, onSelectTech }) => {
  // If store hasn't populated technologies yet, fall back to static data
  const techs = (technologies && technologies.length > 0) ? technologies : TECHNOLOGIES_DATA;
  // Helper: is this tech researched by the current player?
  const isPlayerResearched = (techId: string) => playerResearchedIds?.has(techId) ?? false;
  // Whether the PLAYER can pick this tech: every prerequisite is in the
  // player's own research list. The shared tree's `available` flag is the
  // union across all civs (it unlocks on ANY civ's progress), so with the
  // player's list available it is not a reliable "you can research this" test.
  const isPlayerAvailable = (tech: Technology): boolean => {
    if (!playerResearchedIds) return !!tech.available;
    const prereqs = tech.prerequisites ?? [];
    return prereqs.length === 0 || prereqs.every((p) => playerResearchedIds.has(p));
  };
  // compute depth per tech
  const getDepth = (techId: string, visited = new Set()): number => {
    const tech = techs.find(t => t.id === techId);
    if (!tech || visited.has(techId)) return 0;
    visited.add(techId);
    if (!tech.prerequisites || tech.prerequisites.length === 0) return 0;
    const depths = tech.prerequisites.map(p => getDepth(p, new Set(visited)));
    return Math.max(...depths) + 1;
  };

  const grouped = useMemo(() => {
    const byDepth: Record<number, Technology[]> = {};
    techs.forEach(t => {
      const d = getDepth(t.id);
      if (!byDepth[d]) byDepth[d] = [];
      byDepth[d].push(t);
    });
    return byDepth;
  }, [techs]);

  // layout positions — spread every branch across the full width so the whole
  // tree is fully expanded end-to-end (no overlapping / collapsed branches)
  const depths = Object.keys(grouped).map(k => parseInt(k, 10)).sort((a, b) => a - b);
  const positions: Record<string, { x: number; y: number }> = {};

  // compute positions and dynamic sizing
  let maxRowWidth = 0;
  depths.forEach((d, i) => {
    const row = grouped[d];
    const totalWidth = row.length * nodeWidth + (row.length - 1) * horizontalSpacing;
    maxRowWidth = Math.max(maxRowWidth, totalWidth);
    // If the row fits in the available width, spread its nodes evenly across
    // the full width; otherwise use the row's natural width.
    const rowSpan = Math.max(width, totalWidth);
    row.forEach((tech, j) => {
      // Distribute the row's nodes evenly across the full span
      const slot = rowSpan / row.length;
      const x = slot * j + (slot - nodeWidth) / 2;
      const y = 40 + i * (nodeHeight + verticalSpacing);
      positions[tech.id] = { x, y };
    });
  });

  const svgHeight = Math.max(200, (depths.length) * (nodeHeight + verticalSpacing) + 80);
  const svgWidth = Math.max(width, maxRowWidth + 40);
  // selected path state and helpers for finding path from roots
  // (initialized/kept in sync with the persisted research path).
  const [selectedPath, setSelectedPath] = useState<string[] | null>(researchPath ?? null);
  const [animatingNodes, setAnimatingNodes] = useState<Set<string>>(new Set());
  const [hoveredTech, setHoveredTech] = useState<Technology | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);

  const childrenMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    techs.forEach(t => {
      (t.prerequisites || []).forEach(p => {
        if (!map[p]) map[p] = [];
        map[p].push(t.id);
      });
    });
    return map;
  }, [techs]);

  const findPathTo = (targetId: string): string[] | null => {
    const roots = techs.filter(t => !t.prerequisites || t.prerequisites.length === 0).map(t => t.id);
    const visited = new Set<string>();
    const stack: string[] = [];

    const dfs = (nodeId: string): boolean => {
      if (visited.has(nodeId)) return false;
      visited.add(nodeId);
      stack.push(nodeId);
      if (nodeId === targetId) return true;
      const children = childrenMap[nodeId] || [];
      for (const c of children) {
        if (dfs(c)) return true;
      }
      stack.pop();
      return false;
    };

    for (const r of roots) {
      visited.clear();
      stack.length = 0;
      if (dfs(r)) return [...stack];
    }
    return null;
  };

  const handleNodeClick = (techId: string) => {
    // Ignore clicks that end a drag-pan gesture (so you can pan by dragging)
    if (panDeltaRef.current > 5) return;
    const path = findPathTo(techId);
    setSelectedPath(path ?? [techId]);
    onSelectTech?.(techId);
  };

  const handleNodeMouseEnter = (tech: Technology, event: React.MouseEvent) => {
    setHoveredTech(tech);
    setTooltipPosition({ x: event.clientX + 10, y: event.clientY + 10 });
  };

  const handleNodeMouseLeave = () => {
    setHoveredTech(null);
    setTooltipPosition(null);
  };

  // ---- Click-and-drag panning ----
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const capturedRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const panDeltaRef = useRef(0);
  const [isPanning, setIsPanning] = useState(false);

  const handlePanStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only pan with primary mouse button / touch / pen
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    isPanningRef.current = true;
    panDeltaRef.current = 0;
    capturedRef.current = false;
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
  }, []);

  const handlePanMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current || !panStartRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    panDeltaRef.current = Math.max(panDeltaRef.current, Math.abs(dx), Math.abs(dy));
    // Only capture the pointer once an actual drag starts (beyond a small
    // threshold). Capturing earlier retargets the final `click` event to the
    // container, which would break clicking on individual tech nodes.
    if (!capturedRef.current && panDeltaRef.current > 5) {
      capturedRef.current = true;
      setIsPanning(true);
      el.setPointerCapture?.(e.pointerId);
    }
    el.scrollLeft = panStartRef.current.scrollLeft - dx;
    el.scrollTop = panStartRef.current.scrollTop - dy;
  }, []);

  const handlePanEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capturedRef.current) {
      const el = containerRef.current;
      el?.releasePointerCapture?.(e.pointerId);
    }
    isPanningRef.current = false;
    capturedRef.current = false;
    panStartRef.current = null;
    setIsPanning(false);
  }, []);

  useEffect(() => {
    return () => {
      isPanningRef.current = false;
      panStartRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Keep the highlighted path in sync with the persisted research path.
    setSelectedPath(researchPath ?? null);
  }, [researchPath]);

  useEffect(() => {
    if (selectedPath) {
      const unresearchedInPath = selectedPath.filter(id => {
        const tech = techs.find(t => t.id === id);
        return tech && !isPlayerResearched(id);
      });
      setAnimatingNodes(new Set(unresearchedInPath));
      const timer = setTimeout(() => setAnimatingNodes(new Set()), 3000); // 3 seconds for 5 pulses
      return () => clearTimeout(timer);
    } else {
      setAnimatingNodes(new Set());
    }
  }, [selectedPath, techs]);

  const isLinkOnPath = (fromId: string, toId: string) => {
    if (!selectedPath) return false;
    const fromIndex = selectedPath.indexOf(fromId);
    const toIndex = selectedPath.indexOf(toId);
    return fromIndex !== -1 && toIndex !== -1 && Math.abs(fromIndex - toIndex) === 1;
  };

  return (
    <div
      ref={containerRef}
      className={`tech-tree-container${isPanning ? ' is-panning' : ''}`}
      onPointerDown={handlePanStart}
      onPointerMove={handlePanMove}
      onPointerUp={handlePanEnd}
      onPointerCancel={handlePanEnd}
    >
      <svg width={svgWidth} height={svgHeight} className="tech-tree-svg">
        <defs>
          <pattern id="unresearchedPattern" patternUnits="userSpaceOnUse" width="10" height="10">
            <rect width="10" height="10" fill="transparent"/>
            <line x1="0" y1="0" x2="10" y2="10" stroke="lightblue" strokeWidth="2"/>
          </pattern>
        </defs>
        {/* Path display as first row */}
        {selectedPath && (
          <text x={svgWidth / 2} y={30} className="tech-tree-path-text" fill="#fff" fontSize="16" fontWeight="bold" textAnchor="middle">
            Path: {selectedPath.map(id => techs.find(t => t.id === id)?.name || id).join(' > ')}
          </text>
        )}
        {/* links */}
        {techs.map(tech => (
          tech.prerequisites?.map(pr => {
            const from = positions[pr];
            const to = positions[tech.id];
            if (!from || !to) return null;
            const x1 = from.x + nodeWidth / 2;
            const y1 = from.y + nodeHeight;
            const x2 = to.x + nodeWidth / 2;
            const y2 = to.y;
            const onPath = isLinkOnPath(pr, tech.id);
            return (
              <line key={`${pr}-${tech.id}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={onPath ? 'red' : 'rgba(255,255,255,0.1)'} strokeWidth={2} />
            );
          })
        ))}

        {/* nodes */}
        {techs.map(tech => {
          const pos = positions[tech.id];
          if (!pos) return null;
          const isAnimating = animatingNodes.has(tech.id);
          const isCurrentResearch = tech.id === currentResearchId;
          const playerAvailable = isPlayerAvailable(tech);
          const fill = isAnimating ? 'url(#unresearchedPattern)' : (isPlayerResearched(tech.id) ? '#2f855a' : playerAvailable ? '#1e90ff' : '#444');
          // Effective cost for the current research (map/difficulty scaled);
          // other nodes keep their base cost.
          const nodeCost = isCurrentResearch && currentTechCost != null ? currentTechCost : tech.cost;
          const progress = isCurrentResearch && (nodeCost ?? 0) > 0
            ? Math.min(1, (researchProgress || 0) / (nodeCost || 1))
            : 0;
          const isUnavailable = !isPlayerResearched(tech.id) && !playerAvailable;
          return (
            <g 
              key={tech.id} 
              transform={`translate(${pos.x},${pos.y})`} 
              onClick={() => handleNodeClick(tech.id)} 
              onMouseEnter={(e) => handleNodeMouseEnter(tech, e)}
              onMouseLeave={handleNodeMouseLeave}
              className={`tech-tree-node ${isAnimating ? 'pulse' : ''} ${isCurrentResearch ? 'is-researching' : ''} ${isUnavailable ? 'unavailable' : ''}`}
              style={{ cursor: isUnavailable ? 'not-allowed' : 'pointer', opacity: isUnavailable ? 0.5 : 1 }}
            >
              <rect width={nodeWidth} height={nodeHeight} rx={6} ry={6} fill={fill} stroke={isCurrentResearch ? '#ffd700' : '#0b00a4ff'} strokeWidth={isCurrentResearch ? 3 : 1} />
              <text x={12} y={20} className="tech-tree-node-text">{tech.name}</text>
              <text x={12} y={36} className="tech-tree-node-cost">
                {isCurrentResearch ? `${researchProgress || 0}/${nodeCost} sci` : `${tech.cost} sci`}
              </text>
              {isCurrentResearch && progress > 0 && (
                <rect x={4} y={nodeHeight - 6} width={(nodeWidth - 8) * progress} height={4} rx={2} fill="#ffd700" />
              )}
              {isUnavailable && (
                <text x={nodeWidth / 2} y={nodeHeight / 2 - 2} textAnchor="middle" fill="#fff" fontSize={14} style={{ pointerEvents: 'none' }}>🔒</text>
              )}
            </g>
          );
        })}
        {techs.length === 0 && (
          <g>
            <text x={20} y={30} className="tech-tree-no-tech">No technologies available</text>
          </g>
        )}
      </svg>
      
      {/* Bootstrap-styled tooltip */}
      {hoveredTech && tooltipPosition && (
        <div 
          className="tooltip show" 
          style={{
            position: 'fixed',
            left: tooltipPosition.x,
            top: tooltipPosition.y,
            zIndex: 1000,
            pointerEvents: 'none'
          }}
        >
          <div className="tooltip-inner bg-dark text-light p-2 border border-warning rounded">
            <div className="fw-bold">{hoveredTech.name}</div>
            <div className="small text-warning">Cost: {hoveredTech.cost} science</div>
            {hoveredTech.description && (
              <div className="small mt-1">{hoveredTech.description}</div>
            )}
            {hoveredTech.prerequisites && hoveredTech.prerequisites.length > 0 && (
              <div className="small mt-1 text-muted">
                Prerequisites: {hoveredTech.prerequisites.map(id => 
                  techs.find(t => t.id === id)?.name || id
                ).join(', ')}
              </div>
            )}
            <div className="small mt-1">
              Status: {isPlayerResearched(hoveredTech.id) ? 
                <span className="text-success">✓ Researched</span> : 
                isPlayerAvailable(hoveredTech) ? 
                  <span className="text-info">Available</span> : 
                  <span className="text-secondary">Locked</span>
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TechTreeView;
