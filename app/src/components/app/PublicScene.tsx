import type { ReactNode } from 'react';
import { Camera, MonitorUp, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export interface PublicSceneProps {
  children: ReactNode;
  className?: string;
}

export function PublicScene({ children, className }: PublicSceneProps) {
  const { t } = useTranslation();

  return (
    <main className="app-atmosphere relative min-h-screen overflow-hidden px-4 py-5 sm:px-6">

      <div
        className={cn(
          'reference-atmosphere relative mx-auto grid min-h-[calc(100vh-2.5rem)] w-full max-w-6xl overflow-hidden rounded-[32px] border border-white/[0.10] shadow-[0_30px_90px_rgba(0,0,0,0.48)] lg:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]',
          className,
        )}
      >
        <section className="relative hidden min-h-[620px] flex-col justify-between overflow-hidden border-r border-white/[0.09] p-8 lg:flex xl:p-10">
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-8 w-px bg-white/[0.07] xl:left-10" />
          <div aria-hidden className="pointer-events-none absolute inset-y-0 right-8 w-px bg-white/[0.07] xl:right-10" />
          <div className="relative z-10 flex items-center gap-3">
            <div className="reference-glass size-9 overflow-hidden rounded-[10px]">
              <img src="./logo.png" alt="" className="size-full object-cover" />
            </div>
            <span className="text-[15px] font-semibold tracking-tight text-foreground">
              {t('common.appName')}
            </span>
          </div>

          <div className="relative z-10 max-w-xl px-6">
            <p className="reference-badge mb-5 w-max rounded-full px-3.5 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-white/80">
              {t('auth.workspaceLabel')}
            </p>
            <h1 className="reference-title max-w-lg text-4xl font-semibold leading-[1.08] tracking-[-0.035em] xl:text-5xl">
              {t('auth.heroTitle')}
            </h1>
            <p className="mt-5 max-w-lg text-[15px] leading-6 text-white/68">
              {t('auth.heroDescription')}
            </p>
          </div>

          <div className="reference-dock relative z-10 mx-6 grid grid-cols-3 overflow-hidden rounded-[24px] p-2.5">
            <FlowStep icon={<Camera />} label={t('auth.flowCamera')} />
            <FlowStep icon={<Sparkles />} label={t('auth.flowTransform')} active />
            <FlowStep icon={<MonitorUp />} label={t('auth.flowOutput')} />
          </div>
        </section>

        <section className="relative flex min-h-[620px] items-center justify-center p-5 sm:p-8 lg:p-10">
          <div className="w-full max-w-md">{children}</div>
        </section>
      </div>
    </main>
  );
}

function FlowStep({ icon, label, active = false }: { icon: ReactNode; label: string; active?: boolean }) {
  return (
    <div
      className={cn(
        'relative flex min-w-0 flex-col items-center gap-2 rounded-[16px] px-2 py-3 text-center text-white/50 transition-ui',
        active && 'bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]',
      )}
    >
      {active ? <span className="absolute -bottom-0.5 size-1.5 rounded-full bg-success" /> : null}
      <span className="[&_svg]:size-5">{icon}</span>
      <span className="truncate text-[11px] font-medium">{label}</span>
    </div>
  );
}
