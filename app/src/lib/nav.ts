import {
  LayoutDashboard,
  History,
  Coins,
  Settings,
  ShieldAlert,
  type ComponentType,
} from 'lucide-react';
import { ROUTES } from '@/lib/routes';
import type { TFunction } from 'i18next';

export type NavLabelKey =
  | 'nav.studio'
  | 'nav.history'
  | 'nav.wallet'
  | 'nav.settings'
  | 'nav.admin'
  | 'nav.dashboard'
  | 'nav.credits';

export interface NavLinkItem {
  path: string;
  labelKey: NavLabelKey;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}

export interface NavGroup {
  id: 'workspace' | 'account' | 'admin';
  labelKey: 'nav.groupWorkspace' | 'nav.groupAccount' | 'nav.groupAdmin';
  items: NavLinkItem[];
}

export const WORKSPACE_NAV: NavLinkItem[] = [
  { path: ROUTES.PROTECTED.DASHBOARD, labelKey: 'nav.studio', icon: LayoutDashboard },
  { path: ROUTES.PROTECTED.HISTORY, labelKey: 'nav.history', icon: History },
];

export const ACCOUNT_NAV: NavLinkItem[] = [
  { path: ROUTES.PROTECTED.WALLET, labelKey: 'nav.wallet', icon: Coins },
  { path: ROUTES.PROTECTED.SETTINGS, labelKey: 'nav.settings', icon: Settings },
];

export const ADMIN_NAV: NavLinkItem[] = [
  { path: ROUTES.PROTECTED.ADMIN_DASHBOARD, labelKey: 'nav.admin', icon: ShieldAlert },
];

/** @deprecated Prefer WORKSPACE_NAV + ACCOUNT_NAV */
export const HENSHIN_NAV: NavLinkItem[] = [...WORKSPACE_NAV, ...ACCOUNT_NAV];

const PAGE_TITLE_KEYS: Array<{ path: string; labelKey: NavLabelKey }> = [
  { path: ROUTES.PROTECTED.DASHBOARD, labelKey: 'nav.studio' },
  { path: ROUTES.PROTECTED.HISTORY, labelKey: 'nav.history' },
  { path: ROUTES.PROTECTED.WALLET, labelKey: 'nav.wallet' },
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
