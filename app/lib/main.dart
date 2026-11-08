import 'package:flutter/material.dart';

import 'screens/chat_screen.dart';
import 'services/api.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final api = await ApiClient.load();
  runApp(AgentCartApp(api: api));
}

class AgentCartApp extends StatelessWidget {
  const AgentCartApp({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AgentCart',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0070BA)),
        useMaterial3: true,
      ),
      home: ChatScreen(api: api),
    );
  }
}
