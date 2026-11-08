import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { createStore } from '../src/store.js';
import { createOfflineAgent } from '../src/agent.js';
import { createPayPalClient } from '../src/paypal.js';

const SESSION = 'session-abcdef12';
const OTHER = 'session-zzzzzz99';

/** A fake PayPal sandbox that records what the backend does to it. */
function fakePayPal({ captureStatus = 'COMPLETED', captureAmount } = {}) {
  const log = { orders: new Map(), captures: [] };
  const fetchImpl = async (url, init) => {
    const reply = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
    if (url.endsWith('/v1/oauth2/token')) return reply({ access_token: 'tok', expires_in: 3600 });
    if (url.endsWith('/v2/checkout/orders') && init.method === 'POST') {
      const body = JSON.parse(init.body);
      const id = `ORDER${log.orders.size + 1}`;
      log.orders.set(id, body);
      return reply({ id, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: `https://sandbox.paypal.com/checkoutnow?token=${id}` }] });
    }
    const m = url.match(/\/v2\/checkout\/orders\/([^/]+)\/capture$/);
    if (m) {
      log.captures.push(m[1]);
      const order = log.orders.get(m[1]);
      const value = captureAmount ?? order.purchase_units[0].amount.value;
      return reply({ status: captureStatus, purchase_units: [{ payments: { captures: [{ id: `CAP-${m[1]}`, status: captureStatus, amount: { value, currency_code: 'USD' } }] } }] });
    }
    return reply({ message: 'unexpected' }, 500);
  };
  return { log, client: createPayPalClient({ clientId: 'id', clientSecret: 'secret', fetchImpl }) };
}

async function start({ paypal, agent = createOfflineAgent(), config = {} } = {}) {
  const pp = paypal ?? fakePayPal();
  const app = createApp({ store: createStore(), agent, paypal: pp.client, config: { publicBaseUrl: 'http://localhost:9999', defaultSpendingLimit: 50, ...config } });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
  };
  return { call, paypal: pp, close: () => new Promise((r) => server.close(r)) };
}

const chat = (t, message, extra = {}) => t.call('/api/chat', { method: 'POST', body: { sessionId: SESSION, message, ...extra } });

test('happy path: chat -> confirm -> PayPal return -> paid', async () => {
  const t = await start();
  try {
    const c = await chat(t, 'cheapest bundle under $30, no pork');
    assert.equal(c.status, 200);
    assert.equal(c.body.cart.status, 'proposed');
    assert.equal(c.body.cart.total, '$16.48');
    assert.equal(t.paypal.log.orders.size, 0, 'chat must not create a PayPal order');

    const cartId = c.body.cart.id;
    const conf = await t.call(`/api/carts/${cartId}/confirm`, { method: 'POST', body: { sessionId: SESSION } });
    assert.equal(conf.status, 200);
    assert.equal(conf.body.cart.status, 'pending_approval');
    assert.match(conf.body.approvalUrl, /sandbox\.paypal\.com/);

    const order = t.paypal.log.orders.get(conf.body.cart.paypalOrderId);
    assert.equal(order.purchase_units[0].amount.value, '16.48');
    assert.equal(t.paypal.log.captures.length, 0, 'no capture before the buyer approves');

    const ret = await t.call(`/paypal/return?token=${conf.body.cart.paypalOrderId}`);
    assert.equal(ret.status, 200);
    assert.match(ret.body, /Payment complete/);

    const status = await t.call(`/api/carts/${cartId}?sessionId=${SESSION}`);
    assert.equal(status.body.cart.status, 'paid');
    assert.match(status.body.cart.captureId, /^CAP-/);
  } finally {
    await t.close();
  }
});

test('capture is idempotent: reloading the return page does not capture twice', async () => {
  const t = await start();
  try {
    const c = await chat(t, 'bundle under $30');
    const conf = await t.call(`/api/carts/${c.body.cart.id}/confirm`, { method: 'POST', body: { sessionId: SESSION } });
    const id = conf.body.cart.paypalOrderId;
    await t.call(`/paypal/return?token=${id}`);
    const again = await t.call(`/paypal/return?token=${id}`);
    assert.equal(again.status, 200);
    assert.equal(t.paypal.log.captures.length, 1);
  } finally {
    await t.close();
  }
});

test('return without confirming cannot capture: unknown or unconfirmed orders are refused', async () => {
  const t = await start();
  try {
    const unknown = await t.call('/paypal/return?token=NOPE');
    assert.equal(unknown.status, 404);
    assert.equal(t.paypal.log.captures.length, 0);
  } finally {
    await t.close();
  }
});

test('another session cannot confirm or read your cart', async () => {
  const t = await start();
  try {
    const c = await chat(t, 'bundle under $30');
    const steal = await t.call(`/api/carts/${c.body.cart.id}/confirm`, { method: 'POST', body: { sessionId: OTHER } });
    assert.equal(steal.status, 404);
    const peek = await t.call(`/api/carts/${c.body.cart.id}?sessionId=${OTHER}`);
    assert.equal(peek.status, 404);
    assert.equal(t.paypal.log.orders.size, 0);
  } finally {
    await t.close();
  }
});

test('cancel at PayPal ends the order without capture', async () => {
  const t = await start();
  try {
    const c = await chat(t, 'bundle under $30');
    const conf = await t.call(`/api/carts/${c.body.cart.id}/confirm`, { method: 'POST', body: { sessionId: SESSION } });
    const cancel = await t.call(`/paypal/cancel?token=${conf.body.cart.paypalOrderId}`);
    assert.match(cancel.body, /cancelled/);
    const status = await t.call(`/api/carts/${c.body.cart.id}?sessionId=${SESSION}`);
    assert.equal(status.body.cart.status, 'cancelled');
    const late = await t.call(`/paypal/return?token=${conf.body.cart.paypalOrderId}`);
    assert.equal(late.status, 409);
    assert.equal(t.paypal.log.captures.length, 0);
  } finally {
    await t.close();
  }
});

test('captured amount mismatch is not marked paid', async () => {
  const t = await start({ paypal: fakePayPal({ captureAmount: '1.00' }) });
  try {
    const c = await chat(t, 'bundle under $30');
    const conf = await t.call(`/api/carts/${c.body.cart.id}/confirm`, { method: 'POST', body: { sessionId: SESSION } });
    const ret = await t.call(`/paypal/return?token=${conf.body.cart.paypalOrderId}`);
    assert.equal(ret.status, 502);
    const status = await t.call(`/api/carts/${c.body.cart.id}?sessionId=${SESSION}`);
    assert.equal(status.body.cart.status, 'failed');
  } finally {
    await t.close();
  }
});

test('spending limit is enforced server-side', async () => {
  const t = await start();
  try {
    const c = await chat(t, 'bundle under $30', { spendingLimit: 10 });
    assert.equal(c.status, 200);
    assert.equal(c.body.cart, null);
    assert.equal(c.body.spendingLimit, '$10.00');
  } finally {
    await t.close();
  }
});

test('confirm returns 503 when PayPal credentials are missing and the cart stays a draft', async () => {
  const noCreds = { log: { orders: new Map(), captures: [] }, client: createPayPalClient({}) };
  const t = await start({ paypal: noCreds });
  try {
    const c = await chat(t, 'bundle under $30');
    const conf = await t.call(`/api/carts/${c.body.cart.id}/confirm`, { method: 'POST', body: { sessionId: SESSION } });
    assert.equal(conf.status, 503);
    const status = await t.call(`/api/carts/${c.body.cart.id}?sessionId=${SESSION}`);
    assert.equal(status.body.cart.status, 'proposed');
  } finally {
    await t.close();
  }
});

test('input validation', async () => {
  const t = await start();
  try {
    assert.equal((await t.call('/api/chat', { method: 'POST', body: { message: 'hi' } })).status, 400);
    assert.equal((await t.call('/api/chat', { method: 'POST', body: { sessionId: 'x', message: 'hi' } })).status, 400);
    assert.equal((await chat(t, '')).status, 400);
    assert.equal((await chat(t, 'a'.repeat(501))).status, 400);
    assert.equal((await chat(t, 'hi', { spendingLimit: -5 })).status, 400);
  } finally {
    await t.close();
  }
});

test('webhook is rejected without a verified signature', async () => {
  const t = await start();
  try {
    const r = await t.call('/api/paypal/webhook', { method: 'POST', body: { event_type: 'PAYMENT.CAPTURE.COMPLETED' } });
    assert.equal(r.status, 401);
  } finally {
    await t.close();
  }
});

test('health and catalog endpoints', async () => {
  const t = await start();
  try {
    const h = await t.call('/health');
    assert.equal(h.body.ok, true);
    assert.equal(h.body.paypalConfigured, true);
    const cat = await t.call('/api/catalog');
    assert.ok(cat.body.products.length > 20);
  } finally {
    await t.close();
  }
});
