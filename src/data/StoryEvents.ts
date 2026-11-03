/**
 * StoryEvents — the game's illustrated chronicle.
 *
 * A handful of moments get a HUGE full-screen card (image, eyebrow, title,
 * body, one Continue button — `StoryModal`): the dawn of the game, a
 * barbarian conquest, the nomad migration. Two existing dialogs — the city
 * chronicle (`CityEventModal`) and the wonder completion screen — get the
 * same art treatment through the maps below.
 *
 * Every image lives under `public/assets/story/` and is OPTIONAL: a missing
 * file (not generated yet, renamed, offline) just leaves the card's own
 * gradient — the story never breaks because of art. Generation prompts for
 * all of them: `doc/STORY_ART_PROMPTS.adoc`.
 *
 * Style contract (see the prompts doc): wide cinematic 16-bit pixel scenes,
 * the same technique as the nomad portraits but landscape, dark edges that
 * melt into the card's `#0b0f14` stage.
 */

import type { TranslationKey } from '@/i18n';

/** One full-screen story moment. */
export interface StoryDef {
  id: 'dawn' | 'hordeConquest' | 'nomadMigration';
  /** Root-relative art under public/ (hidden on load error). */
  image: string;
  /** The card's mood — how the shell lights the heading. */
  tone: 'info' | 'danger' | 'success' | 'gold' | 'solemn' | 'neutral';
  eyebrowKey: TranslationKey;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
}

export type StoryId = StoryDef['id'];

export const STORY_EVENTS: Record<StoryId, StoryDef> = {
  dawn: {
    id: 'dawn',
    image: '/assets/story/dawn.png',
    tone: 'solemn',
    eyebrowKey: 'story.dawn.eyebrow',
    titleKey: 'story.dawn.title',
    bodyKey: 'story.dawn.body',
  },
  hordeConquest: {
    id: 'hordeConquest',
    image: '/assets/story/horde_conquest.png',
    tone: 'danger',
    eyebrowKey: 'story.horde.eyebrow',
    titleKey: 'story.horde.title',
    bodyKey: 'story.horde.body',
  },
  nomadMigration: {
    id: 'nomadMigration',
    image: '/assets/story/nomad_migration.png',
    tone: 'gold',
    eyebrowKey: 'story.migration.eyebrow',
    titleKey: 'story.migration.title',
    bodyKey: 'story.migration.body',
  },
};

/** Illustration per city-chronicle kind (shown big inside CityEventModal). */
export const CITY_EVENT_ART: Record<string, string> = {
  founded: '/assets/story/city_founded.png',
  captured: '/assets/story/city_triumph.png',
  razed: '/assets/story/city_flames.png',
  joined: '/assets/story/city_joined.png',
};
