import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SectionHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function SectionHeader({
  title,
  description,
  actions,
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div
      data-slot="section-header"
      className={cn('mb-3 flex items-start justify-between gap-3', className)}
      {...props}
    >
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
