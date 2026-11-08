class CartItem {
  CartItem({
    required this.id,
    required this.name,
    required this.quantity,
    required this.unitPrice,
    required this.lineTotal,
  });

  final String id;
  final String name;
  final int quantity;
  final String unitPrice;
  final String lineTotal;

  factory CartItem.fromJson(Map<String, dynamic> json) => CartItem(
        id: json['id'] as String,
        name: json['name'] as String,
        quantity: (json['quantity'] as num).toInt(),
        unitPrice: json['unitPrice'] as String,
        lineTotal: json['lineTotal'] as String,
      );
}

/// Cart states mirror the backend: proposed, confirmed, pending_approval,
/// capturing, paid, cancelled, failed.
class Cart {
  Cart({
    required this.id,
    required this.status,
    required this.items,
    required this.itemTotal,
    required this.shipping,
    required this.total,
    this.paypalOrderId,
    this.error,
  });

  final String id;
  final String status;
  final List<CartItem> items;
  final String itemTotal;
  final String shipping;
  final String total;
  final String? paypalOrderId;
  final String? error;

  bool get isDraft => status == 'proposed';
  bool get isWaitingForPayPal => status == 'pending_approval' || status == 'confirmed' || status == 'capturing';
  bool get isPaid => status == 'paid';
  bool get isFinished => status == 'paid' || status == 'cancelled' || status == 'failed';

  factory Cart.fromJson(Map<String, dynamic> json) => Cart(
        id: json['id'] as String,
        status: json['status'] as String,
        items: (json['items'] as List<dynamic>)
            .map((e) => CartItem.fromJson(e as Map<String, dynamic>))
            .toList(),
        itemTotal: json['itemTotal'] as String,
        shipping: json['shipping'] as String,
        total: json['total'] as String,
        paypalOrderId: json['paypalOrderId'] as String?,
        error: json['error'] as String?,
      );
}

class ChatResult {
  ChatResult({required this.reply, this.cart, required this.tools});

  final String reply;
  final Cart? cart;
  final List<String> tools;

  factory ChatResult.fromJson(Map<String, dynamic> json) => ChatResult(
        reply: json['reply'] as String,
        cart: json['cart'] == null ? null : Cart.fromJson(json['cart'] as Map<String, dynamic>),
        tools: (json['trace'] as List<dynamic>? ?? [])
            .map((t) => (t as Map<String, dynamic>)['tool'] as String)
            .toList(),
      );
}

enum Sender { user, agent }

class ChatMessage {
  ChatMessage({required this.sender, required this.text, this.cartId, this.tools = const []});

  final Sender sender;
  final String text;
  final String? cartId;
  final List<String> tools;
}
