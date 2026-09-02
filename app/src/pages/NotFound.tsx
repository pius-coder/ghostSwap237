import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppButton } from '@/components/app';
import { Home, ArrowLeft } from 'lucide-react';
import { ROUTES } from '@/lib/routes';

function NotFound() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <p className="mb-2 text-5xl font-semibold tabular-nums text-muted-foreground">404</p>
      <h1 className="mb-2 text-xl font-semibold text-foreground">{t('notFound.title')}</h1>
      <p className="mb-8 max-w-md text-[13px] text-muted-foreground">{t('notFound.body')}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <AppButton onClick={() => navigate(ROUTES.PROTECTED.DASHBOARD)}>
          <Home className="size-4" />
          {t('notFound.home')}
        </AppButton>
        <AppButton variant="secondary" onClick={() => window.history.back()}>
          <ArrowLeft className="size-4" />
          {t('notFound.goBack')}
        </AppButton>
      </div>
    </div>
  );
}

export default NotFound;
