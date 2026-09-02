import { useEffect, useId, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { AppButton } from '@/components/app';
import { LegalDocuments } from '@/components/LegalDocuments';
import { useLocalePreference } from '@/i18n/useLocalePreference';
import { type AppLocale } from '@/i18n/locale';
import { cn } from '@/lib/utils';

type Step = 1 | 2 | 3;

interface OnboardingStatus {
  required: boolean;
  legalGateRequired?: boolean;
  locale?: string | null;
}

export function OnboardingGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { locale, setLocale } = useLocalePreference();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [selectedLocale, setSelectedLocale] = useState<AppLocale>(locale);
  const [scrolled, setScrolled] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const checkedUser = useRef<string | null>(null);

  const loadStatus = async () => {
    setLoadError(false);
    const { data, error } = await supabase.rpc('get_own_onboarding_status');
    if (error || !data) {
      setLoadError(true);
      setStatus(null);
      return;
    }
    setStatus(data as OnboardingStatus);
    if (data.locale === 'fr' || data.locale === 'en') {
      setSelectedLocale(data.locale);
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    if (checkedUser.current === user.id && status) return;
    checkedUser.current = user.id;
    void loadStatus();
    // status intentionally omitted: guards one load per authenticated user id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    titleRef.current?.focus();
  }, [step, status?.required, loadError]);

  if (!user) return <>{children}</>;
  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 ref={titleRef} tabIndex={-1} className="text-xl font-semibold">
            {t('onboarding.loadError')}
          </h1>
          <AppButton onClick={() => void loadStatus()}>{t('common.retry')}</AppButton>
        </div>
      </div>
    );
  }
  if (!status) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-background text-[13px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
      </div>
    );
  }
  if (!status.required) return <>{children}</>;

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 12) setScrolled(true);
  };

  const changeLocaleDuringLegal = async (next: AppLocale) => {
    setSelectedLocale(next);
    setScrolled(false);
    setAccepted(false);
    await setLocale(next);
  };

  const finish = async () => {
    setSubmitting(true);
    setSubmitError(null);
    await setLocale(selectedLocale);
    const { error } = await supabase.rpc('complete_current_onboarding', {
      p_locale: selectedLocale,
      p_app_version: import.meta.env.VITE_APP_VERSION || 'desktop',
      p_user_agent: navigator.userAgent,
    });
    setSubmitting(false);
    if (error) {
      setSubmitError(t('onboarding.completeError'));
      return;
    }
    setStatus({ required: false });
  };

  return (
    <Dialog open>
      <DialogContent
        className="max-h-[94vh] sm:max-w-2xl"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        aria-labelledby={titleId}
      >
        <DialogHeader>
          <p className="text-xs text-muted-foreground">
            {t('onboarding.stepLabel', { current: step, total: 3 })}
          </p>
          <DialogTitle id={titleId} ref={titleRef} tabIndex={-1}>
            {step === 1 && t('onboarding.languageTitle')}
            {step === 2 && t('onboarding.productTitle')}
            {step === 3 && t('onboarding.legalTitle')}
          </DialogTitle>
          <DialogDescription>
            {step === 1 && t('onboarding.languageBody')}
            {step === 2 && t('onboarding.productBody')}
            {step === 3 && t('onboarding.legalBody')}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div
            className="grid gap-3 sm:grid-cols-2"
            role="radiogroup"
            aria-label={t('onboarding.languageTitle')}
          >
            {(
              [
                { code: 'fr' as const, label: t('locale.french') },
                { code: 'en' as const, label: t('locale.english') },
              ] as const
            ).map((option) => (
              <button
                key={option.code}
                type="button"
                role="radio"
                aria-checked={selectedLocale === option.code}
                aria-current={selectedLocale === option.code ? 'true' : undefined}
                className={cn(
                  'rounded-lg border p-4 text-left transition-ui',
                  selectedLocale === option.code
                    ? 'border-primary bg-primary/10'
                    : 'border-white/[0.08]',
                )}
                onClick={() => void setLocale(option.code).then(() => setSelectedLocale(option.code))}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="custom-scrollbar max-h-[50vh] space-y-4 overflow-y-auto text-[13px] text-muted-foreground">
            <section>
              <h3 className="font-semibold text-foreground">{t('onboarding.fastTitle')}</h3>
              <p>{t('onboarding.fastBody')}</p>
            </section>
            <section>
              <h3 className="font-semibold text-foreground">{t('onboarding.proTitle')}</h3>
              <p>{t('onboarding.proBody')}</p>
            </section>
            <section>
              <h3 className="font-semibold text-foreground">{t('onboarding.paymentsTitle')}</h3>
              <p>{t('onboarding.paymentsBody')}</p>
            </section>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex gap-2">
              {(['fr', 'en'] as const).map((code) => (
                <AppButton
                  key={code}
                  size="sm"
                  variant={selectedLocale === code ? 'secondary' : 'ghost'}
                  aria-pressed={selectedLocale === code}
                  onClick={() => void changeLocaleDuringLegal(code)}
                >
                  {code === 'fr' ? t('locale.french') : t('locale.english')}
                </AppButton>
              ))}
            </div>
            <div
              onScroll={onScroll}
              className="custom-scrollbar max-h-[45vh] overflow-y-auto rounded-lg border border-white/[0.08] p-4"
            >
              <LegalDocuments locale={selectedLocale} />
            </div>
            <label className="flex items-start gap-3 text-[13px]">
              <Checkbox
                checked={accepted}
                disabled={!scrolled}
                onCheckedChange={(value) => setAccepted(value === true)}
              />
              <span>{t('onboarding.legalCheckbox')}</span>
            </label>
            {submitError ? (
              <p className="text-[13px] text-destructive" role="alert">
                {submitError}
              </p>
            ) : null}
          </div>
        )}

        <div className="flex justify-between gap-3 pt-2">
          <AppButton
            variant="ghost"
            disabled={step === 1 || submitting}
            onClick={() => setStep((current) => (current > 1 ? ((current - 1) as Step) : current))}
          >
            {t('common.back')}
          </AppButton>
          {step < 3 ? (
            <AppButton
              onClick={() => setStep((current) => (current + 1) as Step)}
              disabled={step === 1 && !selectedLocale}
            >
              {t('common.continue')}
            </AppButton>
          ) : (
            <AppButton
              disabled={!scrolled || !accepted || submitting}
              loading={submitting}
              onClick={() => void finish()}
            >
              {t('onboarding.finish')}
            </AppButton>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
