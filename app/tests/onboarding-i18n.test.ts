import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { allLegalHashes } from '../src/i18n/legal/hash';
import { LEGAL_CONTENT_HASHES, LEGAL_VERSION, canonicalizeLegalDocument } from '../src/i18n/legal/documents';
import { ONBOARDING_VERSION } from '../src/i18n/locale';

const repo = join(import.meta.dir, '../..');
const read = (path: string) => Bun.file(join(repo, path)).text();

describe('legal bilingual hashes', () => {
  test('canonical hashes match constants and migration seeds', async () => {
    const sql = await read('supabase/20260901_onboarding_i18n.sql');
    for (const entry of allLegalHashes()) {
      expect(entry.sha256).toBe(entry.expected);
      expect(entry.sha256).toBe(LEGAL_CONTENT_HASHES[entry.locale][entry.documentType]);
      expect(sql).toContain(entry.sha256);
      expect(createHash('sha256').update(canonicalizeLegalDocument(entry.locale, entry.documentType), 'utf8').digest('hex'))
        .toBe(entry.sha256);
    }
    expect(LEGAL_VERSION).toBe('2026-08-31');
  });

  test('legal copy mentions Fast 2 cr/s, PRO 80 cr/s, Fapshi, Chariow and licence rule', async () => {
    for (const locale of ['en', 'fr'] as const) {
      const terms = canonicalizeLegalDocument(locale, 'terms');
      const privacy = canonicalizeLegalDocument(locale, 'privacy');
      expect(terms).toMatch(/2/);
      expect(terms).toMatch(/80/);
      expect(terms).toContain('Fapshi');
      expect(terms).toContain('Chariow');
      expect(terms.toLowerCase()).toMatch(/pro/);
      expect(privacy).toContain('fal.ai');
      expect(privacy).toContain('Fapshi');
      expect(privacy).toContain('Chariow');
    }
  });
});

describe('onboarding migration and gates', () => {
  test('migration seeds preferences, versions, RPCs and RLS', async () => {
    const sql = await read('supabase/20260901_onboarding_i18n.sql');
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
    expect(sql).toContain('user_preferences');
    expect(sql).toContain('onboarding_versions');
    expect(sql).toContain('legal_document_localizations');
    expect(sql).toContain('set_own_locale');
    expect(sql).toContain('get_own_onboarding_status');
    expect(sql).toContain('complete_current_onboarding');
    expect(sql).toContain('terms_content_sha256');
    expect(sql).toContain('privacy_content_sha256');
    expect(sql).toContain('ON CONFLICT (user_id, terms_version, privacy_version) DO NOTHING');
    expect(sql).not.toContain('UPDATE public.wallets');
    expect(sql).not.toContain('credits = 0');
    expect(ONBOARDING_VERSION).toBe(1);
  });

  test('app gate order and onboarding UX constraints', async () => {
    const app = await read('app/src/App.tsx');
    const onboarding = await read('app/src/components/OnboardingGate.tsx');
    const localeGate = await read('app/src/components/LocaleBootstrapGate.tsx');
    const legalGate = await read('app/src/components/LegalGate.tsx');
    const launch = await read('app/src/components/LaunchPrivacyNotice.tsx');
    const login = await read('app/src/pages/Login.tsx');
    const settings = await read('app/src/pages/Settings.tsx');

    const localeOpen = app.indexOf('<LocaleBootstrapGate>');
    const onboardingOpen = app.indexOf('<OnboardingGate>');
    const legalOpen = app.indexOf('<LegalGate>');
    expect(localeOpen).toBeGreaterThan(-1);
    expect(onboardingOpen).toBeGreaterThan(localeOpen);
    expect(legalOpen).toBeGreaterThan(onboardingOpen);
    expect(app).toContain('LaunchPrivacyNotice');
    expect(localeGate).toContain('confirmLocale');
    expect(localeGate).toContain('detectSystemLocalePreselection');
    expect(onboarding).toContain("supabase.rpc('get_own_onboarding_status')");
    expect(onboarding).toContain("supabase.rpc('complete_current_onboarding'");
    expect(onboarding).toContain('onEscapeKeyDown');
    expect(onboarding).toContain('onPointerDownOutside');
    expect(onboarding).toContain('setScrolled(false)');
    expect(onboarding).toContain('setAccepted(false)');
    expect(onboarding).toContain('disabled={!scrolled}');
    expect(onboarding).toContain('common.retry');
    expect(legalGate).toContain('legalGateRequired');
    expect(launch).toContain('get_own_onboarding_status');
    expect(login).toContain('handleLegalScroll');
    expect(login).toContain('disabled={!legalScrolled}');
    expect(settings).toContain("persistServer: true");
    expect(settings).toContain("t('locale.saved')");
    expect(settings).toContain("t('locale.saveFailed')");
  });

  test('onboarding cannot be bypassed by preview, wallet or settings routes alone', async () => {
    const app = await read('app/src/App.tsx');
    const protectedStart = app.indexOf('<OnboardingGate>');
    const protectedEnd = app.indexOf('</OnboardingGate>');
    const slice = app.slice(protectedStart, protectedEnd);
    expect(slice).toContain('PreviewWindow');
    expect(slice).toContain('ROUTES.PROTECTED.WALLET');
    expect(slice).toContain('ROUTES.PROTECTED.SETTINGS');
    expect(slice).toContain('AdminDashboard');
  });
});

describe('prompt integrity', () => {
  test('personaPrompts hash remains unchanged', async () => {
    const promptSource = await read('app/src/lib/personaPrompts.ts');
    expect(createHash('sha256').update(promptSource).digest('hex').toUpperCase())
      .toBe('B23FF1ECE313EF5CC7EB999709CACDF94A2DADAFDB94B6751D0BF2465764B3D2');
  });
});
