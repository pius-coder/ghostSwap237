import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History as HistoryIcon } from 'lucide-react';
import { useApp, type SessionHistoryEntry } from '@/context/AppContext';
import {
  AppButton,
  AppDrawer,
  AppDrawerContent,
  AppDrawerDescription,
  AppDrawerHeader,
  AppDrawerTitle,
  EmptyState,
  SectionHeader,
  StatusBadge,
} from '@/components/app';
import { formatCredits, formatDateTime, formatDuration } from '@/i18n/format';
import { useLocalePreference } from '@/i18n/useLocalePreference';
import { cn } from '@/lib/utils';

type HistoryFilter = 'all' | 'fast' | 'pro' | 'success' | 'error';

function sessionMode(entry: SessionHistoryEntry): 'fast' | 'pro' {
  if (entry.provider === 'fal') return 'pro';
  return 'fast';
}

export default function HistoryPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const { locale } = useLocalePreference();
  const { sessionHistory, isLoading } = useApp();
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [selected, setSelected] = useState<SessionHistoryEntry | null>(null);

  const filters: Array<{ id: HistoryFilter; label: string }> = [
    { id: 'all', label: t('historyPage.filterAll') },
    { id: 'fast', label: t('historyPage.filterFast') },
    { id: 'pro', label: t('historyPage.filterPro') },
    { id: 'success', label: t('historyPage.filterSuccess') },
    { id: 'error', label: t('historyPage.filterError') },
  ];

  const rows = useMemo(() => {
    const sorted = [...sessionHistory].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    return sorted.filter((entry) => {
      const mode = sessionMode(entry);
      if (filter === 'fast') return mode === 'fast';
      if (filter === 'pro') return mode === 'pro';
      if (filter === 'success') return entry.status === 'ended';
      if (filter === 'error') return entry.status === 'interrupted';
      return true;
    });
  }, [sessionHistory, filter]);

  const providerLabel = (entry: SessionHistoryEntry) => {
    if (entry.provider === 'reactor') return t('historyPage.providerReactor');
    if (entry.provider === 'fal') return t('historyPage.providerLucy');
    if (entry.provider === 'morphly') return t('historyPage.providerMorphly');
    return t('historyPage.providerUnknown');
  };

  const statusLabel = (status: SessionHistoryEntry['status']) => {
    if (status === 'active') return t('historyPage.statusActive');
    if (status === 'ended') return t('historyPage.statusEnded');
    return t('historyPage.statusInterrupted');
  };

  const statusTone = (status: SessionHistoryEntry['status']) => {
    if (status === 'active') return 'live' as const;
    if (status === 'ended') return 'success' as const;
    return 'error' as const;
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {!embedded ? (
        <SectionHeader title={t('historyPage.title')} description={t('historyPage.subtitle')} />
      ) : null}

      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('historyPage.title')}>
        {filters.map((item) => (
          <AppButton
            key={item.id}
            size="sm"
            variant={filter === item.id ? 'primary' : 'secondary'}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </AppButton>
        ))}
      </div>

      {isLoading ? (
        <p className="text-[13px] text-muted-foreground">{t('historyPage.loading')}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<HistoryIcon className="size-8" />}
          title={sessionHistory.length === 0 ? t('historyPage.empty') : t('historyPage.emptyFiltered')}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-white/[0.08]">
          <div className="custom-scrollbar overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
              <thead className="bg-surface-elevated text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">{t('historyPage.date')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('historyPage.mode')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('historyPage.provider')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('historyPage.duration')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('historyPage.credits')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('historyPage.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr
                    key={entry.id}
                    className={cn(
                      'cursor-pointer border-t border-white/[0.06] transition-ui hover:bg-accent/60',
                    )}
                    onClick={() => setSelected(entry)}
                  >
                    <td className="px-3 py-2.5 text-foreground">
                      {formatDateTime(entry.date, locale)}
                    </td>
                    <td className="px-3 py-2.5">
                      {sessionMode(entry) === 'pro'
                        ? t('historyPage.modePro')
                        : t('historyPage.modeFast')}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{providerLabel(entry)}</td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {formatDuration(entry.duration, locale)}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {formatCredits(entry.credits, locale)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge tone={statusTone(entry.status)}>
                        {statusLabel(entry.status)}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AppDrawer open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <AppDrawerContent side="right">
          {selected ? (
            <>
              <AppDrawerHeader>
                <AppDrawerTitle>{t('historyPage.details')}</AppDrawerTitle>
                <AppDrawerDescription>
                  {formatDateTime(selected.date, locale)}
                </AppDrawerDescription>
              </AppDrawerHeader>
              <div className="custom-scrollbar flex-1 space-y-3 overflow-auto px-4 pb-6 text-[13px]">
                <DetailRow
                  label={t('historyPage.mode')}
                  value={
                    sessionMode(selected) === 'pro'
                      ? t('historyPage.modePro')
                      : t('historyPage.modeFast')
                  }
                />
                <DetailRow label={t('historyPage.provider')} value={providerLabel(selected)} />
                <DetailRow
                  label={t('historyPage.duration')}
                  value={formatDuration(selected.duration, locale)}
                />
                <DetailRow
                  label={t('historyPage.credits')}
                  value={formatCredits(selected.credits, locale)}
                />
                <DetailRow label={t('historyPage.status')} value={statusLabel(selected.status)} />
                <DetailRow
                  label={t('historyPage.reason')}
                  value={selected.reason || t('common.unknown')}
                />
              </div>
            </>
          ) : null}
        </AppDrawerContent>
      </AppDrawer>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-white/[0.06] pb-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
