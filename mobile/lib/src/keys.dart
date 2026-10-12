import 'package:dartssh2/dartssh2.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Claves privadas importadas en este dispositivo, en el almacén seguro del sistema.
/// Su contenido nunca se envía al servicio: la cuenta solo guarda el nombre del fichero
/// (`privateKeyPath`) y la passphrase cifrada.
class KeyStore {
  KeyStore({FlutterSecureStorage? storage}) : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static String _key(String connectionId) => 'key:$connectionId';

  Future<String?> read(String connectionId) => _storage.read(key: _key(connectionId));

  Future<void> write(String connectionId, String pem) => _storage.write(key: _key(connectionId), value: pem);

  Future<void> delete(String connectionId) => _storage.delete(key: _key(connectionId));

  /// Comprueba que el texto es una clave privada OpenSSH/PEM que se puede abrir con esa
  /// passphrase. Lanza [FormatException] si no.
  static void validate(String pem, String? passphrase) {
    try {
      final pairs = SSHKeyPair.fromPem(pem, (passphrase?.isEmpty ?? true) ? null : passphrase);
      if (pairs.isEmpty) throw const FormatException('empty');
    } on Object catch (error) {
      throw FormatException(error.toString());
    }
  }
}
