import 'dart:async';

import 'package:absor_connect/src/remote/agent_protocol.dart';
import 'package:absor_connect/src/remote/host_actions.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  HostActions fixture(
    List<HostOperation> sent, {
    Future<void> Function(HostOperation)? send,
  }) => HostActions(
    active: () => true,
    send: send ?? (operation) async => sent.add(operation),
  );
  testWidgets('cancelación y retirada de capacidad no envían', (tester) async {
    final sent = <HostOperation>[];
    final actions = fixture(sent);
    addTearDown(actions.dispose);
    actions.setActions([AgentAction.restart]);
    expect(
      (await actions.run(AgentAction.restart, () async => false)).status,
      HostActionStatus.cancelled,
    );
    final consent = Completer<bool>();
    final pending = actions.run(AgentAction.restart, () => consent.future);
    actions.setActions([]);
    consent.complete(true);
    expect((await pending).status, HostActionStatus.unavailable);
    expect(sent, isEmpty);
  });
  testWidgets(
    'correlaciona ID y acción, ignora duplicados, una orden pendiente',
    (tester) async {
      final sent = <HostOperation>[];
      final actions = fixture(sent);
      addTearDown(actions.dispose);
      actions.setActions([AgentAction.restart, AgentAction.lock]);
      final pending = actions.run(AgentAction.restart, () async => true);
      await tester.pump();
      expect(
        sent.single.id,
        matches(
          RegExp(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          ),
        ),
      );
      expect(
        (await actions.run(AgentAction.lock, () async => true)).status,
        HostActionStatus.unavailable,
      );
      expect(
        actions.receive(
          HostOperationResult(
            id: sent.single.id,
            action: AgentAction.lock,
            status: HostOperationStatus.accepted,
          ),
        ),
        false,
      );
      final result = HostOperationResult(
        id: sent.single.id,
        action: AgentAction.restart,
        status: HostOperationStatus.rejected,
        code: AgentError.notAllowed,
      );
      expect(actions.receive(result), true);
      expect((await pending).status, HostActionStatus.rejected);
      expect(actions.receive(result), false);
      expect(sent, hasLength(1));
    },
  );
  testWidgets(
    'envío colgado vence a 15 s sin repetir y bloquea hasta conexión nueva',
    (tester) async {
      final sent = <HostOperation>[];
      final stalled = Completer<void>();
      final actions = fixture(
        sent,
        send: (operation) {
          sent.add(operation);
          return stalled.future;
        },
      );
      addTearDown(actions.dispose);
      actions.setActions([AgentAction.restart]);
      final pending = actions.run(AgentAction.restart, () async => true);
      await tester.pump();
      await tester.pump(const Duration(seconds: 15));
      expect((await pending).status, HostActionStatus.timedOut);
      expect(actions.state.blocked, true);
      expect(
        (await actions.run(AgentAction.restart, () async => true)).status,
        HostActionStatus.unavailable,
      );
      stalled.complete();
      await tester.pump();
      expect(sent, hasLength(1));
    },
  );
  testWidgets('64 ID sin desalojos y reset resuelve pendientes', (
    tester,
  ) async {
    final sent = <HostOperation>[];
    final actions = fixture(sent);
    addTearDown(actions.dispose);
    actions.setActions([AgentAction.lock]);
    for (var i = 0; i < 64; i++) {
      final pending = actions.run(AgentAction.lock, () async => true);
      await tester.pump();
      actions.receive(
        HostOperationResult(
          id: sent.last.id,
          action: AgentAction.lock,
          status: HostOperationStatus.accepted,
        ),
      );
      expect((await pending).status, HostActionStatus.accepted);
    }
    expect(actions.state.blocked, true);
    expect(sent.map((s) => s.id).toSet(), hasLength(64));
    actions.reset();
    actions.setActions([AgentAction.lock]);
    final pending = actions.run(AgentAction.lock, () async => true);
    await tester.pump();
    actions.reset();
    expect((await pending).status, HostActionStatus.connectionLost);
  });
}
