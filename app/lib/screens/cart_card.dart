import 'package:flutter/material.dart';

import '../models/models.dart';

/// Shows the agent's draft cart and the human Confirm step.
/// The agent can only propose; this button is the only way to start a PayPal checkout.
class CartCard extends StatelessWidget {
  const CartCard({
    super.key,
    required this.cart,
    required this.busy,
    required this.onConfirm,
    required this.onReopenPayPal,
  });

  final Cart cart;
  final bool busy;
  final VoidCallback onConfirm;
  final VoidCallback onReopenPayPal;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Card(
      margin: const EdgeInsets.only(top: 8),
      elevation: 0,
      color: scheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: scheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.shopping_cart_outlined, size: 20),
                const SizedBox(width: 8),
                Text('Your cart', style: text.titleMedium),
                const Spacer(),
                _StatusChip(cart: cart),
              ],
            ),
            const Divider(height: 24),
            for (final item in cart.items)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: Text('${item.quantity} × ${item.name}')),
                    const SizedBox(width: 12),
                    Text(item.lineTotal),
                  ],
                ),
              ),
            const Divider(height: 24),
            _totalRow('Items', cart.itemTotal, text.bodyMedium),
            _totalRow('Shipping', cart.shipping, text.bodyMedium),
            _totalRow('Total', cart.total, text.titleMedium),
            const SizedBox(height: 12),
            _action(context),
          ],
        ),
      ),
    );
  }

  Widget _totalRow(String label, String value, TextStyle? style) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [Text(label, style: style), Text(value, style: style)],
        ),
      );

  Widget _action(BuildContext context) {
    if (cart.isDraft) {
      return SizedBox(
        width: double.infinity,
        child: FilledButton.icon(
          onPressed: busy ? null : onConfirm,
          icon: busy
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.lock_outline),
          label: Text(busy ? 'Starting PayPal…' : 'Confirm and pay with PayPal'),
        ),
      );
    }
    if (cart.isWaitingForPayPal) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(children: [
            SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
            SizedBox(width: 12),
            Expanded(child: Text('Waiting for you to approve the payment in PayPal…')),
          ]),
          const SizedBox(height: 8),
          TextButton(onPressed: onReopenPayPal, child: const Text('Reopen PayPal')),
        ],
      );
    }
    if (cart.isPaid) {
      return const Row(children: [
        Icon(Icons.check_circle, color: Color(0xFF0A7D3B)),
        SizedBox(width: 8),
        Expanded(child: Text('Paid. Your sandbox order is complete.')),
      ]);
    }
    return Row(children: [
      const Icon(Icons.info_outline),
      const SizedBox(width: 8),
      Expanded(child: Text(cart.status == 'cancelled' ? 'Payment cancelled. Nothing was charged.' : (cart.error ?? 'Payment did not complete.'))),
    ]);
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.cart});

  final Cart cart;

  @override
  Widget build(BuildContext context) {
    final label = switch (cart.status) {
      'proposed' => 'Draft',
      'confirmed' || 'pending_approval' || 'capturing' => 'Awaiting PayPal',
      'paid' => 'Paid',
      'cancelled' => 'Cancelled',
      _ => 'Failed',
    };
    return Chip(
      label: Text(label),
      visualDensity: VisualDensity.compact,
      padding: EdgeInsets.zero,
    );
  }
}
