/**
 * The save-format contract — one version gate for the engine and the UI.
 *
 * The bug this module exists to prevent: the file picker used to accept
 * versions 1–3 while the engine wrote version 5, so a save written by the
 * game could not be loaded back through the menu.
 */
import { describe, expect, it } from 'vitest';
import {
  CURRENT_SAVE_VERSION,
  MAX_SUPPORTED_SAVE_VERSION,
  MIN_SUPPORTED_SAVE_VERSION,
  SUPPORTED_SAVE_VERSIONS,
  isSupportedSaveVersion,
  readSaveMetadata,
} from '@shared/types/saves';

function blob(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: CURRENT_SAVE_VERSION,
    currentTurn: 42,
    currentYear: -1200,
    humanCivId: 1,
    timestamp: 1717539200000,
    civilizations: [
      { id: 0, name: 'Rome', isHuman: false },
      { id: 1, name: 'Egypt', isHuman: true },
    ],
    ...overrides,
  });
}

describe('save version gate', () => {
  it('accepts every supported version', () => {
    for (const version of SUPPORTED_SAVE_VERSIONS) {
      expect(isSupportedSaveVersion(version)).toBe(true);
    }
  });

  it('rejects versions outside the supported range', () => {
    expect(isSupportedSaveVersion(0)).toBe(false);
    expect(isSupportedSaveVersion(MAX_SUPPORTED_SAVE_VERSION + 1)).toBe(false);
    expect(isSupportedSaveVersion(-1)).toBe(false);
  });

  it('rejects values that only look like a version', () => {
    expect(isSupportedSaveVersion('5')).toBe(false);
    expect(isSupportedSaveVersion(5.5)).toBe(false);
    expect(isSupportedSaveVersion(NaN)).toBe(false);
    expect(isSupportedSaveVersion(null)).toBe(false);
    expect(isSupportedSaveVersion(undefined)).toBe(false);
  });

  it('spans a contiguous range', () => {
    expect(MIN_SUPPORTED_SAVE_VERSION).toBe(1);
    expect(SUPPORTED_SAVE_VERSIONS).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('save metadata', () => {
  it('reads the turn, the year and the human civilization', () => {
    const meta = readSaveMetadata(blob());
    expect(meta).not.toBeNull();
    expect(meta?.version).toBe(CURRENT_SAVE_VERSION);
    expect(meta?.turn).toBe(42);
    expect(meta?.year).toBe(-1200);
    expect(meta?.civilizationName).toBe('Egypt');
    expect(meta?.timestamp).toBe(1717539200000);
  });

  it('falls back to the first civilization when no human seat is marked', () => {
    const meta = readSaveMetadata(
      blob({ humanCivId: undefined, civilizations: [{ id: 0, name: 'Rome' }] }),
    );
    expect(meta?.civilizationName).toBe('Rome');
  });

  it('returns null for malformed JSON', () => {
    expect(readSaveMetadata('{not json')).toBeNull();
    expect(readSaveMetadata('')).toBeNull();
    expect(readSaveMetadata('null')).toBeNull();
  });

  it('returns null for an unsupported version', () => {
    expect(readSaveMetadata(blob({ version: 99 }))).toBeNull();
    expect(readSaveMetadata(blob({ version: undefined }))).toBeNull();
  });

  it('tolerates a blob without a civilization list', () => {
    const meta = readSaveMetadata(JSON.stringify({ version: 5, currentTurn: 7 }));
    expect(meta?.turn).toBe(7);
    expect(meta?.civilizationName).toBeNull();
  });
});
