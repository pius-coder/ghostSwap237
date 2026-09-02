import * as React from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';
import { cn } from '@/lib/utils';

export const AppDrawer = ({
  shouldScaleBackground = false,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) => (
  <DrawerPrimitive.Root shouldScaleBackground={shouldScaleBackground} {...props} />
);
export const AppDrawerTrigger = DrawerPrimitive.Trigger;
export const AppDrawerClose = DrawerPrimitive.Close;
export const AppDrawerPortal = DrawerPrimitive.Portal;

export function AppDrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay className={cn('fixed inset-0 z-50 bg-black/70', className)} {...props} />
  );
}

export function AppDrawerContent({
  className,
  children,
  side = 'right',
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content> & {
  side?: 'left' | 'right' | 'bottom';
}) {
  return (
    <AppDrawerPortal>
      <AppDrawerOverlay />
      <DrawerPrimitive.Content
        className={cn(
          'fixed z-50 flex flex-col border-white/[0.08] bg-popover text-popover-foreground outline-none',
          side === 'bottom' &&
            'inset-x-0 bottom-0 mt-24 max-h-[85vh] rounded-t-xl border-t',
          side === 'right' &&
            'inset-y-0 right-0 h-full w-[min(100vw,320px)] border-l',
          side === 'left' &&
            'inset-y-0 left-0 h-full w-[min(100vw,280px)] border-r',
          className,
        )}
        {...props}
      >
        {side === 'bottom' ? (
          <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-muted" />
        ) : null}
        {children}
      </DrawerPrimitive.Content>
    </AppDrawerPortal>
  );
}

export function AppDrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('grid gap-1 p-4', className)} {...props} />;
}

export function AppDrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      className={cn('text-[15px] font-semibold text-foreground', className)}
      {...props}
    />
  );
}

export function AppDrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      className={cn('text-[13px] text-muted-foreground', className)}
      {...props}
    />
  );
}
