import { createContext } from 'react';
import type { AppLocale } from './locale';

export interface LocaleContextValue {
  locale: AppLocale;
  hasConfirmedLocale: boolean;
  setLocale: (locale: AppLocale, options?: { persistServer?: boolean }) => Promise<void>;
  confirmLocale: (locale: AppLocale) => Promise<void>;
}

export const LocaleContext = createContext<LocaleContextValue | null>(null);
