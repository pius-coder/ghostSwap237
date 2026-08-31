import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CosmicButton } from '@/components/ui/cosmic-button';
import { useLocalePreference } from '@/i18n/useLocalePreference';
import { detectSystemLocalePreselection, type AppLocale } from '@/i18n/locale';

export function LocaleBootstrapGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { hasConfirmedLocale, confirmLocale } = useLocalePreference();
  const [selected, setSelected] = useState<AppLocale>(detectSystemLocalePreselection());
  const titleId = useId();

  if (hasConfirmedLocale) return <>{children}</>;

  return (
    <div className="mesh-bg flex min-h-screen items-center justify-center p-6" role="dialog" aria-labelledby={titleId}>
      <div className="w-full max-w-lg space-y-6 rounded-2xl border border-border bg-background/95 p-8 shadow-xl">
        <div className="space-y-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Henshin</p>
          <h1 id={titleId} tabIndex={-1} className="text-3xl font-semibold tracking-tight text-foreground">
            {t('locale.title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('locale.subtitle')}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('locale.title')}>
          {([
            { code: 'fr' as const, label: t('locale.french') },
            { code: 'en' as const, label: t('locale.english') },
          ]).map((option) => {
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
                className={`rounded-xl border p-5 text-left transition ${
                  selectedState ? 'border-primary bg-primary/10 ring-1 ring-primary/40' : 'border-border bg-panel/50 hover:border-primary/40'
                }`}
              >
                <p className="text-lg font-semibold text-foreground">{option.label}</p>
                {systemSuggested && (
                  <p className="mt-2 text-xs text-muted-foreground">{t('locale.systemHint')}</p>
                )}
              </button>
            );
          })}
        </div>
        <CosmicButton
          as="button"
          className="w-full"
          contentClassName="min-h-12"
          onClick={() => void confirmLocale(selected)}
        >
          {t('locale.continue')}
        </CosmicButton>
      </div>
    </div>
  );
}
