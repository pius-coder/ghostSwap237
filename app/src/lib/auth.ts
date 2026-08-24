import { ROUTES } from '@/lib/routes';

export function buildHashRouteUrl(path: string): string {
  if (typeof window === 'undefined') {
    return path;
  }

  if (!import.meta.env.DEV && path === ROUTES.PUBLIC.LOGIN) {
    return 'henshin://auth-callback';
  }

  return `${window.location.origin}${window.location.pathname}#${path}`;
}

export function normalizeRedirectPath(path?: string | null): string {
  if (!path || !path.startsWith('/') || path.startsWith('//')) {
    return ROUTES.DEFAULT;
  }

  return path;
}
