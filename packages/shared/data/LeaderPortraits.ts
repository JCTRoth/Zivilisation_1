/**
 * Leader portrait configuration — provides visual data for the diplomacy screen.
 *
 * Each leader has:
 *  - skinTone, hairColor, eyeColor for the procedural SVG portrait
 *  - headgear / clothing / accessory descriptors
 *  - a mood color palette that shifts based on diplomatic attitude
 *  - a short title used in negotiation
 */

export interface LeaderPortraitConfig {
  /** Skin fill color */
  skinTone: string;
  /** Hair fill color */
  hairColor: string;
  /** Eye color */
  eyeColor: string;
  /** Headgear type (rendered on top of head) */
  headgear: 'crown' | 'helmet' | 'turban' | 'hat' | 'headdress' | 'laurel' | 'none' | 'fur_cap' | 'pharaoh' | 'tophat';
  /** Headgear color */
  headgearColor: string;
  /** Clothing/robe color */
  clothingColor: string;
  /** Secondary clothing accent */
  clothingAccent: string;
  /** Facial hair type */
  facialHair: 'none' | 'beard' | 'mustache' | 'goatee';
  /** Facial hair color */
  facialHairColor: string;
  /** Title displayed under name */
  title: string;
  /** Background scene type for the diplomacy audience */
  scene: 'throne' | 'tent' | 'temple' | 'palace' | 'garden' | 'fortress' | 'court';
  /** Scene primary color */
  sceneColor: string;
  /** Scene accent color */
  sceneAccent: string;
}

/** Mood colors used to tint the portrait background based on diplomatic attitude.
 *  Aligned with the game's design-system palette — subtle translucent tints so
 *  the diplomacy panel stays consistent with the rest of the dark UI. */
export const MOOD_COLORS: Record<string, { bg: string; glow: string; border: string }> = {
  friendly: { bg: 'rgba(53, 196, 108, 0.07)', glow: 'rgba(53, 196, 108, 0.14)', border: 'rgba(53, 196, 108, 0.6)' },
  neutral:  { bg: 'rgba(183, 195, 207, 0.05)', glow: 'rgba(183, 195, 207, 0.1)', border: 'rgba(183, 195, 207, 0.45)' },
  annoyed:  { bg: 'rgba(242, 163, 60, 0.07)', glow: 'rgba(242, 163, 60, 0.14)', border: 'rgba(242, 163, 60, 0.6)' },
  hostile:  { bg: 'rgba(239, 90, 110, 0.07)', glow: 'rgba(239, 90, 110, 0.14)', border: 'rgba(239, 90, 110, 0.6)' },
};

/** Per-leader portrait configuration keyed by leader name (matches GameData.ts) */
export const LEADER_PORTRAITS: Record<string, LeaderPortraitConfig> = {
  'Abraham Lincoln': {
    skinTone: '#d4a574',
    hairColor: '#2a1a0a',
    eyeColor: '#4a6741',
    headgear: 'tophat',
    headgearColor: '#1a1a1a',
    clothingColor: '#1a1a2e',
    clothingAccent: '#e0c080',
    facialHair: 'beard',
    facialHairColor: '#2a1a0a',
    title: 'President of the Americans',
    scene: 'court',
    sceneColor: '#2a3045',
    sceneAccent: '#c9a052',
  },
  'Montezuma': {
    skinTone: '#b87333',
    hairColor: '#1a0a00',
    eyeColor: '#3a2a1a',
    headgear: 'headdress',
    headgearColor: '#00aa44',
    clothingColor: '#006633',
    clothingAccent: '#ffd700',
    facialHair: 'none',
    facialHairColor: '#1a0a00',
    title: 'Emperor of the Aztecs',
    scene: 'temple',
    sceneColor: '#2a3a2a',
    sceneAccent: '#ffd700',
  },
  'Hammurabi': {
    skinTone: '#c68642',
    hairColor: '#1a0a00',
    eyeColor: '#3a2a1a',
    headgear: 'turban',
    headgearColor: '#e0c080',
    clothingColor: '#4a3a2a',
    clothingAccent: '#c9a052',
    facialHair: 'beard',
    facialHairColor: '#1a0a00',
    title: 'King of Babylon',
    scene: 'palace',
    sceneColor: '#3a2a1a',
    sceneAccent: '#c9a052',
  },
  'Mao Tse Tung': {
    skinTone: '#d4a574',
    hairColor: '#1a1a1a',
    eyeColor: '#2a1a0a',
    headgear: 'none',
    headgearColor: '#1a1a1a',
    clothingColor: '#4a6741',
    clothingAccent: '#ffd700',
    facialHair: 'none',
    facialHairColor: '#1a1a1a',
    title: 'Chairman of China',
    scene: 'palace',
    sceneColor: '#3a1a1a',
    sceneAccent: '#ffd700',
  },
  'Ramesses II': {
    skinTone: '#c68642',
    hairColor: '#1a0a00',
    eyeColor: '#3a6741',
    headgear: 'pharaoh',
    headgearColor: '#ffd700',
    clothingColor: '#e0e0e0',
    clothingAccent: '#00aacc',
    facialHair: 'goatee',
    facialHairColor: '#1a0a00',
    title: 'Pharaoh of Egypt',
    scene: 'temple',
    sceneColor: '#3a3020',
    sceneAccent: '#ffd700',
  },
  'Elizabeth I': {
    skinTone: '#f5d0b0',
    hairColor: '#cc4400',
    eyeColor: '#4a6790',
    headgear: 'crown',
    headgearColor: '#ffd700',
    clothingColor: '#cc0000',
    clothingAccent: '#e0c080',
    facialHair: 'none',
    facialHairColor: '#cc4400',
    title: 'Queen of England',
    scene: 'throne',
    sceneColor: '#2e1a2e',
    sceneAccent: '#cc0000',
  },
  'Frederick the Great': {
    skinTone: '#f0c8a0',
    hairColor: '#e0e0e0',
    eyeColor: '#4a7090',
    headgear: 'helmet',
    headgearColor: '#808080',
    clothingColor: '#1a3055',
    clothingAccent: '#c9a052',
    facialHair: 'mustache',
    facialHairColor: '#aaaaaa',
    title: 'King of Germany',
    scene: 'fortress',
    sceneColor: '#2a2a3a',
    sceneAccent: '#808080',
  },
  'Napoleon Bonaparte': {
    skinTone: '#f0c8a0',
    hairColor: '#3a2a1a',
    eyeColor: '#4a6741',
    headgear: 'hat',
    headgearColor: '#1a1a1a',
    clothingColor: '#1a3055',
    clothingAccent: '#cc0000',
    facialHair: 'none',
    facialHairColor: '#3a2a1a',
    title: 'Emperor of France',
    scene: 'court',
    sceneColor: '#1a1a3e',
    sceneAccent: '#cc0000',
  },
  'Alexander the Great': {
    skinTone: '#d4a574',
    hairColor: '#c9a052',
    eyeColor: '#4a6741',
    headgear: 'laurel',
    headgearColor: '#4caf50',
    clothingColor: '#e0e0e0',
    clothingAccent: '#1a3055',
    facialHair: 'none',
    facialHairColor: '#c9a052',
    title: 'King of Greece',
    scene: 'palace',
    sceneColor: '#1a2a4a',
    sceneAccent: '#c9a052',
  },
  'Mahatma Gandhi': {
    skinTone: '#c68642',
    hairColor: '#e0e0e0',
    eyeColor: '#3a2a1a',
    headgear: 'none',
    headgearColor: '#ffffff',
    clothingColor: '#e0e0e0',
    clothingAccent: '#ff9800',
    facialHair: 'none',
    facialHairColor: '#e0e0e0',
    title: 'Leader of India',
    scene: 'garden',
    sceneColor: '#2a3a2a',
    sceneAccent: '#ff9800',
  },
  'Dschingis Khan': {
    skinTone: '#c68642',
    hairColor: '#1a0a00',
    eyeColor: '#2a1a0a',
    headgear: 'fur_cap',
    headgearColor: '#5a3a1a',
    clothingColor: '#5a3a1a',
    clothingAccent: '#cc0000',
    facialHair: 'mustache',
    facialHairColor: '#1a0a00',
    title: 'Khan of the Huns',
    scene: 'tent',
    sceneColor: '#3a2a1a',
    sceneAccent: '#cc0000',
  },
  'Julius Caesar': {
    skinTone: '#d4a574',
    hairColor: '#3a2a1a',
    eyeColor: '#4a6741',
    headgear: 'laurel',
    headgearColor: '#ffd700',
    clothingColor: '#cc0000',
    clothingAccent: '#ffd700',
    facialHair: 'none',
    facialHairColor: '#3a2a1a',
    title: 'Emperor of Rome',
    scene: 'throne',
    sceneColor: '#3a1a1a',
    sceneAccent: '#ffd700',
  },
  'Joseph Stalin': {
    skinTone: '#d4a574',
    hairColor: '#3a2a1a',
    eyeColor: '#4a4a4a',
    headgear: 'none',
    headgearColor: '#1a1a1a',
    clothingColor: '#4a4a2a',
    clothingAccent: '#cc0000',
    facialHair: 'mustache',
    facialHairColor: '#3a2a1a',
    title: 'Premier of Russia',
    scene: 'fortress',
    sceneColor: '#2a1a1a',
    sceneAccent: '#cc0000',
  },
  'Shaka': {
    skinTone: '#6b3a1a',
    hairColor: '#1a0a00',
    eyeColor: '#3a2a1a',
    headgear: 'headdress',
    headgearColor: '#cc0000',
    clothingColor: '#8b4513',
    clothingAccent: '#e0c080',
    facialHair: 'none',
    facialHairColor: '#1a0a00',
    title: 'King of the Zulus',
    scene: 'tent',
    sceneColor: '#3a2a1a',
    sceneAccent: '#e0c080',
  },
};
