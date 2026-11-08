import 'dart:async';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/models.dart';
import '../services/api.dart';
import 'cart_card.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  static const _suggestions = [
    'Cheapest frozen food bundle under \$30, no pork',
    'Vegetarian dinner for four under \$25',
    'Something with chicken for a family of 6',
  ];

  final _controller = TextEditingController();
  final _scroll = ScrollController();
  final List<ChatMessage> _messages = [
    ChatMessage(
      sender: Sender.agent,
      text:
          'Hi! Tell me what you want and your budget. I will build a cart, and you decide whether to pay.',
    ),
  ];
  final Map<String, Cart> _carts = {};
  final Map<String, String> _approvalUrls = {};

  double _spendingLimit = 50;
  bool _thinking = false;
  String? _confirmingCartId;
  Timer? _poller;

  @override
  void dispose() {
    _poller?.cancel();
    _controller.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(_scroll.position.maxScrollExtent,
            duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      }
    });
  }

  void _showError(Object error) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(error.toString())));
  }

  Future<void> _send([String? preset]) async {
    final text = (preset ?? _controller.text).trim();
    if (text.isEmpty || _thinking) return;
    _controller.clear();
    setState(() {
      _messages.add(ChatMessage(sender: Sender.user, text: text));
      _thinking = true;
    });
    _scrollToEnd();

    try {
      final result = await widget.api.chat(text, spendingLimit: _spendingLimit);
      if (!mounted) return;
      setState(() {
        if (result.cart != null) _carts[result.cart!.id] = result.cart!;
        _messages.add(ChatMessage(
            sender: Sender.agent,
            text: result.reply,
            cartId: result.cart?.id,
            tools: result.tools));
      });
    } catch (e) {
      _showError(e);
    } finally {
      if (mounted) setState(() => _thinking = false);
      _scrollToEnd();
    }
  }

  /// Human check #1: only this tap can start a PayPal checkout.
  Future<void> _confirm(String cartId) async {
    setState(() => _confirmingCartId = cartId);
    try {
      final result = await widget.api.confirm(cartId);
      _carts[cartId] = result.cart;
      _approvalUrls[cartId] = result.approvalUrl;
      await _openPayPal(cartId);
      _startPolling(cartId);
    } catch (e) {
      _showError(e);
    } finally {
      if (mounted) setState(() => _confirmingCartId = null);
    }
  }

  Future<void> _openPayPal(String cartId) async {
    final url = _approvalUrls[cartId];
    if (url == null) return;
    final ok =
        await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (!ok)
      _showError('Could not open PayPal. Copy this link into a browser: $url');
  }

  /// Human check #2 happens inside PayPal. We just watch for the backend to record the result.
  void _startPolling(String cartId) {
    _poller?.cancel();
    var attempts = 0;
    _poller = Timer.periodic(const Duration(seconds: 2), (timer) async {
      attempts++;
      if (attempts > 150 || !mounted) {
        timer.cancel();
        return;
      }
      try {
        final cart = await widget.api.getCart(cartId);
        if (!mounted) return;
        setState(() => _carts[cartId] = cart);
        if (cart.isFinished) timer.cancel();
      } catch (_) {
        // Transient network errors: keep polling.
      }
    });
  }

  Future<void> _openSettings() async {
    var limit = _spendingLimit;
    final urlController = TextEditingController(text: widget.api.baseUrl);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => Padding(
        padding: EdgeInsets.fromLTRB(
            20, 20, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
        child: StatefulBuilder(
          builder: (context, setSheetState) => Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Settings', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 16),
              Text('Spending limit: \$${limit.toStringAsFixed(0)}'),
              const Text(
                  'The server will not let the agent propose a cart above this.',
                  style: TextStyle(fontSize: 12)),
              Slider(
                value: limit,
                min: 5,
                max: 200,
                divisions: 39,
                label: '\$${limit.toStringAsFixed(0)}',
                onChanged: (v) => setSheetState(() => limit = v),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: urlController,
                decoration: const InputDecoration(
                    labelText: 'Backend URL', border: OutlineInputBorder()),
                keyboardType: TextInputType.url,
              ),
              const SizedBox(height: 16),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('Done')),
              ),
            ],
          ),
        ),
      ),
    );
    if (!mounted) return;
    setState(() => _spendingLimit = limit);
    final newUrl = urlController.text.trim();
    if (newUrl.isNotEmpty && newUrl != widget.api.baseUrl) {
      await widget.api.saveBaseUrl(newUrl);
    }
    urlController.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('AgentCart'),
        actions: [
          IconButton(
              icon: const Icon(Icons.tune),
              tooltip: 'Settings',
              onPressed: _openSettings)
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              controller: _scroll,
              padding: const EdgeInsets.all(16),
              itemCount: _messages.length + (_thinking ? 1 : 0),
              itemBuilder: (context, i) {
                if (i == _messages.length) return const _ThinkingBubble();
                return _MessageBubble(
                  message: _messages[i],
                  cart: _messages[i].cartId == null
                      ? null
                      : _carts[_messages[i].cartId!],
                  confirming: _confirmingCartId == _messages[i].cartId,
                  onConfirm: _confirm,
                  onReopenPayPal: _openPayPal,
                );
              },
            ),
          ),
          if (_messages.length == 1)
            SizedBox(
              height: 48,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: [
                  for (final s in _suggestions)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child:
                          ActionChip(label: Text(s), onPressed: () => _send(s)),
                    ),
                ],
              ),
            ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
                      maxLength: 500,
                      decoration: InputDecoration(
                        hintText: 'What would you like to order?',
                        counterText: '',
                        filled: true,
                        fillColor: scheme.surfaceContainerHighest,
                        border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(24),
                            borderSide: BorderSide.none),
                        contentPadding: const EdgeInsets.symmetric(
                            horizontal: 20, vertical: 12),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                      onPressed: _thinking ? null : () => _send(),
                      icon: const Icon(Icons.send)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({
    required this.message,
    required this.cart,
    required this.confirming,
    required this.onConfirm,
    required this.onReopenPayPal,
  });

  final ChatMessage message;
  final Cart? cart;
  final bool confirming;
  final Future<void> Function(String cartId) onConfirm;
  final Future<void> Function(String cartId) onReopenPayPal;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isUser = message.sender == Sender.user;

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints:
            BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.86),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            crossAxisAlignment:
                isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
            children: [
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color:
                      isUser ? scheme.primary : scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Text(message.text,
                    style: TextStyle(
                        color: isUser ? scheme.onPrimary : scheme.onSurface)),
              ),
              if (message.tools.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4, left: 4),
                  child: Text(
                    'Agent used: ${message.tools.join(' → ')}',
                    style: TextStyle(fontSize: 11, color: scheme.outline),
                  ),
                ),
              if (cart != null)
                CartCard(
                  cart: cart!,
                  busy: confirming,
                  onConfirm: () => onConfirm(cart!.id),
                  onReopenPayPal: () => onReopenPayPal(cart!.id),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ThinkingBubble extends StatelessWidget {
  const _ThinkingBubble();

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 6),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(18),
        ),
        child: const SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2)),
      ),
    );
  }
}
