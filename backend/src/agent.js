// The shopping agent. Gemini decides which tool to call; this module executes the tool
// (see tools.js) and feeds the result back. Gemini is never given a payment tool.

import { TOOL_DECLARATIONS, TOOL_IMPLEMENTATIONS, searchProducts, compareOptions, proposeCart } from './tools.js';
import { formatCents, shippingFor } from './catalog.js';

const MAX_STEPS = 6;
const MAX_HISTORY = 30;

export const SYSTEM_PROMPT = `You are AgentCart, a shopping assistant for a frozen-food store. You help the user find and cart items; a human always pays.

Rules:
- Use only your tools. Never invent products, prices or stock. Prices in tool results are the truth.
- The user's budget applies to the cart TOTAL, shipping included. Shipping is $3.99 unless the item total is $50 or more.
- Respect dietary constraints exactly (for example "no pork" means exclude_tags ["pork"]). Pass them as tool arguments.
- Typical flow: search_products, then compare_options when several items fit, then propose_cart with the best choice.
- propose_cart only saves a DRAFT. You cannot charge, confirm or pay. After proposing, tell the user briefly what is in the cart, the total, and that they need to review it and tap Confirm.
- If nothing fits, say so plainly and suggest the closest alternative or which constraint to relax. Do not stretch the budget.
- If the request is too vague to act on, ask one short clarifying question instead of guessing.
- Keep replies short and friendly.`;

function trimHistory(contents) {
  let trimmed = contents.slice(-MAX_HISTORY);
  // History must start with a user text turn, not a dangling tool response.
  while (trimmed.length && !(trimmed[0].role === 'user' && trimmed[0].parts?.some((p) => p.text))) {
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

function runTool(name, args, ctx, trace) {
  const impl = TOOL_IMPLEMENTATIONS[name];
  if (!impl) {
    trace.push({ tool: name, args, ok: false });
    return { error: `Unknown tool: ${name}` };
  }
  try {
    const result = impl(args ?? {}, ctx);
    trace.push({ tool: name, args, ok: !result?.error });
    return result;
  } catch (err) {
    trace.push({ tool: name, args, ok: false });
    return { error: `Tool failed: ${err.message}` };
  }
}

export function createGeminiAgent({ apiKey, model = 'gemini-2.5-flash', fetchImpl = fetch }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  async function callGemini(contents) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        generationConfig: { temperature: 0.2 },
      }),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
    if (!res.ok) {
      const err = new Error(`Gemini request failed (${res.status}): ${body.error?.message ?? text.slice(0, 200)}`);
      err.status = 502;
      throw err;
    }
    return body;
  }

  return {
    name: `gemini:${model}`,

    async run({ session, message, ctx }) {
      const trace = [];
      const contents = [...session.history, { role: 'user', parts: [{ text: message }] }];
      let reply = '';

      for (let step = 0; step < MAX_STEPS; step++) {
        const data = await callGemini(contents);
        const content = data.candidates?.[0]?.content;
        const parts = content?.parts ?? [];

        if (!content || parts.length === 0) {
          const reason = data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason ?? 'empty response';
          reply = `I couldn't produce an answer (${reason}). Try rephrasing your request.`;
          break;
        }

        const calls = parts.filter((p) => p.functionCall);
        if (calls.length === 0) {
          contents.push({ role: 'model', parts });
          reply = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
          break;
        }

        // Keep the model turn exactly as returned (it may carry thought signatures).
        contents.push({ role: 'model', parts });
        const responses = calls.map((p) => ({
          functionResponse: {
            name: p.functionCall.name,
            response: { result: runTool(p.functionCall.name, p.functionCall.args, ctx, trace) },
          },
        }));
        contents.push({ role: 'user', parts: responses });

        if (step === MAX_STEPS - 1) reply = 'I ran out of steps before finishing. Please try a simpler request.';
      }

      session.history = trimHistory(contents);
      return { reply: reply || 'Done.', trace };
    },
  };
}

// ---------------------------------------------------------------------------
// Offline demo agent: a deterministic rule-based stand-in used when no GEMINI_API_KEY is set,
// so the app and tests run anywhere. It calls the same tools as the Gemini agent.
// It is NOT the AI feature of the project; set GEMINI_API_KEY for that.
// ---------------------------------------------------------------------------

const DIET_WORDS = ['pork', 'beef', 'chicken', 'seafood', 'lamb', 'dairy'];
const KEYWORDS = ['chicken', 'beef', 'pizza', 'fish', 'shrimp', 'samosa', 'paratha', 'burger', 'kebab', 'biryani', 'fries', 'ice cream', 'dumplings', 'wings', 'berries', 'paneer'];

function parseBudgetCents(text) {
  const m = text.match(/(?:under|below|less than|within|up to|max(?:imum)?|budget(?: of)?)\s*\$?\s*(\d+(?:\.\d+)?)/i) || text.match(/\$\s*(\d+(?:\.\d+)?)/);
  return m ? Math.round(parseFloat(m[1]) * 100) : null;
}

export function createOfflineAgent() {
  return {
    name: 'offline-demo',

    async run({ session, message, ctx }) {
      const trace = [];
      const text = message.toLowerCase();
      const budgetCents = parseBudgetCents(text);

      const exclude = [];
      for (const m of text.matchAll(/\b(?:no|without|avoid|except)\s+(\w+)/g)) if (DIET_WORDS.includes(m[1])) exclude.push(m[1]);
      const require = [];
      if (/\bvegan\b/.test(text)) require.push('vegan');
      else if (/\bvegetarian\b|\bveggie\b/.test(text)) require.push('vegetarian');

      const query = KEYWORDS.filter((k) => text.includes(k)).join(' ');
      const wantsBundle = /\bbundle|combo|pack\b/.test(text);
      const args = { query, exclude_tags: exclude, require_tags: require, ...(wantsBundle ? { category: 'bundle' } : {}) };
      if (budgetCents) args.max_price = budgetCents / 100;

      const found = searchProducts(args);
      trace.push({ tool: 'search_products', args, ok: true });

      const fits = found.results
        .filter((p) => !budgetCents || p.priceCents + shippingFor(p.priceCents) <= budgetCents)
        .sort((a, b) => a.priceCents - b.priceCents);

      if (fits.length === 0) {
        const where = budgetCents ? ` under ${formatCents(budgetCents)} (shipping included)` : '';
        return { reply: `I couldn't find anything in stock${where} that matches. Try raising the budget or relaxing a dietary constraint.`, trace };
      }

      if (fits.length > 1) {
        const cmp = compareOptions({ item_ids: fits.slice(0, 4).map((p) => p.id) });
        trace.push({ tool: 'compare_options', args: { item_ids: fits.slice(0, 4).map((p) => p.id) }, ok: !cmp.error });
      }

      const pick = fits[0];
      const proposal = proposeCart({ items: [{ id: pick.id, quantity: 1 }] }, ctx);
      trace.push({ tool: 'propose_cart', args: { items: [{ id: pick.id, quantity: 1 }] }, ok: !proposal.error });

      if (proposal.error) return { reply: proposal.error, trace };
      return {
        reply: `(Offline demo mode, no Gemini key set.) The cheapest match is ${pick.name} at ${pick.price}. Your cart total with shipping is ${proposal.total}. Review it and tap Confirm to pay with PayPal.`,
        trace,
      };
    },
  };
}
