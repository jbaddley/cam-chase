import { resolveLocale, translate, type Locale, type MessageKey, type MessageParams } from '@photochase/i18n';

/**
 * Device language preferences. React Native exposes these through
 * `expo-localization`'s `getLocales()`; until that package is installed the
 * Intl API gives a usable answer on both native and web.
 */
function devicePreferences(): string[] {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().locale;
    return resolved ? [resolved] : [];
  } catch {
    return [];
  }
}

let locale: Locale = resolveLocale(devicePreferences());

/** Override the active locale (settings screen, or a test). */
export function setLocale(next: Locale): void {
  locale = next;
}

export function getLocale(): Locale {
  return locale;
}

/** Translate a key in the active locale. Screens call this, never `translate`. */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(locale, key, params);
}
