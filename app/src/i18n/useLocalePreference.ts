import { useContext } from 'react';
import { LocaleContext, type LocaleContextValue } from '@/i18n/locale-context';

export function useLocalePreference(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocalePreference must be used within LocaleProvider');
  return ctx;
}
