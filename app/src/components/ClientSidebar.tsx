import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ClockCounterClockwise,
  CaretDoubleLeft,
  CaretDoubleRight,
  ShieldCheck,
  SlidersHorizontal,
  SquaresFour,
  VideoCamera,
  Wallet,
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';
import { ACCOUNT_NAV, ADMIN_NAV, WORKSPACE_NAV, type NavLinkItem } from '@/lib/nav';
import { cn } from '@/lib/utils';

const SIDEBAR_VISUALS = {
  'nav.studio': { Icon: VideoCamera, tone: 'violet' },
  'nav.history': { Icon: ClockCounterClockwise, tone: 'blue' },
  'nav.wallet': { Icon: Wallet, tone: 'green' },
  'nav.settings': { Icon: SlidersHorizontal, tone: 'amber' },
  'nav.admin': { Icon: ShieldCheck, tone: 'rose' },
} as const;

function SidebarLink({
  item,
  onNavigate,
  collapsed = false,
}: {
  item: NavLinkItem;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const { t } = useTranslation();
  const visual = SIDEBAR_VISUALS[item.labelKey as keyof typeof SIDEBAR_VISUALS];
  const Icon = visual?.Icon ?? SquaresFour;

  return (
    <NavLink
      to={item.path}
      onClick={onNavigate}
      title={collapsed ? t(item.labelKey) : undefined}
      className={({ isActive }) =>
        cn('client-sidebar-item', collapsed && 'is-collapsed', isActive && 'is-active')
      }
    >
      <span className={cn('client-sidebar-icon', visual && `is-${visual.tone}`)} aria-hidden>
        <Icon size={18} weight="duotone" />
      </span>
      {!collapsed ? <span className="min-w-0 truncate">{t(item.labelKey)}</span> : null}
    </NavLink>
  );
}

function SidebarGroup({
  label,
  items,
  onNavigate,
  collapsed = false,
}: {
  label: string;
  items: NavLinkItem[];
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  return (
    <section className={cn('client-sidebar-group', collapsed && 'is-collapsed')}>
      <div className="client-sidebar-heading-row" aria-hidden={collapsed || undefined}>
        {!collapsed ? <h2 className="client-sidebar-heading">{label}</h2> : null}
        <span className="client-sidebar-divider" />
      </div>
      <nav aria-label={label}>
        {items.map((item) => (
          <SidebarLink
            key={item.path}
            item={item}
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
        ))}
      </nav>
    </section>
  );
}

export function ClientSidebarContent({
  onNavigate,
  mobile = false,
  collapsed = false,
  onToggle,
}: {
  onNavigate?: () => void;
  mobile?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <div
      className={cn(
        'client-sidebar-content custom-scrollbar',
        mobile && 'is-mobile',
        collapsed && 'is-collapsed',
      )}
    >
      <section className="client-sidebar-primary">
        <nav aria-label={t('nav.groupWorkspace')}>
          {WORKSPACE_NAV.map((item) => (
            <SidebarLink
              key={item.path}
              item={item}
              onNavigate={onNavigate}
              collapsed={collapsed}
            />
          ))}
        </nav>
      </section>
      <SidebarGroup
        label={t('nav.groupAccount')}
        items={ACCOUNT_NAV}
        onNavigate={onNavigate}
        collapsed={collapsed}
      />
      {user?.isAdmin ? (
        <SidebarGroup
          label={t('nav.groupAdmin')}
          items={ADMIN_NAV}
          onNavigate={onNavigate}
          collapsed={collapsed}
        />
      ) : null}
      {!mobile && onToggle ? (
        <button
          type="button"
          className="client-sidebar-collapse"
          onClick={onToggle}
          aria-label={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
          title={collapsed ? t('shell.expandSidebar') : undefined}
        >
          {collapsed ? (
            <CaretDoubleRight size={18} weight="bold" />
          ) : (
            <>
              <CaretDoubleLeft size={18} weight="bold" />
              <span>{t('shell.collapseSidebar')}</span>
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}

export function ClientSidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      className="client-sidebar hidden h-full shrink-0 lg:block"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <ClientSidebarContent collapsed={collapsed} onToggle={onToggle} />
    </aside>
  );
}
