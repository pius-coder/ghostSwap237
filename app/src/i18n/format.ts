import type { AppLocale } from './locale';

export function formatNumber(value: number, locale: AppLocale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', options).format(value);
}

export function formatCredits(value: number, locale: AppLocale): string {
  return formatNumber(Math.trunc(value), locale, { maximumFractionDigits: 0 });
}

export function formatDuration(totalSeconds: number, locale: AppLocale): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (locale === 'fr') {
    if (hours > 0) return `${hours} h ${minutes} min`;
    if (minutes > 0) return `${minutes} min ${remainingSeconds} s`;
    return `${remainingSeconds} s`;
  }
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${remainingSeconds} s`;
  return `${remainingSeconds} s`;
}

export function formatDurationFromCredits(
  credits: number,
  creditsPerSecond: number,
  locale: AppLocale,
): string {
  const rate = creditsPerSecond > 0 ? creditsPerSecond : 1;
  return formatDuration(Math.floor(credits / rate), locale);
}

export function formatCurrency(
  amount: number,
  currency: 'XAF' | 'USD',
  locale: AppLocale,
): string {
  if (currency === 'XAF') {
    return `${formatNumber(Math.round(amount), locale, { maximumFractionDigits: 0 })} XAF`;
  }
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDateTime(value: string | number | Date, locale: AppLocale): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
