import 'package:flutter/material.dart';

import 'l10n/app_localizations.dart';
import 'src/services.dart';
import 'ui/auth_screen.dart';
import 'ui/home_screen.dart';
import 'ui/theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(AbsorConnectApp(services: AppServices.create()));
}

class AbsorConnectApp extends StatelessWidget {
  const AbsorConnectApp({super.key, required this.services});

  final AppServices services;

  @override
  Widget build(BuildContext context) => ServicesScope(
        services: services,
        child: MaterialApp(
          title: 'Absor Connect',
          debugShowCheckedModeBanner: false,
          theme: buildTheme(),
          darkTheme: buildTheme(),
          themeMode: ThemeMode.dark,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const SessionGate(),
        ),
      );
}

/// Sin sesión válida solo se ve la pantalla de acceso. Al volver a la app tras un rato
/// se releen las conexiones por si cambiaron desde otro equipo.
class SessionGate extends StatefulWidget {
  const SessionGate({super.key});

  @override
  State<SessionGate> createState() => _SessionGateState();
}

class _SessionGateState extends State<SessionGate> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => AppServices.of(context).session.restore());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) AppServices.of(context).connections.refreshIfStale();
  }

  @override
  Widget build(BuildContext context) {
    final session = AppServices.of(context).session;
    return ListenableBuilder(
      listenable: session,
      builder: (context, _) {
        if (!session.restored) return const Scaffold(body: Center(child: CircularProgressIndicator()));
        // Al cerrar o caducar la sesión se cierran todas las pantallas abiertas encima
        if (!session.isSignedIn) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
          });
          return const AuthScreen();
        }
        return const HomeScreen();
      },
    );
  }
}
