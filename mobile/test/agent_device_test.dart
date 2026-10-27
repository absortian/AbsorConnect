import 'dart:convert';

import 'package:absor_connect/src/api.dart';
import 'package:absor_connect/src/remote/agent_device.dart';
import 'package:absor_connect/src/remote/remote_api.dart';
import 'package:absor_connect/src/session.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const id = '12345678-1234-4abc-8def-123456789abc';
  final caps = {
    'administration': true,
    'login': true,
    'secureAttention': false,
    'restart': true,
  };
  final native = {
    'mode': 'agent',
    'agentVersion': '0.1.0+vm',
    'capabilities': caps,
  };
  test('legado conserva su contrato y las capacidades declaradas no certifican viajes', () {
    final old = RemoteDevice.fromJson({
      'id': id,
      'online': true,
      'remote': {'state': 'available'},
    });
    expect(old.agent.mode, HostMode.legacy);
    expect(old.available, isTrue);
    final device = RemoteDevice.fromJson({
      'id': id,
      'online': false,
      'remote': {'state': 'available', ...native},
    });
    expect(device.agent.mode, HostMode.agent);
    expect(device.agent.capabilities!.restart, isTrue);
    expect(device.agent.certifiedForTravel, isFalse);
    expect(device.state, 'offline');
  });
  test(
    'metadatos incompletos y versiones desconocidas no conceden capacidades',
    () {
      for (final remote in [
        null,
        [],
        {'mode': 'future'},
        {...native, 'agentVersion': 'bad\n'},
        {
          ...native,
          'capabilities': {...caps, 'root': true},
        },
        {
          ...native,
          'capabilities': {...caps, 'login': 1},
        },
        {
          ...native,
          'capabilities': {'restart': true},
        },
        {...native, 'agentVersion': ''},
      ]) {
        final result = AgentDeviceInfo.fromRemote(remote);
        expect(result.mode, HostMode.unknown);
        expect(result.capabilities, isNull);
      }
    },
  );
  test('baja usa exclusivamente el ID validado y transmite el token solo al backend', () async {
    FlutterSecureStorage.setMockInitialValues({
      'session.token': 'acs_test_only',
      'session.email': 'lab@example.invalid',
    });
    final calls = <http.Request>[];
    final session = Session(
      ApiClient(
        baseUrl: 'https://example.invalid',
        client: MockClient((request) async {
          calls.add(request);
          if (request.method == 'GET') {
            return http.Response(
              jsonEncode({
                'devices': [
                  {'id': id, 'remote': native},
                ],
              }),
              200,
            );
          }
          return http.Response('', 204);
        }),
      ),
    );
    await session.restore();
    final api = RemoteApi(session);
    expect((await api.devices()).single.agent.mode, HostMode.agent);
    await api.revokeAgent(id);
    expect(calls.last.method, 'DELETE');
    expect(calls.last.url.path, '/api/devices/$id/agent');
    expect(calls.last.headers['Authorization'], 'Bearer acs_test_only');
    expect(calls.last.body, isEmpty);
    for (final bad in [
      '../me',
      '$id/../../connections',
      id.toUpperCase(),
      '$id\n',
    ]) {
      await expectLater(api.revokeAgent(bad), throwsA(isA<ApiError>()));
    }
    expect(calls.length, 2);
  });
  test('denegación de revocación se conserva sin reintentos ni afectar otras conexiones', () async {
    FlutterSecureStorage.setMockInitialValues({
      'session.token': 'acs_test_only',
    });
    var calls = 0;
    final session = Session(
      ApiClient(
        baseUrl: 'https://example.invalid',
        client: MockClient((request) async {
          calls++;
          return http.Response('{"error":{"code":"device_not_found"}}', 404);
        }),
      ),
    );
    await session.restore();
    await expectLater(
      RemoteApi(session).revokeAgent(id),
      throwsA(
        isA<ApiError>().having((e) => e.code, 'code', 'device_not_found'),
      ),
    );
    expect(calls, 1);
  });
}
