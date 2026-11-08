// The only things the AI agent can do. None of them touch PayPal.
// Totals are always computed here from catalog prices, never from model output.

import { PRODUCTS, getProduct, formatCents, shippingFor, CURRENCY } from './catalog.js';

const MAX_RESULTS = 8;
const MAX_LINE_QUANTITY = 10;

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  return value.map((t) => String(t).toLowerCase().trim()).filter(Boolean);
}

function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

function describe(p) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    price: formatCents(p.priceCents),
    priceCents: p.priceCents,
    serves: p.serves,
    pricePerServing: formatCents(Math.round(p.priceCents / p.serves)),
    tags: p.tags,
    inStock: p.stock > 0,
    description: p.description,
  };
}

export function searchProducts(args = {}) {
  const query = tokenize(args.query);
  const exclude = normalizeTags(args.exclude_tags);
  const require = normalizeTags(args.require_tags);
  const maxCents = Number.isFinite(args.max_price) ? Math.round(args.max_price * 100) : Infinity;
  const category = args.category ? String(args.category).toLowerCase() : null;
  const minServes = Number.isFinite(args.min_servings) ? args.min_servings : 0;

  const scored = [];
  for (const p of PRODUCTS) {
    if (p.stock <= 0) continue;
    if (p.priceCents > maxCents) continue;
    if (category && p.category !== category) continue;
    if (p.serves < minServes) continue;
    if (exclude.some((t) => p.tags.includes(t))) continue;
    if (require.some((t) => !p.tags.includes(t))) continue;

    let score = 0;
    if (query.length) {
      const haystack = `${p.name} ${p.description} ${p.category} ${p.tags.join(' ')}`.toLowerCase();
      for (const t of query) if (haystack.includes(t)) score += 1;
      if (score === 0) continue;
    }
    scored.push({ p, score });
  }

  scored.sort((a, b) => b.score - a.score || a.p.priceCents - b.p.priceCents);
  const results = scored.slice(0, MAX_RESULTS).map((s) => describe(s.p));
  return {
    count: results.length,
    results,
    note: results.length === 0 ? 'No in-stock products match. Relax a constraint or ask the user.' : undefined,
  };
}

export function compareOptions(args = {}) {
  const ids = Array.isArray(args.item_ids) ? args.item_ids.map(String) : [];
  if (ids.length < 2) return { error: 'Provide at least two item_ids to compare.' };

  const items = [];
  const unknown = [];
  for (const id of ids) {
    const p = getProduct(id);
    if (p) items.push(p);
    else unknown.push(id);
  }
  if (unknown.length) return { error: `Unknown item ids: ${unknown.join(', ')}` };

  const ranked = items
    .map((p) => ({ ...describe(p), perServingCents: p.priceCents / p.serves }))
    .sort((a, b) => a.perServingCents - b.perServingCents)
    .map(({ perServingCents, ...rest }) => rest);

  const cheapest = [...items].sort((a, b) => a.priceCents - b.priceCents)[0];
  return {
    rankedByValue: ranked,
    cheapestOverall: cheapest.id,
    bestValueId: ranked[0].id,
  };
}

/** Prices a list of {id, quantity} lines from the catalog. Returns {error} or a priced cart body. */
export function priceLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return { error: 'items must be a non-empty array of {id, quantity}.' };

  const merged = new Map();
  for (const line of lines) {
    const id = String(line?.id ?? '');
    const quantity = Number(line?.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
      return { error: `Quantity for ${id || 'an item'} must be a whole number from 1 to ${MAX_LINE_QUANTITY}.` };
    }
    merged.set(id, (merged.get(id) ?? 0) + quantity);
  }

  const items = [];
  let itemTotalCents = 0;
  for (const [id, quantity] of merged) {
    const p = getProduct(id);
    if (!p) return { error: `Unknown product id: ${id}` };
    if (p.stock < quantity) return { error: `${p.name} has only ${p.stock} in stock.` };
    const lineTotalCents = p.priceCents * quantity;
    itemTotalCents += lineTotalCents;
    items.push({ id: p.id, name: p.name, unitPriceCents: p.priceCents, quantity, lineTotalCents });
  }

  const shippingCents = shippingFor(itemTotalCents);
  return {
    items,
    itemTotalCents,
    shippingCents,
    totalCents: itemTotalCents + shippingCents,
    currency: CURRENCY,
  };
}

export function proposeCart(args, ctx) {
  const priced = priceLines(args?.items);
  if (priced.error) return { error: priced.error };

  const limit = ctx.session.spendingLimitCents;
  if (priced.totalCents > limit) {
    return {
      error: `Cart total ${formatCents(priced.totalCents)} is over the user's spending limit of ${formatCents(limit)}. Propose a cheaper cart or tell the user the limit blocks it.`,
    };
  }

  const cart = {
    id: ctx.store.newCartId(),
    sessionId: ctx.session.id,
    ...priced,
    status: 'proposed',
    createdAt: Date.now(),
  };
  ctx.store.saveCart(cart);
  ctx.lastCart = cart;

  return {
    cartId: cart.id,
    items: cart.items.map((i) => ({ name: i.name, quantity: i.quantity, lineTotal: formatCents(i.lineTotalCents) })),
    itemTotal: formatCents(cart.itemTotalCents),
    shipping: formatCents(cart.shippingCents),
    total: formatCents(cart.totalCents),
    status: 'proposed',
    next: 'The user must review the cart and tap Confirm. You cannot pay or confirm for them.',
  };
}

/** Name -> executor. This table is the agent's entire capability surface. */
export const TOOL_IMPLEMENTATIONS = {
  search_products: (args) => searchProducts(args),
  compare_options: (args) => compareOptions(args),
  propose_cart: (args, ctx) => proposeCart(args, ctx),
};

/** Gemini function declarations for the tools above. There is deliberately no payment tool. */
export const TOOL_DECLARATIONS = [
  {
    name: 'search_products',
    description: 'Search the frozen-food catalog. Returns in-stock products only, cheapest first among equal matches.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Keywords such as "chicken", "bundle", "pizza". May be empty to browse.' },
        max_price: { type: 'NUMBER', description: 'Maximum price per item in USD.' },
        category: { type: 'STRING', description: '"single" or "bundle".' },
        exclude_tags: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Dietary tags to exclude, e.g. ["pork"].' },
        require_tags: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Dietary tags required, e.g. ["vegetarian"].' },
        min_servings: { type: 'NUMBER', description: 'Minimum servings the item must provide.' },
      },
    },
  },
  {
    name: 'compare_options',
    description: 'Compare two or more products by value (price per serving). Use ids from search_products.',
    parameters: {
      type: 'OBJECT',
      properties: {
        item_ids: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Product ids to compare.' },
      },
      required: ['item_ids'],
    },
  },
  {
    name: 'propose_cart',
    description: 'Save a DRAFT cart for the user to review. This does not charge anything; the user must tap Confirm themselves.',
    parameters: {
      type: 'OBJECT',
      properties: {
        items: {
          type: 'ARRAY',
          description: 'Cart lines.',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING', description: 'Product id.' },
              quantity: { type: 'NUMBER', description: 'Whole number, 1 to 10.' },
            },
            required: ['id', 'quantity'],
          },
        },
      },
      required: ['items'],
    },
  },
];
