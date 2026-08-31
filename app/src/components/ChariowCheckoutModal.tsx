import { useEffect, useState } from 'react';
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
import { CosmicButton } from '@/components/ui/cosmic-button';
import { TextureButton } from '@/components/ui/texture-button';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api-client';
import { isValidPhoneNumber, parsePhoneNumberFromString } from 'libphonenumber-js/max';

const COUNTRIES = [
  { code: 'CM', label: 'Cameroon' },
  { code: 'FR', label: 'France' },
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Germany' },
  { code: 'CA', label: 'Canada' },
  { code: 'BE', label: 'Belgium' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'SN', label: 'Senegal' },
  { code: 'CI', label: "Côte d'Ivoire" },
] as const;

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

export function ChariowCheckoutModal({ isOpen, onClose, plan }: ChariowCheckoutModalProps) {
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
      toast.error('Enter your first and last name.');
      return;
    }
    if (!isValidPhoneNumber(phone, countryCode as 'CM')) {
      toast.error('Enter a valid phone number for the selected country.');
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
        throw new Error(result.error || 'International checkout is unavailable.');
      }
      if (result.step === 'payment' && result.link) {
        toast.success('Opening secure Chariow checkout...');
        window.open(String(result.link), '_blank', 'noopener,noreferrer');
        onClose();
        return;
      }
      if (result.step === 'completed' && result.paymentId) {
        window.location.hash = `#/payment-success?provider=chariow&ref=${encodeURIComponent(result.paymentId)}`;
        onClose();
        return;
      }
      throw new Error('Chariow returned an incomplete checkout.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'International checkout is unavailable.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md border-blue-500/20 bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe2 className="size-5 text-primary" />
            International payment
          </DialogTitle>
          <DialogDescription>
            {plan.name || 'Credit pack'} · {plan.credits.toLocaleString()} credits · ${plan.priceUsd.toLocaleString()} USD.
            Card details are entered only on Chariow&apos;s secure page.
          </DialogDescription>
        </DialogHeader>

        {loadingProfile ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading saved details…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="chariow-first">First name</Label>
                <Input id="chariow-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="chariow-last">Last name</Label>
                <Input id="chariow-last" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="chariow-country">Country</Label>
              <select
                id="chariow-country"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
              >
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>{country.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="chariow-phone">Phone</Label>
              <Input
                id="chariow-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="National or +E.164 number"
                autoComplete="tel"
              />
              <p className="text-xs text-muted-foreground">Stored as E.164 for future checkouts. Never enter card numbers here.</p>
            </div>
            <div className="flex gap-2 pt-2">
              <TextureButton variant="minimal" className="flex-1" onClick={onClose} disabled={submitting}>Cancel</TextureButton>
              <CosmicButton as="button" className="flex-1" contentClassName="min-h-11" disabled={submitting} onClick={() => void handlePay()}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                Continue to Chariow
              </CosmicButton>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
