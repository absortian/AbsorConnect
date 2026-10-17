import 'dart:convert';
import 'dart:ffi';
import 'dart:io';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as crypto;
import 'package:ffi/ffi.dart';
import 'package:unorm_dart/unorm_dart.dart' as unorm;

import 'pbkdf2.dart';

/// Prueba de la contraseña del control remoto (add-remote-desktop D6), la misma que
/// `src/shared/remote/auth.ts` del escritorio, con sus mismos vectores (`auth-vectors.json`).
///
/// La contraseña del PC nunca viaja: el PC manda en `hello` {salt, iterations, nonce} y el móvil
/// responde con proof = HMAC-SHA256(K, contexto ‖ nonce ‖ huellaOferta ‖ huellaRespuesta), donde
/// K = PBKDF2(contraseña, salt, iterations). Las huellas DTLS atan la prueba a esta conexión.
const authContext = 'absor-remote-auth-v1';

/// Huella DTLS de una descripción de sesión: el valor de su primera línea `a=fingerprint:`.
String? sdpFingerprint(String sdp) =>
    RegExp(r'^a=fingerprint:(.+)$', multiLine: true).firstMatch(sdp.replaceAll('\r\n', '\n'))?.group(1)!.trim();

/// proof (base64) que demuestra conocer K para esta conexión.
String computeProof(
  List<int> key, {
  required String nonce,
  required String offerFingerprint,
  required String answerFingerprint,
}) {
  final message = utf8.encode('$authContext\n$nonce\n$offerFingerprint\n$answerFingerprint');
  return base64.encode(crypto.Hmac(crypto.sha256, key).convert(message).bytes);
}

/// K = PBKDF2-HMAC-SHA256(contraseña en NFC y UTF-8, salt, iteraciones): 32 bytes.
///
/// 600 000 iteraciones:
///   - iOS y macOS: `CCKeyDerivationPBKDF` de CommonCrypto (por FFI, sin plugin);
///   - el resto (Android y las pruebas en Linux): `pbkdf2HmacSha256`, en Dart, más del doble de
///     rápido que el `SecretKeyFactory` de Android (ver pbkdf2.dart).
/// Las dos van en otro isolate, para no congelar la interfaz.
Future<Uint8List> deriveKey(String password, String saltBase64, int iterations) {
  final secret = utf8.encode(unorm.nfc(password));
  final salt = base64.decode(saltBase64);
  if (Platform.isIOS || Platform.isMacOS) {
    return Isolate.run(() => _commonCryptoPbkdf2(secret, salt, iterations));
  }
  return Isolate.run(() => pbkdf2HmacSha256(secret, salt, iterations));
}

typedef _CCKeyDerivationPBKDFNative = Int32 Function(
    Uint32 algorithm, Pointer<Uint8> password, Size passwordLength, Pointer<Uint8> salt, Size saltLength,
    Uint32 prf, Uint32 rounds, Pointer<Uint8> derivedKey, Size derivedKeyLength);
typedef _CCKeyDerivationPBKDF = int Function(
    int algorithm, Pointer<Uint8> password, int passwordLength, Pointer<Uint8> salt, int saltLength,
    int prf, int rounds, Pointer<Uint8> derivedKey, int derivedKeyLength);

/// `kCCPBKDF2` y `kCCPRFHmacAlgSHA256` de `CommonCrypto/CommonKeyDerivation.h`.
const _kCCPBKDF2 = 2;
const _kCCPRFHmacAlgSHA256 = 3;

Uint8List _commonCryptoPbkdf2(List<int> secret, List<int> salt, int iterations) {
  final derive = DynamicLibrary.process().lookupFunction<_CCKeyDerivationPBKDFNative, _CCKeyDerivationPBKDF>('CCKeyDerivationPBKDF');
  final secretPtr = malloc<Uint8>(secret.isEmpty ? 1 : secret.length);
  final saltPtr = malloc<Uint8>(salt.isEmpty ? 1 : salt.length);
  final keyPtr = malloc<Uint8>(32);
  try {
    secretPtr.asTypedList(secret.length).setAll(0, secret);
    saltPtr.asTypedList(salt.length).setAll(0, salt);
    final status = derive(_kCCPBKDF2, secretPtr, secret.length, saltPtr, salt.length, _kCCPRFHmacAlgSHA256, iterations, keyPtr, 32);
    if (status != 0) throw StateError('CCKeyDerivationPBKDF: $status');
    return Uint8List.fromList(keyPtr.asTypedList(32));
  } finally {
    malloc
      ..free(secretPtr)
      ..free(saltPtr)
      ..free(keyPtr);
  }
}
