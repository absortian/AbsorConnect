import 'dart:convert';
import 'dart:typed_data';

/// Ficheros y portapapeles del control remoto (add-remote-desktop D9), igual que
/// `src/shared/remote/transfer.ts`.
///
/// Ficheros, por el canal `file`: mensajes JSON y trozos binarios de hasta 64 KB con 4 bytes delante
/// (el id de la transferencia, big-endian). Los ids los elige siempre el controlador.
///   Envío al PC:     file-offer → file-accept | file-reject → trozos → file-end → file-done | file-error
///   Descarga del PC: file-request → file-start | file-reject → trozos → file-end
///   Carpetas del PC: fs-list → fs-entries
///   Los dos sentidos: file-cancel
///
/// Portapapeles, por el canal `control`: `clipboard {id, kind, index, count, data}` en trozos.
abstract final class TransferLimits {
  static const chunkBytes = 64 * 1024;

  /// Se deja de enviar mientras el canal tenga más de esto pendiente.
  static const bufferHighBytes = 1024 * 1024;
  static const clipboardTextMaxBytes = 1024 * 1024;
  static const clipboardImageMaxBytes = 10 * 1024 * 1024;
  static const clipboardPieceChars = 60000;
}

const _rejectReasons = {'disabled', 'not_found', 'denied', 'is_directory', 'io', 'busy'};
const _errorReasons = {'integrity', 'io', 'size'};

bool _isId(Object? value) => value is int && value > 0 && value <= 0xffffffff;

class FsEntry {
  const FsEntry({required this.name, required this.dir, required this.size, required this.mtime});

  final String name;
  final bool dir;
  final int size;
  final int mtime;
}

/// Mensaje de texto del canal `file`, ya validado.
class TransferMessage {
  const TransferMessage(this.type, this.id, this.data);

  final String type;
  final int id;
  final Map<String, dynamic> data;

  String? get name => data['name'] as String?;
  int? get size => data['size'] as int?;
  String? get reason => data['reason'] as String?;
  String? get sha256 => data['sha256'] as String?;
  String get path => data['path'] as String? ?? '';
  String? get parent => data['parent'] as String?;
  bool get truncated => data['truncated'] == true;
  String? get error => data['error'] as String?;

  List<FsEntry> get entries => [
        for (final e in (data['entries'] as List? ?? const []))
          if (e is Map && e['name'] is String && e['dir'] is bool && e['size'] is int)
            FsEntry(name: e['name'] as String, dir: e['dir'] as bool, size: e['size'] as int, mtime: (e['mtime'] as num?)?.toInt() ?? 0),
      ];

  /// null si no se reconoce o algún campo no es válido.
  static TransferMessage? parse(String raw) {
    Object? data;
    try {
      data = jsonDecode(raw);
    } on FormatException {
      return null;
    }
    if (data is! Map<String, dynamic>) return null;
    final type = data['type'], id = data['id'];
    if (type is! String || !_isId(id)) return null;
    final valid = switch (type) {
      'file-offer' || 'file-start' => data['name'] is String && (data['name'] as String).isNotEmpty && data['size'] is int && (data['size'] as int) >= 0,
      'file-accept' || 'file-cancel' => true,
      'file-reject' => _rejectReasons.contains(data['reason']),
      'file-end' => data['sha256'] is String && RegExp(r'^[0-9a-f]{64}$').hasMatch(data['sha256'] as String),
      'file-done' => data['name'] is String,
      'file-error' => _errorReasons.contains(data['reason']),
      'fs-entries' => data['path'] is String && data['entries'] is List && (data['parent'] == null || data['parent'] is String),
      _ => false,
    };
    return valid ? TransferMessage(type, id as int, data) : null;
  }

  static String encode(String type, int id, [Map<String, Object?> fields = const {}]) =>
      jsonEncode({'type': type, 'id': id, ...fields});
}

/// Trozo binario: 4 bytes con el id (big-endian) y los datos.
Uint8List encodeChunk(int id, List<int> data) {
  final frame = Uint8List(4 + data.length);
  ByteData.sublistView(frame).setUint32(0, id);
  frame.setRange(4, frame.length, data);
  return frame;
}

({int id, Uint8List data})? decodeChunk(Uint8List frame) {
  if (frame.length < 4 || frame.length > 4 + TransferLimits.chunkBytes) return null;
  final id = ByteData.sublistView(frame, 0, 4).getUint32(0);
  return _isId(id) ? (id: id, data: Uint8List.sublistView(frame, 4)) : null;
}

// --- Portapapeles --------------------------------------------------------------------

class ClipboardPiece {
  const ClipboardPiece({required this.id, required this.kind, required this.index, required this.count, required this.data});

  final int id;
  final String kind;
  final int index;
  final int count;
  final String data;

  Map<String, Object> toJson() => {'v': 1, 'type': 'clipboard', 'id': id, 'kind': kind, 'index': index, 'count': count, 'data': data};

  static ClipboardPiece? parse(Map<String, dynamic> m) {
    final maxCount = (TransferLimits.clipboardImageMaxBytes * 4 / 3 / TransferLimits.clipboardPieceChars).ceil() + 1;
    final id = m['id'], kind = m['kind'], index = m['index'], count = m['count'], data = m['data'];
    if (m['type'] != 'clipboard' || !_isId(id) || (kind != 'text' && kind != 'image')) return null;
    if (count is! int || count < 1 || count > maxCount || index is! int || index < 0 || index >= count) return null;
    if (data is! String || data.length > TransferLimits.clipboardPieceChars) return null;
    return ClipboardPiece(id: id as int, kind: kind as String, index: index, count: count, data: data);
  }
}

/// Trozos de un texto del portapapeles para el canal `control`; vacío si está vacío o no cabe.
List<ClipboardPiece> splitClipboardText(int id, String text) {
  if (text.isEmpty || utf8.encode(text).length > TransferLimits.clipboardTextMaxBytes) return const [];
  final parts = <String>[];
  var start = 0;
  while (start < text.length) {
    var end = (start + TransferLimits.clipboardPieceChars).clamp(0, text.length);
    final last = text.codeUnitAt(end - 1);
    if (end < text.length && last >= 0xD800 && last <= 0xDBFF) end--;
    parts.add(text.substring(start, end));
    start = end;
  }
  return [
    for (final (index, data) in parts.indexed) ClipboardPiece(id: id, kind: 'text', index: index, count: parts.length, data: data),
  ];
}

/// Junta los trozos del portapapeles del PC. Solo se usa el texto: el portapapeles del teléfono
/// es de texto (spec mobile-app). Uno nuevo descarta el que estuviera a medias.
class ClipboardAssembler {
  ({int id, String kind, int count, List<String> parts})? _current;

  /// El texto completo cuando llega el último trozo; null mientras falten o si es una imagen.
  String? add(ClipboardPiece piece) {
    if (piece.index == 0) _current = (id: piece.id, kind: piece.kind, count: piece.count, parts: <String>[]);
    final current = _current;
    if (current == null || current.id != piece.id || current.kind != piece.kind || current.count != piece.count || current.parts.length != piece.index) {
      _current = null;
      return null;
    }
    current.parts.add(piece.data);
    if (current.parts.length < current.count) return null;
    _current = null;
    if (current.kind != 'text') return null;
    final text = current.parts.join();
    return text.isEmpty || utf8.encode(text).length > TransferLimits.clipboardTextMaxBytes ? null : text;
  }
}
