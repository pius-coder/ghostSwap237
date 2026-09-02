import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/AuthContext';
import type { ReactNode } from 'react';
import { ROUTES } from '@/lib/routes';

interface RouteGuardProps {
  children: ReactNode;
  redirectTo?: string;
}

function RouteLoading() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="size-12 animate-spin rounded-full border-4 border-white/20 border-t-foreground" />
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      </div>
    </div>
  );
}

export function ProtectedRoute({ children, redirectTo }: RouteGuardProps) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <RouteLoading />;
  }

  if (!isAuthenticated) {
    return (
      <Navigate 
        to={redirectTo || ROUTES.PUBLIC.LOGIN} 
        state={{ from: location }} 
        replace 
      />
    );
  }

  return <>{children}</>;
}

export function PublicRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading, user } = useAuth();
  
  if (loading) {
    return <RouteLoading />;
  }

  if (isAuthenticated) {
    const redirectPath = user?.isAdmin ? ROUTES.PROTECTED.ADMIN_DASHBOARD : ROUTES.DEFAULT;
    return <Navigate to={redirectPath} replace />;
  }

  return <>{children}</>;
}

interface AuthGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function AuthGuard({ children, fallback }: AuthGuardProps) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return fallback || null;
  }

  if (!isAuthenticated) {
    return fallback || null;
  }

  return <>{children}</>;
}
