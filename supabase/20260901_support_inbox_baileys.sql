-- Persistent client/admin support inbox with WhatsApp notification outbox.
-- Apply after 20260831_finance_notifications_chariow.sql.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.support_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assigned_admin_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  subject text NOT NULL DEFAULT 'Support Henshin'
    CHECK (char_length(btrim(subject)) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  whatsapp_number text CHECK (
    whatsapp_number IS NULL OR whatsapp_number ~ '^\+[1-9][0-9]{7,14}$'
  ),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_client_message_at timestamptz,
  last_admin_message_at timestamptz,
  client_read_at timestamptz,
  admin_read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.support_threads(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('client', 'admin', 'system')),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  channel text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'whatsapp')),
  whatsapp_delivery_status text NOT NULL DEFAULT 'not_requested'
    CHECK (whatsapp_delivery_status IN ('not_requested', 'queued', 'sent', 'failed')),
  whatsapp_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_threads_status_last_message_idx
  ON public.support_threads (status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS support_threads_user_last_message_idx
  ON public.support_threads (user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS support_messages_thread_created_idx
  ON public.support_messages (thread_id, created_at ASC);
CREATE UNIQUE INDEX IF NOT EXISTS support_threads_one_active_per_user_idx
  ON public.support_threads (user_id)
  WHERE status IN ('open', 'pending');

ALTER TABLE public.support_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_threads, public.support_messages FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.support_send_client_message(
  p_user_id uuid,
  p_body text,
  p_thread_id uuid DEFAULT NULL,
  p_whatsapp_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_thread public.support_threads%ROWTYPE;
  v_message public.support_messages%ROWTYPE;
  v_email text;
  v_body text := btrim(COALESCE(p_body, ''));
  v_phone text := NULLIF(btrim(COALESCE(p_whatsapp_number, '')), '');
BEGIN
  IF char_length(v_body) < 1 OR char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'Support message must contain between 1 and 4000 characters'
      USING ERRCODE = '22023';
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'WhatsApp number must use E.164 format' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_email FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Support user not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_thread_id IS NOT NULL THEN
    SELECT * INTO v_thread FROM public.support_threads
    WHERE id = p_thread_id AND user_id = p_user_id AND status <> 'closed'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Support thread not found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    SELECT * INTO v_thread FROM public.support_threads
    WHERE user_id = p_user_id AND status IN ('open', 'pending')
    ORDER BY last_message_at DESC LIMIT 1 FOR UPDATE;
  END IF;

  IF v_thread.id IS NULL THEN
    BEGIN
      INSERT INTO public.support_threads (
        user_id, whatsapp_number, last_client_message_at, admin_read_at
      ) VALUES (p_user_id, v_phone, now(), NULL)
      RETURNING * INTO v_thread;
    EXCEPTION WHEN unique_violation THEN
      SELECT * INTO v_thread FROM public.support_threads
      WHERE user_id = p_user_id AND status IN ('open', 'pending')
      ORDER BY last_message_at DESC LIMIT 1 FOR UPDATE;
    END;
  END IF;

  INSERT INTO public.support_messages (thread_id, sender_id, sender_role, body)
  VALUES (v_thread.id, p_user_id, 'client', v_body)
  RETURNING * INTO v_message;

  UPDATE public.support_threads SET
    status = 'open',
    whatsapp_number = COALESCE(v_phone, whatsapp_number),
    last_message_at = v_message.created_at,
    last_client_message_at = v_message.created_at,
    admin_read_at = NULL,
    updated_at = now()
  WHERE id = v_thread.id
  RETURNING * INTO v_thread;

  INSERT INTO public.notification_outbox (
    event_type, severity, channel, destination, template_key, payload, dedupe_key
  ) VALUES (
    'support.client_message', 'info', 'whatsapp', '+237620124019',
    'support_client_message',
    jsonb_build_object(
      'threadId', v_thread.id,
      'messageId', v_message.id,
      'userId', p_user_id,
      'clientEmail', v_email,
      'message', v_body
    ),
    'support.client_message:' || v_message.id::text
  ) ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN jsonb_build_object('thread', to_jsonb(v_thread), 'message', to_jsonb(v_message));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reply_support_thread(
  p_admin_id uuid,
  p_thread_id uuid,
  p_body text,
  p_notify_whatsapp boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_thread public.support_threads%ROWTYPE;
  v_message public.support_messages%ROWTYPE;
  v_body text := btrim(COALESCE(p_body, ''));
BEGIN
  IF NOT public.is_admin_user_id(p_admin_id) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'Support reply must contain between 1 and 4000 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_thread FROM public.support_threads
  WHERE id = p_thread_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Support thread not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.support_messages (
    thread_id, sender_id, sender_role, body, whatsapp_delivery_status
  ) VALUES (
    v_thread.id, p_admin_id, 'admin', v_body,
    CASE WHEN p_notify_whatsapp AND v_thread.whatsapp_number IS NOT NULL
      THEN 'queued' ELSE 'not_requested' END
  ) RETURNING * INTO v_message;

  UPDATE public.support_threads SET
    assigned_admin_id = COALESCE(assigned_admin_id, p_admin_id),
    status = 'pending',
    last_message_at = v_message.created_at,
    last_admin_message_at = v_message.created_at,
    client_read_at = NULL,
    admin_read_at = now(),
    updated_at = now()
  WHERE id = v_thread.id
  RETURNING * INTO v_thread;

  IF p_notify_whatsapp AND v_thread.whatsapp_number IS NOT NULL THEN
    INSERT INTO public.notification_outbox (
      event_type, severity, channel, destination, template_key, payload, dedupe_key
    ) VALUES (
      'support.admin_reply', 'info', 'whatsapp', v_thread.whatsapp_number,
      'support_admin_reply',
      jsonb_build_object(
        'threadId', v_thread.id,
        'messageId', v_message.id,
        'userId', v_thread.user_id,
        'message', v_body
      ),
      'support.admin_reply:' || v_message.id::text
    ) ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  INSERT INTO public.admin_audit_log (
    actor_user_id, target_user_id, action, entity_type, entity_id, reason, after_state
  ) VALUES (
    p_admin_id, v_thread.user_id, 'support.reply', 'support_thread', v_thread.id,
    'Support reply sent',
    jsonb_build_object('messageId', v_message.id, 'notifyWhatsApp', p_notify_whatsapp)
  );

  RETURN jsonb_build_object('thread', to_jsonb(v_thread), 'message', to_jsonb(v_message));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_support_thread(
  p_admin_id uuid,
  p_thread_id uuid,
  p_status text,
  p_priority text,
  p_reason text
)
RETURNS public.support_threads
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_before public.support_threads%ROWTYPE;
  v_after public.support_threads%ROWTYPE;
BEGIN
  IF NOT public.is_admin_user_id(p_admin_id) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('open', 'pending', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'Invalid support status' USING ERRCODE = '22023';
  END IF;
  IF p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'Invalid support priority' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'An audit reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_before FROM public.support_threads
  WHERE id = p_thread_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Support thread not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.support_threads SET
    status = p_status,
    priority = p_priority,
    assigned_admin_id = COALESCE(assigned_admin_id, p_admin_id),
    updated_at = now()
  WHERE id = p_thread_id
  RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_log (
    actor_user_id, target_user_id, action, entity_type, entity_id, reason,
    before_state, after_state
  ) VALUES (
    p_admin_id, v_after.user_id, 'support.thread.update', 'support_thread', v_after.id,
    btrim(p_reason), to_jsonb(v_before), to_jsonb(v_after)
  );

  RETURN v_after;
END;
$$;

REVOKE ALL ON FUNCTION public.support_send_client_message(uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_reply_support_thread(uuid, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_support_thread(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_send_client_message(uuid, text, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_reply_support_thread(uuid, uuid, text, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_support_thread(uuid, uuid, text, text, text)
  TO service_role;

COMMIT;
