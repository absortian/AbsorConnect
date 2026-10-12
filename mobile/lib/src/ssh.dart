import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:dartssh2/dartssh2.dart';

import 'connections.dart';
import 'keys.dart';

/// Error de SSH con un código estable que la interfaz traduce
/// (`ssh_auth_failed`, `ssh_unreachable`, `ssh_key_missing`…).
class SshError implements Exception {
  SshError(this.code, [this.detail]);

  final String code;
  final String? detail;

  @override
  String toString() => detail == null ? code : '$code: $detail';
}

/// Una conexión SSH por servidor, compartida por el explorador SFTP y las terminales
/// (como el pool del escritorio). La clave de host no se verifica (igual que en escritorio).
class SshPool {
  SshPool(this.keys);

  static const _connectTimeout = Duration(seconds: 15);

  final KeyStore keys;
  final Map<String, _Pooled> _clients = {};

  /// Identifica la configuración: si cambia (otra contraseña, otro host), se reconecta.
  static String _signature(Entry c) =>
      [c.str('host'), c.data['port'], c.str('username'), c.str('authMethod'), c.str('password'), c.str('privateKeyPath'), c.str('passphrase')].join('\u0000');

  Future<SSHClient> client(Entry connection) async {
    final existing = _clients[connection.id];
    if (existing != null && !existing.client.isClosed && existing.signature == _signature(connection)) {
      return existing.client;
    }
    existing?.client.close();
    _clients.remove(connection.id);

    final client = await _connect(connection);
    _clients[connection.id] = _Pooled(client, _signature(connection));
    client.done.whenComplete(() {
      if (identical(_clients[connection.id]?.client, client)) _clients.remove(connection.id);
    }).ignore();
    return client;
  }

  Future<SSHClient> _connect(Entry c) async {
    List<SSHKeyPair>? identities;
    if (c.str('authMethod') == 'privateKey') {
      final pem = await keys.read(c.id);
      if (pem == null) throw SshError('ssh_key_missing');
      try {
        identities = SSHKeyPair.fromPem(pem, c.str('passphrase').isEmpty ? null : c.str('passphrase'));
      } on Object catch (error) {
        throw SshError('ssh_key_invalid', error.toString());
      }
    }

    final port = c.data['port'] is int ? c.data['port'] as int : 22;
    SSHSocket socket;
    try {
      socket = await SSHSocket.connect(c.str('host'), port, timeout: _connectTimeout);
    } on TimeoutException {
      throw SshError('ssh_timeout');
    } on SocketException catch (error) {
      throw SshError('ssh_unreachable', error.message);
    }

    final client = SSHClient(
      socket,
      username: c.str('username'),
      identities: identities,
      onPasswordRequest: identities == null ? () => c.str('password') : null,
      onVerifyHostKey: (_, _) => true,
      authTimeout: _connectTimeout,
    );
    try {
      await client.authenticated;
    } on SSHAuthFailError {
      client.close();
      throw SshError('ssh_auth_failed');
    } on SSHAuthAbortError catch (error) {
      client.close();
      throw SshError('ssh_unreachable', error.toString());
    }
    return client;
  }

  Future<SftpClient> sftp(Entry connection) async => (await client(connection)).sftp();

  void closeAll() {
    for (final pooled in _clients.values) {
      pooled.client.close();
    }
    _clients.clear();
  }
}

class _Pooled {
  _Pooled(this.client, this.signature);

  final SSHClient client;
  final String signature;
}

/// Traduce cualquier error de red o de SSH a un [SshError].
SshError toSshError(Object error) {
  if (error is SshError) return error;
  if (error is SSHAuthFailError) return SshError('ssh_auth_failed');
  if (error is SftpStatusError) return SshError('sftp_error', error.message);
  if (error is SocketException) return SshError('ssh_unreachable', error.message);
  if (error is TimeoutException) return SshError('ssh_timeout');
  if (error is SSHError) return SshError('ssh_disconnected', error.toString());
  return SshError('ssh_error', error.toString());
}

/// Uint8List a partir de las listas que devuelven los streams de ficheros.
Stream<Uint8List> asBytes(Stream<List<int>> stream) =>
    stream.map((chunk) => chunk is Uint8List ? chunk : Uint8List.fromList(chunk));
