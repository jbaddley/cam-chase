import { describe, expect, it } from 'vitest';
import { CATALOGS, LOCALES, pseudoLocalize, translate } from './index.js';
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
