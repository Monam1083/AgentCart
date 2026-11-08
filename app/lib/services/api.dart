import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../models/models.dart';

class ApiException implements Exception {
  ApiException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// Default backend address. The Android emulator reaches the host machine at 10.0.2.2.
String defaultBackendUrl() {
  if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
    return 'http://10.0.2.2:3000';
  }
  return 'http://localhost:3000';
}

String _randomSessionId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  final rng = Random.secure();
  return 'sess-${List.generate(24, (_) => chars[rng.nextInt(chars.length)]).join()}';
}

class ApiClient {
  ApiClient({required this.baseUrl, required this.sessionId, http.Client? client})
      : _http = client ?? http.Client();

  String baseUrl;
  final String sessionId;
  final http.Client _http;

  static Future<ApiClient> load() async {
    final prefs = await SharedPreferences.getInstance();
    var session = prefs.getString('sessionId');
    if (session == null) {
      session = _randomSessionId();
      await prefs.setString('sessionId', session);
    }
    return ApiClient(baseUrl: prefs.getString('backendUrl') ?? defaultBackendUrl(), sessionId: session);
  }

  Future<void> saveBaseUrl(String url) async {
    baseUrl = url.trim().replaceAll(RegExp(r'/+$'), '');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('backendUrl', baseUrl);
  }

  Uri _uri(String path, [Map<String, String>? query]) =>
      Uri.parse('$baseUrl$path').replace(queryParameters: query);

  Future<Map<String, dynamic>> _send(Future<http.Response> Function() request) async {
    final http.Response res;
    try {
      res = await request().timeout(const Duration(seconds: 60));
    } catch (e) {
      throw ApiException('Could not reach the backend at $baseUrl. Is it running? ($e)');
    }
    Map<String, dynamic> body;
    try {
      body = jsonDecode(res.body) as Map<String, dynamic>;
    } catch (_) {
      throw ApiException('Unexpected response from the backend (HTTP ${res.statusCode}).');
    }
    if (res.statusCode >= 400) {
      throw ApiException(body['error'] as String? ?? 'Request failed (HTTP ${res.statusCode}).');
    }
    return body;
  }

  Future<ChatResult> chat(String message, {required double spendingLimit}) async {
    final body = await _send(() => _http.post(
          _uri('/api/chat'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'sessionId': sessionId, 'message': message, 'spendingLimit': spendingLimit}),
        ));
    return ChatResult.fromJson(body);
  }

  /// Human check #1. Returns the PayPal approval URL to open.
  Future<({Cart cart, String approvalUrl})> confirm(String cartId) async {
    final body = await _send(() => _http.post(
          _uri('/api/carts/$cartId/confirm'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'sessionId': sessionId}),
        ));
    return (
      cart: Cart.fromJson(body['cart'] as Map<String, dynamic>),
      approvalUrl: body['approvalUrl'] as String,
    );
  }

  Future<Cart> getCart(String cartId) async {
    final body = await _send(() => _http.get(_uri('/api/carts/$cartId', {'sessionId': sessionId})));
    return Cart.fromJson(body['cart'] as Map<String, dynamic>);
  }
}
