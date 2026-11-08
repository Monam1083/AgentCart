// PayPal Orders v2 client. Sandbox only: there is no code path to the live API.

import { centsToDecimal } from './catalog.js';

export const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';

function resolveBaseUrl(override) {
  if (!override) return SANDBOX_BASE_URL;
  // Allow a local fake PayPal for development and tests, never anything else.
  if (override === SANDBOX_BASE_URL || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(override)) return override;
  throw new Error('PAYPAL_BASE_URL must be the PayPal sandbox or a localhost URL.');
}

export function createPayPalClient({ clientId, clientSecret, baseUrl, fetchImpl = fetch } = {}) {
  const base = resolveBaseUrl(baseUrl);
  let cachedToken = null;

  function assertConfigured() {
    if (!clientId || !clientSecret) {
      const err = new Error('PayPal sandbox credentials are not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET).');
      err.status = 503;
      throw err;
    }
  }

  async function paypalFetch(path, init) {
    const res = await fetchImpl(`${base}${path}`, init);
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(`PayPal ${init?.method ?? 'GET'} ${path} failed (${res.status}): ${body.message ?? body.error_description ?? text.slice(0, 200)}`);
      err.status = 502;
      err.paypal = body;
      throw err;
    }
    return body;
  }

  async function getAccessToken() {
    assertConfigured();
    if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const body = await paypalFetch('/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 300) * 1000 };
    return cachedToken.value;
  }

  async function authed(path, init = {}) {
    const token = await getAccessToken();
    return paypalFetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  }

  return {
    isConfigured: () => Boolean(clientId && clientSecret),

    /** Builds the Orders v2 request body from a server-priced cart. Exported for tests. */
    buildOrderBody(cart, { returnUrl, cancelUrl }) {
      return {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: cart.id,
            custom_id: cart.id,
            description: 'AgentCart order',
            amount: {
              currency_code: cart.currency,
              value: centsToDecimal(cart.totalCents),
              breakdown: {
                item_total: { currency_code: cart.currency, value: centsToDecimal(cart.itemTotalCents) },
                shipping: { currency_code: cart.currency, value: centsToDecimal(cart.shippingCents) },
              },
            },
            items: cart.items.map((i) => ({
              name: i.name.slice(0, 127),
              sku: i.id,
              quantity: String(i.quantity),
              category: 'PHYSICAL_GOODS',
              unit_amount: { currency_code: cart.currency, value: centsToDecimal(i.unitPriceCents) },
            })),
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: 'AgentCart',
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING',
              return_url: returnUrl,
              cancel_url: cancelUrl,
            },
          },
        },
      };
    },

    async createOrder(cart, urls) {
      const order = await authed('/v2/checkout/orders', {
        method: 'POST',
        headers: { 'PayPal-Request-Id': `create-${cart.id}` },
        body: JSON.stringify(this.buildOrderBody(cart, urls)),
      });
      const link = (order.links ?? []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
      if (!order.id || !link) throw Object.assign(new Error('PayPal order response had no approval link.'), { status: 502 });
      return { orderId: order.id, approvalUrl: link.href, status: order.status };
    },

    async captureOrder(orderId) {
      const result = await authed(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
        method: 'POST',
        headers: { 'PayPal-Request-Id': `capture-${orderId}` },
        body: '{}',
      });
      const capture = result.purchase_units?.[0]?.payments?.captures?.[0];
      return {
        status: result.status,
        captureId: capture?.id ?? null,
        captureStatus: capture?.status ?? null,
        amount: capture?.amount?.value ?? null,
        currency: capture?.amount?.currency_code ?? null,
      };
    },

    async getOrder(orderId) {
      return authed(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    },

    /** Verifies a webhook with PayPal's own verification endpoint. Returns true only on SUCCESS. */
    async verifyWebhook({ webhookId, headers, event }) {
      if (!webhookId) return false;
      const result = await authed('/v1/notifications/verify-webhook-signature', {
        method: 'POST',
        body: JSON.stringify({
          auth_algo: headers['paypal-auth-algo'],
          cert_url: headers['paypal-cert-url'],
          transmission_id: headers['paypal-transmission-id'],
          transmission_sig: headers['paypal-transmission-sig'],
          transmission_time: headers['paypal-transmission-time'],
          webhook_id: webhookId,
          webhook_event: event,
        }),
      });
      return result.verification_status === 'SUCCESS';
    },
  };
}
