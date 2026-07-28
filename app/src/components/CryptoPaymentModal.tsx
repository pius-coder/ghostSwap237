import { useEffect, useState } from 'react';
import { Loader2, X, Copy, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { getApiUrl } from '@/lib/api-client';

interface CryptoPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: { id?: string; credits: number; priceNGN: number; priceUSD?: number } | null;
}

interface PaymentMethod {
  id: string;
  name: string;
  crypto_currency: string;
  network: string;
  wallet_address: string;
  qr_code_url?: string | null;
  instructions?: string | null;
}

export function CryptoPaymentModal({ isOpen, onClose, plan }: CryptoPaymentModalProps) {
  const { user } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [step, setStep] = useState<'initial' | 'processing' | 'success'>('initial');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<string | null>(null);
  const [isLoadingMethod, setIsLoadingMethod] = useState(false);
  const paymentMethod =
    paymentMethods.find((method) => method.id === selectedPaymentMethodId) || null;

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setIsLoadingMethod(true);
    setPaymentMethods([]);
    setSelectedPaymentMethodId(null);
    setCopied(false);
    supabase
      .from('payment_methods')
      .select('id, name, crypto_currency, network, wallet_address, qr_code_url, instructions')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('Failed to load payment methods:', error);
          toast.error('Payment details are currently unavailable.');
          setPaymentMethods([]);
          setSelectedPaymentMethodId(null);
        } else {
          const methods = (data || []) as PaymentMethod[];
          setPaymentMethods(methods);
          setSelectedPaymentMethodId(methods[0]?.id || null);
        }
        setIsLoadingMethod(false);
      });

    return () => { cancelled = true; };
  }, [isOpen]);

  if (!isOpen || !plan || !user) return null;

  const handleCopy = () => {
    if (!paymentMethod) return;
    navigator.clipboard.writeText(paymentMethod.wallet_address);
    setCopied(true);
    toast.success('Wallet address copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePaid = async () => {
    setIsProcessing(true);
    setStep('processing');

    try {
      if (!plan.id) throw new Error('Invalid credit package');
      if (!paymentMethod) throw new Error('Select a payment method');

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) {
        throw new Error('Your session has expired. Please sign in again.');
      }

      const response = await fetch(getApiUrl('/payment/crypto-submit'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          packageId: plan.id,
          paymentMethodId: paymentMethod.id,
          userId: user.id,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || 'Failed to submit payment request');
      }

      setStep('success');
      toast.success('Payment request submitted. Admin will confirm shortly.');
      
      setTimeout(() => {
        onClose();
        setStep('initial');
        setIsProcessing(false);
      }, 3000);
    } catch (error: any) {
      console.error('Payment request error:', error);
      toast.error(error.message || 'Failed to submit payment request');
      setIsProcessing(false);
      setStep('initial');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#131316] border border-[#27272a] rounded-2xl p-6 w-full max-w-md shadow-2xl relative">
        <button
          onClick={() => {
            if (!isProcessing) onClose();
          }}
          disabled={isProcessing}
          aria-label="Close"
          className="absolute top-4 right-4 text-[#71717a] hover:text-white disabled:opacity-50 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-2xl font-bold text-white mb-2">Crypto Payment</h2>
        <p className="text-[#a1a1aa] text-sm mb-6">
          {paymentMethod
            ? `Send ${paymentMethod.crypto_currency} on ${paymentMethod.network} to the address below.`
            : isLoadingMethod
              ? 'Loading payment details...'
              : 'No active payment methods are available.'}
        </p>

        <div className="bg-[#1a1a1f] border border-[#27272a] rounded-xl p-4 mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[#a1a1aa] text-sm">Package</span>
            <span className="text-white font-semibold">{plan.credits.toLocaleString()} Credits</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[#a1a1aa] text-sm">Amount to Send</span>
            <span className="text-xl font-bold text-emerald-400">
              {plan.priceUSD ? `$${plan.priceUSD.toLocaleString()}` : `₦${plan.priceNGN.toLocaleString()}`}
            </span>
          </div>
        </div>

        {step === 'success' ? (
          <div className="flex flex-col items-center justify-center py-8 text-emerald-500 text-center">
            <CheckCircle2 className="w-16 h-16 mb-4 animate-in zoom-in" />
            <h3 className="text-xl font-bold text-white mb-2">Request Submitted</h3>
            <p className="text-[#a1a1aa] text-sm">Your payment is being verified by an admin. Credits will be added shortly.</p>
          </div>
        ) : (
          <>
            {paymentMethods.length > 0 && (
              <div className="mb-4">
                <div className="text-xs text-[#a1a1aa] font-medium uppercase tracking-wider mb-2">
                  Choose payment method
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {paymentMethods.map((method) => {
                    const isSelected = method.id === selectedPaymentMethodId;
                    return (
                      <button
                        key={method.id}
                        type="button"
                        onClick={() => {
                          setSelectedPaymentMethodId(method.id);
                          setCopied(false);
                        }}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-500/10'
                            : 'border-[#3f3f46] bg-[#1a1a1f] hover:border-[#52525b]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-white">{method.name}</span>
                          {isSelected && (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          )}
                        </div>
                        <div className="text-xs text-[#a1a1aa] mt-1">
                          {method.crypto_currency} · {method.network}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {paymentMethod && (
              <div className="bg-white p-4 rounded-xl mb-4 flex items-center justify-center">
                <img
                  src={paymentMethod.qr_code_url || `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(paymentMethod.wallet_address)}`}
                  alt={`${paymentMethod.name} QR Code`}
                  className="w-48 h-48 object-contain"
                />
              </div>
            )}

            <div className="bg-[#1a1a1f] border border-[#27272a] rounded-xl p-4 mb-6 flex flex-col gap-2">
              <div className="text-xs text-[#a1a1aa] font-medium uppercase tracking-wider">
                {paymentMethod ? `${paymentMethod.crypto_currency} (${paymentMethod.network}) Address` : 'Payment address'}
              </div>
              <div className="flex items-center gap-2">
                <code className="text-sm text-white font-mono flex-1 break-all bg-black/50 p-2 rounded-lg border border-[#3f3f46]">
                  {isLoadingMethod ? 'Loading...' : paymentMethod?.wallet_address || 'No active payment method configured'}
                </code>
                <Button variant="outline" size="icon" onClick={handleCopy} className="shrink-0 h-10 w-10 bg-[#27272a] border-[#3f3f46] hover:bg-[#3f3f46]">
                  {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-white" />}
                </Button>
              </div>
            </div>

            {paymentMethod?.instructions && (
              <p className="text-xs text-[#a1a1aa] mb-4">{paymentMethod.instructions}</p>
            )}

            <div className="flex flex-col gap-3">
              <Button
                onClick={handlePaid}
                disabled={isProcessing || isLoadingMethod || !paymentMethod}
                className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg transition-all"
              >
                {step === 'processing' ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Submitting...
                  </>
                ) : (
                  'I Have Paid'
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={onClose}
                disabled={isProcessing}
                className="w-full h-12 text-[#a1a1aa] hover:text-white hover:bg-[#27272a] rounded-xl"
              >
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
