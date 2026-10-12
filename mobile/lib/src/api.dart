import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

/// Error de la API con su código estable (`invalid_credentials`,
/// `connections_conflict`…) o `network_error` si no se pudo contactar.
class ApiError implements Exception {
  ApiError(this.code, this.status, [this.body]);

  final String code;
  final int status;
  final Object? body;

  /// Sin respuesta útil del servicio: sin red, timeout o un 5xx.
  bool get isUnavailable => status == 0 || status >= 500;

  @override
  String toString() => 'ApiError($code, $status)';
}

/// Cliente de la API de cuentas y conexiones (mismo contrato que el escritorio).
class ApiClient {
  ApiClient({String? baseUrl, http.Client? client})
      : baseUrl = (baseUrl ?? defaultBaseUrl).replaceAll(RegExp(r'/+$'), ''),
        _http = client ?? http.Client();

  /// Se cambia al compilar con `--dart-define=API_URL=…` (desarrollo).
  static const defaultBaseUrl = String.fromEnvironment('API_URL', defaultValue: 'https://absorconnect.absor.top');
  static const _timeout = Duration(seconds: 15);

  final String baseUrl;
  final http.Client _http;

  /// Se llama cuando una petición con token recibe un 401 (sesión caducada o revocada).
  void Function()? onUnauthorized;

  Future<dynamic> request(String method, String path, {String? token, Object? body}) async {
    final request = http.Request(method, Uri.parse('$baseUrl$path'))
      ..headers['Accept'] = 'application/json';
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }

    http.Response response;
    try {
      response = await http.Response.fromStream(await _http.send(request).timeout(_timeout)).timeout(_timeout);
    } on TimeoutException {
      throw ApiError('network_error', 0);
    } on SocketException {
      throw ApiError('network_error', 0);
    } on http.ClientException {
      throw ApiError('network_error', 0);
    }

    if (response.statusCode == 204) return null;
    Object? data;
    try {
      data = response.body.isEmpty ? null : jsonDecode(utf8.decode(response.bodyBytes));
    } on FormatException {
      data = null; // página de error de un proxy
    }
    if (response.statusCode >= 400) {
      final error = data is Map ? data['error'] : null;
      final code = error is Map && error['code'] is String
          ? error['code'] as String
          : (response.statusCode >= 500 ? 'server_error' : 'http_error');
      if (response.statusCode == 401 && token != null) onUnauthorized?.call();
      throw ApiError(code, response.statusCode, data);
    }
    return data;
  }
}
