import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { AppButton, AppSurface, IconButton } from '@/components/app';

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!open) return null;

  const resolvedConfirm = confirmLabel ?? t('common.continue');
  const resolvedCancel = cancelLabel ?? t('common.cancel');

  return (
    <div
      className="app-region-no-drag fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onClick={busy ? undefined : onClose}
    >
      <AppSurface
        elevated
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-body"
        className="w-full max-w-md p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4">
          <h2 id="confirm-dialog-title" className="text-[15px] font-semibold text-foreground">
            {title}
          </h2>
          <IconButton label={t('common.close')} disabled={busy} onClick={onClose}>
            <X />
          </IconButton>
        </div>
        <p id="confirm-dialog-body" className="px-5 pb-4 text-[13px] leading-snug text-muted-foreground">
          {body}
        </p>
        <div className="flex justify-end gap-2 px-5 pb-5">
          <AppButton variant="ghost" disabled={busy} onClick={onClose}>
            {resolvedCancel}
          </AppButton>
          <AppButton disabled={busy} loading={busy} onClick={onConfirm}>
            {busy ? t('common.working') : resolvedConfirm}
          </AppButton>
        </div>
      </AppSurface>
    </div>
  );
}
