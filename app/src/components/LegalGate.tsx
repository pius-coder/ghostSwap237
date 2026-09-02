import { useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react';
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
import type { AppLocale } from '@/i18n/locale';

/**
 * Shown only when onboarding is already current but legal versions changed.
 * Never shown together with OnboardingGate.
 */
export function LegalGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { locale } = useLocalePreference();
  const [requiredForUser, setRequiredForUser] = useState<{ userId: string; required: boolean } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [ack, setAck] = useState<{ locale: AppLocale; scrolled: boolean; accepted: boolean }>(() => ({
    locale,
    scrolled: false,
    accepted: false,
  }));
  const checkedUser = useRef<string | null>(null);

  if (ack.locale !== locale) {
    setAck({ locale, scrolled: false, accepted: false });
  }

  useEffect(() => {
    if (!user?.id) return;
    if (checkedUser.current === user.id) return;
    checkedUser.current = user.id;
    const userId = user.id;
    void supabase.rpc('get_own_onboarding_status').then(({ data }) => {
      setRequiredForUser({ userId, required: Boolean(data?.legalGateRequired) });
    });
  }, [user?.id]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 12) {
      setAck((prev) => ({ ...prev, scrolled: true }));
    }
  };

  const confirm = async () => {
    setLoading(true);
    const { error } = await supabase.rpc('accept_current_legal_documents', {
      p_app_version: import.meta.env.VITE_APP_VERSION || 'desktop',
      p_locale: locale,
      p_user_agent: navigator.userAgent,
    });
    setLoading(false);
    if (!error && user?.id) setRequiredForUser({ userId: user.id, required: false });
  };

  const required = Boolean(user?.id && requiredForUser?.userId === user.id && requiredForUser.required);

  return (
    <>
      {children}
      <Dialog open={required}>
        <DialogContent
          className="max-h-[92vh] sm:max-w-2xl"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t('legal.gateTitle')}</DialogTitle>
            <DialogDescription>{t('legal.gateDescription')}</DialogDescription>
          </DialogHeader>
          <div
            onScroll={onScroll}
            className="custom-scrollbar max-h-[55vh] overflow-y-auto rounded-lg border border-white/[0.08] p-4"
          >
            <LegalDocuments locale={locale} />
          </div>
          <label className="flex items-start gap-3 text-[13px]">
            <Checkbox
              checked={ack.accepted}
              disabled={!ack.scrolled}
              onCheckedChange={(value) => setAck((prev) => ({ ...prev, accepted: value === true }))}
            />
            <span>{t('legal.checkbox')}</span>
          </label>
          <AppButton
            disabled={!ack.scrolled || !ack.accepted || loading}
            loading={loading}
            onClick={() => void confirm()}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('legal.continue')}
          </AppButton>
        </DialogContent>
      </Dialog>
    </>
  );
}
