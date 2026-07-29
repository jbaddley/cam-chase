import { describe, expect, it } from 'vitest';
import { CATALOGS, LOCALES, pseudoLocalize, resolveLocale, translate } from './index.js';
import { en } from './locales/en.js';

describe('key parity', () => {
  const enKeys = Object.keys(en).sort();
  it.each(LOCALES)('locale %s has exactly the English key set', (locale) => {
    expect(Object.keys(CATALOGS[locale]).sort()).toEqual(enKeys);
  });

  it('no locale has an empty string', () => {
    for (const locale of LOCALES) {
      for (const value of Object.values(CATALOGS[locale])) {
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  it('placeholder tokens are preserved across locales', () => {
    // Every locale's teamsJoined must keep the {count} token.
    for (const locale of LOCALES) {
      expect(CATALOGS[locale]['lobby.teamsJoined']).toContain('{count}');
    }
  });
});

describe('translate', () => {
  it('interpolates params', () => {
    expect(translate('en', 'lobby.teamsJoined', { count: 3 })).toBe('3 teams joined');
    expect(translate('es', 'results.winner', { team: 'Rojos' })).toBe('¡Rojos gana!');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(translate('en', 'results.winner')).toBe('{team} wins!');
  });
});

describe('pseudoLocalize', () => {
  it('accents and brackets the source string', () => {
    const out = pseudoLocalize('game.start');
    expect(out.startsWith('⟦')).toBe(true);
    expect(out.endsWith('⟧')).toBe(true);
    expect(out).toContain('Stárt');
  });
});

describe('resolveLocale', () => {
  it('matches a supported locale ignoring the region subtag', () => {
    expect(resolveLocale(['es-MX'])).toBe('es');
    expect(resolveLocale(['pt-BR'])).toBe('pt');
    expect(resolveLocale(['DE-de'])).toBe('de');
  });

  it('takes the first supported preference in order', () => {
    expect(resolveLocale(['kl', 'is', 'fr-CA', 'es'])).toBe('fr');
  });

  it('falls back to English for unsupported or missing preferences', () => {
    expect(resolveLocale(['kl-GL'])).toBe('en');
    expect(resolveLocale([])).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
  });

  it('honours an explicit fallback', () => {
    expect(resolveLocale(['kl'], 'ja')).toBe('ja');
  });
});

/**
 * The app shipped "1 teams still out" and "1 teams joined", and the web app had
 * already hand-rolled the same problem inline (`player{n === 1 ? '' : 's'}`) —
 * which is untranslatable and assumes English's plural rule is universal.
 */
describe('singular forms', () => {
  it('prefers a _one entry when the count is one', () => {
    expect(translate('en', 'regroup.waitingFor', { count: 1 })).toBe('1 team still out');
    expect(translate('en', 'regroup.waitingFor', { count: 3 })).toBe('3 teams still out');
  });

  it('does the same in every locale that has the pair', () => {
    for (const locale of LOCALES) {
      const one = translate(locale, 'lobby.teamsJoined', { count: 1 });
      const many = translate(locale, 'lobby.teamsJoined', { count: 4 });
      expect(one, locale).not.toBe(many);
      expect(one, locale).toContain('1');
      expect(many, locale).toContain('4');
    }
  });

  it('leaves keys without a singular form exactly as they were', () => {
    // The base key stays the plural, so every existing message is untouched.
    expect(translate('en', 'plan.creditsLeft', { count: 1 })).toBe('1 game credits left');
  });

  it('ignores the rule when there is no count at all', () => {
    expect(translate('en', 'game.start')).toBe('Start game');
  });
});
