import { de } from './locales/de.js';
import { en, type MessageKey } from './locales/en.js';
import { es } from './locales/es.js';
import { fr } from './locales/fr.js';
import { ja } from './locales/ja.js';
import { pt } from './locales/pt.js';

export type { MessageKey };

export const LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];

export const CATALOGS: Record<Locale, Record<MessageKey, string>> = { en, es, fr, de, pt, ja };

export type MessageParams = Record<string, string | number>;

/** Interpolate `{name}` placeholders with params. Missing params are left as-is. */
function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * Look up and interpolate a message for a locale, falling back to English.
 *
 * When a `count` param is present and equal to one, a `<key>_one` entry is
 * preferred if the catalogue has one. The base key stays the plural form, so
 * every existing key keeps working untouched and only the messages that read
 * badly in the singular need a sibling.
 *
 * This exists because the app was shipping "1 teams still out" and "1 teams
 * joined". The web app had already hand-rolled the same problem inline
 * (`player{n === 1 ? '' : 's'}`), which is the shape this prevents spreading:
 * English's plural rule is not every language's, and a ternary in a component
 * cannot be translated.
 *
 * Deliberately only the one/other split. Full CLDR plural categories — Polish
 * has four, Arabic six — are a real requirement the day one of those locales
 * ships, and guessing at them now would be inventing an API against no caller.
 */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const table = CATALOGS[locale] as Record<string, string | undefined>;
  const fallback = CATALOGS.en as Record<string, string | undefined>;
  const singular = params && params.count === 1 ? `${key}_one` : null;
  const template = (singular ? table[singular] ?? fallback[singular] : undefined) ?? table[key] ?? fallback[key] ?? key;
  return interpolate(template, params);
}

const PSEUDO_MAP: Record<string, string> = {
  a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú',
};

/**
 * Pseudo-localize English for layout testing: accents characters and pads the
 * string so truncation and expansion bugs surface before real translations.
 */
export function pseudoLocalize(key: MessageKey, params?: MessageParams): string {
  const base = interpolate(en[key], params);
  const accented = [...base].map((ch) => PSEUDO_MAP[ch] ?? ch).join('');
  return `⟦${accented}⟧`;
}

/**
 * Pick the best supported locale from an ordered list of BCP 47 preferences
 * (`navigator.languages`, or `expo-localization`'s locale list). Region
 * subtags are ignored — `es-MX` and `es-ES` both resolve to `es` — and
 * anything unsupported falls back to English.
 */
export function resolveLocale(preferences: readonly string[] | undefined, fallback: Locale = 'en'): Locale {
  for (const preference of preferences ?? []) {
    const base = preference.toLowerCase().split('-')[0];
    const match = LOCALES.find((locale) => locale === base);
    if (match) return match;
  }
  return fallback;
}
