// Cliente S3 propio contra un servidor S3 que valida las firmas SigV4 (Versity Gateway).
// Prepara el entorno: tool/test_env.sh. Sin él, las pruebas se saltan.
import 'dart:convert';
import 'dart:io';

import 'package:absor_connect/src/connections.dart';
import 'package:absor_connect/src/remote_fs.dart';
import 'package:absor_connect/src/s3.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final endpoint = Platform.environment['S3_TEST_ENDPOINT'];
  final skip = endpoint == null ? 'sin S3_TEST_ENDPOINT (tool/test_env.sh)' : null;
  const bucket = 'pruebas';
  late S3Client client;
  late Directory tmp;

  setUpAll(() async {
    tmp = await Directory.systemTemp.createTemp('s3test');
  });
  setUp(() {
    client = S3Client(endpoint: endpoint ?? '', region: 'us-east-1', accessKey: 'testkey', secretKey: 'testsecret-1234');
  });
  tearDownAll(() => tmp.delete(recursive: true));

  Future<File> localFile(String name, String content) async => File('${tmp.path}/$name')..writeAsStringSync(content);
  Stream<List<int>> bytes(String s) => Stream.value(utf8.encode(s));

  test('lista los buckets', () async {
    expect(await client.listBuckets(), contains(bucket));
  }, skip: skip);

  test('sube, lista por prefijo, descarga y borra (incluidos nombres con espacios y tildes)', () async {
    const key = 'carpeta/año nuevo +1 (copia).txt';
    final progress = <int>[];
    await client.putObject(bucket, key, bytes('hola desde el móvil'), utf8.encode('hola desde el móvil').length, (done, _) => progress.add(done));
    expect(progress.last, utf8.encode('hola desde el móvil').length);

    final root = await client.listObjects(bucket, '');
    expect(root.folders, contains('carpeta/'));
    final inside = await client.listObjects(bucket, 'carpeta/');
    expect(inside.objects.map((o) => o.key), contains(key));

    final target = File('${tmp.path}/descarga.txt');
    await client.getObject(bucket, key, target, (_, _) {});
    expect(await target.readAsString(), 'hola desde el móvil');

    await client.deletePrefix(bucket, 'carpeta/');
    expect((await client.listObjects(bucket, 'carpeta/')).objects, isEmpty);
  }, skip: skip);

  test('una firma con la clave equivocada da acceso denegado', () async {
    final wrong = S3Client(endpoint: endpoint ?? '', region: 'us-east-1', accessKey: 'testkey', secretKey: 'otra');
    await expectLater(wrong.listBuckets(), throwsA(isA<S3Error>().having((e) => e.code, 'code', 's3_access_denied')));
  }, skip: skip);

  test('S3Fs: buckets en la raíz, carpetas, subir, descargar y borrar', () async {
    final fs = S3Fs(Entry({
      'id': 'x', 'name': 'Pruebas', 'type': 's3', 'endpoint': endpoint, 'region': '', 'accessKeyId': 'testkey', 'secretAccessKey': 'testsecret-1234', 'bucket': '',
    }));
    expect(await fs.initialPath(), '');
    expect(fs.canWrite(''), isFalse);
    final buckets = await fs.list('');
    expect(buckets.map((b) => b.path), contains('$bucket/'));

    await fs.mkdir('$bucket/', 'fotos');
    final file = await localFile('foto.jpg', 'jpeg');
    await fs.upload('$bucket/fotos/', UploadSource('foto.jpg', await file.length(), file.openRead), (_, _) {});
    final listing = await fs.list('$bucket/fotos/');
    expect(listing.single.name, 'foto.jpg');
    expect(listing.single.size, 4);
    expect(fs.parent('$bucket/fotos/'), '$bucket/');
    expect(fs.parent('$bucket/'), '');

    final target = File('${tmp.path}/foto-descargada.jpg');
    await fs.download(listing.single, target, (_, _) {});
    expect(await target.readAsString(), 'jpeg');

    final folder = (await fs.list('$bucket/')).firstWhere((i) => i.name == 'fotos');
    expect(folder.isDirectory, isTrue);
    await fs.delete(folder);
    expect((await fs.list('$bucket/')).where((i) => i.name == 'fotos'), isEmpty);
  }, skip: skip);

  // Sin servidor de pruebas: errores que en el móvil acababan en "Algo ha fallado"
  test('endpoint sin https:// se completa; uno inválido da un error claro', () async {
    expect(S3Client.normalizeEndpoint(' s3.ejemplo.com/ '), 'https://s3.ejemplo.com');
    expect(S3Client.normalizeEndpoint('http://10.0.2.2:7070'), 'http://10.0.2.2:7070');
    expect(S3Client.isValidEndpoint('s3.ejemplo.com'), isTrue);
    expect(S3Client.isValidEndpoint('ftp://s3.ejemplo.com'), isFalse);
    expect(S3Client.isValidEndpoint('https://'), isFalse);
    final invalid = S3Client(endpoint: 'ftp://s3.ejemplo.com', region: 'us-east-1', accessKey: 'a', secretKey: 'b');
    await expectLater(invalid.listBuckets(), throwsA(isA<S3Error>().having((e) => e.code, 'code', 's3_invalid_endpoint')));
  });

  test('una redirección (http → https) no se sigue: dice adónde redirige', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) {
      request.response
        ..statusCode = HttpStatus.movedPermanently
        ..headers.set('location', 'https://s3.ejemplo.com/')
        ..close();
    });
    final redirected = S3Client(endpoint: 'http://127.0.0.1:${server.port}', region: 'us-east-1', accessKey: 'a', secretKey: 'b');
    await expectLater(
      redirected.listBuckets(),
      throwsA(isA<S3Error>().having((e) => e.code, 'code', 's3_redirect').having((e) => e.detail, 'detail', 'https://s3.ejemplo.com/')),
    );
    await server.close(force: true);
  });

  test('un certificado no válido da un error de conexión segura', () async {
    // Servidor HTTPS con un certificado que el cliente no reconoce
    final server = await SecureServerSocket.bind(InternetAddress.loopbackIPv4, 0, _selfSignedContext());
    server.listen((socket) => socket.destroy(), onError: (_) {});
    final client = S3Client(endpoint: 'https://127.0.0.1:${server.port}', region: 'us-east-1', accessKey: 'a', secretKey: 'b');
    await expectLater(client.listBuckets(), throwsA(isA<S3Error>().having((e) => e.code, 'code', 's3_tls_error')));
    await server.close();
  }, skip: Process.runSync('which', ['openssl']).exitCode != 0 ? 'sin openssl' : null);
}

/// Certificado autofirmado de un solo uso para el servidor HTTPS de la prueba.
SecurityContext _selfSignedContext() {
  final dir = Directory.systemTemp.createTempSync('tls');
  Process.runSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', //
    '-keyout', '${dir.path}/key.pem', '-out', '${dir.path}/cert.pem',
  ]);
  final context = SecurityContext()
    ..useCertificateChain('${dir.path}/cert.pem')
    ..usePrivateKey('${dir.path}/key.pem');
  dir.deleteSync(recursive: true);
  return context;
}
