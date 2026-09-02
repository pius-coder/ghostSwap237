import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Globe2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AppButton, AppSurface, IconButton } from '@/components/app';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api-client';
import { formatCredits, formatCurrency } from '@/i18n/format';
import { useLocalePreference } from '@/i18n/useLocalePreference';
import { isValidPhoneNumber, parsePhoneNumberFromString } from 'libphonenumber-js/max';

const COUNTRY_CODES = ['CM', 'FR', 'US', 'GB', 'DE', 'CA', 'BE', 'CH', 'SN', 'CI'] as const;

export interface ChariowPlan {
  id: string;
  name?: string;
  credits: number;
  priceUsd: number;
}

interface ChariowCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: ChariowPlan | null;
}

function translateApiError(message: string | undefined, t: (key: string) => string, fallback: string): string {
  if (!message) return fallback;
  const key = `errors.${message}`;
  const translated = t(key);
  return translated === key ? message : translated;
}

export function ChariowCheckoutModal({ isOpen, onClose, plan }: ChariowCheckoutModalProps) {
  const { t } = useTranslation();
  const { locale } = useLocalePreference();
  const { user } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [countryCode, setCountryCode] = useState('CM');
  const [phone, setPhone] = useState('');
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !user?.id) return;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setLoadingProfile(true);
      try {
        const response = await apiFetch(`/wallet?action=payment-profile&userId=${encodeURIComponent(user.id)}`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok || cancelled) return;
        const profile = result.profile;
        if (!profile) return;
        setFirstName(profile.firstName || '');
        setLastName(profile.lastName || '');
        setCountryCode(profile.countryCode || 'CM');
        if (profile.phoneE164) {
          const parsed = parsePhoneNumberFromString(profile.phoneE164);
          setPhone(parsed?.formatNational() || profile.phoneE164);
        }
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, user?.id]);

  if (!isOpen || !plan || !user) return null;

  const handlePay = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error(t('payments.needNames'));
      return;
    }
    if (!isValidPhoneNumber(phone, countryCode as 'CM')) {
      toast.error(t('payments.invalidPhone'));
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiFetch('/wallet?action=chariow-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: plan.id,
          userId: user.id,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          countryCode,
          phone,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(translateApiError(result.error, t, t('payments.chariowUnavailable')));
      }
      if (result.step === 'payment' && result.link) {
        toast.success(t('payments.openingChariow'));
        window.open(String(result.link), '_blank', 'noopener,noreferrer');
        onClose();
        return;
      }
      if (result.step === 'completed' && result.paymentId) {
        window.location.hash = `#/payment-success?provider=chariow&ref=${encodeURIComponent(result.paymentId)}`;
        onClose();
        return;
      }
      throw new Error(t('payments.chariowIncomplete'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('payments.chariowUnavailable'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe2 className="size-5 text-primary" />
            {t('payments.chariowTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('payments.chariowDescription', {
              name: plan.name || t('payments.creditPack'),
              credits: formatCredits(plan.credits, locale),
              price: formatCurrency(plan.priceUsd, 'USD', locale),
            })}
          </DialogDescription>
        </DialogHeader>

        {loadingProfile ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t('payments.loadingProfile')}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="chariow-first">{t('payments.firstName')}</Label>
                <Input id="chariow-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="chariow-last">{t('payments.lastName')}</Label>
                <Input id="chariow-last" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="chariow-country">{t('payments.country')}</Label>
              <select
                id="chariow-country"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
              >
                {COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>{t(`payments.countries.${code}`)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="chariow-phone">{t('payments.phone')}</Label>
              <Input
                id="chariow-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t('payments.phonePlaceholder')}
                autoComplete="tel"
              />
              <p className="text-xs text-muted-foreground">{t('payments.phoneHint')}</p>
            </div>
            <div className="flex gap-2 pt-2">
              <AppButton variant="ghost" className="flex-1" onClick={onClose} disabled={submitting}>{t('common.cancel')}</AppButton>
              <AppButton className="flex-1" disabled={submitting} onClick={() => void handlePay()}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {t('payments.continueChariow')}
              </AppButton>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
