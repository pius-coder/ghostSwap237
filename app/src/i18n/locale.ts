export type AppLocale = 'fr' | 'en';

export const SUPPORTED_LOCALES = ['fr', 'en'] as const;
export const DEFAULT_LOCALE: AppLocale = 'en';
export const LOCALE_STORAGE_KEY = 'henshin.locale';
export const ONBOARDING_VERSION = 1;

export function isAppLocale(value: unknown): value is AppLocale {
  return value === 'fr' || value === 'en';
}

/** System language is only a preselection — never an implicit confirmation. */
export function detectSystemLocalePreselection(): AppLocale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
  const language = String(navigator.language || '').toLowerCase();
  return language.startsWith('fr') ? 'fr' : 'en';
}

export function readStoredLocale(): AppLocale | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isAppLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale: AppLocale): void {
  if (typeof localStorage === 'undefined') return;
  if (!isAppLocale(locale)) return;
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}
