import 'dart:convert';

import 'transfer.dart';

/// Protocolo v1 del canal `control` (add-remote-desktop D6/D9), el mismo que
/// `src/shared/remote/protocol.ts`. Los mensajes son JSON con `v` y `type`; los tipos desconocidos
/// se ignoran.
///
/// PC → móvil: hello, auth-result, features, displays, stream-quality, clipboard, bye.
/// Móvil → PC: auth, select-display, set-stream-quality, clipboard, bye.
const protocolVersion = 1;

/// Etiquetas de los canales de datos que crea el controlador (D9).
abstract final class Channels {
  static const control = 'control';
  static const input = 'input';
  static const pointer = 'pointer';
  static const file = 'file';
}

class DisplayInfo {
  const DisplayInfo({required this.id, required this.name, required this.width, required this.height, required this.primary});

  final String id;
  final String name;
  final double width;
  final double height;
  final bool primary;
}

sealed class HostMessage {
  const HostMessage();
}

class HelloMessage extends HostMessage {
  const HelloMessage({required this.salt, required this.iterations, required this.nonce, required this.hostName});

  final String salt;
  final int iterations;
  final String nonce;
  final String hostName;
}

/// `ok: false` con `wrong_password`, `locked` (con `retryAfter`) o `declined`.
class AuthResultMessage extends HostMessage {
  const AuthResultMessage({required this.ok, this.reason, this.retryAfter});

  final bool ok;
  final String? reason;
  final int? retryAfter;
}

/// Lo que el PC permite en esta sesión.
class FeaturesMessage extends HostMessage {
  const FeaturesMessage({required this.clipboard, required this.files, required this.audio, this.streamQuality = false, this.unattendedControl = false});

  final bool clipboard;
  final bool files;
  final bool audio;
  final bool streamQuality;
  /// Anuncio solamente; los analizadores de la extensión están en agent_protocol.dart.
  final bool unattendedControl;
}

enum StreamProfile { balanced, smooth, native }

StreamProfile? parseStreamProfile(Object? value) => StreamProfile.values.where((p) => p.name == value).firstOrNull;

class StreamQualityMessage extends HostMessage {
  const StreamQualityMessage(this.profile);
  final StreamProfile profile;
}

class DisplaysMessage extends HostMessage {
  const DisplaysMessage({required this.displays, required this.current});

  final List<DisplayInfo> displays;
  final String current;
}

class ClipboardMessage extends HostMessage {
  const ClipboardMessage(this.piece);

  final ClipboardPiece piece;
}

/// El PC cierra la sesión: `local` (Desconectar), `disabled`, `password_changed`, `signed_out`…
class ByeMessage extends HostMessage {
  const ByeMessage(this.reason);

  final String reason;
}

/// Mensaje del PC recibido por el canal `control`; null si no se reconoce o no es válido.
HostMessage? parseHostMessage(String raw) {
  Object? data;
  try {
    data = jsonDecode(raw);
  } on FormatException {
    return null;
  }
  if (data is! Map<String, dynamic>) return null;
  switch (data['type']) {
    case 'hello':
      final salt = data['salt'], iterations = data['iterations'], nonce = data['nonce'];
      if (salt is! String || iterations is! int || iterations < 1 || nonce is! String) return null;
      return HelloMessage(salt: salt, iterations: iterations, nonce: nonce, hostName: data['hostName'] is String ? data['hostName'] as String : '');
    case 'auth-result':
      if (data['ok'] == true) return const AuthResultMessage(ok: true);
      final retryAfter = data['retryAfter'];
      return AuthResultMessage(ok: false, reason: data['reason'] is String ? data['reason'] as String : 'connection_failed', retryAfter: retryAfter is num ? retryAfter.toInt() : null);
    case 'features':
      return FeaturesMessage(clipboard: data['clipboard'] == true, files: data['files'] == true, audio: data['audio'] == true, streamQuality: data['v'] == 1 && data['streamQuality'] == true, unattendedControl: data['v'] == 1 && data['unattendedControl'] == true);
    case 'stream-quality':
      final profile = parseStreamProfile(data['profile']);
      return data['v'] == 1 && profile != null ? StreamQualityMessage(profile) : null;
    case 'displays':
      final list = data['displays'];
      if (list is! List) return null;
      final displays = <DisplayInfo>[];
      for (final (index, item) in list.indexed) {
        if (item is! Map) continue;
        final bounds = item['bounds'];
        displays.add(DisplayInfo(
          id: '${item['id']}',
          name: item['name'] is String && (item['name'] as String).isNotEmpty ? item['name'] as String : '${index + 1}',
          width: bounds is Map && bounds['width'] is num ? (bounds['width'] as num).toDouble() : 0,
          height: bounds is Map && bounds['height'] is num ? (bounds['height'] as num).toDouble() : 0,
          primary: item['primary'] == true,
        ));
      }
      return DisplaysMessage(displays: displays, current: '${data['current']}');
    case 'clipboard':
      final piece = ClipboardPiece.parse(data);
      return piece == null ? null : ClipboardMessage(piece);
    case 'bye':
      return ByeMessage(data['reason'] is String ? data['reason'] as String : 'ended');
    default:
      return null;
  }
}

String authMessage(String proof) => jsonEncode({'v': protocolVersion, 'type': 'auth', 'proof': proof});

String selectDisplayMessage(String id) => jsonEncode({'v': protocolVersion, 'type': 'select-display', 'id': id});

String byeMessage([String reason = 'closed']) => jsonEncode({'v': protocolVersion, 'type': 'bye', 'reason': reason});

String setStreamQualityMessage(StreamProfile profile) => jsonEncode({'v': protocolVersion, 'type': 'set-stream-quality', 'profile': profile.name});
