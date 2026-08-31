import { useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { TextureButton } from '@/components/ui/texture-button';
import { LegalDocuments, PRIVACY_VERSION, TERMS_VERSION } from '@/components/LegalDocuments';

export function LegalGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [required, setRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const checkedUser = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || checkedUser.current === user.id) return;
    checkedUser.current = user.id;
    void supabase.from('legal_acceptances').select('id').eq('user_id', user.id)
      .eq('terms_version', TERMS_VERSION).eq('privacy_version', PRIVACY_VERSION).maybeSingle()
      .then(({ data, error }) => setRequired(Boolean(error || !data)));
  }, [user?.id]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 12) setScrolled(true);
  };
  const confirm = async () => {
    setLoading(true);
    const { error } = await supabase.rpc('accept_current_legal_documents', {
      p_app_version: import.meta.env.VITE_APP_VERSION || 'desktop',
      p_locale: navigator.language,
      p_user_agent: navigator.userAgent,
    });
    setLoading(false);
    if (!error) setRequired(false);
  };

  return <>{children}<Dialog open={required}><DialogContent className="max-h-[92vh] sm:max-w-2xl" onEscapeKeyDown={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()}><DialogHeader><DialogTitle>Terms and privacy acknowledgement required</DialogTitle><DialogDescription>Scroll to the end, then explicitly accept before using Henshin.</DialogDescription></DialogHeader><div onScroll={onScroll} className="custom-scrollbar max-h-[55vh] overflow-y-auto rounded-lg border border-border p-4"><LegalDocuments /></div><label className="flex items-start gap-3 text-sm"><Checkbox checked={accepted} disabled={!scrolled} onCheckedChange={(value) => setAccepted(value === true)} /><span>I accept the Terms of Use and acknowledge that I received the Privacy Notice.</span></label><TextureButton disabled={!scrolled || !accepted || loading} onClick={() => void confirm()}>{loading && <Loader2 className="size-4 animate-spin" />} Continue</TextureButton></DialogContent></Dialog></>;
}
