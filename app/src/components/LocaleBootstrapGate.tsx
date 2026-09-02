import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppButton, AppSurface, PublicScene } from '@/components/app';
import { useLocalePreference } from '@/i18n/useLocalePreference';
import { detectSystemLocalePreselection, type AppLocale } from '@/i18n/locale';
import { cn } from '@/lib/utils';

export function LocaleBootstrapGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { hasConfirmedLocale, confirmLocale } = useLocalePreference();
  const [selected, setSelected] = useState<AppLocale>(detectSystemLocalePreselection());
  const titleId = useId();

  if (hasConfirmedLocale) return <>{children}</>;

  return (
    <PublicScene>
      <AppSurface elevated className="w-full space-y-6 p-6 sm:p-8" role="dialog" aria-labelledby={titleId}>
        <div className="space-y-2 text-left">
          <p className="text-xs font-medium text-muted-foreground">Henshin</p>
          <h1 id={titleId} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-foreground">
            {t('locale.title')}
          </h1>
          <p className="text-[13px] text-muted-foreground">{t('locale.subtitle')}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('locale.title')}>
          {(
            [
              { code: 'fr' as const, label: t('locale.french') },
              { code: 'en' as const, label: t('locale.english') },
            ] as const
          ).map((option) => {
            const selectedState = selected === option.code;
            const systemSuggested = detectSystemLocalePreselection() === option.code;
            return (
              <button
                key={option.code}
                type="button"
                role="radio"
                aria-checked={selectedState}
                aria-current={selectedState ? 'true' : undefined}
                onClick={() => setSelected(option.code)}
                className={cn(
                  'rounded-lg border p-4 text-left transition-ui',
                  selectedState
                    ? 'border-white/60 bg-white/[0.08]'
                    : 'border-white/[0.08] bg-surface hover:border-white/20',
                )}
              >
                <p className="text-[15px] font-semibold text-foreground">{option.label}</p>
                {systemSuggested ? (
                  <p className="mt-2 text-xs text-muted-foreground">{t('locale.systemHint')}</p>
                ) : null}
              </button>
            );
          })}
        </div>
        <AppButton className="w-full" onClick={() => void confirmLocale(selected)}>
          {t('locale.continue')}
        </AppButton>
      </AppSurface>
    </PublicScene>
  );
}
