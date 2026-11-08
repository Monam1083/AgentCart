import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPayPalClient, SANDBOX_BASE_URL } from '../src/paypal.js';
import { priceLines } from '../src/tools.js';

function cartFrom(lines) {
  return { id: 'cart_test', currency: 'USD', ...priceLines(lines) };
}

function res(body, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) };
}

test('refuses any base URL that is not sandbox or localhost', () => {
  assert.throws(() => createPayPalClient({ clientId: 'a', clientSecret: 'b', baseUrl: 'https://api-m.paypal.com' }), /sandbox/);
  assert.doesNotThrow(() => createPayPalClient({ clientId: 'a', clientSecret: 'b', baseUrl: 'http://localhost:4000' }));
});

test('unconfigured client reports so and createOrder fails with 503', async () => {
  const pp = createPayPalClient({});
  assert.equal(pp.isConfigured(), false);
  await assert.rejects(() => pp.createOrder(cartFrom([{ id: 'f12', quantity: 1 }]), { returnUrl: 'x', cancelUrl: 'y' }), (e) => e.status === 503);
});

test('order body is built from server-priced cart cents', () => {
  const pp = createPayPalClient({ clientId: 'a', clientSecret: 'b' });
  const body = pp.buildOrderBody(cartFrom([{ id: 'b01', quantity: 1 }]), { returnUrl: 'https://x/return', cancelUrl: 'https://x/cancel' });
  const unit = body.purchase_units[0];
  assert.equal(body.intent, 'CAPTURE');
  assert.equal(unit.amount.value, '16.48');
  assert.equal(unit.amount.breakdown.item_total.value, '12.49');
  assert.equal(unit.amount.breakdown.shipping.value, '3.99');
  assert.equal(unit.items[0].unit_amount.value, '12.49');
  assert.equal(unit.items[0].quantity, '1');
  assert.equal(body.payment_source.paypal.experience_context.user_action, 'PAY_NOW');
  assert.equal(body.payment_source.paypal.experience_context.return_url, 'https://x/return');
});

test('createOrder gets a token, posts to the sandbox, and returns the approval link', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/v1/oauth2/token')) return res({ access_token: 'tok', expires_in: 3600 });
    return res({ id: 'ORDER1', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'self', href: 'x' }, { rel: 'payer-action', href: 'https://sandbox.paypal.com/checkoutnow?token=ORDER1' }] });
  };
  const pp = createPayPalClient({ clientId: 'id', clientSecret: 'secret', fetchImpl });
  const out = await pp.createOrder(cartFrom([{ id: 'f12', quantity: 1 }]), { returnUrl: 'r', cancelUrl: 'c' });

  assert.equal(out.orderId, 'ORDER1');
  assert.match(out.approvalUrl, /checkoutnow/);
  assert.ok(calls[0].url.startsWith(SANDBOX_BASE_URL));
  assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from('id:secret').toString('base64')}`);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer tok');
  assert.equal(calls[1].init.headers['PayPal-Request-Id'], 'create-cart_test');

  // Token is cached for the next call.
  await pp.createOrder(cartFrom([{ id: 'f12', quantity: 1 }]), { returnUrl: 'r', cancelUrl: 'c' });
  assert.equal(calls.filter((c) => c.url.endsWith('/v1/oauth2/token')).length, 1);
});

test('captureOrder extracts the capture details', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/v1/oauth2/token')) return res({ access_token: 'tok', expires_in: 3600 });
    return res({ status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { value: '8.98', currency_code: 'USD' } }] } }] });
  };
  const pp = createPayPalClient({ clientId: 'a', clientSecret: 'b', fetchImpl });
  const out = await pp.captureOrder('ORDER1');
  assert.deepEqual(out, { status: 'COMPLETED', captureId: 'CAP1', captureStatus: 'COMPLETED', amount: '8.98', currency: 'USD' });
});

test('PayPal API errors become 502s', async () => {
  const fetchImpl = async (url) => (url.endsWith('/v1/oauth2/token') ? res({ access_token: 't', expires_in: 3600 }) : res({ message: 'INVALID' }, 422));
  const pp = createPayPalClient({ clientId: 'a', clientSecret: 'b', fetchImpl });
  await assert.rejects(() => pp.captureOrder('X'), (e) => e.status === 502 && /INVALID/.test(e.message));
});

test('webhook verification needs a webhook id and a SUCCESS verdict', async () => {
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/v1/oauth2/token')) return res({ access_token: 't', expires_in: 3600 });
    const sent = JSON.parse(init.body);
    return res({ verification_status: sent.webhook_id === 'WH1' ? 'SUCCESS' : 'FAILURE' });
  };
  const pp = createPayPalClient({ clientId: 'a', clientSecret: 'b', fetchImpl });
  const headers = { 'paypal-auth-algo': 'a', 'paypal-cert-url': 'c', 'paypal-transmission-id': 'i', 'paypal-transmission-sig': 's', 'paypal-transmission-time': 't' };
  assert.equal(await pp.verifyWebhook({ webhookId: undefined, headers, event: {} }), false);
  assert.equal(await pp.verifyWebhook({ webhookId: 'WH1', headers, event: {} }), true);
  assert.equal(await pp.verifyWebhook({ webhookId: 'WH2', headers, event: {} }), false);
});
