import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './resources/en';
import { fr } from './resources/fr';
import {
  DEFAULT_LOCALE,
  detectSystemLocalePreselection,
  isAppLocale,
  readStoredLocale,
  type AppLocale,
} from './locale';

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: readStoredLocale() ?? detectSystemLocalePreselection(),
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export async function changeAppLocale(locale: AppLocale): Promise<void> {
  if (!isAppLocale(locale)) return;
  await i18n.changeLanguage(locale);
}

export function getAppLocale(): AppLocale {
  return isAppLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
}

export { i18n };
export default i18n;
