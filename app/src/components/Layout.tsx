import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Headset,
  Languages,
  LogOut,
  Menu,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Square,
  Sun,
  X,
} from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { AppButton, IconButton } from '@/components/app';
import { useAuth } from '@/context/AuthContext';
import {
  ACCOUNT_NAV,
  ADMIN_NAV,
  WORKSPACE_NAV,
  getPageTitle,
  type NavLinkItem,
} from '@/lib/nav';
import { ROUTES } from '@/lib/routes';
import { PricingDialogProvider } from '@/components/PricingDialog';
import { ClientSidebar, ClientSidebarContent } from '@/components/ClientSidebar';
import { ClientPlanMenu } from '@/components/ClientPlanMenu';
import { useLocalePreference } from '@/i18n/useLocalePreference';
import type { AppLocale } from '@/i18n/locale';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from './ui/avatar';

const SIDEBAR_STORAGE_KEY = 'henshin.sidebar.collapsed';
const SIDEBAR_OPEN_PX = 216;
const SIDEBAR_COLLAPSED_PX = 64;

function getInitials(name?: string): string {
  if (!name) return 'U';
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function readCollapsedPreference(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsedPreference(collapsed: boolean) {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore */
  }
}

type ElectronBridge = {
  require?: (id: string) => { ipcRenderer: { send: (channel: string) => void } };
};

function getElectronIpc() {
  try {
    const bridge = window as unknown as ElectronBridge;
    return bridge.require?.('electron')?.ipcRenderer ?? null;
  } catch {
    return null;
  }
}

function NavGroup({
  label,
  items,
  collapsed,
  onNavigate,
}: {
  label: string;
  items: NavLinkItem[];
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      {!collapsed ? (
        <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      ) : null}
      <nav className="flex flex-col gap-0.5" aria-label={label}>
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            title={collapsed ? t(item.labelKey) : undefined}
            className={({ isActive }) =>
              cn(
                'nav-item',
                collapsed && 'justify-center px-2',
                isActive && 'aria-[current=page]:bg-primary/10',
              )
            }
          >
            <item.icon className="size-[18px] shrink-0" strokeWidth={1.5} />
            {!collapsed ? <span className="truncate">{t(item.labelKey)}</span> : null}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function SidebarBody({
  collapsed,
  onToggle,
  onNavigate,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { locale, setLocale } = useLocalePreference();

  const handleLogout = () => {
    logout();
    navigate(ROUTES.PUBLIC.LOGIN);
  };

  const cycleLocale = () => {
    const next: AppLocale = locale === 'fr' ? 'en' : 'fr';
    void setLocale(next, { persistServer: true });
  };

  return (
    <div className="flex h-full flex-col gap-4 px-2 py-3">
      <NavGroup
        label={t('nav.groupWorkspace')}
        items={WORKSPACE_NAV}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
      <NavGroup
        label={t('nav.groupAccount')}
        items={ACCOUNT_NAV}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
      {user?.isAdmin ? (
        <NavGroup
          label={t('nav.groupAdmin')}
          items={ADMIN_NAV}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      ) : null}

      <div className="mt-auto flex flex-col gap-1 border-t border-white/[0.08] pt-3">
        <AppButton
          variant="ghost"
          size={collapsed ? 'icon' : 'sm'}
          onClick={cycleLocale}
          aria-label={t('shell.language')}
          className={cn('w-full', !collapsed && 'justify-start')}
        >
          <span className="text-xs font-semibold uppercase">{locale}</span>
          {!collapsed ? <span>{t('shell.language')}</span> : null}
        </AppButton>

        <div
          className={cn(
            'flex items-center gap-2 rounded-lg px-2 py-1.5',
            collapsed && 'justify-center',
          )}
        >
          <Avatar className="size-8 shrink-0">
            <AvatarFallback className="bg-accent text-[11px] font-semibold text-foreground">
              {getInitials(user?.name)}
            </AvatarFallback>
          </Avatar>
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-foreground">
                {user?.name || t('common.user')}
              </p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
          ) : null}
        </div>

        <AppButton
          variant="ghost"
          size={collapsed ? 'icon' : 'sm'}
          onClick={handleLogout}
          aria-label={t('common.signOut')}
          className={cn('w-full', !collapsed && 'justify-start')}
        >
          <LogOut className="size-4" />
          {!collapsed ? <span>{t('common.signOut')}</span> : null}
        </AppButton>

        <AppButton
          variant="ghost"
          size={collapsed ? 'icon' : 'sm'}
          onClick={onToggle}
          aria-label={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
          className={cn('w-full', !collapsed && 'justify-start')}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed ? <span>{t('shell.collapseSidebar')}</span> : null}
        </AppButton>
      </div>
    </div>
  );
}

function LayoutShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { locale, setLocale } = useLocalePreference();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isElectron] = useState(() => getElectronIpc() !== null);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (window.innerWidth < 1024) return true;
    return readCollapsedPreference();
  });
  const [isCompact, setIsCompact] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth < 1024 : false),
  );

  const isClientWorkspace = [
    '/',
    ROUTES.PROTECTED.DASHBOARD,
    ROUTES.PROTECTED.HISTORY,
    ROUTES.PROTECTED.WALLET,
    ROUTES.PROTECTED.SETTINGS,
  ].includes(location.pathname);
  const pageTitle = isClientWorkspace ? 'Henshin Studio' : getPageTitle(location.pathname, t);

  useEffect(() => {
    const onResize = () => {
      const compact = window.innerWidth < 1024;
      setIsCompact(compact);
      if (compact) setCollapsed(true);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    if (!isCompact) writeCollapsedPreference(next);
  }, [collapsed, isCompact]);

  const handleWindowControl = (action: 'minimize' | 'maximize' | 'close') => {
    getElectronIpc()?.send(`window-${action}`);
  };

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED_PX : SIDEBAR_OPEN_PX;

  return (
    <div className="app-atmosphere fixed inset-0 isolate flex flex-col overflow-hidden bg-background">
      <header
        className={cn(
          'app-region-drag relative z-50 flex shrink-0 items-center justify-between pr-0',
          isClientWorkspace
            ? 'h-[52px] bg-white py-2 pl-2 text-[#242322] backdrop-blur-[10px]'
            : 'border-b border-white/[0.08] bg-[rgba(5,6,18,0.78)] pl-3 backdrop-blur-xl',
        )}
      >
        <div className={cn('flex min-w-0 items-center gap-3', isClientWorkspace && 'flex-1')}>
          <div className={cn('flex min-w-0 items-center gap-2', isClientWorkspace && 'px-0')}>
          {isCompact ? (
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <IconButton
                  label={t('shell.openNavigation')}
                  className={cn('app-region-no-drag', isClientWorkspace && 'text-[#242322] hover:bg-black/[0.06]')}
                >
                  <Menu />
                </IconButton>
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px] border-white/[0.08] bg-background p-0">
                <div className="flex items-center px-4 py-3">
                  <span className={cn('text-sm font-semibold', isClientWorkspace ? 'text-[#242322]' : 'text-foreground')}>
                    {isClientWorkspace ? 'Henshin Studio' : t('common.appName')}
                  </span>
                </div>
                {isClientWorkspace ? (
                  <ClientSidebarContent mobile onNavigate={() => setMobileOpen(false)} />
                ) : (
                  <SidebarBody
                    collapsed={false}
                    onToggle={() => setMobileOpen(false)}
                    onNavigate={() => setMobileOpen(false)}
                  />
                )}
              </SheetContent>
            </Sheet>
          ) : null}

          {!isClientWorkspace ? (
            <NavLink
              to={ROUTES.PROTECTED.DASHBOARD}
              aria-label={t('common.appName')}
              className="app-region-no-drag hidden size-8 shrink-0 overflow-hidden rounded-lg lg:flex"
            >
              <img src="./logo.png" alt="" className="h-full w-full object-cover" />
            </NavLink>
          ) : null}

          <p
            className={cn(
              'truncate font-semibold',
              isClientWorkspace
                ? 'text-[24px] font-semibold leading-8 tracking-[-0.45px] text-[#5f6065]'
                : 'text-[15px] text-foreground',
            )}
          >
            {pageTitle}
          </p>
          {isClientWorkspace ? <span className="text-[18px] font-medium tracking-normal text-[#77787d]">変身</span> : null}
          </div>
        </div>

        <div className="app-region-no-drag flex shrink-0 items-center gap-2 pr-3">
          {isClientWorkspace ? (
            <>
              <button
                type="button"
                className="client-topbar-icon-control"
                aria-label="Thème"
              >
                <Sun className="size-[18px]" strokeWidth={2} />
              </button>
              <button
                type="button"
                className="client-topbar-icon-control"
                onClick={() => void setLocale(locale === 'fr' ? 'en' : 'fr', { persistServer: true })}
                aria-label={t('shell.language')}
              >
                <Languages className="size-4" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="client-topbar-icon-control"
                aria-label="Discord"
              >
                <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
                  <path fill="currentColor" d="M19.303 5.337A15.8 15.8 0 0 0 14.963 4c-.191.329-.403.775-.552 1.125a16.7 16.7 0 0 0-4.808 0A12 12 0 0 0 9.051 4a15.7 15.7 0 0 0-4.342 1.337C1.961 9.391 1.218 13.35 1.589 17.255a17.5 17.5 0 0 0 5.318 2.664c.425-.573.807-1.189 1.136-1.836a10.3 10.3 0 0 1-1.794-.86l.435-.34c3.46 1.581 7.207 1.581 10.624 0l.435.34c-.573.34-1.167.626-1.793.86.329.647.711 1.263 1.135 1.836a17.5 17.5 0 0 0 5.318-2.664c.457-4.521-.723-8.448-3.1-11.918M8.52 14.846c-1.04 0-1.889-.945-1.889-2.101 0-1.157.828-2.102 1.889-2.102 1.051 0 1.91.945 1.889 2.102 0 1.156-.838 2.101-1.889 2.101m6.974 0c-1.04 0-1.89-.945-1.89-2.101 0-1.157.829-2.102 1.89-2.102 1.05 0 1.91.945 1.889 2.102 0 1.156-.828 2.101-1.889 2.101" />
                </svg>
              </button>
              <a
                className="client-topbar-icon-control"
                href="https://wa.me/237620124019"
                target="_blank"
                rel="noreferrer"
                aria-label={t('studio.contactWhatsApp')}
              >
                <Headset className="size-4" strokeWidth={1.8} />
              </a>
              <ClientPlanMenu />
            </>
          ) : null}

          {isElectron ? (
            <div className="ml-1 flex items-center self-stretch">
              <IconButton
                label={t('common.minimize')}
                variant="ghost"
                className={cn('rounded-none', isClientWorkspace && 'text-[#242322] hover:bg-black/[0.06]')}
                onClick={() => handleWindowControl('minimize')}
              >
                <Minus />
              </IconButton>
              <IconButton
                label={t('common.maximize')}
                variant="ghost"
                className={cn('rounded-none', isClientWorkspace && 'text-[#242322] hover:bg-black/[0.06]')}
                onClick={() => handleWindowControl('maximize')}
              >
                <Square />
              </IconButton>
              <IconButton
                label={t('common.close')}
                variant="ghost"
                className={cn(
                  'rounded-none hover:bg-destructive hover:text-destructive-foreground',
                  isClientWorkspace && 'text-[#242322]',
                )}
                onClick={() => handleWindowControl('close')}
              >
                <X />
              </IconButton>
            </div>
          ) : null}
        </div>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1">
        {!isCompact ? (
          isClientWorkspace ? (
            <ClientSidebar collapsed={collapsed} onToggle={toggleCollapsed} />
          ) : (
            <aside
              className="hidden h-full shrink-0 border-r border-white/[0.08] bg-[rgba(8,8,18,0.82)] backdrop-blur-xl lg:flex"
              style={{ width: sidebarWidth }}
              data-collapsed={collapsed ? 'true' : 'false'}
            >
              <SidebarBody collapsed={collapsed} onToggle={toggleCollapsed} />
            </aside>
          )
        ) : null}

        <section className={cn('min-h-0 min-w-0 flex-1 overflow-hidden', isClientWorkspace ? 'client-main-frame' : 'bg-black/10')}>
          <div className={cn('custom-scrollbar h-full overflow-auto', isClientWorkspace && 'client-main-shell')}>
            <div className={cn('flex h-full min-h-0 flex-col', isClientWorkspace ? '' : 'p-4 lg:p-5')}>
              <Outlet />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function Layout() {
  return (
    <PricingDialogProvider>
      <LayoutShell />
    </PricingDialogProvider>
  );
}
