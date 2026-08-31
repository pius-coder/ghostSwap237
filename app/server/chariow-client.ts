// @ts-nocheck
const BASE_URL = 'https://api.chariow.com/v1';

export function chariowConfigError() {
  if (!process.env.CHARIOW_API_KEY) return 'CHARIOW_API_KEY is not configured';
  if (!process.env.CHARIOW_WEBHOOK_SECRET) return 'CHARIOW_WEBHOOK_SECRET is not configured';
  return null;
}

export class ChariowApiError extends Error {
  constructor(message, { status = 502, code = 'CHARIOW_ERROR', details = null } = {}) {
    super(message);
    this.name = 'ChariowApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function chariowRequest(path, { method = 'GET', body } = {}) {
  if (!process.env.CHARIOW_API_KEY) throw new ChariowApiError('Chariow is not configured.', { status: 503, code: 'CHARIOW_NOT_CONFIGURED' });

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.CHARIOW_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new ChariowApiError('Chariow checkout timed out. Please try again.', { status: 504, code: 'CHARIOW_TIMEOUT' });
    }
    throw new ChariowApiError('Chariow is unreachable. Please try again.', { status: 502, code: 'CHARIOW_NETWORK' });
  }

  const result = await response.json().catch(() => ({}));
  if (response.status === 401) {
    throw new ChariowApiError('Chariow authentication failed.', { status: 502, code: 'CHARIOW_UNAUTHORIZED' });
  }
  if (response.status === 404) {
    throw new ChariowApiError(result?.message || 'Chariow product not found.', { status: 502, code: 'CHARIOW_NOT_FOUND', details: result?.errors });
  }
  if (response.status === 422) {
    throw new ChariowApiError(result?.message || 'Chariow rejected the checkout payload.', {
      status: 400,
      code: 'CHARIOW_VALIDATION',
      details: result?.errors,
    });
  }
  if (!response.ok) {
    throw new ChariowApiError(result?.message || `Chariow returned HTTP ${response.status}`, {
      status: 502,
      code: 'CHARIOW_HTTP',
      details: result?.errors,
    });
  }
  return result;
}
