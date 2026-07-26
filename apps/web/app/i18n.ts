'use client';

import { useEffect, useState } from 'react';
import { resolveLocale, translate, type Locale, type MessageKey, type MessageParams } from '@photochase/i18n';

export type Translate = (key: MessageKey, params?: MessageParams) => string;

/**
 * Translate in the viewer's browser locale.
 *
 * These pages prerender on the server, where `navigator` does not exist, so the
 * first render must use the same locale the server used or React will report a
 * hydration mismatch. The browser's preference is therefore applied after mount,
 * which re-renders once with the right language.
 */
export function useT(): Translate {
  const [locale, setLocale] = useState<Locale>('en');

  useEffect(() => {
    setLocale(resolveLocale(navigator.languages));
  }, []);

  return (key, params) => translate(locale, key, params);
}
