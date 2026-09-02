import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Smartphone, ShieldCheck } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AppButton, AppSurface, IconButton } from '@/components/app';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { getApiUrl } from '@/lib/api-client';
import { formatCredits, formatCurrency } from '@/i18n/format';
import { useLocalePreference } from '@/i18n/useLocalePreference';

interface FapshiPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: { id?: string; credits: number; priceXAF: number; priceUSD?: number } | null;
}

type ElectronIpcRenderer = {
  invoke: (channel: string, link: string) => Promise<unknown>;
};

function getElectronIpcRenderer(): ElectronIpcRenderer | null {
  if (typeof window === 'undefined') return null;

  try {
    const electronRequire = (window as Window & { require?: (id: string) => unknown }).require;
    if (!electronRequire) return null;
    const electron = electronRequire('electron') as { ipcRenderer?: ElectronIpcRenderer };
    return electron.ipcRenderer ?? null;
  } catch {
    return null;
  }
}

function translateApiError(message: string | undefined, t: (key: string) => string, fallback: string): string {
  if (!message) return fallback;
  const key = `errors.${message}`;
  const translated = t(key);
  return translated === key ? message : translated;
}

export function FapshiPaymentModal({ isOpen, onClose, plan }: FapshiPaymentModalProps) {
  const { t } = useTranslation();
  const { locale } = useLocalePreference();
  const { user } = useAuth();
  const [isRedirecting, setIsRedirecting] = useState(false);

  if (!isOpen || !plan || !user) return null;

  const handlePay = async () => {
    setIsRedirecting(true);

    try {
      if (!plan.id) throw new Error(t('payments.invalidPackage'));
      const ipcRenderer = getElectronIpcRenderer();

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) {
        throw new Error(t('auth.sessionExpired'));
      }

      const response = await fetch(getApiUrl('/payment/fapshi-init'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          packageId: plan.id,
          userId: user.id,
          returnToApp: Boolean(ipcRenderer),
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.link) {
        throw new Error(translateApiError(result.error, t, t('payments.createPaymentFailed')));
      }

      const paymentLink = String(result.link);
      toast.success(t('payments.openingFapshi'));

      if (ipcRenderer) {
        await ipcRenderer.invoke('open-payment-link', paymentLink);
        setIsRedirecting(false);
        onClose();
      } else {
        window.location.assign(paymentLink);
      }
    } catch (error: unknown) {
      console.error('Fapshi payment error:', error);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t('payments.startPaymentFailed'),
      );
      setIsRedirecting(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isRedirecting) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto bg-card"
        showCloseButton={!isRedirecting}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold tracking-tight text-foreground">
            {t('payments.fapshiTitle')}
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            {t('payments.fapshiDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-white/[0.08] bg-panel p-4">
          <div className="mb-2 flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">{t('payments.package')}</span>
            <span className="font-semibold text-foreground">
              {t('payments.selectedCredits', { count: formatCredits(plan.credits, locale) })}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">{t('payments.amount')}</span>
            <span className="text-xl font-semibold text-foreground">
              {plan.priceXAF > 0
                ? formatCurrency(plan.priceXAF, 'XAF', locale)
                : plan.priceUSD
                  ? formatCurrency(plan.priceUSD, 'USD', locale)
                  : '—'}
            </span>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('payments.fapshiAutoCredit')}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <AppButton
            onClick={handlePay}
            disabled={isRedirecting}
            className="w-full"
          >
            {isRedirecting ? (
              <>
                <Loader2 className="mr-2 size-5 animate-spin" />
                {t('common.redirecting')}
              </>
            ) : (
              <>
                <Smartphone className="mr-2 size-5" />
                {t('payments.payWithFapshi')}
              </>
            )}
          </AppButton>
          <AppButton
            variant="ghost"
            size="lg"
            onClick={onClose}
            disabled={isRedirecting}
            className="w-full"
          >
            {t('common.cancel')}
          </AppButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
