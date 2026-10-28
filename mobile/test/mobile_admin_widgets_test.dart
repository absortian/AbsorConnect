import 'dart:async';

import 'package:absor_connect/l10n/app_localizations.dart';
import 'package:absor_connect/src/api.dart';
import 'package:absor_connect/src/session.dart';
import 'package:absor_connect/src/remote/agent_protocol.dart';
import 'package:absor_connect/src/remote/host_actions.dart';
import 'package:absor_connect/src/remote/remote_api.dart';
import 'package:absor_connect/src/remote/viewer_session.dart';
import 'package:absor_connect/ui/viewer_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class PresenceApi extends RemoteApi {
  PresenceApi() : super(Session(ApiClient(baseUrl: 'https://example.invalid')));
  bool online = true, newHeartbeat = false;
  int reads = 0;
  @override
  Future<RemoteAvailability> availability(String id) async {
    reads++;
    return RemoteAvailability(
      online: online,
      available: online,
      lastSeenAt: DateTime.utc(
        2026,
        10,
        28,
      ).add(Duration(seconds: newHeartbeat ? reads : 0)),
    );
  }
}

class ScreenSession extends ViewerSession {
  ScreenSession(PresenceApi api)
    : super(api, '12345678-1234-4abc-8def-123456789abc') {
    commands = HostActions(
      active: () => phase == ViewerPhase.connected,
      send: (command) async {
        sent.add(command);
        scheduleMicrotask(
          () => commands.receive(
            HostOperationResult(
              id: command.id,
              action: command.action,
              status: HostOperationStatus.accepted,
            ),
          ),
        );
      },
    );
    commands.addListener(notifyListeners);
  }
  late final HostActions commands;
  final sent = <HostOperation>[];
  int offers = 0, releases = 0;
  String? lastPassword;
  @override
  HostActions get operations => commands;
  @override
  bool get inputAllowed => false;
  @override
  bool get hasKey => false;
  @override
  Future<void> connect([String? password]) async {
    offers++;
    lastPassword = password;
    phase = ViewerPhase.connected;
    commands.setActions([AgentAction.lock, AgentAction.restart]);
    notifyListeners();
  }

  @override
  void releaseInput() {
    releases++;
  }

  @override
  Future<void> close() async {
    phase = ViewerPhase.closed;
    notifyListeners();
  }

  @override
  Future<void> recoverIfLost() async {}
  @override
  Future<void> dispose() async {
    commands.removeListener(notifyListeners);
    commands.dispose();
    await super.dispose();
  }
}

void main() {
  for (final locale in ['es', 'en']) {
    testWidgets(
      'acciones confirmadas, espera y cancelación en $locale a 360 px',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(360, 800));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        final api = PresenceApi();
        final session = ScreenSession(api);
        await tester.pumpWidget(
          MaterialApp(
            locale: Locale(locale),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: ViewerScreen(
              api: api,
              device: RemoteDevice.fromJson({
                'id': session.deviceId,
                'name': 'PC laboratorio',
                'platform': 'linux',
              }),
              password: 'prueba',
              sessionFactory: (_, _) => session,
            ),
          ),
        );
        await tester.pumpAndSettle();
        Future<void> choose(String label) async {
          await tester.tap(find.byKey(const Key('remote-admin')));
          await tester.pumpAndSettle();
          await tester.tap(find.text(label));
          await tester.pumpAndSettle();
        }

        await choose(locale == 'es' ? 'Bloquear' : 'Lock');
        expect(find.byKey(const Key('remote-admin-confirm')), findsOneWidget);
        expect(session.releases, 1);
        await tester.tap(find.byKey(const Key('remote-admin-cancel')));
        await tester.pumpAndSettle();
        expect(session.sent, isEmpty);
        await choose(locale == 'es' ? 'Reiniciar' : 'Restart');
        await tester.tap(find.byKey(const Key('remote-admin-accept')));
        await tester.pump(const Duration(seconds: 1));
        expect(session.sent.single.action, AgentAction.restart);
        expect(find.byKey(const Key('remote-restart-cancel')), findsOneWidget);
        expect(session.offers, 1);
        await tester.tap(find.byKey(const Key('remote-restart-cancel')));
        await tester.pumpAndSettle();
        api.online = false;
        await tester.tap(find.byKey(const Key('remote-restart-connect')));
        await tester.pumpAndSettle();
        expect(session.offers, 1);
        expect(find.byType(AlertDialog), findsNothing);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        await tester.pump(const Duration(milliseconds: 250));
      },
    );
  }
  testWidgets('retirar acciones cierra solo confirmación y no envía', (
    tester,
  ) async {
    final api = PresenceApi();
    final session = ScreenSession(api);
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: ViewerScreen(
          api: api,
          device: RemoteDevice.fromJson({
            'id': session.deviceId,
            'name': 'PC laboratorio',
          }),
          password: 'prueba',
          sessionFactory: (_, _) => session,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('remote-admin')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Lock'));
    await tester.pumpAndSettle();
    session.operations.setActions([]);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('remote-admin-confirm')), findsNothing);
    expect(session.sent, isEmpty);
    expect(find.byKey(const Key('remote-admin')), findsNothing);
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(milliseconds: 250));
  });
  testWidgets(
    'volver disponible pide contraseña nueva antes de publicar otra oferta',
    (tester) async {
      final api = PresenceApi()..newHeartbeat = true;
      final session = ScreenSession(api);
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('es'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: ViewerScreen(
            api: api,
            device: RemoteDevice.fromJson({
              'id': session.deviceId,
              'name': 'PC laboratorio',
            }),
            password: 'contraseña anterior ficticia',
            sessionFactory: (_, _) => session,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('remote-admin')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Reiniciar'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('remote-admin-accept')));
      await tester.pumpAndSettle();
      expect(session.offers, 1);
      await tester.tap(find.byKey(const Key('remote-restart-connect')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pc-password')), findsOneWidget);
      expect(session.offers, 1);
      await tester.enterText(
        find.byKey(const Key('pc-password')),
        'contraseña nueva ficticia',
      );
      await tester.tap(find.byKey(const Key('pc-password-connect')));
      await tester.pumpAndSettle();
      expect(session.offers, 2);
      expect(session.lastPassword, 'contraseña nueva ficticia');
      expect(find.byKey(const Key('remote-restart-status')), findsNothing);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(milliseconds: 250));
    },
  );
}
