import 'dart:convert';

import 'package:file_picker/file_picker.dart';

import '../src/keys.dart';

class PickedKey {
  PickedKey(this.fileName, this.pem);

  final String fileName;
  final String pem;
}

/// Abre el selector del sistema para elegir el fichero de una clave privada y devuelve
/// su contenido, o null si se cancela. Lanza [FormatException] si no es una clave válida
/// para esa passphrase.
Future<PickedKey?> pickPrivateKey(String? passphrase) async {
  final files = await FilePicker.pickFiles();
  final file = files.firstOrNull;
  if (file == null) return null;
  final length = await file.length();
  if (length == null || length > 64 * 1024) throw const FormatException('size');
  final bytes = await file.readAsBytes();
  final pem = utf8.decode(bytes, allowMalformed: true);
  KeyStore.validate(pem, passphrase);
  return PickedKey(file.name, pem);
}
