-- Onboarding preferences, bilingual legal localizations, and completion RPC.
-- Follow-up to 20260831_legal_acceptance.sql. Do NOT apply in production from this task.

BEGIN;

CREATE TABLE IF NOT EXISTS public.onboarding_versions (
  version integer PRIMARY KEY CHECK (version > 0),
  is_current boolean NOT NULL DEFAULT false,
  effective_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_one_current_idx
  ON public.onboarding_versions ((1))
  WHERE is_current;

INSERT INTO public.onboarding_versions (version, is_current, effective_at)
VALUES (1, true, '2026-09-01T00:00:00Z')
ON CONFLICT (version) DO UPDATE SET is_current = EXCLUDED.is_current;

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  locale text NOT NULL CHECK (locale IN ('fr', 'en')),
  onboarding_version integer REFERENCES public.onboarding_versions(version),
  onboarding_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_preferences FROM PUBLIC, anon;
GRANT SELECT ON public.user_preferences TO authenticated;

DROP POLICY IF EXISTS user_preferences_select_own ON public.user_preferences;
CREATE POLICY user_preferences_select_own
  ON public.user_preferences FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.legal_document_localizations (
  document_type text NOT NULL CHECK (document_type IN ('terms', 'privacy')),
  version text NOT NULL,
  locale text NOT NULL CHECK (locale IN ('fr', 'en')),
  content_sha256 text NOT NULL CHECK (char_length(content_sha256) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_type, version, locale),
  FOREIGN KEY (document_type, version)
    REFERENCES public.legal_document_versions(document_type, version)
    ON DELETE RESTRICT
);

ALTER TABLE public.legal_document_localizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read legal localizations"
  ON public.legal_document_localizations FOR SELECT USING (true);

ALTER TABLE public.legal_acceptances
  ADD COLUMN IF NOT EXISTS terms_content_sha256 text,
  ADD COLUMN IF NOT EXISTS privacy_content_sha256 text;

INSERT INTO public.legal_document_localizations (document_type, version, locale, content_sha256)
VALUES
  ('terms', '2026-08-31', 'en', '9d015f72e47a8b3a7a99c3b2b8db33a658b74fe9a4004cf67df34113700cf7b1'),
  ('privacy', '2026-08-31', 'en', '15f754338e06678b67d133033033a1c50ec92fc7ca3e902e893127857421a737'),
  ('terms', '2026-08-31', 'fr', 'a5972695d1c7e3f3bf37923c66f1793839e523180dfbe345d72b7f3300006e29'),
  ('privacy', '2026-08-31', 'fr', '93b7ddb7d24e257e8cb5301f7b048d2110052261d0f2c6d161fed4cf7df4b751')
ON CONFLICT (document_type, version, locale) DO UPDATE
SET content_sha256 = EXCLUDED.content_sha256;

-- Keep document-level hash columns for compatibility; prefer localization hashes for new acceptances.
UPDATE public.legal_document_versions
SET content_sha256 = CASE document_type
  WHEN 'terms' THEN '9d015f72e47a8b3a7a99c3b2b8db33a658b74fe9a4004cf67df34113700cf7b1'
  WHEN 'privacy' THEN '15f754338e06678b67d133033033a1c50ec92fc7ca3e902e893127857421a737'
  ELSE content_sha256
END
WHERE version = '2026-08-31';

CREATE OR REPLACE FUNCTION public.set_own_locale(p_locale text)
RETURNS public.user_preferences
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_locale text := lower(trim(p_locale));
  v_row public.user_preferences%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_locale NOT IN ('fr', 'en') THEN
    RAISE EXCEPTION 'Locale must be fr or en' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.user_preferences (user_id, locale, updated_at)
  VALUES (v_user_id, v_locale, now())
  ON CONFLICT (user_id) DO UPDATE
  SET locale = EXCLUDED.locale,
      updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_own_onboarding_status()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_current integer;
  v_terms text;
  v_privacy text;
  v_prefs public.user_preferences%ROWTYPE;
  v_legal_ok boolean := false;
  v_required boolean := true;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT version INTO v_current FROM public.onboarding_versions WHERE is_current LIMIT 1;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'No current onboarding version' USING ERRCODE = 'P0001';
  END IF;

  SELECT version INTO v_terms FROM public.legal_document_versions WHERE document_type = 'terms' AND is_current;
  SELECT version INTO v_privacy FROM public.legal_document_versions WHERE document_type = 'privacy' AND is_current;
  SELECT * INTO v_prefs FROM public.user_preferences WHERE user_id = v_user_id;

  SELECT EXISTS (
    SELECT 1 FROM public.legal_acceptances a
    WHERE a.user_id = v_user_id
      AND a.terms_version = v_terms
      AND a.privacy_version = v_privacy
  ) INTO v_legal_ok;

  v_required := v_prefs.user_id IS NULL
    OR v_prefs.onboarding_version IS NULL
    OR v_prefs.onboarding_completed_at IS NULL
    OR v_prefs.onboarding_version < v_current;

  RETURN jsonb_build_object(
    'required', v_required,
    'currentOnboardingVersion', v_current,
    'userOnboardingVersion', v_prefs.onboarding_version,
    'locale', v_prefs.locale,
    'onboardingCompletedAt', v_prefs.onboarding_completed_at,
    'termsVersion', v_terms,
    'privacyVersion', v_privacy,
    'legalAccepted', v_legal_ok,
    'legalGateRequired', (NOT v_required) AND (NOT v_legal_ok)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_current_onboarding(
  p_locale text,
  p_app_version text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_locale text := lower(trim(p_locale));
  v_current integer;
  v_terms text;
  v_privacy text;
  v_terms_hash text;
  v_privacy_hash text;
  v_prefs public.user_preferences%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_locale NOT IN ('fr', 'en') THEN
    RAISE EXCEPTION 'Locale must be fr or en' USING ERRCODE = '22023';
  END IF;

  SELECT version INTO v_current FROM public.onboarding_versions WHERE is_current LIMIT 1;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'No current onboarding version' USING ERRCODE = 'P0001';
  END IF;

  SELECT version INTO v_terms FROM public.legal_document_versions WHERE document_type = 'terms' AND is_current;
  SELECT version INTO v_privacy FROM public.legal_document_versions WHERE document_type = 'privacy' AND is_current;
  IF v_terms IS NULL OR v_privacy IS NULL THEN
    RAISE EXCEPTION 'Current legal documents are missing' USING ERRCODE = 'P0001';
  END IF;

  SELECT content_sha256 INTO v_terms_hash
  FROM public.legal_document_localizations
  WHERE document_type = 'terms' AND version = v_terms AND locale = v_locale;
  SELECT content_sha256 INTO v_privacy_hash
  FROM public.legal_document_localizations
  WHERE document_type = 'privacy' AND version = v_privacy AND locale = v_locale;
  IF v_terms_hash IS NULL OR v_privacy_hash IS NULL THEN
    RAISE EXCEPTION 'Legal localization hashes are missing' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.legal_acceptances (
    user_id, terms_version, privacy_version, accepted_terms, acknowledged_privacy,
    app_version, locale, user_agent, terms_content_sha256, privacy_content_sha256
  ) VALUES (
    v_user_id, v_terms, v_privacy, true, true,
    left(p_app_version, 100), v_locale, left(p_user_agent, 500),
    v_terms_hash, v_privacy_hash
  )
  ON CONFLICT (user_id, terms_version, privacy_version) DO NOTHING;

  INSERT INTO public.user_preferences (
    user_id, locale, onboarding_version, onboarding_completed_at, updated_at
  ) VALUES (
    v_user_id, v_locale, v_current, now(), now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET locale = EXCLUDED.locale,
      onboarding_version = EXCLUDED.onboarding_version,
      onboarding_completed_at = CASE
        WHEN public.user_preferences.onboarding_version IS NOT DISTINCT FROM EXCLUDED.onboarding_version
          AND public.user_preferences.onboarding_completed_at IS NOT NULL
        THEN public.user_preferences.onboarding_completed_at
        ELSE EXCLUDED.onboarding_completed_at
      END,
      updated_at = now()
  RETURNING * INTO v_prefs;

  RETURN jsonb_build_object(
    'ok', true,
    'locale', v_prefs.locale,
    'onboardingVersion', v_prefs.onboarding_version,
    'onboardingCompletedAt', v_prefs.onboarding_completed_at,
    'termsVersion', v_terms,
    'privacyVersion', v_privacy,
    'termsContentSha256', v_terms_hash,
    'privacyContentSha256', v_privacy_hash
  );
END;
$$;

-- Update accept_current_legal_documents to store localized hashes when locale is fr/en.
CREATE OR REPLACE FUNCTION public.accept_current_legal_documents(
  p_app_version text DEFAULT NULL,
  p_locale text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_terms text;
  v_privacy text;
  v_locale text := lower(left(COALESCE(p_locale, 'en'), 50));
  v_terms_hash text;
  v_privacy_hash text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF v_locale NOT IN ('fr', 'en') THEN v_locale := 'en'; END IF;
  SELECT version INTO v_terms FROM public.legal_document_versions WHERE document_type = 'terms' AND is_current;
  SELECT version INTO v_privacy FROM public.legal_document_versions WHERE document_type = 'privacy' AND is_current;
  SELECT content_sha256 INTO v_terms_hash FROM public.legal_document_localizations
    WHERE document_type = 'terms' AND version = v_terms AND locale = v_locale;
  SELECT content_sha256 INTO v_privacy_hash FROM public.legal_document_localizations
    WHERE document_type = 'privacy' AND version = v_privacy AND locale = v_locale;
  INSERT INTO public.legal_acceptances (
    user_id, terms_version, privacy_version, accepted_terms, acknowledged_privacy,
    app_version, locale, user_agent, terms_content_sha256, privacy_content_sha256
  ) VALUES (
    v_user_id, v_terms, v_privacy, true, true, left(p_app_version, 100),
    v_locale, left(p_user_agent, 500), v_terms_hash, v_privacy_hash
  ) ON CONFLICT (user_id, terms_version, privacy_version) DO NOTHING;
  RETURN jsonb_build_object('accepted', true, 'termsVersion', v_terms, 'privacyVersion', v_privacy, 'locale', v_locale);
END;
$$;

REVOKE ALL ON FUNCTION public.set_own_locale(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_own_onboarding_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_current_onboarding(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_own_locale(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_own_onboarding_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_current_onboarding(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_current_legal_documents(text, text, text) TO authenticated;

ALTER TABLE public.onboarding_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read onboarding versions"
  ON public.onboarding_versions FOR SELECT USING (true);

COMMIT;
