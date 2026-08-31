import { useTranslation } from 'react-i18next';
import { ArrowDownLeft, ArrowUpRight, Plus, LogOut } from 'lucide-react';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CosmicButton } from '@/components/ui/cosmic-button';
import { Separator } from '@/components/ui/separator';
import { TextureButton } from '@/components/ui/texture-button';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { usePricingDialog } from '@/hooks/usePricingDialog';
import { useProAccess } from '@/hooks/useProAccess';
import { formatCredits, formatDateTime, formatDuration } from '@/i18n/format';
import { useLocalePreference } from '@/i18n/useLocalePreference';

const CREDITS_PER_SECOND = 2;

function Wallet() {
  const { t } = useTranslation();
  const { locale } = useLocalePreference();
  const { credits, transactions } = useApp();
  const { user, logout } = useAuth();
  const { openPricing } = usePricingDialog();
  const { access: proAccess } = useProAccess(user?.id);

  const remainingSeconds = Math.floor(credits / CREDITS_PER_SECOND);
  const proRemainingSeconds = proAccess.active && proAccess.creditsPerSecond
    ? Math.floor(credits / proAccess.creditsPerSecond)
    : null;

  return (
    <div className="max-w-[800px]">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">{t('wallet.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('wallet.subtitle')}</p>
        </div>
        <TextureButton
          onClick={logout}
          variant="destructive"
        >
          <LogOut className="w-4 h-4" />
          <span className="text-sm font-medium">{t('wallet.logout')}</span>
        </TextureButton>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-medium text-muted-foreground">{t('wallet.available')}</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <p className="mb-6 text-4xl font-semibold text-foreground">
            <AnimatedNumber value={Math.round(credits)} format={(n) => formatCredits(n, locale)} />{' '}
            <span className="text-xl text-muted-foreground">{t('common.credits')}</span>
          </p>
          <div className="mb-6 space-y-1 text-sm text-muted-foreground">
            <p>{t('wallet.fastAtRate', { duration: formatDuration(remainingSeconds, locale) })}</p>
            {proRemainingSeconds !== null && (
              <p>
                {t('wallet.proAtRate', {
                  rate: proAccess.creditsPerSecond,
                  duration: formatDuration(proRemainingSeconds, locale),
                })}
              </p>
            )}
          </div>
          <CosmicButton
            as="button"
            onClick={openPricing}
            id="fund-wallet-btn"
          >
            <Plus className="w-4 h-4 mr-2" />
            {t('wallet.buy')}
          </CosmicButton>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-medium text-muted-foreground">{t('wallet.transactionHistory')}</CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">{t('wallet.emptyFound')}</div>
          ) : (
            <div className="space-y-4 pt-4">
              {transactions.map((tx, index) => (
                <div key={tx.id}>
                  <div className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <div className={`flex size-10 items-center justify-center rounded-full ${tx.type === 'credit' ? 'bg-primary/10' : 'bg-destructive/10'}`}>
                        {tx.type === 'credit' ? (
                          <ArrowDownLeft className="size-5 text-primary" />
                        ) : (
                          <ArrowUpRight className="size-5 text-destructive" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {tx.description || (tx.type === 'credit' ? t('wallet.creditsPurchased') : t('wallet.streamUsage'))}
                        </p>
                        <p className="text-xs text-muted-foreground">{formatDateTime(tx.timestamp, locale)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold ${tx.type === 'credit' ? 'text-primary' : 'text-destructive'}`}>
                        {typeof tx.credits === 'number' && Number.isFinite(tx.credits)
                          ? t('wallet.creditsDelta', {
                              sign: tx.type === 'debit' ? '-' : '+',
                              count: formatCredits(tx.credits, locale),
                            })
                          : t('wallet.creditsUnavailable')}
                      </p>
                      <p className="text-xs text-muted-foreground">{t('common.completed')}</p>
                    </div>
                  </div>
                  {index < transactions.length - 1 && <Separator className="bg-blue-500/10" />}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

export default Wallet;
