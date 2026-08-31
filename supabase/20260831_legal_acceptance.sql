-- Versioned clickwrap evidence. Privacy acknowledgement and Terms acceptance
-- are recorded separately and cannot be edited or deleted.

CREATE TABLE IF NOT EXISTS public.legal_document_versions (
  document_type text NOT NULL CHECK (document_type IN ('terms', 'privacy')),
  version text NOT NULL,
  content_sha256 text NOT NULL,
  effective_at timestamptz NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  PRIMARY KEY (document_type, version)
);

INSERT INTO public.legal_document_versions (document_type, version, content_sha256, effective_at, is_current)
VALUES
  ('terms', '2026-08-31', 'a396b16d94c1963a9c29a7fb911baa8ec2844d59519c201a1e8c6dd690a0d030', '2026-08-31T00:00:00Z', true),
  ('privacy', '2026-08-31', 'a396b16d94c1963a9c29a7fb911baa8ec2844d59519c201a1e8c6dd690a0d030', '2026-08-31T00:00:00Z', true)
ON CONFLICT (document_type, version) DO UPDATE SET is_current = EXCLUDED.is_current;

CREATE UNIQUE INDEX IF NOT EXISTS legal_one_current_document_idx
  ON public.legal_document_versions (document_type) WHERE is_current;

CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  terms_version text NOT NULL,
  privacy_version text NOT NULL,
  accepted_terms boolean NOT NULL CHECK (accepted_terms),
  acknowledged_privacy boolean NOT NULL CHECK (acknowledged_privacy),
  app_version text,
  locale text,
  user_agent text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, terms_version, privacy_version)
);

CREATE OR REPLACE FUNCTION public.reject_legal_acceptance_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN RAISE EXCEPTION 'Legal acceptance evidence is immutable'; END;
$$;
DROP TRIGGER IF EXISTS legal_acceptances_immutable ON public.legal_acceptances;
CREATE TRIGGER legal_acceptances_immutable BEFORE UPDATE OR DELETE ON public.legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.reject_legal_acceptance_mutation();

ALTER TABLE public.legal_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read current legal documents" ON public.legal_document_versions
  FOR SELECT USING (is_current);
CREATE POLICY "Users can read own legal acceptances" ON public.legal_acceptances
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.accept_current_legal_documents(
  p_app_version text DEFAULT NULL, p_locale text DEFAULT NULL, p_user_agent text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user_id uuid := auth.uid(); v_terms text; v_privacy text; v_result public.legal_acceptances%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT version INTO v_terms FROM public.legal_document_versions WHERE document_type = 'terms' AND is_current;
  SELECT version INTO v_privacy FROM public.legal_document_versions WHERE document_type = 'privacy' AND is_current;
  INSERT INTO public.legal_acceptances (
    user_id, terms_version, privacy_version, accepted_terms, acknowledged_privacy,
    app_version, locale, user_agent
  ) VALUES (
    v_user_id, v_terms, v_privacy, true, true, left(p_app_version, 100),
    left(p_locale, 50), left(p_user_agent, 500)
  ) ON CONFLICT (user_id, terms_version, privacy_version) DO NOTHING
  RETURNING * INTO v_result;
  RETURN jsonb_build_object('accepted', true, 'termsVersion', v_terms, 'privacyVersion', v_privacy);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_current_legal_documents(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_current_legal_documents(text, text, text) TO authenticated;
