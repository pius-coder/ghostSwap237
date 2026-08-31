import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import {
  PACK_CATALOG,
  MIN_GROSS_MARGIN,
  packMargins,
  estimatedFastCostUsd,
  fapshiNetUsd,
  chariowNetUsd,
  FAST_COST_USD_PER_CREDIT,
} from '../server/payment-economics';
import { amountsMatch, currenciesMatch, validateChariowSuccessfulSale, validateFapshiSettlement } from '../server/payment-validators';
import { verifyChariowSignature } from '../server/chariow-pulse';
import { normalizePhoneE164, normalizePersonName, normalizeCountryCode } from '../server/payment-phone';

const repo = join(import.meta.dir, '../..');
const read = (path: string) => Bun.file(join(repo, path)).text();

describe('credit catalogue and Fast margin', () => {
  test('locks the approved credit and price grid', () => {
    expect(PACK_CATALOG).toEqual([
      { name: 'Starter', credits: 18_000, priceXaf: 15_000, priceUsd: 30 },
      { name: 'Basic', credits: 36_000, priceXaf: 30_000, priceUsd: 60 },
      { name: 'Pro', credits: 72_000, priceXaf: 60_000, priceUsd: 120 },
      { name: 'Enterprise', credits: 180_000, priceXaf: 150_000, priceUsd: 300 },
    ]);
  });

  test('keeps Fast worst-case gross margin above 30% for Fapshi and Chariow', () => {
    expect(FAST_COST_USD_PER_CREDIT).toBe(0.00085);
    for (const row of packMargins()) {
      expect(row.fapshiMargin).toBeGreaterThanOrEqual(MIN_GROSS_MARGIN);
      expect(row.chariowMargin).toBeGreaterThanOrEqual(MIN_GROSS_MARGIN);
      expect(row.cost).toBe(estimatedFastCostUsd(row.credits));
      expect(row.fapshiNet).toBe(fapshiNetUsd(
        PACK_CATALOG.find((p) => p.name === row.name)!.priceXaf,
      ));
      expect(row.chariowNet).toBe(chariowNetUsd(
        PACK_CATALOG.find((p) => p.name === row.name)!.priceUsd,
      ));
    }
  });

  test('margin helpers never touch wallet state', async () => {
    const economics = await read('app/server/payment-economics.ts');
    expect(economics).not.toContain('supabase');
    expect(economics).not.toMatch(/\bwallets\b/);
    expect(economics).not.toContain('fulfill');
  });
});

describe('migration finance contract', () => {
  test('defines provider mappings, profiles, ledger types, and fulfilment RPC', async () => {
    const sql = await read('supabase/20260831_finance_notifications_chariow.sql');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.payment_provider_products');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.user_payment_profiles');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.payment_orders');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.wallet_ledger');
    expect(sql).toContain('legacy_opening_balance');
    expect(sql).toContain('provider_product_id');
    expect(sql).toContain("fulfill_payment_order");
    expect(sql).toContain('payment.fulfilled');
    expect(sql).toContain('payment.fulfilment_failed');
    expect(sql).toContain('admin_upsert_payment_provider_product');
    expect(sql).toContain('excluded_from_revenue');
    expect(sql).toContain("'Starter', 18000, 15000, 30");
    expect(sql).toContain("'Enterprise', 180000, 150000, 300");
    expect(sql).toContain("provider = 'chariow'");
    expect(sql).toContain('enabled = false');
  });

  test('does not zero wallets or grant provider tables to the renderer', async () => {
    const sql = await read('supabase/20260831_finance_notifications_chariow.sql');
    expect(sql).not.toMatch(/UPDATE\s+public\.wallets[\s\S]*credits\s*=\s*0/i);
    expect(sql).toContain('REVOKE ALL ON public.payment_provider_products FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('REVOKE ALL ON public.payment_orders');
  });
});

describe('Fapshi settlement validation', () => {
  const order = {
    id: '11111111-1111-1111-1111-111111111111',
    provider_reference: 'tr_abc',
    gross_amount: 15000,
    currency: 'XAF',
  };

  test('accepts matching transId, externalId, amount and default XAF', () => {
    expect(validateFapshiSettlement(order, {
      transId: 'tr_abc',
      externalId: order.id,
      amount: 15000,
    })).toEqual({ ok: true });
  });

  test('rejects bad transId, externalId and amount', () => {
    expect(validateFapshiSettlement(order, { transId: 'other', externalId: order.id, amount: 15000 }).ok).toBe(false);
    expect(validateFapshiSettlement(order, { transId: 'tr_abc', externalId: 'wrong', amount: 15000 }).ok).toBe(false);
    expect(validateFapshiSettlement(order, { transId: 'tr_abc', externalId: order.id, amount: 14999 }).ok).toBe(false);
  });

  test('Fapshi handlers freeze mapping amounts and reconcile', async () => {
    const init = await read('app/server/fapshi-init.ts');
    const webhook = await read('app/server/fapshi-webhook.ts');
    const status = await read('app/server/fapshi-status.ts');
    expect(init).toContain("loadProviderProduct(packageId, 'fapshi', 'XAF')");
    expect(init).toContain('externalId: payment.id');
    expect(init).toContain('attachProviderReference');
    expect(webhook).toContain('validateFapshiSettlement');
    expect(webhook).toContain('recordValidationFailure');
    expect(webhook).not.toContain('admin_confirm_payment');
    expect(status).toContain('validateFapshiSettlement');
    expect(status).toContain('reconciliation');
  });
});

describe('Chariow checkout and Pulse', () => {
  test('validates phone profile helpers', () => {
    expect(normalizePersonName('Ada', 'first name')).toBe('Ada');
    expect(() => normalizePersonName('', 'first name')).toThrow();
    expect(normalizeCountryCode('cm')).toBe('CM');
    const phone = normalizePhoneE164('+237650000000', 'CM');
    expect(phone.e164).toBe('+237650000000');
    expect(() => normalizePhoneE164('123', 'CM')).toThrow();
  });

  test('payment notifications include succeeded and validation failures', async () => {
    const orders = await read('app/server/payment-orders.ts');
    expect(orders).toContain("payment.succeeded");
    expect(orders).toContain("payment.validation_failed");
    expect(orders).toContain("payment.refunded");
    expect(orders).toContain("payment.disputed");
  });

  test('signs and verifies Pulse on the raw body', () => {
    const raw = Buffer.from(JSON.stringify({ event: 'successful.sale', sale: { id: 'sal_1' } }), 'utf8');
    const secret = 'pulse_test_secret';
    const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    expect(verifyChariowSignature(raw, signature, secret)).toBe(true);
    expect(verifyChariowSignature(raw, 'sha256=deadbeef', secret)).toBe(false);
    // Re-serializing must not be used for verification — different spacing fails.
    const reshaped = Buffer.from(JSON.stringify(JSON.parse(raw.toString('utf8')), null, 2), 'utf8');
    const reshapedSig = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    expect(verifyChariowSignature(reshaped, reshapedSig, secret)).toBe(false);
  });

  test('successful.sale validator enforces order, sale, product, amount and currency', () => {
    const order = {
      id: 'ord_1',
      provider: 'chariow',
      provider_reference: 'sal_1',
      gross_amount: 30,
      currency: 'USD',
      metadata: { chariow_product_id: 'prd_1' },
    };
    const mapping = { external_product_id: 'prd_1' };
    const body = {
      event: 'successful.sale',
      sale: {
        id: 'sal_1',
        amount: { value: 30, currency: 'USD' },
        custom_metadata: { henshin_order_id: 'ord_1' },
      },
      product: { id: 'prd_1' },
    };
    expect(validateChariowSuccessfulSale(order, mapping, body)).toEqual({ ok: true });
    expect(validateChariowSuccessfulSale(order, mapping, { ...body, event: 'failed.sale' }).ok).toBe(false);
    expect(validateChariowSuccessfulSale(order, mapping, {
      ...body,
      sale: { ...body.sale, id: 'sal_other' },
    }).ok).toBe(false);
    expect(validateChariowSuccessfulSale(order, mapping, {
      ...body,
      product: { id: 'prd_other' },
    }).ok).toBe(false);
    expect(validateChariowSuccessfulSale(order, mapping, {
      ...body,
      sale: { ...body.sale, amount: { value: 29, currency: 'USD' } },
    }).ok).toBe(false);
    expect(validateChariowSuccessfulSale(order, mapping, {
      ...body,
      sale: { ...body.sale, amount: { value: 30, currency: 'EUR' } },
    }).ok).toBe(false);
  });

  test('Chariow init and pulse enforce configuration, raw signature and no PRO licence writes', async () => {
    const init = await read('app/server/chariow-init.ts');
    const pulse = await read('app/server/chariow-pulse.ts');
    const wallet = await read('app/api/wallet.ts');
    const local = await read('app/scripts/local-api-server.mjs');
    expect(init).toContain("loadProviderProduct(packageId, 'chariow', 'USD')");
    expect(init).toContain('normalizePhoneE164');
    expect(init).toContain("purpose: 'wallet_credits'");
    expect(init).toContain('already_purchased');
    expect(init).toContain('CHARIOW_NOT_CONFIGURED');
    expect(pulse).toContain('verifyChariowSignature');
    expect(pulse).toContain('readRawBody');
    expect(pulse).toContain('x-pulse-delivery-id');
    expect(pulse).toContain('x-pulse-event');
    expect(pulse).not.toContain('JSON.stringify(payload');
    expect(pulse).not.toMatch(/\.from\(\s*['"]pro_licenses['"]\s*\)/);
    expect(pulse).toContain('never mutate Henshin PRO licences');
    expect(wallet).toContain("action === 'chariow-pulse'");
    expect(wallet).toContain('bodyParser: false');
    expect(local).toContain("express.raw({ type: 'application/json'");
    expect(local.indexOf("express.raw({ type: 'application/json'")).toBeLessThan(
      local.indexOf('app.use(express.json'),
    );
  });
});

describe('ledger semantics helpers', () => {
  test('never silently adds mismatched currencies', () => {
    expect(currenciesMatch('USD', 'USD')).toBe(true);
    expect(currenciesMatch('XAF', null, { defaultCurrency: 'XAF' })).toBe(true);
    expect(currenciesMatch('USD', 'XAF')).toBe(false);
    expect(amountsMatch(30, 30, 'USD')).toBe(true);
    expect(amountsMatch(15000, 15000.4, 'XAF')).toBe(true);
  });

  test('SQL separates purchase, admin, usage and legacy opening balances', async () => {
    const sql = await read('supabase/20260831_finance_notifications_chariow.sql');
    expect(sql).toContain("'purchase'");
    expect(sql).toContain("'admin_adjustment'");
    expect(sql).toContain("'session_usage'");
    expect(sql).toContain("'legacy_opening_balance'");
    expect(sql).toContain('wallet_ledger_purchase_once_idx');
    expect(sql).toContain('wallet_ledger_legacy_opening_once_idx');
  });
});

describe('wallet checkout UI contract', () => {
  test('shows both prices, channel choice, Chariow form and return states', async () => {
    const pricing = await read('app/src/components/PricingDialog.tsx');
    const chariow = await read('app/src/components/ChariowCheckoutModal.tsx');
    const success = await read('app/src/pages/PaymentSuccess.tsx');
    const en = await read('app/src/i18n/resources/en.ts');
    expect(pricing).toContain("t('payments.cameroonMobile')");
    expect(pricing).toContain("t('payments.internationalCard')");
    expect(pricing).toContain("formatCurrency(plan.priceXAF, 'XAF', locale)");
    expect(pricing).toContain("formatCurrency(plan.priceUSD, 'USD', locale)");
    expect(pricing).toContain('formatDurationFromCredits(plan.credits, 2, locale)');
    expect(pricing).toContain('formatDurationFromCredits(plan.credits, 80, locale)');
    expect(pricing).toContain('chariow-disabled-message');
    expect(pricing).toContain("t('payments.packsIntro')");
    expect(en).toContain('not a PRO licence');
    expect(chariow).toContain('isValidPhoneNumber');
    expect(chariow).toContain("t('payments.phoneHint')");
    expect(en).toContain('Never enter card numbers');
    expect(success).toContain("t('payments.verifying')");
    expect(success).toContain('fulfilment_failed');
    expect(success).toContain("t('payments.footerNote')");
    expect(en).toContain('never credits your wallet directly');
  });
});

describe('wallet bodyParser false non-regression', () => {
  test('multiplexed POST and GET wallet actions still parse with bodyParser false', async () => {
    const wallet = await read('app/api/wallet.ts');
    const fapshi = await read('app/server/fapshi-init.ts');
    const chariow = await read('app/server/chariow-init.ts');
    const pulse = await read('app/server/chariow-pulse.ts');
    const local = await read('app/scripts/local-api-server.mjs');

    expect(wallet).toContain('bodyParser: false');
    expect(wallet).toContain("action === 'fapshi-init'");
    expect(wallet).toContain("action === 'chariow-init'");
    expect(wallet).toContain("action === 'chariow-pulse'");
    expect(wallet).toContain("action === 'payment-status'");
    expect(wallet).toContain("action === 'catalog'");
    expect(wallet).toContain("action === 'payment-profile'");
    expect(wallet).toContain('ensureJsonBody');
    expect(wallet).toContain('JSON.parse(raw.toString');
    expect(fapshi).toContain('req.body?.packageId');
    expect(chariow).toContain('req.body?.packageId');
    expect(pulse).toContain('rawBody');
    expect(local).toContain('rawBody');
  });
});
