// Protocolo v1 del control remoto en Dart (add-remote-desktop 7.2): la prueba de la contraseña con
// los mismos vectores que el escritorio (src/shared/remote/auth-vectors.json), los mensajes del
// canal control, la entrada y las transferencias. Sin red.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:absor_connect/src/remote/auth.dart';
import 'package:absor_connect/src/remote/input.dart';
import 'package:absor_connect/src/remote/pbkdf2.dart';
import 'package:absor_connect/src/remote/protocol.dart';
import 'package:absor_connect/src/remote/transfer.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('autenticación (auth-vectors.json del escritorio)', () {
    final vectors = jsonDecode(File('../src/shared/remote/auth-vectors.json').readAsStringSync()) as Map<String, dynamic>;

    test('el contexto es el mismo', () => expect(vectors['context'], authContext));

    for (final v in (vectors['vectors'] as List).cast<Map<String, dynamic>>()) {
      test('prueba: ${v['note']}', () {
        final proof = computeProof(base64.decode(v['key'] as String),
            nonce: v['nonce'] as String, offerFingerprint: v['offerFingerprint'] as String, answerFingerprint: v['answerFingerprint'] as String);
        expect(proof, v['proof']);
      });
    }

    test('PBKDF2 con 600 000 iteraciones da la K del vector', () async {
      final v = (vectors['vectors'] as List).cast<Map<String, dynamic>>().firstWhere((v) => v.containsKey('password'));
      final watch = Stopwatch()..start();
      final key = await deriveKey(v['password'] as String, v['salt'] as String, v['iterations'] as int);
      // ignore: avoid_print
      print('PBKDF2 ${v['iterations']} iteraciones (${Platform.operatingSystem}): ${watch.elapsedMilliseconds} ms');
      expect(base64.encode(key), v['key']);
    }, timeout: const Timeout(Duration(minutes: 2)));

    test('la contraseña se normaliza a NFC, como en el escritorio', () async {
      // "ñ" precompuesta (U+00F1) y descompuesta (n + U+0303) dan la misma K
      final composed = await deriveKey('contraseña', 'c2FsdA==', 1000);
      final decomposed = await deriveKey('contraseña', 'c2FsdA==', 1000);
      expect(decomposed, composed);
    });

    // La ruta de Android, también en macOS (donde deriveKey va por CommonCrypto). Los dos primeros
    // son de la RFC 7914 (§11, primeros 32 bytes); los demás, de hashlib.pbkdf2_hmac de Python:
    // contraseña vacía, de 64 y de 65 bytes (se resume) y sales alrededor del límite de un bloque
    for (final (password, salt, iterations, expected) in [
      ('passwd', 'salt', 1, 'VawEblbjCJ/sFpHCJUS2BflBhSFt3gRl5oudV8INrLw='),
      ('Password', 'NaCl', 80000, 'TdzY9guYviGDDO5e8icB+WQaRBjQTAQUrv8Ih2s0q1Y='),
      ('', '', 1, '984LZT0tcqQQjPWr6RL/3Xd2Ftu7J6cOggTzri0Pb60='),
      ('a' * 64, 's' * 55, 2, '0Rkuhk8i6xUOdykDl7s7/UC9oCIzMfCJcIAJUKN9Gug='),
      ('b' * 65, 's' * 56, 3, 'kS7YRQXqgBJKqjjpMTHmfeROZLJP/BqnGYXtIPKcR+w='),
      ('contraseña muy larga ' * 8, 'x' * 64, 1000, '+wlYrlvjuv4h+M8mphOoCAmnxPhzt1ZyAaBS7aUnzzk='),
      ('ñandú', 'sal-de-100-bytes-' * 6, 4096, 'ViU+pQrG8n9lf6S9IgSdOhYREoSoakDUja4cXCFiJes='),
    ]) {
      test('PBKDF2 en Dart: ${utf8.encode(password).length} bytes de contraseña, ${salt.length} de sal, $iterations iteraciones', () {
        expect(base64.encode(pbkdf2HmacSha256(utf8.encode(password), utf8.encode(salt), iterations)), expected);
      });
    }

    test('PBKDF2 en Dart con 600 000 iteraciones da la K del vector', () {
      final v = (vectors['vectors'] as List).cast<Map<String, dynamic>>().firstWhere((v) => v.containsKey('password'));
      final watch = Stopwatch()..start();
      final key = pbkdf2HmacSha256(utf8.encode(v['password'] as String), base64.decode(v['salt'] as String), v['iterations'] as int);
      // ignore: avoid_print
      print('PBKDF2 en Dart, ${v['iterations']} iteraciones: ${watch.elapsedMilliseconds} ms');
      expect(base64.encode(key), v['key']);
    });

    test('cambiar una huella o el nonce cambia la prueba', () {
      final key = List<int>.filled(32, 7);
      final base = computeProof(key, nonce: 'n', offerFingerprint: 'A', answerFingerprint: 'B');
      expect(computeProof(key, nonce: 'n', offerFingerprint: 'A', answerFingerprint: 'C'), isNot(base));
      expect(computeProof(key, nonce: 'm', offerFingerprint: 'A', answerFingerprint: 'B'), isNot(base));
    });

    test('huella DTLS de una descripción de sesión (con CRLF)', () {
      const sdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\na=fingerprint:sha-256 AB:CD:EF  \r\na=fingerprint:sha-256 00:11\r\n';
      expect(sdpFingerprint(sdp), 'sha-256 AB:CD:EF');
      expect(sdpFingerprint('v=0\r\n'), isNull);
    });
  });

  group('canal control', () {
    test('hello, auth-result, features, displays y bye', () {
      final hello = parseHostMessage('{"v":1,"type":"hello","salt":"c2FsdA==","iterations":600000,"nonce":"bm9uY2U=","hostName":"Sobremesa"}');
      expect(hello, isA<HelloMessage>().having((m) => m.iterations, 'iterations', 600000).having((m) => m.hostName, 'hostName', 'Sobremesa'));

      final locked = parseHostMessage('{"v":1,"type":"auth-result","ok":false,"reason":"locked","retryAfter":896}') as AuthResultMessage;
      expect((locked.ok, locked.reason, locked.retryAfter), (false, 'locked', 896));
      expect((parseHostMessage('{"v":1,"type":"auth-result","ok":true}') as AuthResultMessage).ok, isTrue);

      final features = parseHostMessage('{"v":1,"type":"features","clipboard":true,"files":false,"audio":true}') as FeaturesMessage;
      expect((features.clipboard, features.files, features.audio), (true, false, true));

      final displays = parseHostMessage(jsonEncode({
        'v': 1,
        'type': 'displays',
        'current': '1',
        'displays': [
          {'id': 1, 'name': 'Integrada', 'bounds': {'x': 0, 'y': 0, 'width': 1512, 'height': 982}, 'scaleFactor': 2, 'primary': true},
          {'id': '10', 'name': '', 'bounds': {'x': -1069, 'y': 0, 'width': 1069, 'height': 744}, 'scaleFactor': 2, 'primary': false},
        ],
      })) as DisplaysMessage;
      expect(displays.current, '1');
      expect(displays.displays.map((d) => (d.id, d.name, d.width, d.primary)), [('1', 'Integrada', 1512.0, true), ('10', '2', 1069.0, false)]);

      expect((parseHostMessage('{"v":1,"type":"bye","reason":"password_changed"}') as ByeMessage).reason, 'password_changed');
    });

    test('se ignoran los tipos desconocidos y lo que no es JSON válido', () {
      expect(parseHostMessage('{"v":1,"type":"nuevo-en-v2"}'), isNull);
      expect(parseHostMessage('no es json'), isNull);
      expect(parseHostMessage('[1,2]'), isNull);
      expect(parseHostMessage('{"v":1,"type":"hello","salt":"x"}'), isNull);
    });

    test('extensión de calidad compatible con hosts anteriores y perfiles estrictos', () {
      final old = parseHostMessage('{"v":1,"type":"features","audio":true}') as FeaturesMessage;
      expect(old.streamQuality, isFalse);
      final current = parseHostMessage('{"v":1,"type":"features","streamQuality":true}') as FeaturesMessage;
      expect(current.streamQuality, isTrue);
      for (final profile in StreamProfile.values) {
        final message = parseHostMessage(jsonEncode({'v': 1, 'type': 'stream-quality', 'profile': profile.name})) as StreamQualityMessage;
        expect(message.profile, profile);
        expect(jsonDecode(setStreamQualityMessage(profile)), {'v': 1, 'type': 'set-stream-quality', 'profile': profile.name});
      }
      for (final profile in ['4k', '', null, 1, {}, ['smooth']]) {
        expect(parseHostMessage(jsonEncode({'v': 1, 'type': 'stream-quality', 'profile': profile})), isNull);
      }
      for (final version in [null, 0, 2, '1']) {
        expect(parseHostMessage(jsonEncode({'v': version, 'type': 'stream-quality', 'profile': 'smooth'})), isNull);
      }
    });

    test('lo que envía el móvil', () {
      expect(jsonDecode(authMessage('prueba')), {'v': 1, 'type': 'auth', 'proof': 'prueba'});
      expect(jsonDecode(selectDisplayMessage('10')), {'v': 1, 'type': 'select-display', 'id': '10'});
      expect(jsonDecode(byeMessage()), {'v': 1, 'type': 'bye', 'reason': 'closed'});
    });
  });

  group('entrada', () {
    test('los mensajes tienen la forma que valida el PC (parseInputEvent)', () {
      expect(jsonDecode(RemoteInput.move(1.5, -0.2)), {'v': 1, 'type': 'move', 'x': 1.0, 'y': 0.0});
      expect(jsonDecode(RemoteInput.button(2, down: true)), {'v': 1, 'type': 'button', 'button': 2, 'down': true});
      expect(jsonDecode(RemoteInput.wheel(0, 120)), {'v': 1, 'type': 'wheel', 'dx': 0, 'dy': 120, 'mode': 0});
      expect(jsonDecode(RemoteInput.key('KeyC', down: false)), {'v': 1, 'type': 'key', 'code': 'KeyC', 'down': false});
      expect(jsonDecode(RemoteInput.releaseAll()), {'v': 1, 'type': 'release-all'});
    });

    test('"Mañana" va como texto, y un texto largo en trozos sin partir un emoji', () {
      expect(RemoteInput.text('Mañana').map(jsonDecode), [
        {'v': 1, 'type': 'text', 'text': 'Mañana'},
      ]);
      final long = '${'a' * (RemoteInput.maxTextLength - 1)}😀fin';
      final parts = RemoteInput.text(long).map((m) => (jsonDecode(m) as Map)['text'] as String).toList();
      expect(parts.length, 2);
      expect(parts.every((p) => p.length <= RemoteInput.maxTextLength), isTrue);
      expect(parts.join(), long);
      expect(parts.last.startsWith('😀'), isTrue);
    });

    test('Ctrl+C: Ctrl, C y se sueltan al revés', () {
      final code = RemoteKeys.codeFor('c')!;
      expect(code, 'KeyC');
      expect(RemoteInput.combo([RemoteKeys.control, code]).map((m) => (jsonDecode(m) as Map).values.skip(2).toList()), [
        ['ControlLeft', true],
        ['KeyC', true],
        ['KeyC', false],
        ['ControlLeft', false],
      ]);
    });

    test('teclas por posición para las combinaciones', () {
      expect(RemoteKeys.codeFor('A'), 'KeyA');
      expect(RemoteKeys.codeFor('4'), 'Digit4');
      expect(RemoteKeys.codeFor(' '), 'Space');
      expect(RemoteKeys.codeFor('/'), 'Slash');
      expect(RemoteKeys.codeFor('ñ'), isNull, reason: 'sin tecla propia: va como texto');
      expect(RemoteKeys.codeFor('ab'), isNull);
    });
  });

  group('ficheros y portapapeles', () {
    test('trozo binario: 4 bytes con el id (big-endian) y los datos', () {
      final frame = encodeChunk(0x01020304, [9, 8, 7]);
      expect(frame, [1, 2, 3, 4, 9, 8, 7]);
      final chunk = decodeChunk(frame)!;
      expect(chunk.id, 0x01020304);
      expect(chunk.data, [9, 8, 7]);
      expect(decodeChunk(Uint8List.fromList([0, 0, 0, 0, 1])), isNull, reason: 'el id 0 no vale');
      expect(decodeChunk(Uint8List(4 + TransferLimits.chunkBytes + 1)..[3] = 1), isNull, reason: 'trozo demasiado grande');
    });

    test('mensajes del canal file', () {
      expect(TransferMessage.parse('{"type":"file-accept","id":3}')?.type, 'file-accept');
      expect(TransferMessage.parse('{"type":"file-done","id":3,"name":"informe (1).pdf"}')?.name, 'informe (1).pdf');
      expect(TransferMessage.parse('{"type":"file-reject","id":3,"reason":"disabled"}')?.reason, 'disabled');
      expect(TransferMessage.parse('{"type":"file-reject","id":3,"reason":"inventada"}'), isNull);
      expect(TransferMessage.parse('{"type":"file-end","id":3,"sha256":"${'a' * 64}"}')?.sha256, 'a' * 64);
      expect(TransferMessage.parse('{"type":"file-end","id":3,"sha256":"corto"}'), isNull);
      expect(TransferMessage.parse('{"type":"file-start","id":0,"name":"x","size":1}'), isNull);
      final listing = TransferMessage.parse(jsonEncode({
        'type': 'fs-entries',
        'id': 5,
        'path': '/home/ana',
        'parent': '/home',
        'entries': [
          {'name': 'Documentos', 'dir': true, 'size': 0, 'mtime': 1},
          {'name': 'foto.jpg', 'dir': false, 'size': 2048, 'mtime': 2},
          {'name': 'roto'},
        ],
      }))!;
      expect(listing.entries.map((e) => (e.name, e.dir, e.size)), [('Documentos', true, 0), ('foto.jpg', false, 2048)]);
      expect(jsonDecode(TransferMessage.encode('file-offer', 7, {'name': 'a.txt', 'size': 3})), {'type': 'file-offer', 'id': 7, 'name': 'a.txt', 'size': 3});
    });

    test('portapapeles: un texto largo va en trozos y se recompone', () {
      final text = '${'x' * (TransferLimits.clipboardPieceChars - 1)}😀${'y' * 100}';
      final pieces = splitClipboardText(9, text);
      expect(pieces.length, 2);
      expect(pieces.every((p) => p.data.length <= TransferLimits.clipboardPieceChars), isTrue);
      // Lo que viaja tiene la forma que valida el PC (parseClipboardPiece)
      expect(pieces.first.toJson().keys, ['v', 'type', 'id', 'kind', 'index', 'count', 'data']);
      final assembler = ClipboardAssembler();
      expect(assembler.add(ClipboardPiece.parse(pieces[0].toJson())!), isNull);
      expect(assembler.add(ClipboardPiece.parse(pieces[1].toJson())!), text);
    });

    test('portapapeles: una imagen o trozos desordenados no se aplican', () {
      final assembler = ClipboardAssembler();
      expect(assembler.add(const ClipboardPiece(id: 1, kind: 'image', index: 0, count: 1, data: 'iVBORw0KGgo=')), isNull);
      expect(assembler.add(const ClipboardPiece(id: 2, kind: 'text', index: 1, count: 2, data: 'b')), isNull);
      expect(splitClipboardText(3, ''), isEmpty);
    });
  });
}
