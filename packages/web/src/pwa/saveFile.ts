/**
 * Save-file import/export.
 *
 * The exported file is the raw V5 save blob — byte-identical to what the
 * server persists and to what the campaign library holds. One format, one
 * parser, one place that decides whether a file is acceptable.
 */

import { isSupportedSaveVersion, describeSaveVersionSupport } from '@shared/types/saves';

/** The result of reading a save file from disk. */
export type SaveFileReadResult =
  | { ok: true; json: string }
  | { ok: false; reason: 'unreadable' | 'invalid-json' | 'unsupported-version' };

/** Read and validate a save file the player picked. */
export async function readSaveFile(file: File): Promise<SaveFileReadResult> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  const version =
    data && typeof data === 'object' ? (data as { version?: unknown }).version : undefined;
  if (!isSupportedSaveVersion(version)) {
    return { ok: false, reason: 'unsupported-version' };
  }
  return { ok: true, json: text };
}

/** Type guard for the rejected variant (`ok` is not narrowed by the compiler here). */
export function isSaveFileError(
  result: SaveFileReadResult,
): result is { ok: false; reason: 'unreadable' | 'invalid-json' | 'unsupported-version' } {
  return (result as { ok: boolean }).ok === false;
}

/** A message the player can act on. */
export function describeSaveFileError(reason: 'unreadable' | 'invalid-json' | 'unsupported-version'): string {
  switch (reason) {
    case 'unreadable':
      return 'Could not read the selected file.';
    case 'invalid-json':
      return 'That file is not a valid save (bad JSON).';
    case 'unsupported-version':
      return `That save cannot be loaded (this build reads ${describeSaveVersionSupport()}).`;
    default:
      return 'Invalid or incompatible save file.';
  }
}

/** The file name a save gets when it is exported. */
export function saveFileName(turn: number): string {
  return `civ1-save-turn-${turn}.json`;
}

/**
 * Hand a save blob to the browser as a file download.
 *
 * The temporary anchor is removed immediately; the object URL is revoked on a
 * timer because Safari needs the URL to stay alive until the download has
 * started.
 */
export function downloadSaveFile(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Open the platform file picker and resolve with the chosen file (or null). */
export function pickSaveFile(accept = '.json,application/json'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(file);
      if (document.body.contains(input)) document.body.removeChild(input);
    };
    input.onchange = () => finish(input.files?.[0] ?? null);
    // A cancelled picker fires no event in most browsers; `cancel` is the
    // modern signal, and the timeout is the last resort.
    input.oncancel = () => finish(null);
    document.body.appendChild(input);
    input.click();
    timer = setTimeout(() => {
      if (!input.files || input.files.length === 0) finish(null);
    }, 60_000);
  });
}
