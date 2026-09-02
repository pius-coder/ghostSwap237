// @ts-nocheck
import { supabaseAdmin } from '../api/supabase.js';

export async function loadProviderProduct(packageId, provider, currency) {
  const { data, error } = await supabaseAdmin
    .from('payment_provider_products')
    .select('*, credit_packages!inner(id, name, credits, is_active, sort_order)')
    .eq('package_id', packageId)
    .eq('provider', provider)
    .eq('currency', String(currency).toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadCheckoutCatalog() {
  const [{ data: packages, error: packageError }, { data: products, error: productError }] = await Promise.all([
    supabaseAdmin
      .from('credit_packages')
      .select('id, name, credits, price_xaf, price_usd, is_active, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('credits', { ascending: true }),
    supabaseAdmin
      .from('payment_provider_products')
      .select('id, package_id, provider, currency, amount, external_product_id, enabled'),
  ]);
  if (packageError) throw packageError;

  // During a staged deployment the application can be newer than the database.
  // Keep the catalogue readable, but never advertise a checkout provider whose
  // authoritative mapping table is not available yet.
  const providerMappingsUnavailable = productError?.code === 'PGRST205';
  if (productError && !providerMappingsUnavailable) throw productError;

  return (packages || []).map((pack) => {
    const mappings = providerMappingsUnavailable
      ? []
      : (products || []).filter((row) => row.package_id === pack.id);
    const fapshi = mappings.find((row) => row.provider === 'fapshi' && row.currency === 'XAF');
    const chariow = mappings.find((row) => row.provider === 'chariow' && row.currency === 'USD');
    return {
      id: pack.id,
      name: pack.name,
      credits: Number(pack.credits),
      priceXaf: Number(fapshi?.amount ?? pack.price_xaf ?? 0),
      priceUsd: Number(chariow?.amount ?? pack.price_usd ?? 0),
      fapshi: {
        enabled: !providerMappingsUnavailable && fapshi?.enabled === true,
        amount: Number(fapshi?.amount ?? pack.price_xaf ?? 0),
        currency: 'XAF',
      },
      chariow: {
        enabled: !providerMappingsUnavailable && chariow?.enabled === true && Boolean(chariow?.external_product_id),
        configured: !providerMappingsUnavailable && Boolean(chariow?.external_product_id),
        amount: Number(chariow?.amount ?? pack.price_usd ?? 0),
        currency: 'USD',
      },
      databaseReady: !providerMappingsUnavailable,
    };
  });
}

export function publicOrderView(order) {
  if (!order) return null;
  return {
    paymentId: order.id,
    provider: order.provider,
    providerStatus: order.provider_status,
    paymentStatus: order.status,
    fulfilmentStatus: order.fulfilment_status,
    credits: Number(order.credits_purchased),
    amount: Number(order.gross_amount),
    currency: order.currency,
    failureReason: order.failure_reason || undefined,
  };
}
