import React, { useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { LanguageId } from '@/i18n/languages';
import '../../styles/languageSwitcher.css';

interface LanguageSwitcherProps {
  /** Currently active language (drives the selected card). */
  value: LanguageId;
  /** Called with the picked language id. The caller owns persisting it. */
  onChange: (language: LanguageId) => void;
}

/**
 * Language picker as a grid of cards — flag, native name and English name.
 *
 * Accessibility: rendered as a `radiogroup` with roving tabindex (one tab
 * stop, arrow keys walk the options and select as they go), so keyboard and
 * screen-reader players pick a language the same way as a radio group.
 * Changing the language is applied instantly by the caller, which means the
 * whole UI — including this switcher's own labels — repaints immediately.
 */
const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ value, onChange }) => {
  const { languages, t } = useTranslation();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const pick = (language: LanguageId, index: number) => {
    onChange(language);
    buttonRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>, index: number) => {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !backward) {
      return;
    }
    event.preventDefault();
    const count = languages.length;
    const nextIndex = (index + (forward ? 1 : -1) + count) % count;
    pick(languages[nextIndex].id, nextIndex);
  };

  return (
    <div className="lang-switch" role="radiogroup" aria-label={t('language.ariaGroup')}>
      {languages.map((language, index) => {
        const selected = language.id === value;
        return (
          <button
            key={language.id}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={t('language.ariaOption', { language: language.nativeName })}
            tabIndex={selected ? 0 : -1}
            className={`lang-card${selected ? ' is-selected' : ''}`}
            data-language={language.id}
            onClick={() => pick(language.id, index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span className="lang-card__flag" aria-hidden="true">
              {language.flag}
            </span>
            <span className="lang-card__names">
              <span className="lang-card__native">{language.nativeName}</span>
              <span className="lang-card__english">{language.englishName}</span>
            </span>
            <span className="lang-card__check" aria-hidden="true">
              ✓
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default LanguageSwitcher;
