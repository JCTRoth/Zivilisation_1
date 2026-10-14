/**
 * Browser-language detection — the game's first guess at which language you
 * read, used only until you pick one yourself.
 *
 * Kept apart from `languages.ts` (which deliberately imports nothing) so the
 * registry stays usable from the data layer without dragging the browser in.
 *
 * ── Why the fallbacks are not a plain lookup ──────────────────────────────
 * A naive `tags.includes(id)` map would send a Polish player to English, and
 * there are a great many browsers on this earth set to a language the game
 * does not ship. Two rules catch most of the rest without pretending to
 * translate anything:
 *
 *   • the Slavic languages share enough with Russian that a Russian build is
 *     far better than English — the script is the same and a large part of the
 *     vocabulary is cognate;
 *   • Portuguese is left out deliberately and routed to Spanish, its closest
 *     shipped sibling (the request), rather than to English.
 *
 * Everything else falls back to English, which is the source of truth for
 * every key and therefore never renders a half-string.
 */
import { DEFAULT_LANGUAGE, isSupportedLanguage, type LanguageId } from './languages';

/**
 * Slavic primary subtags. East, West and South are all covered: a Czech, a
 * Croat and a Ukrainian all get the Russian build rather than English.
 *
 * `be` is Belarusian (ISO 639-1), not Belgian — a browser will not report a
 * country tag here without a language tag in front of it.
 */
const SLAVIC: ReadonlySet<string> = new Set([
  // East
  'ru', 'uk', 'be', 'rue',
  // West
  'pl', 'cs', 'sk', 'hsb', 'dsb', 'csb',
  // South
  'sl', 'hr', 'sr', 'bs', 'me', 'bg', 'mk',
]);

/** The language a browser tag resolves to, given in preference order. */
/**
 * The language one browser tag resolves to, or null when no rule answers and
 * the caller should keep looking further down the preference list.
 *
 * Mirrors `resolveNationForTag` in `data/CivilizationByLanguage` on purpose:
 * both are per-tag, both return null for "not my language", and the pair can
 * therefore be walked over the same list and compared entry by entry.
 */
export function resolveBrowserLanguageForTag(tag: unknown): LanguageId | null {
  const primary = primarySubtag(tag);
  if (!primary) return null;
  // Exact ship: `de`, `de-AT`, `de-CH` and `de_AT` all land on German.
  if (isSupportedLanguage(primary)) return primary;
  if (SLAVIC.has(primary)) return 'ru';
  // Portuguese → Spanish, per the game's own routing rule.
  if (primary === 'pt') return 'es';
  return null;
}

/** First tag in preference order that resolves, else English. */
export function resolveBrowserLanguage(tags: readonly string[]): LanguageId {
  for (const tag of tags) {
    const resolved = resolveBrowserLanguageForTag(tag);
    if (resolved) return resolved;
  }
  return DEFAULT_LANGUAGE;
}

/**
 * The browser's language preferences, in the user's own order.
 *
 * This is the ordered list behind the browser setting that reads "Some web
 * pages are displayed in multiple languages. Choose languages in your
 * preferred order." Both the UI language and the preselected nation are read
 * from it, through this one function, so the two can never disagree about
 * which list they are looking at.
 *
 * `languages` is the ordered preference list; `language` is the older single
 * value and is all some browsers still populate. Returns an empty list when
 * there is no browser at all (node tests, storage-blocked contexts).
 */
export function browserLanguageTags(): readonly string[] {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  if (!nav) return [];
  if (Array.isArray(nav.languages) && nav.languages.length > 0) return nav.languages;
  return nav.language ? [nav.language] : [];
}

/**
 * The language the game should start in, read from the browser. Returns
 * English when the browser is unavailable or reports nothing usable.
 */
export function detectBrowserLanguage(): LanguageId {
  return resolveBrowserLanguage(browserLanguageTags());
}

/** The part of a BCP-47 tag that identifies the language (`pt-BR` → `pt`). */
function primarySubtag(tag: unknown): string {
  if (typeof tag !== 'string' || tag.length === 0) return '';
  const cut = tag.split(/[-_]/)[0];
  return cut.toLowerCase();
}
