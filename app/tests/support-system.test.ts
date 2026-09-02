import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const repo = join(import.meta.dir, '../..');
const read = (path: string) => Bun.file(join(repo, path)).text();

describe('persistent support inbox', () => {
  test('keeps support tables and RPCs behind the service role', async () => {
    const sql = await read('supabase/20260901_support_inbox_baileys.sql');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.support_threads');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.support_messages');
    expect(sql).toContain('support_threads_one_active_per_user_idx');
    expect(sql).toContain('REVOKE ALL ON public.support_threads, public.support_messages FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('public.support_send_client_message');
    expect(sql).toContain('public.admin_reply_support_thread');
    expect(sql).toContain('public.admin_update_support_thread');
    expect(sql).toContain('TO service_role');
    expect(sql).toContain("'support.client_message:' || v_message.id::text");
    expect(sql).toContain("'support.admin_reply:' || v_message.id::text");
    expect(sql).toContain("'support.reply', 'support_thread'");
  });

  test('authenticates client and admin support APIs', async () => {
    const supportApi = await read('app/server/support.ts');
    const adminApi = await read('app/server/admin.ts');
    const router = await read('app/api/pro.ts');
    expect(supportApi).toContain('await requireAuthUser(req)');
    expect(supportApi).toContain("rpc('support_send_client_message'");
    expect(supportApi).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(adminApi).toContain('await requireAdminUser(req)');
    expect(adminApi).toContain("action === 'support-reply'");
    expect(adminApi).toContain("rpc('admin_reply_support_thread'");
    expect(router).toContain('support,');
  });

  test('routes signed WhatsApp notifications to the isolated Baileys service', async () => {
    const dispatch = await read('app/server/notification-dispatch.ts');
    const gateway = await read('app/scripts/whatsapp-baileys-service.mjs');
    const env = await read('app/.env.example');
    expect(dispatch).toContain("row?.channel === 'whatsapp'");
    expect(dispatch).toContain('WHATSAPP_BAILEYS_URL');
    expect(dispatch).toContain('WHATSAPP_BAILEYS_SECRET');
    expect(gateway).toContain("createHmac('sha256'");
    expect(gateway).toContain('timingSafeEqual');
    expect(gateway).toContain('useMultiFileAuthState(authDir)');
    expect(gateway).toContain("app.post('/notifications'");
    expect(gateway).toContain("req.body?.channel !== 'whatsapp'");
    expect(env).not.toContain('VITE_WHATSAPP_BAILEYS_SECRET');
  });

  test('exposes the admin inbox and in-app client conversation', async () => {
    const admin = await read('app/src/pages/AdminDashboard.tsx');
    const widget = await read('app/src/components/studio/SessionBar.tsx');
    expect(admin).toContain('<TabsTrigger value="support">Support</TabsTrigger>');
    expect(admin).toContain('Boîte de réception support');
    expect(admin).toContain("action: 'support-reply'");
    expect(admin).toContain('Notifier aussi sur WhatsApp');
    expect(widget).toContain("apiFetch('/support'");
    expect(widget).toContain('session-support-message-list');
    expect(widget).not.toContain('window.open(`https://wa.me/');
  });
});
