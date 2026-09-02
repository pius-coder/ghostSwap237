import * as React from 'react';
import { cn } from '@/lib/utils';
import { AppButton, type AppButtonProps } from './AppButton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export interface IconButtonProps extends Omit<AppButtonProps, 'size' | 'children'> {
  label: string;
  children: React.ReactNode;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
}

export function IconButton({
  label,
  children,
  tooltipSide = 'bottom',
  className,
  variant = 'ghost',
  ...props
}: IconButtonProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <AppButton
            variant={variant}
            size="icon"
            aria-label={label}
            className={cn('size-9 min-h-9 min-w-9', className)}
            {...props}
          >
            {children}
          </AppButton>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
