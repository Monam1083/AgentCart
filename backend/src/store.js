// In-memory store for sessions, carts and orders.
// Good enough for a demo and for judges running it locally; swap for Firestore/Postgres to persist across restarts.

import { randomUUID } from 'node:crypto';
export function createStore() {
  const sessions = new Map();
  const carts = new Map();
  const cartByOrderId = new Map();

  return {
    getSession(id, defaults = {}) {
      let s = sessions.get(id);
      if (!s) {
        s = { id, history: [], spendingLimitCents: defaults.spendingLimitCents ?? 5000, createdAt: Date.now() };
        sessions.set(id, s);
      }
      return s;
    },

    saveCart(cart) {
      carts.set(cart.id, cart);
      if (cart.paypalOrderId) cartByOrderId.set(cart.paypalOrderId, cart.id);
      return cart;
    },

    newCartId() {
      return `cart_${randomUUID().slice(0, 12)}`;
    },

    getCart(id) {
      return carts.get(id) ?? null;
    },

    getCartByOrderId(orderId) {
      const id = cartByOrderId.get(orderId);
      return id ? carts.get(id) : null;
    },

    indexOrder(orderId, cartId) {
      cartByOrderId.set(orderId, cartId);
    },
  };
}
