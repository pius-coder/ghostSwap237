import { LayoutDashboard, Coins, CreditCard, Settings, ShieldAlert, type ComponentType } from 'lucide-react';
import { ROUTES } from '@/lib/routes';
import type { TFunction } from 'i18next';

interface NavItemBase {
  labelKey: 'nav.dashboard' | 'nav.credits' | 'nav.buyCredits' | 'nav.settings' | 'nav.admin';
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}

export interface NavLinkItem extends NavItemBase {
  path: string;
  action?: never;
}

export interface NavActionItem extends NavItemBase {
  action: 'buy-credits';
  path?: never;
}

export type NavItem = NavLinkItem | NavActionItem;

export const HENSHIN_NAV: NavItem[] = [
  { path: ROUTES.PROTECTED.DASHBOARD, labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { path: ROUTES.PROTECTED.WALLET, labelKey: 'nav.credits', icon: Coins },
  { action: 'buy-credits', labelKey: 'nav.buyCredits', icon: CreditCard },
  { path: ROUTES.PROTECTED.SETTINGS, labelKey: 'nav.settings', icon: Settings },
];

export const ADMIN_NAV: NavItem[] = [
  { path: ROUTES.PROTECTED.ADMIN_DASHBOARD, labelKey: 'nav.admin', icon: ShieldAlert },
];

const PAGE_TITLE_KEYS: Array<{ path: string; labelKey: NavItemBase['labelKey'] }> = [
  { path: ROUTES.PROTECTED.DASHBOARD, labelKey: 'nav.dashboard' },
  { path: ROUTES.PROTECTED.WALLET, labelKey: 'nav.credits' },
  { path: ROUTES.PROTECTED.SETTINGS, labelKey: 'nav.settings' },
  { path: ROUTES.PROTECTED.ADMIN_DASHBOARD, labelKey: 'nav.admin' },
];

export function getPageTitle(pathname: string, t: TFunction): string {
  const exact = PAGE_TITLE_KEYS.find((item) => pathname === item.path);
  if (exact) return t(exact.labelKey);

  const nested = PAGE_TITLE_KEYS.filter((item) => pathname.startsWith(`${item.path}/`)).sort(
    (a, b) => b.path.length - a.path.length,
  )[0];
  if (nested) return t(nested.labelKey);

  return t('common.appName');
}
