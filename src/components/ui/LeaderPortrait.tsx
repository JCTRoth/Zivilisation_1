import React from 'react';
import type { LeaderPortraitConfig } from '@/data/LeaderPortraits';

interface LeaderPortraitProps {
  config: LeaderPortraitConfig;
  mood: 'friendly' | 'neutral' | 'annoyed' | 'hostile';
  size?: number;
  leaderName?: string;
}

// Import leader images
import leader_Alexander_the_Great from '@/assets/leader/Alexander_the_Great.jpg';
import leader_Elizabeth_I from '@/assets/leader/Elizabeth_I.jpg';
import leader_Frederick_the_Great from '@/assets/leader/Frederick_the_Great.jpg';
import leader_Genghis_Khan from '@/assets/leader/Genghis_Khan.jpg';
import leader_Hammurabi from '@/assets/leader/Hammurabi.jpg';
import leader_Joseph_Stalin from '@/assets/leader/Joseph_Stalin.jpg';
import leader_Julius_Caesar from '@/assets/leader/Julius_Caesar.jpg';
import leader_Mahatma_Gandhi from '@/assets/leader/Mahatma_Gandhi.jpg';
import leader_Mao_Tse_Tung from '@/assets/leader/Mao_Tse_Tung.jpg';
import leader_Montezuma from '@/assets/leader/Montezuma.jpg';
import leader_Napoleon_Bonaparte from '@/assets/leader/Napoleon_Bonaparte.jpg';
import leader_Ramesses_II from '@/assets/leader/Ramesses_II.jpg';
import leader_Shaka from '@/assets/leader/Shaka.jpg';
import leader_Abraham_Lincoln from '@/assets/leader/lincoln.jpg';

// Map leader names to image paths
const LEADER_IMAGES: Record<string, string> = {
  'Alexander the Great': leader_Alexander_the_Great,
  'Elizabeth I': leader_Elizabeth_I,
  'Frederick the Great': leader_Frederick_the_Great,
  'Dschingis Khan': leader_Genghis_Khan,
  'Hammurabi': leader_Hammurabi,
  'Joseph Stalin': leader_Joseph_Stalin,
  'Julius Caesar': leader_Julius_Caesar,
  'Mahatma Gandhi': leader_Mahatma_Gandhi,
  'Mao Tse Tung': leader_Mao_Tse_Tung,
  'Montezuma': leader_Montezuma,
  'Napoleon Bonaparte': leader_Napoleon_Bonaparte,
  'Ramesses II': leader_Ramesses_II,
  'Shaka': leader_Shaka,
  'Abraham Lincoln': leader_Abraham_Lincoln,
};

function renderHeadgear(cfg: LeaderPortraitConfig, cx: number, topY: number): React.ReactNode {
  const c = cfg.headgearColor;
  switch (cfg.headgear) {
    case 'crown':
      return (
        <g>
          <rect x={cx - 18} y={topY - 8} width={36} height={12} rx={2} fill={c} />
          <polygon points={`${cx - 16},${topY - 8} ${cx - 12},${topY - 18} ${cx - 8},${topY - 8}`} fill={c} />
          <polygon points={`${cx - 4},${topY - 8} ${cx},${topY - 20} ${cx + 4},${topY - 8}`} fill={c} />
          <polygon points={`${cx + 8},${topY - 8} ${cx + 12},${topY - 18} ${cx + 16},${topY - 8}`} fill={c} />
          <circle cx={cx - 12} cy={topY - 15} r={2} fill="#e53935" />
          <circle cx={cx} cy={topY - 17} r={2.5} fill="#42a5f5" />
          <circle cx={cx + 12} cy={topY - 15} r={2} fill="#66bb6a" />
        </g>
      );
    case 'tophat':
      return (
        <g>
          <rect x={cx - 22} y={topY - 2} width={44} height={5} rx={2} fill={c} />
          <rect x={cx - 14} y={topY - 30} width={28} height={30} rx={3} fill={c} />
          <rect x={cx - 14} y={topY - 30} width={28} height={4} rx={1} fill="#333" />
        </g>
      );
    case 'helmet':
      return (
        <g>
          <ellipse cx={cx} cy={topY - 5} rx={22} ry={16} fill={c} />
          <rect x={cx - 2} y={topY - 22} width={4} height={14} rx={2} fill="#e0c080" />
          <ellipse cx={cx} cy={topY + 4} rx={24} ry={4} fill={c} opacity={0.6} />
        </g>
      );
    case 'turban':
      return (
        <g>
          <ellipse cx={cx} cy={topY - 4} rx={22} ry={14} fill={c} />
          <ellipse cx={cx + 2} cy={topY - 8} rx={18} ry={10} fill={c} opacity={0.8} />
          <circle cx={cx} cy={topY - 14} r={4} fill="#e53935" />
        </g>
      );
    case 'hat':
      return (
        <g>
          <ellipse cx={cx} cy={topY} rx={26} ry={5} fill={c} />
          <ellipse cx={cx} cy={topY - 8} rx={18} ry={12} fill={c} />
          <rect x={cx - 18} y={topY - 8} width={36} height={2} fill="#c9a052" />
        </g>
      );
    case 'headdress':
      return (
        <g>
          <ellipse cx={cx} cy={topY - 2} rx={20} ry={10} fill={c} />
          {[-12, -6, 0, 6, 12].map((dx, i) => (
            <rect key={i} x={cx + dx - 1.5} y={topY - 24 + Math.abs(dx)} width={3} height={18 - Math.abs(dx) * 0.5} rx={1} fill={i % 2 === 0 ? c : '#ffd700'} />
          ))}
        </g>
      );
    case 'laurel':
      return (
        <g>
          <ellipse cx={cx - 16} cy={topY - 4} rx={6} ry={10} fill={c} opacity={0.8} />
          <ellipse cx={cx + 16} cy={topY - 4} rx={6} ry={10} fill={c} opacity={0.8} />
          <ellipse cx={cx - 10} cy={topY - 10} rx={5} ry={8} fill={c} />
          <ellipse cx={cx + 10} cy={topY - 10} rx={5} ry={8} fill={c} />
          <ellipse cx={cx} cy={topY - 12} rx={4} ry={6} fill={c} />
        </g>
      );
    case 'pharaoh':
      return (
        <g>
          <rect x={cx - 20} y={topY - 6} width={40} height={14} rx={2} fill={c} />
          <polygon points={`${cx - 20},${topY + 8} ${cx - 24},${topY + 24} ${cx - 16},${topY + 8}`} fill={c} />
          <polygon points={`${cx + 20},${topY + 8} ${cx + 24},${topY + 24} ${cx + 16},${topY + 8}`} fill={c} />
          <rect x={cx - 5} y={topY - 18} width={10} height={14} rx={2} fill={c} />
          <circle cx={cx} cy={topY - 18} r={5} fill="#42a5f5" />
        </g>
      );
    case 'fur_cap':
      return (
        <g>
          <ellipse cx={cx} cy={topY - 2} rx={22} ry={14} fill={c} />
          <ellipse cx={cx} cy={topY + 4} rx={24} ry={6} fill="#d4a574" opacity={0.5} />
        </g>
      );
    default:
      return null;
  }
}

function renderFacialHair(cfg: LeaderPortraitConfig, cx: number, mouthY: number): React.ReactNode {
  switch (cfg.facialHair) {
    case 'beard':
      return (
        <g>
          <ellipse cx={cx} cy={mouthY + 8} rx={14} ry={12} fill={cfg.facialHairColor} opacity={0.85} />
          <ellipse cx={cx} cy={mouthY + 4} rx={12} ry={6} fill={cfg.facialHairColor} opacity={0.7} />
        </g>
      );
    case 'mustache':
      return (
        <g>
          <ellipse cx={cx - 6} cy={mouthY - 1} rx={7} ry={3} fill={cfg.facialHairColor} opacity={0.85} />
          <ellipse cx={cx + 6} cy={mouthY - 1} rx={7} ry={3} fill={cfg.facialHairColor} opacity={0.85} />
        </g>
      );
    case 'goatee':
      return (
        <ellipse cx={cx} cy={mouthY + 6} rx={6} ry={8} fill={cfg.facialHairColor} opacity={0.85} />
      );
    default:
      return null;
  }
}

function renderScene(cfg: LeaderPortraitConfig, w: number, h: number): React.ReactNode {
  const sc = cfg.sceneColor;
  const sa = cfg.sceneAccent;
  switch (cfg.scene) {
    case 'throne':
      return (
        <g>
          <rect x={0} y={0} width={w} height={h} fill={sc} />
          <rect x={w * 0.2} y={h * 0.05} width={w * 0.6} height={h * 0.85} rx={4} fill={sa} opacity={0.12} />
          <rect x={w * 0.15} y={h * 0.7} width={w * 0.7} height={h * 0.1} rx={2} fill={sa} opacity={0.2} />
          <rect x={w * 0.3} y={h * 0.06} width={w * 0.4} height={h * 0.05} rx={1} fill={sa} opacity={0.25} />
        </g>
      );
    case 'temple':
      return (
        <g>
          <rect x={0} y={0} width={w} height={h} fill={sc} />
          {[0.15, 0.4, 0.65, 0.85].map((x, i) => (
            <rect key={i} x={w * x} y={h * 0.15} width={w * 0.05} height={h * 0.7} rx={2} fill={sa} opacity={0.2} />
          ))}
          <polygon points={`${w * 0.1},${h * 0.15} ${w * 0.5},${h * 0.02} ${w * 0.9},${h * 0.15}`} fill={sa} opacity={0.15} />
        </g>
      );
    case 'palace':
      return (
        <g>
          <rect x={0} y={0} width={w} height={h} fill={sc} />
          <rect x={w * 0.05} y={h * 0.1} width={w * 0.9} height={h * 0.8} rx={6} fill={sa} opacity={0.08} />
          <ellipse cx={w * 0.5} cy={h * 0.12} rx={w * 0.3} ry={h * 0.08} fill={sa} opacity={0.12} />
          <rect x={w * 0.1} y={h * 0.75} width={w * 0.8} height={h * 0.05} rx={2} fill={sa} opacity={0.15} />
        </g>
      );
    case 'tent':
      return (
        <g>
          <rect x={0} y={0} width={w} height={h} fill={sc} />
          <polygon points={`${w * 0.05},${h * 0.85} ${w * 0.5},${h * 0.05} ${w * 0.95},${h * 0.85}`} fill={sa} opacity={0.1} />
          <line x1={w * 0.5} y1={h * 0.05} x2={w * 0.5} y2={h * 0.85} stroke={sa} strokeWidth={1} opacity={0.15} />
        </g>
      );
    case 'garden':
      return (
        <g>
          <rect x={0} y={0} width={w} height={h} fill={sc} />
          <ellipse cx={w * 0.2} cy={h * 0.85} rx={w * 0.15} ry={h * 0.12} fill="#2e5a2e" opacity={0.3} />
          <ellipse cx={w * 0.7} cy={h * 0.8} rx={w * 0.2} ry={h * 0.14} fill="#2e5a2e" opacity={0.25} />
          <circle cx={w * 0.85} cy={h * 0.15} r={w * 0.08} fill={sa} opacity={0.15} />
        </g>
      );
    case 'fortress':
      return (
        <g>
          <rect x={0} y={0} width={w} height={h} fill={sc} />
          <rect x={w * 0.05} y={h * 0.3} width={w * 0.12} height={h * 0.6} fill={sa} opacity={0.15} />
          <rect x={w * 0.83} y={h * 0.3} width={w * 0.12} height={h * 0.6} fill={sa} opacity={0.15} />
          <rect x={w * 0.05} y={h * 0.25} width={w * 0.9} height={h * 0.08} fill={sa} opacity={0.12} />
          {[0.08, 0.2, 0.32, 0.68, 0.8, 0.88].map((x, i) => (
            <rect key={i} x={w * x} y={h * 0.2} width={w * 0.06} height={h * 0.08} fill={sa} opacity={0.15} />
          ))}
        </g>
      );
    case 'court':
    default:
      return (
        <g>
          <rect x={0} y={0} width={w} height={h} fill={sc} />
          <rect x={w * 0.1} y={h * 0.08} width={w * 0.8} height={h * 0.84} rx={4} fill={sa} opacity={0.06} />
          <rect x={w * 0.2} y={h * 0.7} width={w * 0.6} height={h * 0.06} rx={2} fill={sa} opacity={0.12} />
          {[0.25, 0.75].map((x, i) => (
            <rect key={i} x={w * x - w * 0.02} y={h * 0.12} width={w * 0.04} height={h * 0.56} rx={1} fill={sa} opacity={0.1} />
          ))}
        </g>
      );
  }
}

/** Leader portrait - uses image file if available, otherwise procedural SVG */
const LeaderPortrait: React.FC<LeaderPortraitProps> = ({ config, mood, size = 120, leaderName }) => {
  const w = size;
  const h = size * 1.3;
  const cx = w / 2;
  const headY = h * 0.35;
  const headR = w * 0.18;
  const mouthY = headY + headR * 0.45;

  // Use image file if available
  if (leaderName && LEADER_IMAGES[leaderName]) {
    return (
      <div 
        className="leader-portrait-image"
        style={{
          width: w,
          height: h,
          position: 'relative',
          borderRadius: '4px',
          overflow: 'hidden',
          background: '#111',
          border: '2px solid #555'
        }}
      >
        <img 
          src={LEADER_IMAGES[leaderName]} 
          alt={leaderName}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center'
          }}
        />
      </div>
    );
  }

  // Mood-based expression: mouth shape
  const mouthPath = mood === 'friendly'
    ? `M${cx - 6},${mouthY} Q${cx},${mouthY + 5} ${cx + 6},${mouthY}`
    : mood === 'hostile'
      ? `M${cx - 6},${mouthY + 3} Q${cx},${mouthY - 3} ${cx + 6},${mouthY + 3}`
      : mood === 'annoyed'
        ? `M${cx - 5},${mouthY + 1} L${cx + 5},${mouthY + 1}`
        : `M${cx - 5},${mouthY} L${cx + 5},${mouthY}`;

  // Eyebrow angle based on mood
  const browAngle = mood === 'hostile' ? -3 : mood === 'annoyed' ? -1.5 : mood === 'friendly' ? 1.5 : 0;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="leader-portrait-svg"
    >
      {/* Scene background */}
      {renderScene(config, w, h)}

      {/* Body / clothing */}
      <ellipse cx={cx} cy={h * 0.82} rx={w * 0.35} ry={h * 0.2} fill={config.clothingColor} />
      <ellipse cx={cx} cy={h * 0.74} rx={w * 0.18} ry={h * 0.06} fill={config.clothingAccent} opacity={0.6} />
      {/* Collar / neckline */}
      <polygon
        points={`${cx - w * 0.1},${h * 0.56} ${cx},${h * 0.62} ${cx + w * 0.1},${h * 0.56}`}
        fill={config.clothingAccent}
        opacity={0.4}
      />

      {/* Neck */}
      <rect x={cx - w * 0.06} y={h * 0.48} width={w * 0.12} height={h * 0.1} rx={3} fill={config.skinTone} />

      {/* Hair (behind head) */}
      <ellipse cx={cx} cy={headY - headR * 0.15} rx={headR + 4} ry={headR + 6} fill={config.hairColor} />

      {/* Head */}
      <ellipse cx={cx} cy={headY} rx={headR} ry={headR * 1.15} fill={config.skinTone} />

      {/* Eyes */}
      <g>
        {/* Left eye */}
        <ellipse cx={cx - headR * 0.35} cy={headY - headR * 0.1} rx={3.5} ry={2.5} fill="white" />
        <circle cx={cx - headR * 0.35} cy={headY - headR * 0.1} r={1.8} fill={config.eyeColor} />
        <circle cx={cx - headR * 0.35 + 0.3} cy={headY - headR * 0.1 - 0.3} r={0.8} fill="#111" />
        {/* Right eye */}
        <ellipse cx={cx + headR * 0.35} cy={headY - headR * 0.1} rx={3.5} ry={2.5} fill="white" />
        <circle cx={cx + headR * 0.35} cy={headY - headR * 0.1} r={1.8} fill={config.eyeColor} />
        <circle cx={cx + headR * 0.35 + 0.3} cy={headY - headR * 0.1 - 0.3} r={0.8} fill="#111" />
      </g>

      {/* Eyebrows (mood-aware) */}
      <line
        x1={cx - headR * 0.5} y1={headY - headR * 0.3 - browAngle}
        x2={cx - headR * 0.2} y2={headY - headR * 0.3 + browAngle}
        stroke={config.hairColor} strokeWidth={2} strokeLinecap="round"
      />
      <line
        x1={cx + headR * 0.2} y1={headY - headR * 0.3 + browAngle}
        x2={cx + headR * 0.5} y2={headY - headR * 0.3 - browAngle}
        stroke={config.hairColor} strokeWidth={2} strokeLinecap="round"
      />

      {/* Nose */}
      <line
        x1={cx} y1={headY - headR * 0.05}
        x2={cx} y2={headY + headR * 0.2}
        stroke={config.skinTone} strokeWidth={2} opacity={0.5}
      />
      <circle cx={cx} cy={headY + headR * 0.2} r={2} fill={config.skinTone} stroke="#00000020" strokeWidth={0.5} />

      {/* Mouth (mood-based) */}
      <path d={mouthPath} stroke="#8b4040" strokeWidth={1.5} fill="none" strokeLinecap="round" />

      {/* Facial hair */}
      {renderFacialHair(config, cx, mouthY)}

      {/* Headgear */}
      {renderHeadgear(config, cx, headY - headR * 1.1)}
    </svg>
  );
};

export default LeaderPortrait;
