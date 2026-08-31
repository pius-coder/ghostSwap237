import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, ArrowRight, Coins, ShieldCheck, Clock } from 'lucide-react';
import { toast } from 'sonner';

import { AnimatedNumber } from '@/components/ui/animated-number';
import { CosmicButton } from '@/components/ui/cosmic-button';
import { TextureCard } from '@/components/ui/texture-card';
import { TextureButton } from '@/components/ui/texture-button';
import { useApp } from '@/context/AppContext';
import { apiFetch } from '@/lib/api-client';
import { supabase } from '@/lib/supabase';

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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshCredits } = useApp();

  const [state, setState] = useState<VerifyState>('verifying');
  const [message, setMessage] = useState('Checking your payment...');
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
        setMessage('Verification in progress…');

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (sessionError || !session?.access_token) {
          throw new Error('Your session has expired. Please sign in again.');
        }

        const reference = paymentId || transactionId;
        if (!reference) {
          setState('failed');
          setMessage('Missing transaction information. Please contact support.');
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
              setMessage(data.error || 'This payment could not be found. Please contact support.');
              return;
            }
            throw new Error(data.error || 'Unable to check the payment.');
          }

          setPaidAmount(Number.isFinite(data.amount) ? Number(data.amount) : null);
          setPaidCurrency(String(data.currency || 'XAF'));
          setPaidCredits(Number.isFinite(data.credits as number) ? Number(data.credits) : null);

          if (data.paymentStatus === 'expired' || data.providerStatus === 'EXPIRED') {
            setState('expired');
            setMessage('The payment link expired before the payment was completed.');
            return;
          }

          if (
            data.paymentStatus === 'failed' ||
            data.providerStatus === 'FAILED' ||
            data.providerStatus === 'CANCELLED'
          ) {
            setState('failed');
            setMessage('The payment failed or was declined. No credits were added.');
            toast.error('Payment failed');
            return;
          }

          if (data.fulfilmentStatus === 'fulfilled') {
            try {
              await refreshCredits();
            } catch (syncError) {
              console.warn('Failed to refresh credits:', syncError);
            }
            setState('success');
            setMessage(`${(data.credits ?? 0).toLocaleString()} credits have been added to your account.`);
            toast.success('Payment confirmed! Credits added.');
            return;
          }

          if (
            (data.paymentStatus === 'paid' ||
              data.providerStatus === 'SUCCESSFUL' ||
              data.providerStatus === 'COMPLETED') &&
            data.fulfilmentStatus === 'failed'
          ) {
            setState('fulfilment_failed');
            setMessage(
              data.failureReason ||
                'Payment was confirmed but credit delivery failed. Support has been alerted.',
            );
            return;
          }

          if (
            data.paymentStatus === 'paid' ||
            data.providerStatus === 'SUCCESSFUL' ||
            data.providerStatus === 'COMPLETED'
          ) {
            setState('fulfilment_failed');
            setMessage(
              'Payment confirmed. Automatic credit delivery is still pending; we will keep retrying.',
            );
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
            setMessage('Payment is still pending. We will check again shortly.');
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
        setMessage('Payment is still pending. You can check again without starting a new payment.');
      } catch (error) {
        if (controller.signal.aborted) return;
        setState('failed');
        console.error('Payment status check error:', error);
        setMessage(
          error instanceof Error && error.message
            ? error.message
            : 'Unable to check the payment. Please contact support if you were charged.',
        );
      }
    };

    void checkPayment();
    return () => controller.abort();
  }, [checkRequest, paymentId, paymentProvider, refreshCredits, transactionId]);

  const title =
    state === 'verifying' ? 'Verification in progress'
      : state === 'pending' ? 'Payment pending'
        : state === 'success' ? 'Payment confirmed and credits delivered'
          : state === 'fulfilment_failed' ? 'Payment confirmed — delivery issue'
            : state === 'expired' ? 'Payment expired'
              : 'Payment failed';

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <TextureCard contentClassName="p-8 text-center">
          <div className="mb-6">
            {(state === 'verifying' || state === 'pending') && (
              <div className="w-20 h-20 mx-auto rounded-full bg-blue-500/10 flex items-center justify-center">
                {state === 'pending' ? <Clock className="w-10 h-10 text-blue-400" /> : <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />}
              </div>
            )}
            {state === 'success' && (
              <div className="w-20 h-20 mx-auto rounded-full bg-blue-500/10 flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-blue-400" />
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
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 mb-6">
              {paidCredits && (
                <>
                  <p className="text-xs text-blue-300/70 mb-1">
                    {state === 'success' ? 'Credits added' : 'Credits expected'}
                  </p>
                  <p className="text-3xl font-bold text-blue-300">
                    <AnimatedNumber value={paidCredits} /> credits
                  </p>
                </>
              )}
              {paidAmount != null && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Amount: {paidAmount.toLocaleString()} {paidCurrency === 'XAF' ? 'FCFA' : paidCurrency}
                </p>
              )}
            </div>
          )}

          <div className="space-y-3">
            {(state === 'pending' || state === 'failed' || state === 'fulfilment_failed' || state === 'expired') &&
              (paymentId || transactionId) && (
                <TextureButton
                  variant="secondary"
                  size="lg"
                  onClick={() => setCheckRequest((request) => request + 1)}
                  className="w-full"
                >
                  Check again
                </TextureButton>
              )}

            {(state === 'success' || state === 'fulfilment_failed' || state === 'pending') && (
              <>
                <CosmicButton as="button" onClick={() => navigate('/credits')} className="w-full" contentClassName="min-h-12">
                  <Coins className="w-4 h-4 mr-2" />
                  Go to Credits
                </CosmicButton>
                <TextureButton variant="minimal" onClick={() => navigate('/dashboard')} className="w-full">
                  Back to Dashboard
                  <ArrowRight className="w-4 h-4 ml-2" />
                </TextureButton>
              </>
            )}

            {(state === 'failed' || state === 'expired') && (
              <>
                <CosmicButton as="button" onClick={() => navigate('/credits')} className="w-full" contentClassName="min-h-12">
                  Try Again
                </CosmicButton>
                <TextureButton variant="minimal" onClick={() => navigate('/dashboard')} className="w-full">
                  Back to Dashboard
                </TextureButton>
              </>
            )}
          </div>
        </TextureCard>

        <p className="mt-6 text-center text-xs text-muted-foreground/60">
          This page never credits your wallet directly. Credits are delivered only after server-side payment verification.
        </p>
      </div>
    </div>
  );
}

export default PaymentSuccess;
