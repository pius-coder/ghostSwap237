import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Loader2, XCircle } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { AppButton, AppSurface, PublicScene } from '@/components/app';
import { ROUTES } from '@/lib/routes';
import { supabase } from '@/lib/supabase';

type CallbackState = 'loading' | 'success' | 'error';

function AuthCallback() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const code = searchParams.get('code');
  const providerError = searchParams.get('error_description') || searchParams.get('error');
  const invalidMessage = providerError || (!code ? t('auth.invalidLink') : '');
  const [state, setState] = useState<CallbackState>(invalidMessage ? 'error' : 'loading');
  const [message, setMessage] = useState(invalidMessage || t('auth.confirming'));

  useEffect(() => {
    if (!code || providerError) return;

    let active = true;
    void supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (!active) return;
      if (error) {
        setState('error');
        setMessage(error.message);
        return;
      }

      setState('success');
      setMessage(t('auth.confirmed'));
      window.setTimeout(() => navigate(ROUTES.DEFAULT, { replace: true }), 800);
    });

    return () => {
      active = false;
    };
  }, [code, navigate, providerError, t]);

  return (
    <PublicScene>
      <AppSurface elevated className="w-full max-w-md p-8 text-center">
        {state === 'loading' && <Loader2 className="mx-auto size-10 animate-spin text-foreground" />}
        {state === 'success' && <CheckCircle className="mx-auto size-10 text-success" />}
        {state === 'error' && <XCircle className="mx-auto size-10 text-destructive" />}
        <h1 className="mt-5 text-xl font-semibold text-foreground">{t('auth.callbackTitle')}</h1>
        <p className="mt-3 text-[13px] text-muted-foreground">{message}</p>
        {state === 'error' && (
          <AppButton className="mt-6 w-full" onClick={() => navigate(ROUTES.PUBLIC.LOGIN)}>
            {t('auth.returnToSignIn')}
          </AppButton>
        )}
      </AppSurface>
    </PublicScene>
  );
}

export default AuthCallback;
