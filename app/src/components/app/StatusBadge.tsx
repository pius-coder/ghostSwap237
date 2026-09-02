import type * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const statusBadgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        idle: 'bg-muted text-muted-foreground',
        connecting: 'bg-warning/15 text-warning',
        live: 'bg-success/15 text-success',
        success: 'bg-success/15 text-success',
        error: 'bg-destructive/15 text-destructive',
        info: 'bg-white/[0.08] text-foreground',
      },
    },
    defaultVariants: {
      tone: 'idle',
    },
  },
);

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusBadgeVariants> {
  pulse?: boolean;
}

export function StatusBadge({
  className,
  tone,
  pulse = false,
  children,
  ...props
}: StatusBadgeProps) {
  return (
    <span className={cn(statusBadgeVariants({ tone }), className)} {...props}>
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          tone === 'live' && 'bg-success',
          tone === 'success' && 'bg-success',
          tone === 'connecting' && 'bg-warning',
          tone === 'error' && 'bg-destructive',
          tone === 'info' && 'bg-foreground',
          (!tone || tone === 'idle') && 'bg-muted-foreground',
          pulse && 'animate-pulse',
        )}
        aria-hidden
      />
      {children}
    </span>
  );
}
