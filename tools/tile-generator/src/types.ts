export interface TextureVariant {
  filename: string;
  path: string;
  size: number;
  n: number;
  mtime: number;
}

export interface GameTile {
  filename: string;
  path: string;
  size: number;
  mtime: number;
}

export interface TextureGroup {
  name: string;
  variants: TextureVariant[];
  inGame: GameTile | null;
  inGameTiles: GameTile[];
}

/** A pre-rendered feature-on-tile PNG from tools/tile-generator/tiles. */
export interface ComposedTile {
  filename: string;
  path: string;
  size: number;
  mtime: number;
  inGame: boolean;
}

export interface FalModel {
  id: string;
  name: string;
  description: string;
  status: string;
  category?: string;
  isEdit?: boolean;
  pricing: null | { cost: string; unit: string; type: string };
}

export interface GenerateResult {
  ok: boolean;
  filename?: string;
  path?: string;
  size?: number;
  n?: number;
  error?: string;
}

export interface Preset {
  name: string;
  color: string;
  file: string;
  w: number;
  h: number;
  /**
   * Roster ids this preset plans. Without it the preset key itself is the
   * roster id (every terrain preset is named after its terrain); feature
   * presets name the stem base their variants share (`forest_feature` →
   * `forest_feature_1..3`).
   */
  selection?: { terrains?: string[]; features?: string[]; units?: string[] };
}

/** One asset kind the abstract generator can plan. */
export interface PromptAssetVariant {
  variant: number;
  prompt: string;
  keywords?: Record<string, string>;
}

export interface PromptAsset {
  kind: 'terrain' | 'feature' | 'unit';
  id: string;
  spec?: string;
  output?: string;
  negative?: string;
  source?: { kind: string; file?: string; glob?: string };
  variants: PromptAssetVariant[];
}

/** What abstract_generator returns for a request (JSON in, bundle out). */
export interface PromptBundle {
  version: number;
  label?: string;
  seed?: number;
  iterations?: number;
  generatedAt?: string;
  theme?: string;
  style?: string;
  assets: PromptAsset[];
  error?: string;
}
