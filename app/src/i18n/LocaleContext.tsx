import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { changeAppLocale, getAppLocale } from '@/i18n';
import {
  isAppLocale,
  readStoredLocale,
  writeStoredLocale,
  type AppLocale,
} from '@/i18n/locale';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { LocaleContext } from '@/i18n/locale-context';

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const { user } = useAuth();
  const [locale, setLocaleState] = useState<AppLocale>(() => getAppLocale());
  const [hasConfirmedLocale, setHasConfirmedLocale] = useState(() => readStoredLocale() !== null);

  useEffect(() => {
    const onLanguageChanged = (lng: string) => {
      if (isAppLocale(lng)) setLocaleState(lng);
    };
    i18n.on('languageChanged', onLanguageChanged);
    return () => {
      i18n.off('languageChanged', onLanguageChanged);
    };
  }, [i18n]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void supabase
      .from('user_preferences')
      .select('locale')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(async ({ data }) => {
        if (cancelled || !isAppLocale(data?.locale)) return;
        writeStoredLocale(data.locale);
        setHasConfirmedLocale(true);
        await changeAppLocale(data.locale);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const setLocale = useCallback(async (next: AppLocale, options?: { persistServer?: boolean }) => {
    if (!isAppLocale(next)) return;
    const previous = getAppLocale();
    writeStoredLocale(next);
    setHasConfirmedLocale(true);
    await changeAppLocale(next);
    if (options?.persistServer && user?.id) {
      const { error } = await supabase.rpc('set_own_locale', { p_locale: next });
      if (error) {
        writeStoredLocale(previous);
        await changeAppLocale(previous);
        throw error;
      }
    }
  }, [user?.id]);

  const confirmLocale = useCallback(async (next: AppLocale) => {
    await setLocale(next, { persistServer: false });
  }, [setLocale]);

  const value = useMemo(
    () => ({ locale, hasConfirmedLocale, setLocale, confirmLocale }),
    [locale, hasConfirmedLocale, setLocale, confirmLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
