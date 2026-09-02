import { useTranslation } from 'react-i18next';
import { ArrowDownLeft, ArrowUpRight, Plus } from 'lucide-react';
import { AnimatedNumber } from '@/components/ui/animated-number';
import {
  AppButton,
  AppSurface,
  EmptyState,
  Metric,
  SectionHeader,
} from '@/components/app';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { usePricingDialog } from '@/hooks/usePricingDialog';
import { useProAccess } from '@/hooks/useProAccess';
import { formatCredits, formatDateTime, formatDuration } from '@/i18n/format';
import { useLocalePreference } from '@/i18n/useLocalePreference';

const CREDITS_PER_SECOND = 2;

function originLabel(
  description: string | undefined,
  type: string,
  t: (key: string, opts?: Record<string, string>) => string,
): string {
  const raw = (description || '').toLowerCase();
  if (raw.includes('legacy') || raw.includes('opening_balance') || raw.includes('opening balance')) {
    return t('wallet.legacyBalance');
  }
  if (raw.includes('manual') || raw.includes('admin')) {
    return t('wallet.manualCredit');
  }
  if (type === 'debit' || raw.includes('stream') || raw.includes('usage') || raw.includes('session')) {
    return t('wallet.streamUsage');
  }
  return description || t('wallet.creditsPurchased');
}

function Wallet({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const { locale } = useLocalePreference();
  const { credits, transactions } = useApp();
  const { user } = useAuth();
  const { openPricing } = usePricingDialog();
  const { access: proAccess } = useProAccess(user?.id);

  const remainingSeconds = Math.floor(credits / CREDITS_PER_SECOND);
  const proRemainingSeconds =
    proAccess.active && proAccess.creditsPerSecond
      ? Math.floor(credits / proAccess.creditsPerSecond)
      : null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      {!embedded ? (
        <SectionHeader
          title={t('wallet.title')}
          description={t('wallet.subtitle')}
          actions={
            <AppButton id="fund-wallet-btn" onClick={openPricing}>
              <Plus className="size-4" />
              {t('wallet.buy')}
            </AppButton>
          }
        />
      ) : (
        <div className="flex justify-end">
          <AppButton id="fund-wallet-btn" onClick={openPricing}>
            <Plus className="size-4" />
            {t('wallet.buy')}
          </AppButton>
        </div>
      )}

      <AppSurface elevated className="grid gap-6 sm:grid-cols-3">
        <Metric
          label={t('wallet.available')}
          value={
            <AnimatedNumber value={Math.round(credits)} format={(n) => formatCredits(n, locale)} />
          }
        />
        <Metric
          label={t('studio.fast')}
          value={formatDuration(remainingSeconds, locale)}
          hint={t('wallet.fastAtRate', { duration: formatDuration(remainingSeconds, locale) })}
        />
        <Metric
          label={t('studio.pro')}
          value={
            proRemainingSeconds !== null
              ? formatDuration(proRemainingSeconds, locale)
              : t('settings.proInactive')
          }
          hint={
            proRemainingSeconds !== null
              ? t('wallet.proAtRate', {
                  rate: proAccess.creditsPerSecond,
                  duration: formatDuration(proRemainingSeconds, locale),
                })
              : undefined
          }
        />
      </AppSurface>

      <section>
        <SectionHeader title={t('wallet.transactionHistory')} />
        {transactions.length === 0 ? (
          <EmptyState title={t('wallet.emptyFound')} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-white/[0.08]">
            <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
              <thead className="bg-surface-elevated text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">{t('historyPage.date')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('wallet.origin')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('common.credits')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('historyPage.status')}</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const isLegacy =
                    (tx.description || '').toLowerCase().includes('legacy') ||
                    (tx.description || '').toLowerCase().includes('opening');
                  return (
                    <tr key={tx.id} className="border-t border-white/[0.06]">
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {formatDateTime(tx.timestamp, locale)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          {tx.type === 'credit' ? (
                            <ArrowDownLeft className="size-4 text-primary" />
                          ) : (
                            <ArrowUpRight className="size-4 text-destructive" />
                          )}
                          <span>
                            {originLabel(tx.description, tx.type, t)}
                            {isLegacy ? (
                              <span className="ml-2 text-xs text-muted-foreground">
                                ({t('wallet.legacyBalance')})
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </td>
                      <td
                        className={
                          tx.type === 'credit'
                            ? 'px-3 py-2.5 font-medium tabular-nums text-primary'
                            : 'px-3 py-2.5 font-medium tabular-nums text-destructive'
                        }
                      >
                        {typeof tx.credits === 'number' && Number.isFinite(tx.credits)
                          ? t('wallet.creditsDelta', {
                              sign: tx.type === 'debit' ? '-' : '+',
                              count: formatCredits(tx.credits, locale),
                            })
                          : t('wallet.creditsUnavailable')}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{t('common.completed')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default Wallet;
