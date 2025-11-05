import React, { useMemo } from 'react';
import { Technology } from '../../../types/game';
import { TECHNOLOGIES_DATA } from '../../game/technologyData';

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
      const y = i * (nodeHeight + verticalSpacing);
      positions[tech.id] = { x, y };
    });
  });

  const svgHeight = Math.max(200, (depths.length) * (nodeHeight + verticalSpacing) + 40);
  const svgWidth = Math.max(width, maxRowWidth + 40);

  return (
    <div style={{ overflow: 'auto' }}>
  <svg width={svgWidth} height={svgHeight} style={{ background: 'transparent' }}>
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
            return (
              <line key={`${pr}-${tech.id}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.2)" strokeWidth={2} />
            );
          })
        ))}

        {/* nodes */}
        {techs.map(tech => {
          const pos = positions[tech.id];
          if (!pos) return null;
          return (
            <g key={tech.id} transform={`translate(${pos.x},${pos.y})`}>
              <rect width={nodeWidth} height={nodeHeight} rx={6} ry={6} fill={tech.researched ? '#2f855a' : tech.available ? '#1e90ff' : '#444'} stroke="#0b00a4ff" />
              <text x={12} y={20} style={{ fill: '#fff', fontSize: 14, fontWeight: 600 }}>{tech.name}</text>
              <text x={12} y={36} style={{ fill: '#ddd', fontSize: 12 }}>{tech.cost} sci</text>
            </g>
          );
        })}
        {techs.length === 0 && (
          <g>
            <text x={20} y={30} style={{ fill: '#fff' }}>No technologies available</text>
          </g>
        )}
      </svg>
    </div>
  );
};

export default TechTreeView;
