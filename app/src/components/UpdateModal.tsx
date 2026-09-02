import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, Download, Rocket } from 'lucide-react';
import { AppButton } from '@/components/app';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { subscribeToDesktopUpdateState, installDesktopUpdate } from '@/lib/desktop-updater';
import { toast } from 'sonner';

export function UpdateModal() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToDesktopUpdateState((state) => {
      if (state.status === 'downloaded' && !isInstalling) {
        setIsOpen(true);
      }
    });

    return unsubscribe;
  }, [isInstalling]);

  const handleInstall = async () => {
    try {
      setIsInstalling(true);
      await installDesktopUpdate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('updates.installFailed'));
      setIsInstalling(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10">
            <Download className="size-6 text-primary" />
          </div>
          <DialogTitle className="text-center text-lg font-semibold tracking-tight">
            {t('updates.available')}
          </DialogTitle>
          <DialogDescription className="pt-2 text-center">
            {t('updates.readyBody')}
          </DialogDescription>
        </DialogHeader>

        <div className="my-2 flex items-start gap-3 rounded-lg border border-white/[0.08] bg-surface-elevated p-4">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="text-[13px] text-muted-foreground">
            <p className="mb-1 font-semibold text-foreground">{t('updates.defenderNote')}</p>
            {t('updates.defenderBody')}
            <br />
            <span className="font-medium text-primary">{t('updates.moreInfo')}</span>
            {' → '}
            <span className="font-medium text-primary">{t('updates.runAnyway')}</span>
          </div>
        </div>

        <DialogFooter className="mt-4 flex w-full flex-col gap-2 sm:flex-row sm:justify-between">
          <AppButton variant="ghost" onClick={() => setIsOpen(false)} className="sm:w-1/2">
            {t('updates.later')}
          </AppButton>
          <AppButton
            onClick={() => void handleInstall()}
            disabled={isInstalling}
            loading={isInstalling}
            className="sm:w-1/2"
          >
            {isInstalling ? (
              t('updates.launching')
            ) : (
              <>
                <Rocket className="size-4" />
                {t('updates.install')}
              </>
            )}
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
