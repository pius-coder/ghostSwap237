import type * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'flex gap-2 rounded-lg border px-3 py-2.5 text-[13px]',
  {
    variants: {
      tone: {
        info: 'border-white/[0.10] bg-white/[0.04] text-foreground',
        success: 'border-success/25 bg-success/10 text-foreground',
        warning: 'border-warning/25 bg-warning/10 text-foreground',
        error: 'border-destructive/25 bg-destructive/10 text-foreground',
      },
    },
    defaultVariants: {
      tone: 'info',
    },
  },
);

export interface InlineAlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

export function InlineAlert({ className, tone, children, ...props }: InlineAlertProps) {
  return (
    <div role="alert" className={cn(alertVariants({ tone }), className)} {...props}>
      {children}
    </div>
  );
}
