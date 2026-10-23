// Equipos y solicitudes de sesión contra el backend de desarrollo (add-remote-desktop 7.2). El "PC"
// se simula con llamadas a la API, como hace el escritorio en hostService.dev.test.ts: la conexión
// WebRTC en sí se prueba en el emulador. Prepara el entorno: tool/test_env.sh; sin él, se saltan.
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:absor_connect/src/api.dart';
import 'package:absor_connect/src/remote/remote_api.dart';
import 'package:absor_connect/src/session.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  HttpOverrides.global = null;
  final apiUrl = Platform.environment['API_TEST_URL'];
  final skip = apiUrl == null ? 'sin API_TEST_URL (tool/test_env.sh)' : null;
  const password = 'contraseña-movil-1';

  // Una sola cuenta para todas las pruebas: el registro admite 5 altas por hora y por IP, y la
  // suite completa también da de alta las de account_test.dart
  late RemoteApi mobile;
  late String email;
  setUpAll(() async {
    if (apiUrl == null) return;
    FlutterSecureStorage.setMockInitialValues({});
    final session = Session(ApiClient(baseUrl: apiUrl));
    await session.restore();
    email = 'movil-remoto-${DateTime.now().microsecondsSinceEpoch}@ejemplo.com';
    await session.register(email, password);
    mobile = RemoteApi(session);
  });

  /// El móvil y un PC nuevo de la misma cuenta, con su propia sesión y su clave.
  Future<(RemoteApi, _FakePc)> setUpAccount() async {
    final login = await ApiClient(baseUrl: apiUrl).request('POST', '/api/auth/login', body: {'email': email, 'password': password, 'deviceName': 'Sobremesa'}) as Map;
    final pc = _FakePc(apiUrl!, login['token'] as String);
    await pc.register('Sobremesa de prueba');
    return (mobile, pc);
  }

  test('Equipos: el PC aparece en línea y disponible, y los servidores ICE llegan', () async {
    final (api, pc) = await setUpAccount();
    final devices = await api.devices();
    final device = devices.singleWhere((d) => d.id == pc.id);
    expect((device.name, device.platform, device.state, device.available), ('Sobremesa de prueba', 'linux', 'available', true));
    expect(await api.iceServers(), isNotEmpty, reason: 'al menos el STUN');
  }, skip: skip);

  test('solicitud de sesión: el PC la ve, responde y el móvil recibe la respuesta', () async {
    final (api, pc) = await setUpAccount();
    final requestId = await api.createRequest(pc.id, 'v=0 oferta del móvil');
    expect(await api.poll(requestId), isA<RequestPending>());

    final pending = await pc.poll();
    expect(pending.map((r) => (r['id'], r['offer'])), [(requestId, 'v=0 oferta del móvil')]);
    expect(pending.single['controllerName'], startsWith(Platform.operatingSystem), reason: 'el nombre del dispositivo del móvil (en las pruebas, el sistema)');
    await pc.answer(requestId, {'answer': 'v=0 respuesta del PC'});

    expect(await api.poll(requestId), isA<RequestAnswered>().having((a) => a.answer, 'answer', 'v=0 respuesta del PC'));
  }, skip: skip);

  test('rechazos y errores con su código: bloqueado, desactivado y PC inexistente', () async {
    final (api, pc) = await setUpAccount();
    final requestId = await api.createRequest(pc.id, 'v=0 oferta');
    await pc.poll();
    await pc.answer(requestId, {'rejected': {'reason': 'locked', 'retryAfter': 840}});
    expect(await api.poll(requestId), isA<RequestRejected>().having((r) => (r.reason, r.retryAfter), 'rechazo', ('locked', 840)));

    await pc.register('Sobremesa de prueba', state: 'disabled');
    expect((await api.devices()).singleWhere((d) => d.id == pc.id).state, 'disabled');
    await expectLater(api.createRequest(pc.id, 'v=0'), throwsA(isA<ApiError>().having((e) => e.code, 'code', 'remote_disabled')));
    await expectLater(api.createRequest(_uuid(), 'v=0'), throwsA(isA<ApiError>().having((e) => e.code, 'code', 'device_not_found')));
  }, skip: skip);
}

/// Un PC de la cuenta hablando con la API como lo hace HostService (X-Device-Key en sus operaciones).
class _FakePc {
  _FakePc(this.apiUrl, this.token);

  final String apiUrl;
  final String token;
  final String id = _uuid();
  final String key = base64Url.encode(List<int>.generate(32, (_) => Random.secure().nextInt(256))).replaceAll('=', '');

  Future<Object?> _call(String method, String path, [Object? body]) async {
    final request = http.Request(method, Uri.parse('$apiUrl$path'))
      ..headers.addAll({'Authorization': 'Bearer $token', 'X-Device-Key': key, 'Accept': 'application/json', if (body != null) 'Content-Type': 'application/json'});
    if (body != null) request.body = jsonEncode(body);
    final response = await http.Response.fromStream(await request.send());
    if (response.statusCode >= 400) throw StateError('${response.statusCode} ${response.body}');
    return response.body.isEmpty ? null : jsonDecode(response.body);
  }

  Future<void> register(String name, {String state = 'available'}) => _call('PUT', '/api/devices/$id', {
        'name': name,
        'platform': 'linux',
        'appVersion': '0.4.0',
        'remote': {'state': state, 'features': {'clipboard': true, 'files': true, 'audio': true}},
      });

  Future<List<Map<String, dynamic>>> poll() async =>
      ((await _call('GET', '/api/devices/$id/remote-requests') as Map)['requests'] as List).cast<Map<String, dynamic>>();

  Future<void> answer(String requestId, Map<String, Object> body) => _call('PUT', '/api/remote-requests/$requestId/answer', body);
}

String _uuid() {
  final bytes = List<int>.generate(16, (_) => Random.secure().nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
