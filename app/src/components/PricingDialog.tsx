import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Coins, Loader2, Smartphone, Globe2, Zap } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FapshiPaymentModal } from '@/components/FapshiPaymentModal';
import { ChariowCheckoutModal } from '@/components/ChariowCheckoutModal';
import { CosmicButton } from '@/components/ui/cosmic-button';
import { TextureCard } from '@/components/ui/texture-card';
import { TextureButton } from '@/components/ui/texture-button';
import { PricingDialogContext } from '@/hooks/usePricingDialog';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api-client';
import { formatCurrency, formatCredits, formatDurationFromCredits } from '@/i18n/format';
import { useLocalePreference } from '@/i18n/useLocalePreference';

export interface CreditPackage {
  id: string;
  credits: number;
  priceXAF: number;
  priceUSD: number;
  name?: string;
  fapshiEnabled?: boolean;
  chariowEnabled?: boolean;
  chariowConfigured?: boolean;
}

export function PricingDialogProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { locale } = useLocalePreference();
  const location = useLocation();
  const { user } = useAuth();
  const [pricingOpen, setPricingOpen] = useState(false);
  const [dismissedQueryKey, setDismissedQueryKey] = useState<string | null>(null);
  const [plans, setPlans] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<CreditPackage | null>(null);
  const [fapshiPlan, setFapshiPlan] = useState<CreditPackage | null>(null);
  const [chariowPlan, setChariowPlan] = useState<CreditPackage | null>(null);
  const loadStarted = useRef(false);

  const buyRequested = new URLSearchParams(location.search).get('buy') === '1';
  const dialogOpen = pricingOpen || (buyRequested && dismissedQueryKey !== location.key);

  const openPricing = () => {
    setDismissedQueryKey(null);
    setPricingOpen(true);
  };

  const handlePricingOpenChange = (open: boolean) => {
    setPricingOpen(open);
    if (!open) {
      setSelectedPlan(null);
      if (buyRequested) setDismissedQueryKey(location.key);
    }
  };

  useEffect(() => {
    if (loadStarted.current) return;
    loadStarted.current = true;

    async function loadPlans() {
      try {
        const response = await apiFetch('/wallet?action=catalog');
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || t('payments.loadFailed'));
        setPlans(
          (result.packages ?? []).map((plan: {
            id: string;
            credits: number;
            priceXaf: number;
            priceUsd: number;
            name?: string;
            fapshi?: { enabled?: boolean };
            chariow?: { enabled?: boolean; configured?: boolean };
          }) => ({
            id: plan.id,
            credits: plan.credits,
            priceXAF: Number(plan.priceXaf || 0),
            priceUSD: Number(plan.priceUsd || 0),
            name: plan.name || undefined,
            fapshiEnabled: plan.fapshi?.enabled === true,
            chariowEnabled: plan.chariow?.enabled === true,
            chariowConfigured: plan.chariow?.configured === true,
          })),
        );
      } catch (error) {
        console.error('Failed to load credit packages:', error);
        toast.error(t('payments.loadFailed'));
      } finally {
        setLoading(false);
      }
    }

    void loadPlans();
  }, [t]);

  const popularIndex = plans.length > 1 ? Math.floor(plans.length / 2) : -1;

  return (
    <PricingDialogContext.Provider value={{ openPricing }}>
      {children}

      <Dialog open={dialogOpen} onOpenChange={handlePricingOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] !max-w-[1120px] gap-0 overflow-hidden border-blue-500/15 bg-background/95 p-0 shadow-none backdrop-blur-xl sm:!max-w-[1120px]">
          <div className="custom-scrollbar overflow-y-auto px-4 py-8 sm:px-7 lg:px-10 lg:py-10">
            <DialogHeader className="mx-auto mb-8 max-w-3xl items-center text-center sm:text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{t('payments.creditsHeading')}</p>
              <DialogTitle className="bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-3xl font-semibold tracking-tight text-transparent sm:text-4xl">
                {t('payments.payPerUse')}
              </DialogTitle>
              <DialogDescription className="max-w-xl leading-relaxed">
                {t('payments.packsIntro')}
              </DialogDescription>
            </DialogHeader>

            {loading ? (
              <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" />
                {t('payments.loadingPackages')}
              </div>
            ) : plans.length === 0 ? (
              <div className="rounded-2xl border border-blue-500/15 bg-panel/70 px-6 py-14 text-center text-sm text-muted-foreground">
                {t('payments.noPackages')}
              </div>
            ) : selectedPlan ? (
              <div className="mx-auto max-w-xl space-y-5">
                <div className="rounded-2xl border border-border/70 bg-panel/60 p-5">
                  <p className="text-sm font-semibold uppercase tracking-[0.08em] text-primary">{selectedPlan.name}</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">
                    {t('payments.selectedCredits', { count: formatCredits(selectedPlan.credits, locale) })}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('payments.selectedPrices', {
                      xaf: formatCurrency(selectedPlan.priceXAF, 'XAF', locale),
                      usd: formatCurrency(selectedPlan.priceUSD, 'USD', locale),
                    })}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextureButton
                    variant="secondary"
                    size="lg"
                    className="h-auto min-h-24 flex-col items-start gap-2 p-4 text-left"
                    disabled={selectedPlan.fapshiEnabled === false}
                    onClick={() => {
                      handlePricingOpenChange(false);
                      setFapshiPlan(selectedPlan);
                    }}
                  >
                    <span className="flex items-center gap-2 font-semibold text-foreground">
                      <Smartphone className="size-4 text-primary" /> {t('payments.cameroonMobile')}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t('payments.fapshiPrice', { price: formatCurrency(selectedPlan.priceXAF, 'XAF', locale) })}
                    </span>
                  </TextureButton>
                  <TextureButton
                    variant="secondary"
                    size="lg"
                    className="h-auto min-h-24 flex-col items-start gap-2 p-4 text-left"
                    disabled={!selectedPlan.chariowEnabled}
                    data-testid="chariow-pay-button"
                    onClick={() => {
                      if (!user?.id) return toast.error(t('payments.signInFirst'));
                      handlePricingOpenChange(false);
                      setChariowPlan(selectedPlan);
                    }}
                  >
                    <span className="flex items-center gap-2 font-semibold text-foreground">
                      <Globe2 className="size-4 text-primary" /> {t('payments.internationalCard')}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t('payments.chariowPrice', { price: formatCurrency(selectedPlan.priceUSD, 'USD', locale) })}
                    </span>
                  </TextureButton>
                </div>
                {!selectedPlan.chariowEnabled && (
                  <p className="text-center text-xs text-muted-foreground" data-testid="chariow-disabled-message">
                    {t('payments.chariowDisabled')}
                  </p>
                )}
                <TextureButton variant="minimal" className="w-full" onClick={() => setSelectedPlan(null)}>
                  {t('payments.backToPacks')}
                </TextureButton>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {plans.map((plan, index) => {
                  const popular = index === popularIndex;
                  return (
                    <TextureCard
                      key={plan.id}
                      className={`pricing-card relative min-h-[360px] overflow-hidden ${popular ? 'ring-1 ring-primary/60' : ''}`}
                    >
                      {popular && <div className="pricing-card-glow" aria-hidden />}
                      <div className="relative flex flex-1 flex-col gap-7 p-6 sm:p-7">
                        <div className="flex min-h-8 items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <Coins className="size-5 shrink-0 text-primary" strokeWidth={1.75} />
                            <span className="truncate text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
                              {plan.name || t('payments.selectedCredits', { count: formatCredits(plan.credits, locale) })}
                            </span>
                          </div>
                          {popular && (
                            <span className="flex shrink-0 items-center gap-1 rounded-lg border border-primary/25 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                              <Zap className="size-3.5" />
                              {t('payments.popular')}
                            </span>
                          )}
                        </div>

                        <div>
                          <p className="text-3xl font-semibold tracking-[-0.04em] text-foreground xl:text-4xl">
                            {formatCurrency(plan.priceXAF, 'XAF', locale)}
                          </p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {t('payments.usdInternational', { price: formatCurrency(plan.priceUSD, 'USD', locale) })}
                          </p>
                        </div>

                        <ul className="flex flex-1 flex-col gap-3 text-sm text-muted-foreground">
                          <li className="flex gap-2.5">
                            <Check className="mt-0.5 size-[18px] shrink-0 text-primary" />
                            <span>{t('payments.henshinCredits', { count: formatCredits(plan.credits, locale) })}</span>
                          </li>
                          <li className="flex gap-2.5">
                            <Check className="mt-0.5 size-[18px] shrink-0 text-primary" />
                            <span>{t('payments.aboutFast', { duration: formatDurationFromCredits(plan.credits, 2, locale) })}</span>
                          </li>
                          <li className="flex gap-2.5">
                            <Check className="mt-0.5 size-[18px] shrink-0 text-primary" />
                            <span>{t('payments.aboutPro', { duration: formatDurationFromCredits(plan.credits, 80, locale) })}</span>
                          </li>
                          <li className="flex gap-2.5">
                            <Check className="mt-0.5 size-[18px] shrink-0 text-primary" />
                            <span>{t('payments.neverExpire')}</span>
                          </li>
                        </ul>

                        {popular ? (
                          <CosmicButton as="button" onClick={() => setSelectedPlan(plan)} className="w-full" contentClassName="min-h-12">
                            {t('payments.choosePack')}
                          </CosmicButton>
                        ) : (
                          <TextureButton variant="secondary" size="lg" onClick={() => setSelectedPlan(plan)} className="w-full">
                            {t('payments.choosePack')}
                          </TextureButton>
                        )}
                      </div>
                    </TextureCard>
                  );
                })}
              </div>
            )}

            <p className="mt-7 text-center text-xs text-muted-foreground">
              {t('payments.fastRateNote')}
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <FapshiPaymentModal
        isOpen={fapshiPlan !== null}
        onClose={() => setFapshiPlan(null)}
        plan={fapshiPlan}
      />
      <ChariowCheckoutModal
        isOpen={chariowPlan !== null}
        onClose={() => setChariowPlan(null)}
        plan={chariowPlan ? {
          id: chariowPlan.id,
          name: chariowPlan.name,
          credits: chariowPlan.credits,
          priceUsd: chariowPlan.priceUSD,
        } : null}
      />
    </PricingDialogContext.Provider>
  );
}
