import type * as React from 'react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

export interface FieldGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
}

export function FieldGroup({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
  ...props
}: FieldGroupProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)} {...props}>
      <Label htmlFor={htmlFor} className="text-[13px] font-medium text-foreground">
        {label}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
