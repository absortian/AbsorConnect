// Lo que tarda derivar K en el dispositivo (add-remote-desktop 7.2, Open Question de las iteraciones
// de PBKDF2): la cadena completa del vector del escritorio (600 000 iteraciones) con la ruta
// de cada sistema, tres veces. En un Android o un iPhone conectados:
//   flutter test integration_test/pbkdf2_test.dart -d <dispositivo>
import 'dart:convert';
import 'dart:io';

import 'package:absor_connect/src/remote/auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  test('PBKDF2-HMAC-SHA256 con 600 000 iteraciones', () async {
    // Vector "cadena completa PBKDF2+HMAC" de src/shared/remote/auth-vectors.json
    const password = 'contraseña-del-pc', salt = 'c2FsdC1maWpvLTE2LWJ5dA==', key = 'T/Ffxp4GTajIgqtVcHNXZtYMdnBBQF0IbEnYU8WgO70=';
    final times = <int>[];
    for (var i = 0; i < 3; i++) {
      final watch = Stopwatch()..start();
      final derived = await deriveKey(password, salt, 600000);
      times.add(watch.elapsedMilliseconds);
      expect(base64.encode(derived), key);
    }
    // ignore: avoid_print
    print('PBKDF2 ${jsonEncode({
          'system': Platform.operatingSystem,
          'version': Platform.operatingSystemVersion,
          'implementation': Platform.isIOS || Platform.isMacOS ? 'CommonCrypto' : 'Dart',
          'iterations': 600000,
          'ms': times,
        })}');
  }, timeout: const Timeout(Duration(minutes: 5)));
}
