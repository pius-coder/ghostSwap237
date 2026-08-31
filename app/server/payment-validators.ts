// @ts-nocheck
/** Shared validation for provider settlement events before fulfilment. */

export function amountsMatch(expected, received, currency) {
  const left = Number(expected);
  const right = Number(received);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (String(currency || '').toUpperCase() === 'XAF') {
    return Math.round(left) === Math.round(right);
  }
  return Math.abs(left - right) < 0.005;
}

export function currenciesMatch(expected, received, { defaultCurrency = null } = {}) {
  const left = String(expected || '').toUpperCase();
  const right = String(received || defaultCurrency || '').toUpperCase();
  return Boolean(left) && left === right;
}

export function validateFapshiSettlement(order, payload) {
  const transId = String(payload?.transId || '').trim();
  const externalId = String(payload?.externalId || '').trim();
  const amount = payload?.amount;
  const currency = payload?.currency;

  if (!transId && !externalId) {
    return { ok: false, reason: 'Missing transId or externalId', httpStatus: 400 };
  }
  if (externalId && externalId !== order.id) {
    return { ok: false, reason: 'externalId does not match Henshin order', httpStatus: 400 };
  }
  if (transId && order.provider_reference && transId !== order.provider_reference) {
    return { ok: false, reason: 'transId does not match stored provider reference', httpStatus: 400 };
  }
  if (amount != null && !amountsMatch(order.gross_amount, amount, order.currency)) {
    return { ok: false, reason: 'Payment amount mismatch', httpStatus: 400 };
  }
  if (!currenciesMatch(order.currency, currency, { defaultCurrency: 'XAF' })) {
    return { ok: false, reason: 'Payment currency mismatch', httpStatus: 400 };
  }
  return { ok: true };
}

export function validateChariowSuccessfulSale(order, productMapping, body) {
  const sale = body?.sale || {};
  const product = body?.product || {};
  const saleId = String(sale.id || '').trim();
  const orderId = String(sale.custom_metadata?.henshin_order_id || '').trim();
  const productId = String(product.id || '').trim();
  const amount = sale.amount?.value;
  const currency = sale.amount?.currency;

  if (String(body?.event || '') !== 'successful.sale') {
    return { ok: false, reason: 'Event is not successful.sale', httpStatus: 400 };
  }
  if (!order || order.provider !== 'chariow') {
    return { ok: false, reason: 'Unknown Chariow order', httpStatus: 404 };
  }
  if (!orderId || orderId !== order.id) {
    return { ok: false, reason: 'henshin_order_id mismatch', httpStatus: 400 };
  }
  if (!saleId || !order.provider_reference || saleId !== order.provider_reference) {
    return { ok: false, reason: 'sale.id mismatch', httpStatus: 400 };
  }
  const expectedProductId = String(productMapping?.external_product_id || order.metadata?.chariow_product_id || '');
  if (!productId || productId !== expectedProductId) {
    return { ok: false, reason: 'product.id mismatch', httpStatus: 400 };
  }
  if (!amountsMatch(order.gross_amount, amount, order.currency)) {
    return { ok: false, reason: 'Sale amount mismatch', httpStatus: 400 };
  }
  if (!currenciesMatch(order.currency, currency)) {
    return { ok: false, reason: 'Sale currency mismatch', httpStatus: 400 };
  }
  return { ok: true };
}
