import React, { useMemo, useState, useEffect } from 'react';
import { Technology } from '../../../types/game';
import { TECHNOLOGIES_DATA } from '../../data/TechnologyData';
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
};

const TechTreeView: React.FC<Props> = ({ technologies = [], width = 800, nodeWidth = 200, nodeHeight = 56, verticalSpacing = 80, horizontalSpacing = 40 }) => {
  // If store hasn't populated technologies yet, fall back to static data
  const techs = (technologies && technologies.length > 0) ? technologies : TECHNOLOGIES_DATA;
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

  // layout positions
  const depths = Object.keys(grouped).map(k => parseInt(k, 10)).sort((a, b) => a - b);
  const positions: Record<string, { x: number; y: number }> = {};

  // compute positions and dynamic sizing
  let maxRowWidth = 0;
  depths.forEach((d, i) => {
    const row = grouped[d];
    const totalWidth = row.length * nodeWidth + (row.length - 1) * horizontalSpacing;
    maxRowWidth = Math.max(maxRowWidth, totalWidth);
    const startX = Math.max(0, (Math.max(width, totalWidth) - totalWidth) / 2);
    row.forEach((tech, j) => {
      const x = startX + j * (nodeWidth + horizontalSpacing);
      const y = 40 + i * (nodeHeight + verticalSpacing);
      positions[tech.id] = { x, y };
    });
  });

  const svgHeight = Math.max(200, (depths.length) * (nodeHeight + verticalSpacing) + 80);
  const svgWidth = Math.max(width, maxRowWidth + 40);
  // selected path state and helpers for finding path from roots
  const [selectedPath, setSelectedPath] = useState<string[] | null>(null);
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
    const path = findPathTo(techId);
    if (path) setSelectedPath(path);
    else setSelectedPath([techId]);
  };

  const handleNodeMouseEnter = (tech: Technology, event: React.MouseEvent) => {
    setHoveredTech(tech);
    setTooltipPosition({ x: event.clientX + 10, y: event.clientY + 10 });
  };

  const handleNodeMouseLeave = () => {
    setHoveredTech(null);
    setTooltipPosition(null);
  };

  useEffect(() => {
    if (selectedPath) {
      const unresearchedInPath = selectedPath.filter(id => {
        const tech = techs.find(t => t.id === id);
        return tech && !tech.researched;
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
    <div className="tech-tree-container">
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
          const fill = isAnimating ? 'url(#unresearchedPattern)' : (tech.researched ? '#2f855a' : tech.available ? '#1e90ff' : '#444');
          return (
            <g 
              key={tech.id} 
              transform={`translate(${pos.x},${pos.y})`} 
              onClick={() => handleNodeClick(tech.id)} 
              onMouseEnter={(e) => handleNodeMouseEnter(tech, e)}
              onMouseLeave={handleNodeMouseLeave}
              className={`tech-tree-node ${isAnimating ? 'pulse' : ''}`}
            >
              <rect width={nodeWidth} height={nodeHeight} rx={6} ry={6} fill={fill} stroke="#0b00a4ff" />
              <text x={12} y={20} className="tech-tree-node-text">{tech.name}</text>
              <text x={12} y={36} className="tech-tree-node-cost">{tech.cost} sci</text>
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
              Status: {hoveredTech.researched ? 
                <span className="text-success">✓ Researched</span> : 
                hoveredTech.available ? 
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
