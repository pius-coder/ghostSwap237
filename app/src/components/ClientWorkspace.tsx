import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { IconButton } from '@/components/app';
import Dashboard from '@/pages/Dashboard';
import History from '@/pages/History';
import Settings from '@/pages/Settings';
import Wallet from '@/pages/Wallet';
import { ROUTES } from '@/lib/routes';

type ClientPanel = 'history' | 'wallet' | 'settings';

export default function ClientWorkspace() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);

  const panel = useMemo<ClientPanel | null>(() => {
    if (location.pathname === ROUTES.PROTECTED.HISTORY) return 'history';
    if (
      location.pathname === ROUTES.PROTECTED.WALLET ||
      location.pathname === ROUTES.PROTECTED.SUBSCRIPTION
    ) {
      return 'wallet';
    }
    if (location.pathname === ROUTES.PROTECTED.SETTINGS) return 'settings';
    return null;
  }, [location.pathname]);

  const title =
    panel === 'history'
      ? t('nav.history')
      : panel === 'wallet'
        ? t('nav.wallet')
        : t('nav.settings');
  const description =
    panel === 'history'
      ? t('historyPage.subtitle')
      : panel === 'wallet'
        ? t('wallet.subtitle')
        : t('settings.subtitle');

  useEffect(() => {
    if (!panel) return;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') navigate(ROUTES.PROTECTED.DASHBOARD);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, panel]);

  const panelWidth =
    panel === 'history'
      ? 'lg:w-[min(900px,calc(100vw-96px))]'
      : panel === 'wallet'
        ? 'lg:w-[min(820px,calc(100vw-96px))]'
        : 'lg:w-[min(860px,calc(100vw-96px))]';

  return (
    <>
      <Dashboard />
      {panel ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label={title}
          tabIndex={-1}
          className={`workspace-panel fixed inset-x-2 bottom-2 top-[52px] z-40 overflow-hidden rounded-2xl outline-none sm:inset-x-4 sm:bottom-4 sm:top-[60px] lg:left-auto ${panelWidth}`}
        >
          <div className="flex h-11 items-center justify-between border-b border-white/[0.06] px-4">
            <div className="min-w-0">
              <h2 className="truncate text-[13px] font-semibold text-foreground">{title}</h2>
              <p className="truncate text-[11px] text-muted-foreground">{description}</p>
            </div>
            <IconButton
              label={t('common.close')}
              variant="ghost"
              className="size-8"
              onClick={() => navigate(ROUTES.PROTECTED.DASHBOARD)}
            >
              <X />
            </IconButton>
          </div>
          <div className="custom-scrollbar h-[calc(100%-44px)] overflow-y-auto p-4 sm:p-5">
            {panel === 'history' ? <History embedded /> : null}
            {panel === 'wallet' ? <Wallet embedded /> : null}
            {panel === 'settings' ? <Settings embedded /> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
