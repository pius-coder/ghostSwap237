import * as React from 'react';
import { cn } from '@/lib/utils';

export interface AppSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
  padded?: boolean;
}

export function AppSurface({
  className,
  elevated = false,
  padded = true,
  ...props
}: AppSurfaceProps) {
  return (
    <div
      data-slot="app-surface"
      className={cn(
        elevated ? 'surface-elevated' : 'surface-base',
        padded && 'p-4',
        className,
      )}
      {...props}
    />
  );
}
