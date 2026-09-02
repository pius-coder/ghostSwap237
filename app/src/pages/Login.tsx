import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { LegalDocuments } from '@/components/LegalDocuments';
import { Loader2, Eye, EyeOff, MailCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { AppButton, AppSurface, FieldGroup, IconButton, PublicScene } from '@/components/app';
import { useAuth } from '@/context/AuthContext';
import { ROUTES } from '@/lib/routes';
import { toast } from 'sonner';
import { useLocalePreference } from '@/i18n/useLocalePreference';

function Login() {
  const { t } = useTranslation();
  const { locale } = useLocalePreference();
  const { login, loginWithGoogle, register, loading, error, clearError } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isLogin = location.pathname !== ROUTES.PUBLIC.SIGNUP;
  const verificationEmail = (location.state as { verificationEmail?: string } | null)?.verificationEmail;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [legalAck, setLegalAck] = useState({ locale, scrolled: false, accepted: false });
  if (legalAck.locale !== locale) {
    setLegalAck({ locale, scrolled: false, accepted: false });
  }
  const legalScrolled = legalAck.scrolled;
  const legalAccepted = legalAck.accepted;

  useEffect(() => {
    if (error) {
      toast.error(error);
      clearError();
    }
  }, [error, clearError]);

  useEffect(() => {
    clearError();
  }, [clearError, isLogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isLogin) {
        await login(email, password);
        toast.success(t('auth.welcomeBack'));
      } else {
        if (!legalScrolled || !legalAccepted) throw new Error(t('auth.legalRequired'));
        const result = await register(email, name, password);
        if (result.requiresEmailConfirmation) {
          navigate(ROUTES.PUBLIC.LOGIN, {
            replace: true,
            state: { verificationEmail: email },
          });
        } else {
          toast.success(t('auth.createAccount'));
        }
      }
    } catch {
      // Error is handled by the auth context and shown via toast
    }
  };

  const toggleMode = () => {
    clearError();
    navigate(isLogin ? ROUTES.PUBLIC.SIGNUP : ROUTES.PUBLIC.LOGIN);
  };

  const handleGoogleLogin = async () => {
    try {
      if (!isLogin && (!legalScrolled || !legalAccepted)) {
        toast.error(t('auth.legalRequired'));
        return;
      }
      await loginWithGoogle();
    } catch {
      // Error is handled by the auth context and shown via toast
    }
  };

  const handleLegalScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 12) {
      setLegalAck((prev) => ({ ...prev, scrolled: true }));
    }
  };

  return (
    <PublicScene>
      <div className="w-full">
        <div className="mb-6 flex items-center gap-3 lg:hidden">
          <div className="flex size-9 items-center justify-center overflow-hidden rounded-lg bg-surface-elevated">
            <img src="./logo.png" alt="" className="size-full object-cover" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-foreground">
            {t('common.appName')}
          </span>
        </div>

        <AppSurface elevated className="public-form-panel p-5 sm:p-6">
          <h1 className="mb-6 text-left text-xl font-semibold tracking-tight text-foreground">
            {verificationEmail
              ? t('auth.confirmEmailTitle')
              : isLogin
                ? t('auth.signIn')
                : t('auth.createAccount')}
          </h1>

          {verificationEmail ? (
            <div className="text-center">
              <div className="mx-auto flex size-14 items-center justify-center rounded-lg bg-white/[0.06]">
                <MailCheck className="size-7 text-success" />
              </div>
              <p className="mt-4 text-[13px] leading-6 text-muted-foreground">
                {t('auth.confirmEmailBody', { email: verificationEmail })}
              </p>
              <AppButton
                type="button"
                className="mt-6 w-full"
                onClick={() => navigate(ROUTES.PUBLIC.LOGIN, { replace: true, state: null })}
              >
                {t('auth.signIn')}
              </AppButton>
            </div>
          ) : (
            <>
              <AppButton
                type="button"
                variant="secondary"
                className="mb-5 w-full"
                disabled={loading}
                onClick={() => void handleGoogleLogin()}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
                  <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z" />
                  <path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.43l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
                  <path fill="#FBBC05" d="M6.39 13.86A6.01 6.01 0 0 1 6.08 12c0-.65.11-1.28.31-1.86V7.52H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.48l3.35-2.62Z" />
                  <path fill="#EA4335" d="M12 6.01c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.52l3.35 2.62C7.18 7.77 9.39 6.01 12 6.01Z" />
                </svg>
                {t('auth.continueWithGoogle')}
              </AppButton>

              <div className="mb-5 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-white/[0.08]" />
                <span>{t('auth.orEmail')}</span>
                <span className="h-px flex-1 bg-white/[0.08]" />
              </div>

              <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
                {!isLogin && (
                  <FieldGroup label={t('auth.name')}>
                    <Input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="h-9"
                      disabled={loading}
                      required={!isLogin}
                    />
                  </FieldGroup>
                )}
                <FieldGroup label={t('auth.email')}>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-9"
                    disabled={loading}
                    required
                  />
                </FieldGroup>
                <FieldGroup label={t('auth.password')}>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-9 pr-10"
                      disabled={loading}
                      required
                      minLength={6}
                    />
                    <IconButton
                      label={showPassword ? t('common.close') : t('auth.password')}
                      variant="ghost"
                      className="absolute right-1 top-1/2 size-8 -translate-y-1/2"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </IconButton>
                  </div>
                </FieldGroup>
                {!isLogin && (
                  <div className="space-y-3 rounded-lg border border-white/[0.08] p-3">
                    <p className="text-[13px] font-medium text-foreground">{t('auth.legalTitle')}</p>
                    <div
                      onScroll={handleLegalScroll}
                      className="custom-scrollbar h-52 overflow-y-auto rounded-lg border border-white/[0.08] p-3"
                    >
                      <LegalDocuments locale={locale} />
                    </div>
                    <label className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        disabled={!legalScrolled}
                        checked={legalAccepted}
                        onCheckedChange={(value) =>
                          setLegalAck((prev) => ({ ...prev, accepted: value === true }))
                        }
                      />
                      <span>{t('auth.legalCheckbox')}</span>
                    </label>
                  </div>
                )}
                <AppButton
                  type="submit"
                  className="w-full"
                  loading={loading}
                  disabled={!isLogin && (!legalScrolled || !legalAccepted)}
                >
                  {loading
                    ? isLogin
                      ? t('auth.signingIn')
                      : t('auth.creating')
                    : isLogin
                      ? t('auth.signIn')
                      : t('auth.createAccount')}
                </AppButton>
              </form>

              <div className="mt-6 text-center text-[13px] text-muted-foreground">
                {isLogin ? t('auth.noAccount') : t('auth.hasAccount')}{' '}
                <button
                  type="button"
                  onClick={toggleMode}
                  disabled={loading}
                  className="font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50"
                >
                  {isLogin ? t('auth.createAccount') : t('auth.signIn')}
                </button>
              </div>
            </>
          )}
        </AppSurface>
      </div>
    </PublicScene>
  );
}

export default Login;
