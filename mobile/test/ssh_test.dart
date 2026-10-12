// SFTP y terminal contra un servidor SSH de pruebas (contraseña y clave privada).
// Prepara el entorno: tool/test_env.sh. Sin él, las pruebas se saltan.
import 'dart:convert';
import 'dart:io';

import 'package:absor_connect/src/connections.dart';
import 'package:absor_connect/src/keys.dart';
import 'package:absor_connect/src/remote_fs.dart';
import 'package:absor_connect/src/ssh.dart';
import 'package:absor_connect/src/terminals.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final port = int.tryParse(Platform.environment['SSH_TEST_PORT'] ?? '');
  final keyFile = Platform.environment['SSH_TEST_KEY'];
  final skip = port == null ? 'sin SSH_TEST_PORT (tool/test_env.sh)' : null;
  late SshPool pool;
  late KeyStore keys;
  late Directory tmp;

  Entry conn(Map<String, dynamic> extra) =>
      Entry({'id': 'ssh-1', 'name': 'Pruebas', 'type': 'ssh', 'host': '127.0.0.1', 'port': port, 'username': 'test', 'authMethod': 'password', 'password': 'test', ...extra});

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    keys = KeyStore();
    pool = SshPool(keys);
    tmp = await Directory.systemTemp.createTemp('sshtest');
  });
  tearDown(() async {
    pool.closeAll();
    await tmp.delete(recursive: true);
  });

  test('SFTP: crear carpeta, subir, listar, descargar y borrar con contenido', () async {
    final fs = SftpFs(pool, conn({}));
    final home = await fs.initialPath();
    await fs.mkdir(home, 'movil-prueba');
    final dir = '$home/movil-prueba';
    final source = File('${tmp.path}/a.txt')..writeAsStringSync('contenido de prueba');
    await fs.upload(dir, UploadSource('a b.txt', await source.length(), source.openRead), (_, _) {});
    final listing = await fs.list(dir);
    expect(listing.single.name, 'a b.txt');
    expect(listing.single.size, 19);

    final target = File('${tmp.path}/b.txt');
    await fs.download(listing.single, target, (_, _) {});
    expect(await target.readAsString(), 'contenido de prueba');

    final folder = (await fs.list(home)).firstWhere((i) => i.name == 'movil-prueba');
    await fs.delete(folder);
    expect((await fs.list(home)).where((i) => i.name == 'movil-prueba'), isEmpty);
  }, skip: skip);

  test('contraseña incorrecta y puerto cerrado dan errores comprensibles', () async {
    await expectLater(SftpFs(pool, conn({'password': 'mal'})).initialPath(), throwsA(isA<SshError>().having((e) => e.code, 'code', 'ssh_auth_failed')));
    await expectLater(SftpFs(pool, conn({'port': 1})).initialPath(), throwsA(isA<SshError>().having((e) => e.code, 'code', 'ssh_unreachable')));
  }, skip: skip);

  test('clave privada: falta importarla y, una vez importada, conecta', () async {
    final entry = conn({'authMethod': 'privateKey', 'privateKeyPath': 'id_test', 'passphrase': 'frase-de-prueba'})..data.remove('password');
    await expectLater(SftpFs(pool, entry).initialPath(), throwsA(isA<SshError>().having((e) => e.code, 'code', 'ssh_key_missing')));
    final pem = File(keyFile!).readAsStringSync();
    expect(() => KeyStore.validate(pem, 'otra'), throwsFormatException);
    KeyStore.validate(pem, 'frase-de-prueba');
    await keys.write(entry.id, pem);
    expect(await SftpFs(pool, entry).initialPath(), startsWith('/'));
  }, skip: keyFile == null ? 'sin SSH_TEST_KEY' : skip);

  test('terminal: ejecuta un comando, Ctrl+C interrumpe y la sesión se reconecta', () async {
    final session = TerminalSession(1, conn({}), 'Pruebas', pool);
    session.terminal.resize(100, 30);
    await session.connect();
    expect(session.status, TerminalStatus.open);

    String screen() => session.terminal.buffer.getText();
    Future<void> waitFor(String text) async {
      for (var i = 0; i < 100 && !screen().contains(text); i++) {
        await Future<void>.delayed(const Duration(milliseconds: 100));
      }
      expect(screen(), contains(text));
    }

    session.terminal.textInput('echo resultado-\$((6*7))\r');
    await waitFor('resultado-42');
    // El shell repite lo tecleado: se busca el resultado calculado (fin-42), no el texto
    session.terminal.textInput('sleep 30; echo fin-\$((40+2))\r');
    await Future<void>.delayed(const Duration(milliseconds: 500));
    session.terminal.onOutput!(String.fromCharCode(3)); // Ctrl+C
    session.terminal.textInput('echo tras-interrumpir\r');
    await waitFor('tras-interrumpir');
    expect(screen(), isNot(contains('fin-42')));

    session.terminal.textInput('exit\r');
    for (var i = 0; i < 50 && session.status == TerminalStatus.open; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
    expect(session.status, TerminalStatus.closed);
    await session.reconnect();
    expect(session.status, TerminalStatus.open);
    session.close();
    expect(utf8.encode(screen()), isNotEmpty);
  }, skip: skip, timeout: const Timeout(Duration(seconds: 60)));

  test('dos terminales a la vez en el mismo servidor, cada una con su salida', () async {
    final sessions = TerminalSessions(pool);
    final first = sessions.open(conn({}));
    final second = sessions.open(conn({}));
    expect([first.title, second.title], ['Pruebas', 'Pruebas (2)']);
    for (var i = 0; i < 100 && [first, second].any((s) => s.status != TerminalStatus.open); i++) {
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
    expect([first.status, second.status], [TerminalStatus.open, TerminalStatus.open]);

    Future<void> waitFor(TerminalSession session, String text) async {
      for (var i = 0; i < 100 && !session.terminal.buffer.getText().contains(text); i++) {
        await Future<void>.delayed(const Duration(milliseconds: 100));
      }
      expect(session.terminal.buffer.getText(), contains(text));
    }

    first.terminal.textInput('echo primera-\$((1+1))\r');
    second.terminal.textInput('echo segunda-\$((2+2))\r');
    await waitFor(first, 'primera-2');
    await waitFor(second, 'segunda-4');
    expect(first.terminal.buffer.getText(), isNot(contains('segunda')));

    // Cerrar una no cierra la otra (comparten la conexión SSH)
    sessions.close(first);
    second.terminal.textInput('echo sigue-\$((3+3))\r');
    await waitFor(second, 'sigue-6');
    expect(sessions.sessions, [second]);
    sessions.closeAll();
  }, skip: skip, timeout: const Timeout(Duration(seconds: 60)));
}
