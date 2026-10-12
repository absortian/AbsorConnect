import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api.dart';

/// Sesión de este dispositivo: token y email en el almacén seguro del sistema
/// (Keychain en iOS, Keystore en Android). El token no se guarda en ningún otro sitio.
class Session extends ChangeNotifier {
  Session(this.api, {FlutterSecureStorage? storage}) : _storage = storage ?? const FlutterSecureStorage() {
    api.onUnauthorized = _expire;
  }

  static const _tokenKey = 'session.token';
  static const _emailKey = 'session.email';

  final ApiClient api;
  final FlutterSecureStorage _storage;

  String? _token;
  String? _email;
  bool _restored = false;
  bool _expired = false;

  /// Se llama al cerrar la sesión por cualquier motivo (cerrar SSH, vaciar cachés…).
  final List<VoidCallback> _onSignedOut = [];

  String? get token => _token;
  String? get email => _email;
  bool get isSignedIn => _token != null;
  bool get restored => _restored;

  /// La sesión se cerró porque el servicio la rechazó (caducada o revocada).
  bool get expired => _expired;

  void addSignOutListener(VoidCallback listener) => _onSignedOut.add(listener);

  Future<void> restore() async {
    try {
      _token = await _storage.read(key: _tokenKey);
      _email = await _storage.read(key: _emailKey);
    } on Exception {
      _token = null; // almacén ilegible (p. ej. restaurado en otro dispositivo)
    }
    _restored = true;
    notifyListeners();
  }

  Future<void> login(String email, String password) => _signIn('/api/auth/login', email, password);

  Future<void> register(String email, String password) => _signIn('/api/auth/register', email, password);

  Future<void> _signIn(String path, String email, String password) async {
    final result = await api.request('POST', path, body: {
      'email': email,
      'password': password,
      'deviceName': await _deviceName(),
    }) as Map<String, dynamic>;
    _token = result['token'] as String;
    _email = (result['user'] as Map<String, dynamic>)['email'] as String;
    _expired = false;
    await _storage.write(key: _tokenKey, value: _token);
    await _storage.write(key: _emailKey, value: _email);
    notifyListeners();
  }

  /// Autenticada con el token de la sesión actual.
  Future<dynamic> request(String method, String path, {Object? body}) {
    final token = _token;
    if (token == null) throw ApiError('unauthenticated', 401);
    return api.request(method, path, token: token, body: body);
  }

  /// Lo local se borra ya; la revocación en el servicio se intenta sin esperar.
  Future<void> logout() async {
    final token = _token;
    await _clear(expired: false);
    if (token != null) {
      api.request('POST', '/api/auth/logout', token: token).catchError((_) => null);
    }
  }

  void _expire() {
    if (_token == null) return;
    _clear(expired: true);
  }

  Future<void> _clear({required bool expired}) async {
    _token = null;
    _expired = expired;
    for (final listener in _onSignedOut) {
      listener();
    }
    notifyListeners();
    await _storage.delete(key: _tokenKey);
  }

  static Future<String> _deviceName() async {
    final info = DeviceInfoPlugin();
    try {
      if (Platform.isAndroid) {
        final android = await info.androidInfo;
        return 'Android · ${android.manufacturer} ${android.model}';
      }
      if (Platform.isIOS) {
        final ios = await info.iosInfo;
        return 'iOS · ${ios.utsname.machine}';
      }
    } on Exception {
      // sin datos del dispositivo
    }
    return Platform.operatingSystem;
  }
}
