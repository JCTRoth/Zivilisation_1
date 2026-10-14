/**
 * Test bootstrap.
 *
 * The game picks its starting language from the browser, which in a vitest
 * node environment means the *machine's* locale. On a German dev box that made
 * `gameSpeedLabel(0)` return "Volle Geschwindigkeit" while the assertion said
 * "Full Speed" — a test that passes in CI and fails at home, decided by
 * someone's regional settings.
 *
 * So the language is pinned here, before each test file, the same way a test
 * would pin a clock or a random seed: the suite asserts on English strings,
 * and English is the source of truth every other dictionary falls back to.
 */
import { beforeEach } from 'vitest';
import { setLanguage } from '@/i18n';

beforeEach(() => {
  setLanguage('en');
});
