import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiAgent, createOfflineAgent } from '../src/agent.js';
import { createStore } from '../src/store.js';

function setup(limitCents = 5000) {
  const store = createStore();
  const session = store.getSession('session-agent-1', { spendingLimitCents: limitCents });
  return { store, session, ctx: { store, session, lastCart: null } };
}

function jsonResponse(body, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) };
}

test('Gemini agent runs tool calls and returns the final text', async () => {
  const { session, ctx } = setup();
  const requests = [];
  const script = [
    { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'search_products', args: { category: 'bundle', max_price: 14, exclude_tags: ['pork'] } } }] } }] },
    { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'propose_cart', args: { items: [{ id: 'b01', quantity: 1 }] } } }] } }] },
    { candidates: [{ content: { role: 'model', parts: [{ text: 'I added the Student Bundle. Tap Confirm to pay.' }] } }] },
  ];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    return jsonResponse(script[requests.length - 1]);
  };

  const agent = createGeminiAgent({ apiKey: 'test-key', model: 'gemini-test', fetchImpl });
  const out = await agent.run({ session, message: 'cheapest bundle under $20, no pork', ctx });

  assert.equal(out.reply, 'I added the Student Bundle. Tap Confirm to pay.');
  assert.deepEqual(out.trace.map((t) => t.tool), ['search_products', 'propose_cart']);
  assert.ok(out.trace.every((t) => t.ok));
  assert.equal(ctx.lastCart.status, 'proposed');
  assert.equal(ctx.lastCart.totalCents, 1648);

  // API key goes in a header, not the URL, and the model name is used.
  assert.match(requests[0].url, /gemini-test:generateContent$/);
  assert.equal(requests[0].init.headers['x-goog-api-key'], 'test-key');
  assert.doesNotMatch(requests[0].url, /key=/);

  // Declared tools contain no payment tool.
  const declared = requests[0].body.tools[0].functionDeclarations.map((d) => d.name);
  assert.deepEqual(declared.sort(), ['compare_options', 'propose_cart', 'search_products']);

  // The tool result was fed back to the model on the next request.
  const lastTurn = requests[1].body.contents.at(-1);
  assert.equal(lastTurn.parts[0].functionResponse.name, 'search_products');
  assert.ok(lastTurn.parts[0].functionResponse.response.result.count > 0);

  // History keeps the conversation for the next turn.
  assert.equal(session.history[0].role, 'user');
  assert.ok(session.history.length >= 4);
});

test('Gemini agent survives an unknown tool and a tool error', async () => {
  const { session, ctx } = setup(500);
  const script = [
    { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'pay_now', args: {} } }] } }] },
    { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'propose_cart', args: { items: [{ id: 'b03', quantity: 1 }] } } }] } }] },
    { candidates: [{ content: { role: 'model', parts: [{ text: 'That is over your limit.' }] } }] },
  ];
  let i = 0;
  const agent = createGeminiAgent({ apiKey: 'k', fetchImpl: async () => jsonResponse(script[i++]) });
  const out = await agent.run({ session, message: 'pay for the family feast', ctx });

  assert.equal(out.reply, 'That is over your limit.');
  assert.deepEqual(out.trace.map((t) => t.ok), [false, false]);
  assert.equal(ctx.lastCart, null);
});

test('Gemini agent surfaces API errors', async () => {
  const { session, ctx } = setup();
  const agent = createGeminiAgent({ apiKey: 'bad', fetchImpl: async () => jsonResponse({ error: { message: 'API key not valid' } }, 400) });
  await assert.rejects(() => agent.run({ session, message: 'hi', ctx }), /API key not valid/);
});

test('Gemini agent stops looping after the step limit', async () => {
  const { session, ctx } = setup();
  const loop = { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'search_products', args: {} } }] } }] };
  const agent = createGeminiAgent({ apiKey: 'k', fetchImpl: async () => jsonResponse(loop) });
  const out = await agent.run({ session, message: 'browse forever', ctx });
  assert.match(out.reply, /ran out of steps/);
  assert.ok(out.trace.length <= 6);
});

test('offline agent: cheapest bundle under budget, no pork', async () => {
  const { session, ctx } = setup();
  const out = await createOfflineAgent().run({ session, message: 'order the cheapest frozen food bundle under $30, no pork', ctx });
  assert.equal(ctx.lastCart.items[0].id, 'b01');
  assert.ok(ctx.lastCart.totalCents <= 3000);
  assert.ok(out.trace.some((t) => t.tool === 'propose_cart'));
});

test('offline agent: says so when nothing fits', async () => {
  const { session, ctx } = setup();
  const out = await createOfflineAgent().run({ session, message: 'a bundle under $5', ctx });
  assert.equal(ctx.lastCart, null);
  assert.match(out.reply, /couldn't find/);
});
