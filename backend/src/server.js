import express from 'express';
import { fileURLToPath } from 'node:url';
import { PRODUCTS, formatCents } from './catalog.js';
import { createStore } from './store.js';
import { createPayPalClient } from './paypal.js';
import { createGeminiAgent, createOfflineAgent } from './agent.js';
import { priceLines } from './tools.js';

const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_MESSAGE_LENGTH = 500;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function resultPage({ title, message, ok }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f6f7f9}
.card{background:#fff;border-radius:16px;padding:32px;max-width:360px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}
h1{font-size:22px;margin:0 0 8px;color:${ok ? '#0a7d3b' : '#b3261e'}}p{color:#444;line-height:1.5}</style></head>
<body><div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p>You can close this tab and return to the AgentCart app.</p></div></body></html>`;
}

function publicCart(cart) {
  return {
    id: cart.id,
    status: cart.status,
    items: cart.items.map((i) => ({
      id: i.id,
      name: i.name,
      quantity: i.quantity,
      unitPrice: formatCents(i.unitPriceCents),
      lineTotal: formatCents(i.lineTotalCents),
    })),
    itemTotal: formatCents(cart.itemTotalCents),
    shipping: formatCents(cart.shippingCents),
    total: formatCents(cart.totalCents),
    totalCents: cart.totalCents,
    currency: cart.currency,
    paypalOrderId: cart.paypalOrderId ?? null,
    captureId: cart.captureId ?? null,
    error: cart.error ?? null,
  };
}

export function createApp({ store = createStore(), agent, paypal, config = {} } = {}) {
  const publicBaseUrl = (config.publicBaseUrl ?? 'http://localhost:3000').replace(/\/$/, '');
  const defaultLimitCents = Math.round((config.defaultSpendingLimit ?? 50) * 100);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));

  // Minimal CORS so the Flutter web build can call the API from another origin.
  app.use((req, res, next) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  function requireSession(req, res) {
    const id = req.body?.sessionId ?? req.query.sessionId;
    if (typeof id !== 'string' || !SESSION_ID_RE.test(id)) {
      res.status(400).json({ error: 'sessionId is required (8-64 chars: letters, digits, _ or -).' });
      return null;
    }
    return id;
  }

  app.get('/health', (_req, res) => {
    res.json({ ok: true, agent: agent.name, paypalConfigured: paypal.isConfigured() });
  });

  app.get('/api/catalog', (_req, res) => {
    res.json({
      products: PRODUCTS.map((p) => ({ id: p.id, name: p.name, price: formatCents(p.priceCents), tags: p.tags, inStock: p.stock > 0 })),
    });
  });

  // --- Chat: the agent proposes a draft cart. Nothing is charged here. ---
  app.post('/api/chat', async (req, res) => {
    const sessionId = requireSession(req, res);
    if (!sessionId) return;
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) return res.status(400).json({ error: 'message is required.' });
    if (message.length > MAX_MESSAGE_LENGTH) return res.status(400).json({ error: `message must be at most ${MAX_MESSAGE_LENGTH} characters.` });

    const session = store.getSession(sessionId, { spendingLimitCents: defaultLimitCents });
    if (req.body.spendingLimit !== undefined) {
      const limit = Number(req.body.spendingLimit);
      if (!Number.isFinite(limit) || limit <= 0 || limit > 1000) return res.status(400).json({ error: 'spendingLimit must be between 0 and 1000 (USD).' });
      session.spendingLimitCents = Math.round(limit * 100);
    }

    const ctx = { store, session, lastCart: null };
    try {
      const { reply, trace } = await agent.run({ session, message, ctx });
      res.json({
        reply,
        cart: ctx.lastCart ? publicCart(ctx.lastCart) : null,
        trace: trace.map((t) => ({ tool: t.tool, ok: t.ok })),
        spendingLimit: formatCents(session.spendingLimitCents),
      });
    } catch (err) {
      console.error('chat failed:', err.message);
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.get('/api/carts/:id', (req, res) => {
    const sessionId = requireSession(req, res);
    if (!sessionId) return;
    const cart = store.getCart(req.params.id);
    if (!cart || cart.sessionId !== sessionId) return res.status(404).json({ error: 'Cart not found.' });
    res.json({ cart: publicCart(cart) });
  });

  // --- Human check #1: the user taps Confirm. Only here can a PayPal order be created. ---
  app.post('/api/carts/:id/confirm', async (req, res) => {
    const sessionId = requireSession(req, res);
    if (!sessionId) return;
    const cart = store.getCart(req.params.id);
    if (!cart || cart.sessionId !== sessionId) return res.status(404).json({ error: 'Cart not found.' });

    // Idempotent: confirming again while approval is pending returns the same approval link.
    if (cart.status === 'pending_approval' && cart.approvalUrl) {
      return res.json({ cart: publicCart(cart), approvalUrl: cart.approvalUrl });
    }
    if (cart.status !== 'proposed') return res.status(409).json({ error: `Cart is ${cart.status} and cannot be confirmed.` });
    if (!paypal.isConfigured()) return res.status(503).json({ error: 'PayPal sandbox credentials are not configured on the server.' });

    // Re-price from the catalog at confirmation time; never trust the stored draft blindly.
    const repriced = priceLines(cart.items.map((i) => ({ id: i.id, quantity: i.quantity })));
    if (repriced.error) return res.status(409).json({ error: repriced.error });
    Object.assign(cart, repriced);

    const session = store.getSession(sessionId, { spendingLimitCents: defaultLimitCents });
    if (cart.totalCents > session.spendingLimitCents) {
      return res.status(409).json({ error: `Total ${formatCents(cart.totalCents)} exceeds the spending limit of ${formatCents(session.spendingLimitCents)}.` });
    }

    cart.status = 'confirmed';
    cart.confirmedAt = Date.now();
    try {
      const order = await paypal.createOrder(cart, {
        returnUrl: `${publicBaseUrl}/paypal/return`,
        cancelUrl: `${publicBaseUrl}/paypal/cancel`,
      });
      cart.paypalOrderId = order.orderId;
      cart.approvalUrl = order.approvalUrl;
      cart.status = 'pending_approval';
      cart.error = null;
      store.saveCart(cart);
      res.json({ cart: publicCart(cart), approvalUrl: order.approvalUrl });
    } catch (err) {
      console.error('create order failed:', err.message);
      cart.status = 'proposed';
      cart.error = 'Could not start PayPal checkout. Try again.';
      res.status(err.status ?? 502).json({ error: err.message });
    }
  });

  // --- Human check #2: the buyer approves at PayPal, which redirects here. Capture happens only now. ---
  app.get('/paypal/return', async (req, res) => {
    const orderId = String(req.query.token ?? '');
    const cart = store.getCartByOrderId(orderId);
    if (!cart) return res.status(404).send(resultPage({ title: 'Order not found', message: 'We could not match this PayPal order.', ok: false }));

    if (cart.status === 'paid') return res.send(resultPage({ title: 'Payment complete', message: `Order ${cart.id} is paid. Thank you!`, ok: true }));
    if (cart.status !== 'pending_approval') {
      return res.status(409).send(resultPage({ title: 'Cannot capture', message: `This order is ${cart.status}.`, ok: false }));
    }

    cart.status = 'capturing'; // guards against double capture while the request is in flight
    try {
      const capture = await paypal.captureOrder(orderId);
      const amountOk = capture.amount === (cart.totalCents / 100).toFixed(2) && capture.currency === cart.currency;
      if (capture.status === 'COMPLETED' && capture.captureStatus === 'COMPLETED' && amountOk) {
        cart.status = 'paid';
        cart.captureId = capture.captureId;
        cart.paidAt = Date.now();
        return res.send(resultPage({ title: 'Payment complete', message: `Order ${cart.id} is paid. Thank you!`, ok: true }));
      }
      cart.status = 'failed';
      cart.error = amountOk ? `PayPal capture was ${capture.captureStatus ?? capture.status}.` : 'Captured amount did not match the cart total.';
      return res.status(502).send(resultPage({ title: 'Payment not completed', message: cart.error, ok: false }));
    } catch (err) {
      console.error('capture failed:', err.message);
      cart.status = 'pending_approval';
      cart.error = 'Capture failed. You can retry from the app.';
      return res.status(err.status ?? 502).send(resultPage({ title: 'Payment not completed', message: 'PayPal could not complete the payment. Please try again.', ok: false }));
    }
  });

  app.get('/paypal/cancel', (req, res) => {
    const cart = store.getCartByOrderId(String(req.query.token ?? ''));
    if (cart && cart.status === 'pending_approval') {
      cart.status = 'cancelled';
    }
    res.send(resultPage({ title: 'Payment cancelled', message: 'No money was taken.', ok: false }));
  });

  // --- Webhook: late status updates. Rejected unless PayPal's own verification says SUCCESS. ---
  app.post('/api/paypal/webhook', async (req, res) => {
    try {
      const ok = await paypal.verifyWebhook({ webhookId: config.paypalWebhookId, headers: req.headers, event: req.body });
      if (!ok) return res.sendStatus(401);
    } catch (err) {
      console.error('webhook verification failed:', err.message);
      return res.sendStatus(401);
    }
    const event = req.body ?? {};
    const orderId = event.resource?.supplementary_data?.related_ids?.order_id ?? event.resource?.id;
    const cart = orderId ? store.getCartByOrderId(orderId) : null;
    if (cart && event.event_type === 'PAYMENT.CAPTURE.COMPLETED' && cart.status !== 'paid') {
      cart.status = 'paid';
      cart.captureId = event.resource?.id ?? cart.captureId;
    }
    res.sendStatus(200);
  });

  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  return app;
}

export function configFromEnv(env = process.env) {
  return {
    port: Number(env.PORT ?? 3000),
    publicBaseUrl: env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT ?? 3000}`,
    defaultSpendingLimit: Number(env.DEFAULT_SPENDING_LIMIT ?? 50),
    paypalWebhookId: env.PAYPAL_WEBHOOK_ID,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const config = configFromEnv(env);
  const agent = env.GEMINI_API_KEY
    ? createGeminiAgent({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-2.5-flash' })
    : createOfflineAgent();
  const paypal = createPayPalClient({
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
    baseUrl: env.PAYPAL_BASE_URL,
  });

  if (!env.GEMINI_API_KEY) console.warn('GEMINI_API_KEY not set: running the offline demo agent. Set it to use Gemini.');
  if (!paypal.isConfigured()) console.warn('PayPal sandbox credentials not set: chat works, checkout will return 503.');

  createApp({ agent, paypal, config }).listen(config.port, () => {
    console.log(`AgentCart backend on :${config.port} (agent: ${agent.name})`);
  });
}
