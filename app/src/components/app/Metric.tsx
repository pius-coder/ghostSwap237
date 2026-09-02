import type * as React from 'react';
import { cn } from '@/lib/utils';

export interface MetricProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  hint?: string;
}

export function Metric({ label, value, hint, className, ...props }: MetricProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)} {...props}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums tracking-tight text-foreground sm:text-2xl">
        {value}
      </span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
