import { useTranslation } from 'react-i18next';

export default function LoadingScreen() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="size-12 animate-spin rounded-full border-4 border-foreground border-t-transparent"></div>
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </div>
    </div>
  );
}
