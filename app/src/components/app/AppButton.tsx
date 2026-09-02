import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const appButtonVariants = cva(
  'relative isolate inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-lg text-[13px] font-medium transition-ui outline-none before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-gradient-to-b before:from-white/[0.09] before:to-transparent focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-foreground text-background shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_1px_2px_rgba(0,0,0,0.35),0_6px_18px_rgba(0,0,0,0.18)] hover:bg-white hover:-translate-y-px active:translate-y-0',
        secondary:
          'border border-white/[0.09] bg-white/[0.045] text-secondary-foreground shadow-[inset_0_1px_2px_rgba(255,255,255,0.10),inset_0_8px_18px_-12px_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.28)] hover:bg-white/[0.09]',
        ghost: 'rounded-lg text-foreground before:hidden hover:bg-white/[0.07] hover:text-accent-foreground',
        danger:
          'bg-destructive text-destructive-foreground shadow-[inset_0_1px_2px_rgba(255,255,255,0.16),0_3px_10px_rgba(120,8,8,0.25)] hover:bg-destructive/90',
      },
      size: {
        default: 'h-9 min-h-9 px-3',
        sm: 'h-8 min-h-8 px-3 text-xs',
        lg: 'h-10 min-h-10 px-4 text-sm',
        icon: 'size-9 min-h-9 min-w-9 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

export interface AppButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof appButtonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const AppButton = React.forwardRef<HTMLButtonElement, AppButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        data-slot="app-button"
        className={cn(appButtonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            <span className="truncate">{children}</span>
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
AppButton.displayName = 'AppButton';

export { appButtonVariants };
