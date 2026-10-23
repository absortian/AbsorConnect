import 'dart:convert';
import 'dart:io';

import 'package:absor_connect/src/remote/agent_protocol.dart';
import 'package:absor_connect/src/remote/protocol.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final vectors = jsonDecode(
    File('../src/shared/remote/agent-protocol-vectors.json').readAsStringSync(),
  ) as Map<String, dynamic>;
  for (final vector in vectors['valid'] as List) {
    test('acepta y reconstruye ${vector['name']}', () {
      final raw = jsonEncode(vector['message']);
      final AgentControlMessage? parsed = vector['direction'] == 'host'
          ? parseAgentHostMessage(raw)
          : parseAgentControllerMessage(raw);
      expect(parsed?.toJson(), vector['message']);
    });
  }
  for (final vector in vectors['invalid'] as List) {
    test('rechaza ${vector['name']}', () {
      final raw = jsonEncode(vector['message']);
      final AgentControlMessage? parsed = vector['direction'] == 'host'
          ? parseAgentHostMessage(raw)
          : parseAgentControllerMessage(raw);
      expect(parsed, isNull);
    });
  }
  test('limita bytes y rechaza JSON roto o mensajes de la otra dirección', () {
    final valid = vectors['valid'] as List;
    final controller = jsonEncode(
      valid.firstWhere((v) => v['direction'] == 'controller')['message'],
    );
    final host = jsonEncode(
      valid.firstWhere((v) => v['direction'] == 'host')['message'],
    );
    expect(
      parseAgentControllerMessage(controller.padRight(agentControlLimit)),
      isNotNull,
    );
    expect(
      parseAgentControllerMessage(controller.padRight(agentControlLimit + 1)),
      isNull,
    );
    expect(parseAgentHostMessage(host.padRight(agentControlLimit + 1)), isNull);
    for (final raw in ['', '{', 'null', '[]', 'true']) {
      expect(parseAgentControllerMessage(raw), isNull);
      expect(parseAgentHostMessage(raw), isNull);
    }
    expect(parseAgentControllerMessage(host), isNull);
    expect(parseAgentHostMessage(controller), isNull);
  });
  test('host anterior o versión desconocida no anuncian administración', () {
    for (final raw in [
      '{"v":1,"type":"features"}',
      '{"v":2,"type":"features","unattendedControl":true}',
      '{"type":"features","unattendedControl":true}',
      '{"v":1,"type":"features","unattendedControl":1}',
    ]) {
      expect(
        (parseHostMessage(raw) as FeaturesMessage).unattendedControl,
        isFalse,
      );
    }
    expect(
      (parseHostMessage(
        '{"v":1,"type":"features","unattendedControl":true}',
      ) as FeaturesMessage).unattendedControl,
      isTrue,
    );
    expect(
      parseHostMessage(
        '{"v":1,"type":"agent-context","extension":1,"state":"login","sequence":1,"imageAvailable":true}',
      ),
      isNull,
    );
  });
}
