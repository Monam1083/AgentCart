import 'package:agentcart/models/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final json = {
    'id': 'cart_1',
    'status': 'proposed',
    'items': [
      {'id': 'b01', 'name': 'Student Bundle', 'quantity': 1, 'unitPrice': '\$12.49', 'lineTotal': '\$12.49'},
    ],
    'itemTotal': '\$12.49',
    'shipping': '\$3.99',
    'total': '\$16.48',
    'paypalOrderId': null,
    'error': null,
  };

  test('Cart parses the backend payload', () {
    final cart = Cart.fromJson(json);
    expect(cart.items.single.name, 'Student Bundle');
    expect(cart.total, '\$16.48');
    expect(cart.isDraft, isTrue);
    expect(cart.isFinished, isFalse);
  });

  test('Cart status helpers', () {
    expect(Cart.fromJson({...json, 'status': 'pending_approval'}).isWaitingForPayPal, isTrue);
    expect(Cart.fromJson({...json, 'status': 'paid'}).isPaid, isTrue);
    expect(Cart.fromJson({...json, 'status': 'cancelled'}).isFinished, isTrue);
  });

  test('ChatResult parses reply, cart and tool names', () {
    final result = ChatResult.fromJson({
      'reply': 'Done',
      'cart': json,
      'trace': [
        {'tool': 'search_products', 'ok': true},
        {'tool': 'propose_cart', 'ok': true},
      ],
    });
    expect(result.reply, 'Done');
    expect(result.cart?.id, 'cart_1');
    expect(result.tools, ['search_products', 'propose_cart']);
  });

  test('ChatResult allows no cart', () {
    final result = ChatResult.fromJson({'reply': 'Nothing fits', 'cart': null, 'trace': []});
    expect(result.cart, isNull);
  });
}
