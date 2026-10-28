import 'dart:async';

import 'package:absor_connect/src/api.dart';
import 'package:absor_connect/src/remote/restart_wait.dart';
import 'package:absor_connect/src/remote/remote_api.dart';
import 'package:absor_connect/src/remote/background_lease.dart';
import 'package:absor_connect/src/remote/monotonic_clock.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final baseline = DateTime.utc(2026, 10, 28);
  RemoteAvailability present({
    bool online = true,
    bool available = true,
    int seconds = 0,
  }) => RemoteAvailability(
    online: online,
    available: available,
    lastSeenAt: baseline.add(Duration(seconds: seconds)),
  );
  test('reloj nativo disponible y creciente', () async {
    final clock = MobileMonotonicClock();
    final start = clock.nowMicros();
    expect(start, isNotNull);
    await Future<void>.delayed(const Duration(milliseconds: 2));
    expect(clock.nowMicros(), greaterThan(start!));
  });
  testWidgets('10 s conserva y 30 s cierra aun con Timer suspendido', (
    tester,
  ) async {
    var now = 0, expired = 0;
    final lease = BackgroundLease(
      onExpired: () => expired++,
      nowMicros: () => now,
    );
    addTearDown(lease.dispose);
    lease.pause();
    now = 10000000;
    expect(lease.resume(), true);
    expect(expired, 0);
    lease.pause();
    now = 41000000;
    expect(lease.resume(), false);
    expect(expired, 1);
    await tester.pump(const Duration(seconds: 31));
    expect(expired, 1);
    lease.renew();
    lease.pause();
    await tester.pump(const Duration(seconds: 30));
    expect(expired, 2);
  });
  test('reloj ausente o que retrocede cierra', () {
    int? now = 10;
    final lease = BackgroundLease(onExpired: () {}, nowMicros: () => now);
    lease.pause();
    now = 9;
    expect(lease.resume(), false);
    lease.renew();
    now = null;
    lease.pause();
    expect(lease.expired, true);
    lease.dispose();
  });
  testWidgets('exige cambio de presencia y no crea ofertas', (tester) async {
    var calls = 0;
    final wait = RestartWait(
      nowMicros: () => 0,
      status: () async {
        calls++;
        return calls == 1
            ? present()
            : calls == 2
            ? present(online: false, available: false)
            : present();
      },
    );
    addTearDown(wait.dispose);
    wait.start(baseline);
    await tester.pump();
    expect(wait.state, RestartWaitState.waiting);
    await tester.pump(const Duration(seconds: 2));
    expect(wait.state, RestartWaitState.waiting);
    await tester.pump(const Duration(seconds: 2));
    expect(wait.state, RestartWaitState.ready);
    expect(calls, 3);
  });
  testWidgets(
    'heartbeat nuevo permite disponibilidad, cancelación ignora respuesta tardía',
    (tester) async {
      final response = Completer<RemoteAvailability>();
      final wait = RestartWait(
        nowMicros: () => 0,
        status: () => response.future,
      );
      addTearDown(wait.dispose);
      wait.start(baseline);
      wait.cancel();
      response.complete(present(seconds: 10));
      await tester.pump();
      expect(wait.state, RestartWaitState.cancelled);
      final ready = RestartWait(
        nowMicros: () => 0,
        status: () async => present(seconds: 1),
      );
      addTearDown(ready.dispose);
      ready.start(baseline);
      await tester.pump();
      expect(ready.state, RestartWaitState.ready);
    },
  );
  testWidgets('HTTP colgado vence a cinco minutos y no solapa generaciones', (
    tester,
  ) async {
    final response = Completer<RemoteAvailability>();
    var calls = 0;
    final wait = RestartWait(
      nowMicros: () => 0,
      status: () {
        calls++;
        return response.future;
      },
    );
    addTearDown(wait.dispose);
    wait.start(baseline);
    await tester.pump(const Duration(minutes: 5));
    expect(wait.state, RestartWaitState.expired);
    expect(calls, 1);
    wait.start(baseline);
    await tester.pump();
    expect(calls, 1);
    wait.cancel();
    response.complete(present(seconds: 1));
    await tester.pump();
    expect(wait.state, RestartWaitState.cancelled);
  });
  testWidgets(
    'pausa consultas y al volver comprueba reloj antes de consultar',
    (tester) async {
      var now = 0, calls = 0;
      final wait = RestartWait(
        nowMicros: () => now,
        status: () async {
          calls++;
          return present();
        },
      );
      addTearDown(wait.dispose);
      wait.start(baseline);
      await tester.pump();
      wait.setForeground(false);
      await tester.pump(const Duration(seconds: 10));
      expect(calls, 1);
      now = 300000001;
      wait.setForeground(true);
      expect(wait.state, RestartWaitState.expired);
      expect(calls, 1);
    },
  );
  testWidgets('RetryAfter no extiende plazo y 401 es terminal', (tester) async {
    var calls = 0;
    final wait = RestartWait(
      nowMicros: () => 0,
      status: () async {
        calls++;
        throw ApiError('too_many_requests', 429, {
          'error': {
            'details': {'retryAfter': 400},
          },
        });
      },
    );
    addTearDown(wait.dispose);
    wait.start(baseline);
    await tester.pump(const Duration(seconds: 299));
    expect(calls, 1);
    await tester.pump(const Duration(seconds: 1));
    expect(wait.state, RestartWaitState.expired);
    final denied = RestartWait(
      nowMicros: () => 0,
      status: () async => throw ApiError('unauthenticated', 401),
    );
    addTearDown(denied.dispose);
    denied.start(baseline);
    await tester.pump();
    expect(denied.state, RestartWaitState.failed);
  });
}
