import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:xml/xml.dart';

import 'connections.dart';

/// Error de S3 con un código estable (`s3_access_denied`, `s3_not_found`,
/// `network_error`…) y el código que devolvió el servicio, si lo hubo.
class S3Error implements Exception {
  S3Error(this.code, [this.detail]);

  final String code;
  final String? detail;

  @override
  String toString() => detail == null ? code : '$code: $detail';
}

class S3Object {
  S3Object(this.key, this.size, this.lastModified);

  final String key;
  final int size;
  final DateTime? lastModified;
}

class S3Listing {
  S3Listing(this.folders, this.objects);

  final List<String> folders; // prefijos completos acabados en "/"
  final List<S3Object> objects;
}

/// Cliente S3 mínimo con firma SigV4 y estilo de ruta (como `forcePathStyle` en el
/// escritorio), válido para AWS, MinIO, DigitalOcean Spaces, R2, Wasabi…
class S3Client {
  S3Client({required String endpoint, required this.region, required this.accessKey, required this.secretKey, http.Client? client})
      : endpoint = Uri.tryParse(normalizeEndpoint(endpoint)) ?? Uri(),
        _http = client ?? http.Client();

  /// Las claves de S3 nunca llevan espacios: se recortan por si se pegaron con un salto de línea.
  factory S3Client.fromConnection(Entry c) => S3Client(
        endpoint: c.str('endpoint'),
        region: c.str('region').trim().isEmpty ? 'us-east-1' : c.str('region').trim(),
        accessKey: c.str('accessKeyId').trim(),
        secretKey: c.str('secretAccessKey').trim(),
      );

  /// Endpoint tal como se guarda: sin espacios ni barras finales y con `https://` si se
  /// escribió solo el nombre del servidor (`s3.ejemplo.com`).
  static String normalizeEndpoint(String raw) {
    var value = raw.trim();
    if (value.isEmpty) return value;
    if (!value.contains('://')) value = 'https://$value';
    while (value.endsWith('/') && !value.endsWith('://')) {
      value = value.substring(0, value.length - 1);
    }
    return value;
  }

  /// Si el endpoint es una dirección http(s) con servidor.
  static bool isValidEndpoint(String raw) {
    final uri = Uri.tryParse(normalizeEndpoint(raw));
    return uri != null && (uri.scheme == 'http' || uri.scheme == 'https') && uri.host.isNotEmpty;
  }

  static const _timeout = Duration(seconds: 30);

  final Uri endpoint;
  final String region;
  final String accessKey;
  final String secretKey;
  final http.Client _http;

  Future<List<String>> listBuckets() async {
    final doc = await _xml('GET', '');
    return doc.findAllElements('Bucket').map((b) => b.getElement('Name')?.innerText ?? '').where((n) => n.isNotEmpty).toList();
  }

  Future<S3Listing> listObjects(String bucket, String prefix, {String delimiter = '/'}) async {
    final folders = <String>[];
    final objects = <S3Object>[];
    String? token;
    do {
      final doc = await _xml('GET', bucket, query: {
        'list-type': '2',
        'prefix': prefix,
        if (delimiter.isNotEmpty) 'delimiter': delimiter,
        'continuation-token': ?token,
      });
      for (final p in doc.findAllElements('CommonPrefixes')) {
        final value = p.getElement('Prefix')?.innerText;
        if (value != null) folders.add(value);
      }
      for (final c in doc.findAllElements('Contents')) {
        objects.add(S3Object(
          c.getElement('Key')?.innerText ?? '',
          int.tryParse(c.getElement('Size')?.innerText ?? '') ?? 0,
          DateTime.tryParse(c.getElement('LastModified')?.innerText ?? ''),
        ));
      }
      final truncated = doc.findAllElements('IsTruncated').firstOrNull?.innerText == 'true';
      token = truncated ? doc.findAllElements('NextContinuationToken').firstOrNull?.innerText : null;
    } while (token != null);
    return S3Listing(folders, objects);
  }

  Future<void> getObject(String bucket, String key, File target, void Function(int done, int? total) onProgress) async {
    final response = await _send('GET', '$bucket/$key');
    final total = response.contentLength;
    final sink = target.openWrite();
    var done = 0;
    try {
      await for (final chunk in response.stream) {
        sink.add(chunk);
        done += chunk.length;
        onProgress(done, total);
      }
    } on Object catch (error) {
      throw S3Error('network_error', error.toString());
    } finally {
      await sink.close();
    }
  }

  /// Subida en streaming: el cuerpo no se firma (`UNSIGNED-PAYLOAD`), así no hace falta
  /// leer el fichero dos veces. Va siempre por la conexión cifrada del endpoint.
  Future<void> putObject(String bucket, String key, Stream<List<int>> source, int length, void Function(int done, int? total) onProgress) async {
    var done = 0;
    final body = source.map((chunk) {
      done += chunk.length;
      onProgress(done, length);
      return chunk;
    });
    await (await _send('PUT', '$bucket/$key', body: body, contentLength: length)).stream.drain<void>();
  }

  /// "Carpeta": objeto vacío acabado en "/", como la crea el escritorio.
  Future<void> putEmpty(String bucket, String key) async {
    await (await _send('PUT', '$bucket/$key', bytes: Uint8List(0))).stream.drain<void>();
  }

  Future<void> deleteObject(String bucket, String key) async {
    await (await _send('DELETE', '$bucket/$key')).stream.drain<void>();
  }

  /// Borra todo lo que empieza por el prefijo, en lotes de 1000 (DeleteObjects).
  Future<void> deletePrefix(String bucket, String prefix) async {
    final keys = (await listObjects(bucket, prefix, delimiter: '')).objects.map((o) => o.key).toList();
    if (!keys.contains(prefix)) keys.add(prefix); // el marcador de la carpeta, si existe
    for (var i = 0; i < keys.length; i += 1000) {
      final batch = keys.sublist(i, i + 1000 > keys.length ? keys.length : i + 1000);
      final xml = '<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>'
          '${batch.map((k) => '<Object><Key>${const HtmlEscape(HtmlEscapeMode.element).convert(k)}</Key></Object>').join()}</Delete>';
      final bytes = Uint8List.fromList(utf8.encode(xml));
      await (await _send('POST', bucket, query: {'delete': ''}, bytes: bytes, extraHeaders: {
        'content-md5': base64.encode(md5.convert(bytes).bytes),
        'content-type': 'application/xml',
      }))
          .stream
          .drain<void>();
    }
  }

  Future<XmlDocument> _xml(String method, String path, {Map<String, String> query = const {}}) async {
    final response = await _send(method, path, query: query);
    final text = await response.stream.bytesToString();
    try {
      return XmlDocument.parse(text);
    } on XmlException {
      throw S3Error('s3_bad_response');
    }
  }

  /// Firma y envía. Lanza [S3Error] con el código de S3 si la respuesta no es 2xx.
  Future<http.StreamedResponse> _send(
    String method,
    String path, {
    Map<String, String> query = const {},
    Uint8List? bytes,
    Stream<List<int>>? body,
    int? contentLength,
    Map<String, String> extraHeaders = const {},
  }) async {
    if ((endpoint.scheme != 'http' && endpoint.scheme != 'https') || endpoint.host.isEmpty) {
      throw S3Error('s3_invalid_endpoint');
    }
    final basePath = endpoint.path;
    final canonicalPath = '$basePath/${path.split('/').map(_encode).join('/')}';
    final sortedQuery = query.entries.toList()..sort((a, b) => a.key.compareTo(b.key));
    final canonicalQuery = sortedQuery.map((e) => '${_encode(e.key)}=${_encode(e.value)}').join('&');
    final uri = Uri.parse('${endpoint.scheme}://${endpoint.authority}$canonicalPath${canonicalQuery.isEmpty ? '' : '?$canonicalQuery'}');

    final now = DateTime.now().toUtc();
    final amzDate = '${_date(now)}T${_two(now.hour)}${_two(now.minute)}${_two(now.second)}Z';
    final payloadHash = body != null ? 'UNSIGNED-PAYLOAD' : sha256.convert(bytes ?? const []).toString();
    final headers = <String, String>{
      'host': endpoint.hasPort && !_isDefaultPort(endpoint) ? '${endpoint.host}:${endpoint.port}' : endpoint.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extraHeaders,
    };
    final signedNames = headers.keys.map((k) => k.toLowerCase()).toList()..sort();
    final canonicalHeaders = signedNames.map((k) => '$k:${headers[k]!.trim()}\n').join();
    final signedHeaders = signedNames.join(';');
    final canonicalRequest = [method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
    final scope = '${_date(now)}/$region/s3/aws4_request';
    final stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256.convert(utf8.encode(canonicalRequest)).toString()].join('\n');
    List<int> key = utf8.encode('AWS4$secretKey');
    for (final part in [_date(now), region, 's3', 'aws4_request']) {
      key = Hmac(sha256, key).convert(utf8.encode(part)).bytes;
    }
    final signature = Hmac(sha256, key).convert(utf8.encode(stringToSign)).toString();

    final http.BaseRequest request;
    if (body != null) {
      final streamed = http.StreamedRequest(method, uri)..contentLength = contentLength;
      body.listen(streamed.sink.add, onDone: streamed.sink.close, onError: streamed.sink.addError, cancelOnError: true);
      request = streamed;
    } else {
      request = http.Request(method, uri)..bodyBytes = bytes ?? Uint8List(0);
    }
    // Una redirección perdería la firma y S3 respondería "acceso denegado": mejor decirlo
    request.followRedirects = false;
    request.headers.addAll({...headers..remove('host'), 'authorization': 'AWS4-HMAC-SHA256 Credential=$accessKey/$scope, SignedHeaders=$signedHeaders, Signature=$signature'});

    http.StreamedResponse response;
    try {
      response = await _http.send(request).timeout(_timeout);
    } on TimeoutException {
      throw S3Error('network_error', 'timeout');
    } on TlsException catch (error) {
      throw S3Error('s3_tls_error', error.osError?.message ?? error.message);
    } on SocketException catch (error) {
      throw S3Error('network_error', error.message);
    } on http.ClientException catch (error) {
      final tls = error.message.contains('CERTIFICATE') || error.message.contains('Handshake');
      throw S3Error(tls ? 's3_tls_error' : 'network_error', error.message);
    } on IOException catch (error) {
      throw S3Error('network_error', error.toString());
    }
    if (response.isRedirect || (response.statusCode >= 300 && response.statusCode < 400)) {
      await response.stream.drain<void>();
      throw S3Error('s3_redirect', response.headers['location'] ?? 'HTTP ${response.statusCode}');
    }
    if (response.statusCode >= 300) {
      final text = await response.stream.bytesToString();
      String? code;
      try {
        code = XmlDocument.parse(text).findAllElements('Code').firstOrNull?.innerText;
      } on XmlException {
        code = null;
      }
      throw S3Error(switch (response.statusCode) {
        401 || 403 => 's3_access_denied',
        404 => 's3_not_found',
        _ => 's3_error',
      }, code ?? 'HTTP ${response.statusCode}');
    }
    return response;
  }

  static bool _isDefaultPort(Uri uri) => (uri.scheme == 'https' && uri.port == 443) || (uri.scheme == 'http' && uri.port == 80);

  static String _two(int n) => n.toString().padLeft(2, '0');

  static String _date(DateTime t) => '${t.year}${_two(t.month)}${_two(t.day)}';

  /// Codificación URI de SigV4: todo salvo A-Z a-z 0-9 - _ . ~
  static String _encode(String value) {
    final out = StringBuffer();
    for (final byte in utf8.encode(value)) {
      final isUnreserved = (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39) ||
          byte == 0x2d || byte == 0x5f || byte == 0x2e || byte == 0x7e;
      out.write(isUnreserved ? String.fromCharCode(byte) : '%${byte.toRadixString(16).toUpperCase().padLeft(2, '0')}');
    }
    return out.toString();
  }
}
