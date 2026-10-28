import 'dart:async';

import 'package:absor_connect/src/api.dart';
import 'package:absor_connect/src/session.dart';
import 'package:absor_connect/src/remote/remote_api.dart';
import 'package:flutter_test/flutter_test.dart';

class Account extends Session {
  Account() : super(ApiClient(baseUrl: 'https://example.invalid'));
  String? owner = 'primera';
  Object? response;
  Completer<Object?>? pending;
  int requests = 0;
  @override
  String? get token => owner;
  @override
  Future<dynamic> request(String method, String path, {Object? body}) async {
    expect(method, 'GET');
    expect(path, '/api/devices');
    requests++;
    return pending?.future ?? response;
  }
}

void main() {
  const id = '12345678-1234-4abc-8def-123456789abc';
  Map<String, Object?> device(String key) => {
    'id': key,
    'online': true,
    'lastSeenAt': '2026-10-28T00:00:00+00:00',
    'remote': {'state': 'available'},
  };
  test('consulta solo el destino y valida ID antes de red', () async {
    final account = Account()
      ..response = {
        'devices': [device('otro'), device(id)],
      };
    final api = RemoteApi(account);
    final status = await api.availability(id);
    expect(status.available, true);
    expect(status.lastSeenAt, DateTime.utc(2026, 10, 28));
    await expectLater(api.availability('../otro'), throwsA(isA<ApiError>()));
    expect(account.requests, 1);
  });
  test('rechaza respuesta de una cuenta anterior', () async {
    final account = Account()..pending = Completer<Object?>();
    final request = RemoteApi(account).availability(id);
    account.owner = 'segunda';
    account.pending!.complete({
      'devices': [device(id)],
    });
    await expectLater(
      request,
      throwsA(isA<ApiError>().having((e) => e.status, 'estado', 401)),
    );
  });
  test(
    'equipo ausente, duplicado o presencia malformada no se ofrece',
    () async {
      for (final list in [
        [],
        [device(id), device(id)],
        [
          {...device(id), 'lastSeenAt': false},
        ],
        [
          {...device(id), 'online': 'true'},
        ],
      ]) {
        final account = Account()..response = {'devices': list};
        await expectLater(
          RemoteApi(account).availability(id),
          throwsA(isA<ApiError>()),
        );
      }
    },
  );
}
