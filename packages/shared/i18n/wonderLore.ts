/**
 * Wonder prose localization — the long-form texts of the World Wonders
 * (effect, flavour/history, "about" paragraph and the fact bullets).
 *
 * These texts are too long and too array-shaped for the flat `t()` dictionaries
 * (src/i18n/*.ts), so they live here as per-language modules keyed by the
 * stable wonder id. English is *not* duplicated: the base texts stay in
 * `src/data/WonderData.ts`, and the English "lore" is the empty map — every
 * lookup falls back to the data fields.
 *
 * Components read the texts through `localizedWonder(id, wonder)`, which
 * returns a shallow copy of the wonder definition with translated fields
 * overriding the English ones. The components already call `useTranslation()`,
 * so a language switch repaints them.
 *
 * ── Adding a language ────────────────────────────────────────────────────
 * Create `src/i18n/wonderLore/<id>.ts` (copy an existing one, translate the
 * values, keep every wonder id and the exact number of `facts`), import it in
 * `LORES` below, and add it to `LanguageId` — `tests/wonderLore.test.ts`
 * fails on any missing wonder or missing fact.
 *
 * The same module localizes the *Wikipedia links* of the wonder artwork
 * credits: `wonderWikiUrl()` points the "Read more on Wikipedia" link at the
 * article in the player's language (curated titles where the localized
 * article name differs from the English slug, subdomain swap otherwise).
 */
import { getLanguage } from './index';
import type { LanguageId } from './languages';
import wonderLoreDe from './wonderLore/de';
import wonderLoreFr from './wonderLore/fr';
import wonderLoreRu from './wonderLore/ru';
import wonderLoreEs from './wonderLore/es';
import wonderLoreJa from './wonderLore/ja';

/** Translated prose of one wonder. Every field is optional; missing = English. */
export interface WonderLoreEntry {
  /** One-line effect reminder (city screen, production list, overview card). */
  shortEffect?: string;
  /** Full mechanical effect in plain language. */
  effectText?: string;
  /** Short historical/flavour text ("History"). */
  flavor?: string;
  /** Longer background paragraph ("Trivia"). */
  about?: string;
  /** The "Some facts" bullets — the count must match the English entry. */
  facts?: string[];
}

/** Lore of every wonder in one language, keyed by wonder id. */
export type WonderLore = Record<string, WonderLoreEntry | undefined>;

/**
 * English is the data itself (empty map); the other languages override.
 * Register a new language here when adding one.
 */
const LORES: Record<LanguageId, WonderLore> = {
  en: {},
  de: wonderLoreDe,
  fr: wonderLoreFr,
  ru: wonderLoreRu,
  es: wonderLoreEs,
  ja: wonderLoreJa,
};

/** Translated lore of a wonder in the ACTIVE language (undefined = English). */
export function getWonderLore(wonderId: string, language: LanguageId = getLanguage()): WonderLoreEntry | undefined {
  return LORES[language]?.[wonderId];
}

/** Shape of a wonder definition as far as prose goes. */
type WonderLike = {
  id: string;
  shortEffect: string;
  effectText: string;
  flavor: string;
  about?: string;
  facts: string[];
};

/**
 * A wonder definition with the active language's prose on top: translated
 * fields win, untranslated fields fall back to the English data. Returns the
 * original object untouched when the language has no lore for the wonder.
 */
export function localizedWonder<T extends WonderLike>(wonder: T, wonderId: string = wonder.id): T {
  const lore = getWonderLore(wonderId);
  if (!lore) return wonder;
  const merged: Record<string, unknown> = { ...wonder };
  for (const [field, value] of Object.entries(lore)) {
    if (value !== undefined) merged[field] = value;
  }
  return merged as T;
}

/**
 * Per-language Wikipedia article titles, for the wonders whose localized
 * article name differs from the English slug in the artwork credits.
 * Missing entries fall back to the English slug on the localized subdomain.
 */
export const WONDER_WIKI_TITLES: Record<string, Partial<Record<LanguageId, string>>> = {
  colossus: { de: 'Koloss von Rhodos', fr: 'Colosse de Rhodes', ru: 'Колосс Родосский', es: 'Coloso de Rodas', ja: 'ロドスのコロッソス' },
  great_library: { de: 'Bibliothek von Alexandria', fr: "Bibliothèque d'Alexandrie", ru: 'Александрийская библиотека', es: 'Biblioteca de Alejandría', ja: 'アレクサンドリア大図書館' },
  hanging_gardens: { de: 'Hängende Gärten (Babylon)', fr: 'Jardins suspendus de Babylone', ru: 'Висячие сады Вавилона', es: 'Jardines colgantes de Babilonia', ja: 'バビロンの空中庭園' },
  lighthouse: { de: 'Pharos von Alexandria', fr: "Phare d'Alexandrie", ru: 'Александрийский маяк', es: 'Faro de Alejandría', ja: 'アレクサンドリア大灯台' },
  oracle: { de: 'Delphi', fr: 'Delphes', ru: 'Дельфы', es: 'Delfos', ja: 'デルポイ' },
  pyramids: { de: 'Große Pyramide von Gizeh', fr: 'Grande pyramide de Gizeh', ru: 'Великая пирамида Гизы', es: 'Gran Pirámide de Guiza', ja: 'ギザの大ピラミッド' },
  silk_road: { de: 'Seidenstraße', fr: 'Route de la soie', ru: 'Шёлковый путь', es: 'Ruta de la Seda', ja: 'シルクロード' },
  copernicus_observatory: { de: 'Nikolaus Kopernikus', fr: 'Nicolas Copernic', ru: 'Николай Коперник', es: 'Nicolás Copérnico', ja: 'ニコラウス・コペルニクス' },
  isaac_newtons_college: { de: 'Trinity College (Cambridge)', fr: 'Trinity College', ru: 'Тринити-колледж (Кембридж)', es: 'Trinity College (Cambridge)', ja: 'トリニティ・カレッジ（ケンブリッジ）' },
  js_bachs_cathedral: { de: 'Thomaskirche (Leipzig)', fr: 'Église Saint-Thomas (Leipzig)', ru: 'Церковь Святого Фома (Лейпциг)', es: 'Iglesia de Santo Tomás (Leipzig)', ja: 'ライプツィヒ聖トマス教会' },
  magellans_expedition: { de: 'Magellan-Expedition', fr: 'Expédition de Magellan', ru: 'Экспедиция Магеллана', es: 'Expedición de Magallanes', ja: 'マゼランの世界一周航海' },
  michelangelos_chapel: { de: 'Decke der Sixtinischen Kapelle', fr: 'Plafond de la chapelle Sixtine', ru: 'Потолок Сикстинской капеллы', es: 'Bóveda de la Capilla Sixtina', ja: 'システィーナ礼拝堂天井画' },
  shakespeare_theatre: { de: 'Globe Theatre', fr: 'Théâtre du Globe', ru: 'Глобус (театр)', es: 'Globe Theatre', ja: 'グローブ座' },
  leonardos_workshop: { de: 'Codex Atlanticus', fr: 'Codex Atlanticus', ru: 'Кодекс Атлантикус', es: 'Códice Atlántico', ja: 'アトランティカ写本' },
  international_space_station: { de: 'Internationale Raumstation', fr: 'Station spatiale internationale', ru: 'Международная космическая станция', es: 'Estación Espacial Internacional', ja: '国際宇宙ステーション' },
  human_genome_project: { de: 'Human-Genom-Projekt', fr: 'Projet du génome humain', ru: 'Проект «Геном человека»', es: 'Proyecto del Genoma Humano', ja: 'ヒトゲノム計画' },
  hoover_dam: { de: 'Hoover-Talsperre', fr: 'Barrage Hoover', ru: 'Дамба Гувера', es: 'Presa Hoover', ja: 'フーバー・ダム' },
  manhattan_project: { de: 'Manhattan-Projekt', fr: 'Projet Manhattan', ru: 'Манхэттенский проект', es: 'Proyecto Manhattan', ja: 'マンハッタン計画' },
  seti_program: { de: 'Suche nach außerirdischer Intelligenz', fr: "Recherche d'intelligence extraterrestre", ru: 'Поиск внеземных цивилизаций', es: 'Búsqueda de inteligencia extraterrestre', ja: '地球外知的生命探査' },
  super_kamiokande: { de: 'Super-Kamiokande', fr: 'Super-Kamiokande', ru: 'Супер-Камиокандэ', es: 'Super-Kamiokande', ja: 'スーパーカミオカンデ' },
  statue_of_liberty: { de: 'Freiheitsstatue', fr: 'Statue de la liberté', ru: 'Статуя Свободы', es: 'Estatua de la Libertad', ja: '自由の女神' },
  tiangong: { de: 'Tiangong (Raumstation)', fr: 'Tiangong', ru: 'Тяньгун (станция)', es: 'Tiangong', ja: '天宮宇宙ステーション' },
  mir: { de: 'Mir (Raumstation)', fr: 'Mir (station spatiale)', ru: 'Мир (станция)', es: 'Mir (estación espacial)', ja: 'ミール' },
  ai_supercluster: { de: 'Colossus (Rechenzentrum)', fr: 'Colossus (centre de données)', ru: 'Colossus (дата-центр)', es: 'Colossus (centro de datos)', ja: 'Colossus（データセンター）' },
};

/**
 * The Wikipedia article URL in the active language: a curated localized title
 * when one is known, otherwise the English slug served from the localized
 * subdomain (the article exists there under the same name for cognate titles).
 * English and unknown languages get the original URL untouched.
 */
export function wonderWikiUrl(articleUrl: string, wonderId: string, language: LanguageId = getLanguage()): string {
  if (language === 'en') return articleUrl;
  const title = WONDER_WIKI_TITLES[wonderId]?.[language];
  if (title) {
    return `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  }
  return articleUrl.replace('://en.wikipedia.org/', `://${language}.wikipedia.org/`);
}
