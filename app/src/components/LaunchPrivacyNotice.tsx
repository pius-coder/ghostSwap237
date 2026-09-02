import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AppButton } from '@/components/app';
import { LegalDocuments } from '@/components/LegalDocuments';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

/** Shown on each app launch only after authentication and completed onboarding. */
export function LaunchPrivacyNotice() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [gate, setGate] = useState<{ userId: string; allowed: boolean } | null>(null);
  const [open, setOpen] = useState(() => sessionStorage.getItem('henshin-launch-privacy-shown') !== '1');

  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;
    let cancelled = false;
    void supabase.rpc('get_own_onboarding_status').then(({ data }) => {
      if (!cancelled) setGate({ userId, allowed: data?.required === false });
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const close = () => {
    sessionStorage.setItem('henshin-launch-privacy-shown', '1');
    setOpen(false);
  };

  const allowed = Boolean(user?.id && gate?.userId === user.id && gate.allowed);
  if (!allowed || !user) return null;

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-h-[92vh] sm:max-w-2xl"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('legal.launchTitle')}</DialogTitle>
          <DialogDescription>{t('legal.launchBody')}</DialogDescription>
        </DialogHeader>
        <div className="custom-scrollbar max-h-[60vh] overflow-y-auto rounded-lg border border-white/[0.08] p-4">
          <LegalDocuments />
        </div>
        <AppButton onClick={close}>{t('legal.launchAck')}</AppButton>
      </DialogContent>
    </Dialog>
  );
}
