import 'dart:typed_data';

import 'package:crypto/crypto.dart' as crypto;

/// PBKDF2-HMAC-SHA256 con una salida de 32 bytes (un bloque), en Dart y sin reservar memoria en el
/// bucle: los estados de HMAC tras ipad y opad se calculan una vez, así que cada iteración son dos
/// compresiones de SHA-256 sobre un mensaje fijo de 32 bytes.
///
/// Es la ruta de Android (add-remote-desktop D12): la de `cryptography` en Dart tarda de cuatro a
/// cinco veces más, y la del sistema (`SecretKeyFactory`, BouncyCastle en Java) más del doble y
/// bloquea el hilo principal. En iOS y macOS se usa CommonCrypto (`auth.dart`).
Uint8List pbkdf2HmacSha256(List<int> password, List<int> salt, int iterations) {
  if (iterations < 1) throw ArgumentError.value(iterations, 'iterations');
  final key = password.length > 64 ? crypto.sha256.convert(password).bytes : password;
  final inner = _padState(key, 0x36), outer = _padState(key, 0x5c);

  // U1 = HMAC(P, salt ‖ INT(1)), con la sal de cualquier longitud
  final first = crypto.Hmac(crypto.sha256, password).convert([...salt, 0, 0, 0, 1]).bytes;
  final u = Uint32List(8), t = Uint32List(8), w = Uint32List(64);
  final firstWords = ByteData.sublistView(Uint8List.fromList(first));
  for (var i = 0; i < 8; i++) {
    u[i] = t[i] = firstWords.getUint32(i * 4);
  }
  // Uj = HMAC(P, Uj-1): 32 bytes tras un bloque ya procesado, con su relleno fijo (768 bits)
  for (var j = 1; j < iterations; j++) {
    _fillBlock(w, u);
    _compress(inner, w, u);
    _fillBlock(w, u);
    _compress(outer, w, u);
    for (var i = 0; i < 8; i++) {
      t[i] ^= u[i];
    }
  }
  final out = ByteData(32);
  for (var i = 0; i < 8; i++) {
    out.setUint32(i * 4, t[i]);
  }
  return out.buffer.asUint8List();
}

void _fillBlock(Uint32List w, Uint32List digest) {
  for (var i = 0; i < 8; i++) {
    w[i] = digest[i];
  }
  w[8] = 0x80000000;
  for (var i = 9; i < 15; i++) {
    w[i] = 0;
  }
  w[15] = (64 + 32) * 8;
}

/// Estado de SHA-256 tras el bloque de la clave con ipad (0x36) u opad (0x5c).
Uint32List _padState(List<int> key, int pad) {
  final block = Uint8List(64)..setAll(0, key);
  for (var i = 0; i < 64; i++) {
    block[i] ^= pad;
  }
  final data = ByteData.sublistView(block);
  final w = Uint32List(64);
  for (var i = 0; i < 16; i++) {
    w[i] = data.getUint32(i * 4);
  }
  final state = Uint32List(8);
  _compress(_initial, w, state);
  return state;
}

/// Compresión de SHA-256: `out` = `state` + f(`state`, `w[0..15]`). `w` tiene sitio para 64 palabras.
void _compress(Uint32List state, Uint32List w, Uint32List out) {
  for (var t = 16; t < 64; t++) {
    final x = w[t - 15], y = w[t - 2];
    // Uint32List recorta a 32 bits al guardar
    w[t] = w[t - 16] + (((x >> 7) | (x << 25)) ^ ((x >> 18) | (x << 14)) ^ (x >> 3)) + w[t - 7] +
        (((y >> 17) | (y << 15)) ^ ((y >> 19) | (y << 13)) ^ (y >> 10));
  }
  var a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
  // Solo importan los 32 bits bajos: basta con recortar a y e, que son los que se desplazan a la derecha
  for (var t = 0; t < 64; t++) {
    final t1 = h + (((e >> 6) | (e << 26)) ^ ((e >> 11) | (e << 21)) ^ ((e >> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + _k[t] + w[t];
    final t2 = (((a >> 2) | (a << 30)) ^ ((a >> 13) | (a << 19)) ^ ((a >> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c));
    h = g;
    g = f;
    f = e;
    e = (d + t1) & 0xffffffff;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) & 0xffffffff;
  }
  out[0] = state[0] + a;
  out[1] = state[1] + b;
  out[2] = state[2] + c;
  out[3] = state[3] + d;
  out[4] = state[4] + e;
  out[5] = state[5] + f;
  out[6] = state[6] + g;
  out[7] = state[7] + h;
}

final _initial = Uint32List.fromList(const [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);

final _k = Uint32List.fromList(const [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
