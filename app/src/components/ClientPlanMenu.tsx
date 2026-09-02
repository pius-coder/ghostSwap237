import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Clock3, Settings2, WalletCards, Zap } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePricingDialog } from '@/hooks/usePricingDialog';
import { formatCredits, formatDurationFromCredits } from '@/i18n/format';
import { useLocalePreference } from '@/i18n/useLocalePreference';
import { loadLiveProvider, LIVE_PROVIDER_CHANGE_EVENT, type LiveProvider } from '@/lib/liveProvider';
import { ROUTES } from '@/lib/routes';
import { cn } from '@/lib/utils';

export function ClientPlanMenu() {
  const { credits, sessionStatus } = useApp();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { locale } = useLocalePreference();
  const { openPricing } = usePricingDialog();
  const navigate = useNavigate();
  const [provider, setProvider] = useState<LiveProvider>(() => loadLiveProvider());
  const creditCapacityRef = useRef(Math.max(1, credits));

  useEffect(() => {
    const syncProvider = () => setProvider(loadLiveProvider());
    window.addEventListener('storage', syncProvider);
    window.addEventListener(LIVE_PROVIDER_CHANGE_EVENT, syncProvider);
    return () => {
      window.removeEventListener('storage', syncProvider);
      window.removeEventListener(LIVE_PROVIDER_CHANGE_EVENT, syncProvider);
    };
  }, []);

  const isPro = provider === 'pro';
  const isLive = sessionStatus === 'LIVE';
  const rate = isPro ? 80 : 2;
  const planName = isPro ? t('studio.pro') : 'X2';
  const engineName = isPro ? 'fal.ai Lucy 2.5' : 'Reactor X2';
  const accountName = user?.name || t('common.user');
  const initials = (user?.name || t('common.user')).split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  if (!isLive && credits > creditCapacityRef.current) creditCapacityRef.current = credits;
  const creditProgress = Math.max(0, Math.min(1, credits / Math.max(1, creditCapacityRef.current)));
  const ringLength = 91.106;
  const ringOffset = ringLength * (1 - creditProgress);
  const triggerLabel = isLive ? `${formatCredits(credits, locale)} ${t('nav.credits')}` : accountName;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn('client-plan-trigger', isLive && 'is-live', isLive && isPro && 'is-pro-live')}
          aria-label={triggerLabel}
        >
          <span className="client-plan-trigger-copy">
            <span className="client-plan-trigger-name" title={triggerLabel}>{triggerLabel}</span>
            <span className="client-plan-trigger-tag">{isLive ? t('common.live') : isPro ? 'PRO' : 'X2'}</span>
          </span>
          <span className="client-plan-trigger-avatar">
            <Avatar className="relative z-[1] size-[22px]">
              <AvatarFallback className={cn('client-plan-avatar-fallback text-[9px] font-bold', isLive && isPro && 'is-pro-live')}>{initials}</AvatarFallback>
            </Avatar>
            <svg viewBox="0 0 32 32" className="pointer-events-none absolute inset-0 -rotate-90" aria-hidden="true">
              <defs>
                <linearGradient id="client-pro-burn-gradient" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#ff6b6b" />
                  <stop offset="0.5" stopColor="#ef3340" />
                  <stop offset="1" stopColor="#a50f25" />
                </linearGradient>
              </defs>
              <circle cx="16" cy="16" r="14.5" fill="none" stroke="rgb(0 0 0 / 0.08)" strokeWidth="2.25" />
              <circle
                className="client-plan-credit-ring"
                cx="16"
                cy="16"
                r="14.5"
                fill="none"
                stroke={isLive && isPro ? 'url(#client-pro-burn-gradient)' : '#6849d8'}
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeDasharray={ringLength}
                strokeDashoffset={ringOffset}
              />
            </svg>
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="client-plan-menu w-80 p-0"
      >
        <div className="client-plan-menu-summary">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-[#f7f5ff]">{accountName}</p>
                <span className="client-plan-menu-tag">{isPro ? 'PRO' : 'X2'}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-[#aaa4bc]">{user?.email}</p>
            </div>
            <button type="button" className="client-plan-menu-settings" onClick={() => navigate(ROUTES.PROTECTED.SETTINGS)} aria-label={t('nav.settings')}>
              <Settings2 className="size-3.5" strokeWidth={1.8} />
            </button>
          </div>

          <div className="client-plan-menu-balance">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold tabular-nums text-[#f7f5ff]">
                {formatCredits(credits, locale)}
              </span>
              <span className="text-[#aaa4bc]">{t('nav.creditsBalance')}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-[#d5cfea]">
                {formatDurationFromCredits(credits, rate, locale)}
              </span>
              <span className="text-[#aaa4bc]">{planName}</span>
            </div>
            <p className="mt-1 truncate text-[11px] text-[#827c96]">{engineName} · {rate} cr/s</p>
            <button type="button" className="client-plan-buy" onClick={openPricing}>
              <Zap className="size-4" strokeWidth={1.8} />
              {t('nav.buyCredits')}
            </button>
          </div>
        </div>

        <DropdownMenuSeparator className="client-plan-menu-separator" />

        <div className="client-plan-menu-actions">
          <DropdownMenuItem className="client-plan-menu-item" onSelect={() => navigate(ROUTES.PROTECTED.WALLET)}>
            <WalletCards />
            {t('nav.wallet')}
          </DropdownMenuItem>
          <DropdownMenuItem className="client-plan-menu-item" onSelect={() => navigate(ROUTES.PROTECTED.HISTORY)}>
            <Clock3 />
            {t('nav.history')}
          </DropdownMenuItem>
          <DropdownMenuItem className="client-plan-menu-item" onSelect={() => navigate(ROUTES.PROTECTED.SETTINGS)}>
            <Settings2 />
            {t('nav.settings')}
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
