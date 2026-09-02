import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, ArrowRight, Coins, ShieldCheck, Clock } from 'lucide-react';
import { toast } from 'sonner';

import { AnimatedNumber } from '@/components/ui/animated-number';
import { AppButton, AppSurface, IconButton } from '@/components/app';
import { useApp } from '@/context/AppContext';
import { apiFetch } from '@/lib/api-client';
import { supabase } from '@/lib/supabase';
import { formatCredits, formatCurrency, formatNumber } from '@/i18n/format';
import { useLocalePreference } from '@/i18n/useLocalePreference';

type VerifyState =
  | 'verifying'
  | 'pending'
  | 'success'
  | 'fulfilment_failed'
  | 'failed'
  | 'expired';

const MAX_STATUS_CHECKS = 6;
const STATUS_POLL_INTERVAL_MS = 4_000;

interface StatusResponse {
  providerStatus?: string;
  paymentStatus?: string;
  fulfilmentStatus?: string;
  credits?: number;
  amount?: number;
  currency?: string;
  failureReason?: string;
  error?: string;
}

function PaymentSuccess() {
  const { t } = useTranslation();
  const { locale } = useLocalePreference();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshCredits } = useApp();

  const [state, setState] = useState<VerifyState>('verifying');
  const [message, setMessage] = useState(() => t('payments.checkingPayment'));
  const [paidAmount, setPaidAmount] = useState<number | null>(null);
  const [paidCurrency, setPaidCurrency] = useState<string>('XAF');
  const [paidCredits, setPaidCredits] = useState<number | null>(null);
  const [checkRequest, setCheckRequest] = useState(0);

  const externalSearchParams = new URLSearchParams(window.location.search);
  const paymentId = searchParams.get('ref') || externalSearchParams.get('ref');
  const transactionId = searchParams.get('transId') || externalSearchParams.get('transId');
  const paymentProvider = searchParams.get('provider') || externalSearchParams.get('provider') || 'fapshi';

  useEffect(() => {
    const controller = new AbortController();

    const checkPayment = async () => {
      try {
        setState('verifying');
        setMessage(t('payments.verifying'));

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (sessionError || !session?.access_token) {
          throw new Error(t('auth.sessionExpired'));
        }

        const reference = paymentId || transactionId;
        if (!reference) {
          setState('failed');
          setMessage(t('payments.missingTransaction'));
          return;
        }

        const queryKey = paymentId ? 'ref' : 'transId';

        for (let attempt = 0; attempt < MAX_STATUS_CHECKS; attempt += 1) {
          const statusPath = paymentProvider === 'chariow'
            ? `/wallet?action=payment-status&provider=chariow&ref=${encodeURIComponent(reference)}`
            : `/payment/fapshi-status?${queryKey}=${encodeURIComponent(reference)}`;
          const res = await apiFetch(statusPath, {
            method: 'GET',
            headers: { Authorization: `Bearer ${session.access_token}` },
            signal: controller.signal,
            retries: 1,
            timeoutMs: 30_000,
          });

          const data: StatusResponse = await res.json();
          if (!res.ok) {
            if (res.status === 404) {
              setState('failed');
              setMessage(data.error || t('payments.paymentNotFound'));
              return;
            }
            throw new Error(data.error || t('payments.unableToCheck'));
          }

          setPaidAmount(Number.isFinite(data.amount) ? Number(data.amount) : null);
          setPaidCurrency(String(data.currency || 'XAF'));
          setPaidCredits(Number.isFinite(data.credits as number) ? Number(data.credits) : null);

          if (data.paymentStatus === 'expired' || data.providerStatus === 'EXPIRED') {
            setState('expired');
            setMessage(t('payments.linkExpired'));
            return;
          }

          if (
            data.paymentStatus === 'failed' ||
            data.providerStatus === 'FAILED' ||
            data.providerStatus === 'CANCELLED'
          ) {
            setState('failed');
            setMessage(t('payments.paymentFailedDetail'));
            toast.error(t('payments.failed'));
            return;
          }

          if (data.fulfilmentStatus === 'fulfilled') {
            try {
              await refreshCredits();
            } catch (syncError) {
              console.warn('Failed to refresh credits:', syncError);
            }
            setState('success');
            setMessage(t('payments.creditsDelivered', {
              count: formatCredits(data.credits ?? 0, locale),
            }));
            toast.success(t('payments.paymentConfirmedToast'));
            return;
          }

          if (
            (data.paymentStatus === 'paid' ||
              data.providerStatus === 'SUCCESSFUL' ||
              data.providerStatus === 'COMPLETED') &&
            data.fulfilmentStatus === 'failed'
          ) {
            setState('fulfilment_failed');
            setMessage(data.failureReason || t('payments.fulfilmentFailedDetail'));
            return;
          }

          if (
            data.paymentStatus === 'paid' ||
            data.providerStatus === 'SUCCESSFUL' ||
            data.providerStatus === 'COMPLETED'
          ) {
            setState('fulfilment_failed');
            setMessage(t('payments.fulfilmentPending'));
            if (attempt < MAX_STATUS_CHECKS - 1) {
              await new Promise<void>((resolve) => {
                const timer = window.setTimeout(resolve, STATUS_POLL_INTERVAL_MS);
                controller.signal.addEventListener('abort', () => {
                  window.clearTimeout(timer);
                  resolve();
                }, { once: true });
              });
              if (controller.signal.aborted) return;
              continue;
            }
            return;
          }

          if (attempt < MAX_STATUS_CHECKS - 1) {
            setState('pending');
            setMessage(t('payments.stillPending'));
            await new Promise<void>((resolve) => {
              const timer = window.setTimeout(resolve, STATUS_POLL_INTERVAL_MS);
              controller.signal.addEventListener('abort', () => {
                window.clearTimeout(timer);
                resolve();
              }, { once: true });
            });
            if (controller.signal.aborted) return;
          }
        }

        setState('pending');
        setMessage(t('payments.stillPendingManual'));
      } catch (error) {
        if (controller.signal.aborted) return;
        setState('failed');
        console.error('Payment status check error:', error);
        setMessage(
          error instanceof Error && error.message
            ? error.message
            : t('payments.checkFailedSupport'),
        );
      }
    };

    void checkPayment();
    return () => controller.abort();
  }, [checkRequest, locale, paymentId, paymentProvider, refreshCredits, t, transactionId]);

  const title =
    state === 'verifying' ? t('payments.verifying')
      : state === 'pending' ? t('payments.pending')
        : state === 'success' ? t('payments.success')
          : state === 'fulfilment_failed' ? t('payments.fulfilmentFailed')
            : state === 'expired' ? t('payments.expired')
              : t('payments.failed');

  const amountLabel = paidAmount != null
    ? (paidCurrency === 'XAF' || paidCurrency === 'USD'
        ? formatCurrency(paidAmount, paidCurrency, locale)
        : `${formatNumber(paidAmount, locale)} ${paidCurrency}`)
    : null;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <AppSurface elevated>
          <div className="mb-6">
            {(state === 'verifying' || state === 'pending') && (
              <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-white/[0.06]">
                {state === 'pending' ? <Clock className="size-8 text-warning" /> : <Loader2 className="size-8 animate-spin text-foreground" />}
              </div>
            )}
            {state === 'success' && (
              <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-success/10">
                <CheckCircle className="size-8 text-success" />
              </div>
            )}
            {state === 'fulfilment_failed' && (
              <div className="w-20 h-20 mx-auto rounded-full bg-amber-500/10 flex items-center justify-center">
                <ShieldCheck className="w-10 h-10 text-amber-400" />
              </div>
            )}
            {(state === 'failed' || state === 'expired') && (
              <div className="w-20 h-20 mx-auto rounded-full bg-red-500/10 flex items-center justify-center">
                <XCircle className="w-10 h-10 text-red-500" />
              </div>
            )}
          </div>

          <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">{title}</h1>
          <p className="mb-8 text-sm text-muted-foreground">{message}</p>

          {(state === 'success' || state === 'fulfilment_failed') && (paidAmount || paidCredits) && (
            <div className="mb-6 rounded-lg border border-white/[0.08] bg-white/[0.03] p-4">
              {paidCredits && (
                <>
                  <p className="mb-1 text-xs text-muted-foreground">
                    {state === 'success' ? t('payments.creditsAdded') : t('payments.creditsExpected')}
                  </p>
                  <p className="text-3xl font-semibold tracking-tight text-foreground">
                    <AnimatedNumber value={paidCredits} format={(n) => formatCredits(n, locale)} />{' '}
                    {t('payments.creditsUnit')}
                  </p>
                </>
              )}
              {amountLabel && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('payments.amountPaid', { amount: amountLabel })}
                </p>
              )}
            </div>
          )}

          <div className="space-y-3">
            {(state === 'pending' || state === 'failed' || state === 'fulfilment_failed' || state === 'expired') &&
              (paymentId || transactionId) && (
                <AppButton
                  variant="secondary"
                  size="lg"
                  onClick={() => setCheckRequest((request) => request + 1)}
                  className="w-full"
                >
                  {t('payments.checkAgain')}
                </AppButton>
              )}

            {(state === 'success' || state === 'fulfilment_failed' || state === 'pending') && (
              <>
                <AppButton onClick={() => navigate('/credits')} className="w-full">
                  <Coins className="w-4 h-4 mr-2" />
                  {t('payments.goCredits')}
                </AppButton>
                <AppButton variant="ghost" onClick={() => navigate('/dashboard')} className="w-full">
                  {t('payments.backDashboard')}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </AppButton>
              </>
            )}

            {(state === 'failed' || state === 'expired') && (
              <>
                <AppButton onClick={() => navigate('/credits')} className="w-full">
                  {t('payments.tryAgain')}
                </AppButton>
                <AppButton variant="ghost" onClick={() => navigate('/dashboard')} className="w-full">
                  {t('payments.backDashboard')}
                </AppButton>
              </>
            )}
          </div>
        </AppSurface>

        <p className="mt-6 text-center text-xs text-muted-foreground/60">
          {t('payments.footerNote')}
        </p>
      </div>
    </div>
  );
}

export default PaymentSuccess;
