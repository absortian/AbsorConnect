// Sesión y conexiones contra el backend de desarrollo (docker compose up -d --wait).
// Prepara el entorno: tool/test_env.sh. Sin él, las pruebas se saltan.
import 'dart:io';

import 'package:absor_connect/src/api.dart';
import 'package:absor_connect/src/connections.dart';
import 'package:absor_connect/src/session.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // El binding de pruebas sustituye HTTP por uno falso que responde 400: aquí se usa la red real
  setUpAll(() => HttpOverrides.global = null);
  final apiUrl = Platform.environment['API_TEST_URL'];
  final skip = apiUrl == null ? 'sin API_TEST_URL (tool/test_env.sh)' : null;
  const password = 'contraseña-movil-1';

  Future<(Session, ConnectionsStore, String)> signedUp() async {
    FlutterSecureStorage.setMockInitialValues({});
    final session = Session(ApiClient(baseUrl: apiUrl));
    await session.restore();
    final email = 'movil-${DateTime.now().microsecondsSinceEpoch}@ejemplo.com';
    await session.register(email, password);
    return (session, ConnectionsStore(session), email);
  }

  test('registro, sesión recordada y errores por código', () async {
    final (session, _, email) = await signedUp();
    expect(session.isSignedIn, isTrue);
    expect(session.email, email);

    final again = Session(ApiClient(baseUrl: apiUrl));
    await again.restore();
    expect(again.token, session.token, reason: 'el token se recuerda en el almacén seguro');

    await expectLater(again.login(email, 'otra-cosa-1234'), throwsA(isA<ApiError>().having((e) => e.code, 'code', 'invalid_credentials')));
    await expectLater(ApiClient(baseUrl: 'http://127.0.0.1:1').request('GET', '/api/health'), throwsA(isA<ApiError>().having((e) => e.code, 'code', 'network_error')));
  }, skip: skip);

  test('conexiones: crear, carpeta con contenido, mover, conflicto con otro equipo y borrar en cascada', () async {
    final (session, store, email) = await signedUp();
    await store.load();
    expect(store.entries, isEmpty);

    final folder = Entry({'id': newUuid(), 'name': 'Trabajo', 'isFolder': true, 'parentId': null});
    final ssh = Entry({'id': newUuid(), 'name': 'Web', 'type': 'ssh', 'host': 'web.example', 'port': 22, 'username': 'deploy', 'authMethod': 'password', 'password': 'pw', 'parentId': null});
    await store.upsert(folder);
    await store.upsert(ssh);
    await store.move(ssh.id, folder.id);
    expect(store.byId(ssh.id)!.parentId, folder.id);
    expect(store.byId(ssh.id)!.str('password'), 'pw');

    // Otro "equipo" con la misma cuenta guarda antes
    final other = ApiClient(baseUrl: apiUrl);
    final token = (await other.request('POST', '/api/auth/login', body: {'email': email, 'password': password, 'deviceName': 'Otro'}) as Map)['token'] as String;
    final current = await other.request('GET', '/api/connections', token: token) as Map<String, dynamic>;
    await other.request('PUT', '/api/connections', token: token, body: {
      'revision': current['revision'],
      'entries': [...current['entries'] as List, {'id': 'de-otro', 'name': 'Del otro equipo', 'type': 's3', 'endpoint': 'https://s3.example', 'accessKeyId': 'a', 'secretAccessKey': 'b'}],
    });
    await expectLater(store.upsert(Entry({'id': newUuid(), 'name': 'Nueva', 'isFolder': true})), throwsA(isA<ConnectionsConflict>()));
    expect(store.entries.map((e) => e.name), contains('Del otro equipo'), reason: 'la lista se recarga tras el conflicto');

    await store.remove(folder.id);
    expect(store.byId(ssh.id), isNull, reason: 'borrar una carpeta borra lo que contiene');
    expect(store.entries.map((e) => e.name), ['Del otro equipo']);
    expect(session.isSignedIn, isTrue);
  }, skip: skip);

  test('una sesión revocada desde otro equipo vuelve a la pantalla de acceso', () async {
    final (session, store, email) = await signedUp();
    var signedOut = false;
    session.addSignOutListener(() => signedOut = true);
    final other = ApiClient(baseUrl: apiUrl);
    final token = (await other.request('POST', '/api/auth/login', body: {'email': email, 'password': password, 'deviceName': 'Otro'}) as Map)['token'] as String;
    await other.request('PUT', '/api/me/password', token: token, body: {'currentPassword': password, 'newPassword': 'contraseña-nueva-2'});

    await expectLater(store.load(), throwsA(isA<ApiError>().having((e) => e.status, 'status', 401)));
    expect(session.isSignedIn, isFalse);
    expect(session.expired, isTrue);
    expect(signedOut, isTrue);
    expect(store.loaded, isFalse);
  }, skip: skip);
}
