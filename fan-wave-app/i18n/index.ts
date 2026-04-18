import { I18n } from 'i18n-js';
import { getLocales } from 'expo-localization';
import en from './en.json';
import es from './es.json';

const i18n = new I18n({ en, es });

// Set default and detect device language
i18n.defaultLocale = 'en';
i18n.enableFallback = true;

// Detect device language
const deviceLocales = getLocales();
const deviceLang = deviceLocales?.[0]?.languageCode ?? 'en';
i18n.locale = ['en', 'es'].includes(deviceLang) ? deviceLang : 'en';

/**
 * Translate a key. Usage: t('auth.signIn')
 */
export function t(key: string, options?: Record<string, any>): string {
  return i18n.t(key, options);
}

/**
 * Change locale at runtime.
 */
export function setLocale(locale: 'en' | 'es') {
  i18n.locale = locale;
}

/**
 * Get current locale.
 */
export function getLocale(): string {
  return i18n.locale;
}

export default i18n;
