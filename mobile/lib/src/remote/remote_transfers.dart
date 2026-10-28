import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart' as crypto;
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:path_provider/path_provider.dart';

import 'transfer.dart';
import 'viewer_session.dart';

enum RemoteTransferStatus { waiting, running, done, failed, cancelled }

/// Una transferencia de la sesión, para la lista de la pantalla.
class RemoteTransfer {
  RemoteTransfer(this.id, this.upload, this.name, this.size);

  final int id;

  /// Del móvil al PC (true) o del PC al móvil.
  final bool upload;
  final String name;
  final int size;
  int bytes = 0;
  RemoteTransferStatus status = RemoteTransferStatus.waiting;

  /// Al terminar: el nombre con el que quedó en el PC (envío) o el fichero local (descarga).
  String? result;

  /// Código del fallo (los mismos que el escritorio).
  String? error;

  bool get active => status == RemoteTransferStatus.waiting || status == RemoteTransferStatus.running;
}

/// Carpeta del PC (`fs-entries`).
class RemoteListing {
  const RemoteListing({required this.path, required this.parent, required this.entries, required this.truncated, this.error});

  final String path;
  final String? parent;
  final List<FsEntry> entries;
  final bool truncated;
  final String? error;
}

/// Ficheros y portapapeles de la sesión del móvil (add-remote-desktop D9/D12), como
/// `src/renderer/viewer/transfers.ts`:
///   - envío al PC desde Archivos o Fotos, en cola, leyendo por trozos con su SHA-256;
///   - descarga del PC a un fichero temporal, que después se comparte (hoja de compartir);
///   - portapapeles de texto: lo que copia el PC se aplica aquí, y lo de aquí se envía con un botón.
class RemoteTransfers extends ChangeNotifier {
  RemoteTransfers(this.session) {
    session
      ..onFileChannel = _attach
      ..onClipboard = _onClipboardPiece
      ..onContextBoundary = _contextBoundary;
  }

  final ViewerSession session;
  final List<RemoteTransfer> transfers = [];
  var _assembler = ClipboardAssembler();
  int _epoch = 0;
  bool _disposed = false;
  bool get _filesAllowed => !_disposed && session.features.files && session.agentContext.sensitiveAllowed;
  final _waiters = <int, ({Set<String> types, Completer<TransferMessage?> completer})>{};

  /// Descargas que aceptan trozos, con su fichero y su resumen.
  final _receiving = <int, ({IOSink sink, File file, ByteConversionSink hash, _Digest digest})>{};
  RTCDataChannel? _channel;
  int _nextId = 1;
  int _clipboardId = 0;
  Future<void> _uploads = Future.value();
  DateTime _lastNotify = DateTime.fromMillisecondsSinceEpoch(0);

  void _attach(RTCDataChannel? channel) {
    if (channel == null) return _detach();
    _channel = channel;
    channel.onMessage = _onMessage;
  }

  /// Se perdió la conexión: lo que estaba en marcha falla (al reconectar no se reanuda).
  void _detach() {
    _epoch++;
    _assembler = ClipboardAssembler();
    _channel = null;
    for (final transfer in transfers.where((t) => t.active)) {
      transfer
        ..status = RemoteTransferStatus.failed
        ..error = 'connection_lost';
    }
    for (final entry in _receiving.entries) {
      unawaited(_discard(entry.value.sink, entry.value.file));
    }
    _receiving.clear();
    for (final waiter in _waiters.values) {
      if (!waiter.completer.isCompleted) waiter.completer.complete(null);
    }
    _waiters.clear();
    _notify();
  }

  void _contextBoundary() {
    final channel = _channel;
    _detach();
    transfers.clear();
    _channel = channel;
    _notify();
  }

  void _notify() { if (!_disposed) notifyListeners(); }

  @override
  void dispose() {
    _disposed = true;
    if (session.onFileChannel == _attach) session.onFileChannel = null;
    if (session.onClipboard == _onClipboardPiece) session.onClipboard = null;
    if (session.onContextBoundary == _contextBoundary) session.onContextBoundary = null;
    _detach();
    super.dispose();
  }

  // --- Portapapeles ------------------------------------------------------------------

  void _onClipboardPiece(ClipboardPiece piece) {
    if (_disposed || !session.agentContext.sensitiveAllowed || !session.features.clipboard) return;
    final text = _assembler.add(piece);
    if (text != null) unawaited(Clipboard.setData(ClipboardData(text: text)));
  }

  /// Envía al PC el texto del portapapeles del teléfono. Devuelve false si no había texto.
  Future<bool> sendClipboard() async {
    if (_disposed || !session.agentContext.sensitiveAllowed || !session.features.clipboard) return false;
    final epoch = _epoch;
    final text = (await Clipboard.getData(Clipboard.kTextPlain))?.text;
    if (epoch != _epoch || !session.agentContext.sensitiveAllowed || !session.features.clipboard) return false;
    final pieces = text == null ? const <ClipboardPiece>[] : splitClipboardText(++_clipboardId, text);
    if (pieces.isEmpty) return false;
    for (final piece in pieces) {
      if (!await session.controlRoom() || epoch != _epoch || !session.features.clipboard || !session.agentContext.sensitiveAllowed) return false;
      session.sendControl(jsonEncode(piece.toJson()));
    }
    return true;
  }

  // --- Ficheros ----------------------------------------------------------------------

  /// Envía ficheros al PC, uno detrás de otro. Se leen como flujo de bytes: en Android, lo elegido
  /// en Archivos o Fotos es un `content://` sin ruta de fichero.
  void upload(List<({String name, int size, Stream<List<int>> Function() open})> files) {
    if (!_filesAllowed) return;
    for (final file in files) {
      final transfer = _add(true, file.name.isEmpty ? 'fichero' : file.name, file.size);
      _uploads = _uploads.then((_) => _send(transfer, file.open));
    }
  }

  /// Descarga un fichero del PC a un fichero temporal. Al terminar, `result` es su ruta.
  Future<RemoteTransfer> download(String path, String name, int size) async {
    if (!_filesAllowed) {
      return RemoteTransfer(_nextId++, false, name, size)..status = RemoteTransferStatus.failed..error = 'disabled';
    }
    final transfer = _add(false, name, size);
    await _receive(transfer, path);
    return transfer;
  }

  void cancel(RemoteTransfer transfer) {
    if (!transfer.active) return;
    transfer.status = RemoteTransferStatus.cancelled;
    _sendMessage(TransferMessage.encode('file-cancel', transfer.id));
    final receiving = _receiving.remove(transfer.id);
    if (receiving != null) unawaited(_discard(receiving.sink, receiving.file));
    final waiter = _waiters.remove(transfer.id);
    if (waiter != null && !waiter.completer.isCompleted) waiter.completer.complete(null);
    _notify();
  }

  void clearFinished() {
    transfers.removeWhere((t) => !t.active);
    _notify();
  }

  /// Contenido de una carpeta del PC ('' es la del usuario); null si se perdió la conexión.
  Future<RemoteListing?> list(String path) async {
    if (!_filesAllowed) return null;
    final epoch = _epoch;
    final id = _nextId++;
    _sendMessage(TransferMessage.encode('fs-list', id, {'path': path}));
    final reply = await _wait(id, {'fs-entries'});
    if (epoch != _epoch || reply == null) return null;
    return RemoteListing(path: reply.path, parent: reply.parent, entries: reply.entries, truncated: reply.truncated, error: reply.error);
  }

  Future<void> _send(RemoteTransfer transfer, Stream<List<int>> Function() open) async {
    final channel = _channel;
    if (!_filesAllowed || transfer.status != RemoteTransferStatus.waiting) return;
    final epoch = _epoch;
    if (channel == null) return _fail(transfer, 'connection_lost');
    _update(transfer, status: RemoteTransferStatus.running);
    _sendMessage(TransferMessage.encode('file-offer', transfer.id, {'name': _truncate(transfer.name), 'size': transfer.size}));
    final reply = await _wait(transfer.id, {'file-accept', 'file-reject'});
    if (epoch != _epoch || reply == null) return;
    if (reply.type == 'file-reject') return _fail(transfer, reply.reason);

    final digest = _Digest();
    final hash = crypto.sha256.startChunkedConversion(digest);
    try {
      await for (final read in open()) {
        final block = read is Uint8List ? read : Uint8List.fromList(read);
        for (var offset = 0; offset < block.length; offset += TransferLimits.chunkBytes) {
          if (transfer.status != RemoteTransferStatus.running) return;
          final part = Uint8List.sublistView(block, offset, (offset + TransferLimits.chunkBytes).clamp(0, block.length));
          hash.add(part);
          while (channel.state == RTCDataChannelState.RTCDataChannelOpen && await channel.getBufferedAmount() > TransferLimits.bufferHighBytes) {
            if (epoch != _epoch || !_filesAllowed) return;
            await Future<void>.delayed(const Duration(milliseconds: 20));
          }
          if (epoch != _epoch || !_filesAllowed || transfer.status != RemoteTransferStatus.running) return;
          if (channel.state != RTCDataChannelState.RTCDataChannelOpen || _channel != channel) return _fail(transfer, 'connection_lost');
          await channel.send(RTCDataChannelMessage.fromBinary(encodeChunk(transfer.id, part)));
          _update(transfer, bytes: transfer.bytes + part.length);
        }
      }
    } on Exception {
      if (epoch != _epoch) return;
      _sendMessage(TransferMessage.encode('file-cancel', transfer.id));
      return _fail(transfer, 'read');
    }
    if (epoch != _epoch || !_filesAllowed || transfer.status != RemoteTransferStatus.running) return;
    hash.close();
    _sendMessage(TransferMessage.encode('file-end', transfer.id, {'sha256': digest.hex}));
    final result = await _wait(transfer.id, {'file-done', 'file-error'});
    if (epoch != _epoch || result == null) return;
    if (result.type == 'file-done') {
      transfer.result = result.name;
      _update(transfer, status: RemoteTransferStatus.done);
    } else {
      _fail(transfer, result.reason);
    }
  }

  Future<void> _receive(RemoteTransfer transfer, String path) async {
    final epoch = _epoch;
    final temporary = await getTemporaryDirectory();
    if (epoch != _epoch || !_filesAllowed) return;
    final dir = Directory('${temporary.path}/remote-downloads/${transfer.id}-${DateTime.now().millisecondsSinceEpoch}');
    await dir.create(recursive: true);
    if (epoch != _epoch || !_filesAllowed) { await dir.delete(); return; }
    final file = File('${dir.path}/${_safeName(transfer.name)}');
    final digest = _Digest();
    _receiving[transfer.id] = (sink: file.openWrite(), file: file, hash: crypto.sha256.startChunkedConversion(digest), digest: digest);
    _update(transfer, status: RemoteTransferStatus.running);
    _sendMessage(TransferMessage.encode('file-request', transfer.id, {'path': path}));
    final start = await _wait(transfer.id, {'file-start', 'file-reject'});
    if (epoch != _epoch || start == null) return;
    if (start.type == 'file-reject' || start.size != transfer.size) {
      final receiving = _receiving.remove(transfer.id);
      if (receiving != null) await _discard(receiving.sink, receiving.file);
      if (start.type == 'file-start') _sendMessage(TransferMessage.encode('file-cancel', transfer.id));
      return _fail(transfer, start.type == 'file-reject' ? start.reason : 'size');
    }
    final end = await _wait(transfer.id, {'file-end'});
    final receiving = _receiving.remove(transfer.id);
    if (end == null || receiving == null) return;
    receiving.hash.close();
    await receiving.sink.close();
    if (epoch != _epoch || !_filesAllowed) { await receiving.file.delete().catchError((_) => receiving.file); return; }
    // Lo que llegó tiene que ser lo que el PC dice que envió
    if (transfer.bytes != transfer.size) return _discardAndFail(transfer, receiving.file, 'size');
    if (receiving.digest.hex != end.sha256) return _discardAndFail(transfer, receiving.file, 'integrity');
    transfer.result = receiving.file.path;
    _update(transfer, status: RemoteTransferStatus.done);
  }

  Future<void> _discardAndFail(RemoteTransfer transfer, File file, String error) async {
    await file.delete().catchError((_) => file);
    _fail(transfer, error);
  }

  Future<void> _discard(IOSink sink, File file) async {
    await sink.close().catchError((_) {});
    await file.delete().catchError((_) => file);
  }

  // --- Canal -------------------------------------------------------------------------

  RemoteTransfer _add(bool upload, String name, int size) {
    final transfer = RemoteTransfer(_nextId++, upload, name, size);
    transfers.add(transfer);
    _notify();
    return transfer;
  }

  void _fail(RemoteTransfer transfer, String? error) {
    transfer.error = error ?? 'io';
    _update(transfer, status: RemoteTransferStatus.failed);
  }

  void _update(RemoteTransfer transfer, {RemoteTransferStatus? status, int? bytes}) {
    if (bytes != null) transfer.bytes = bytes;
    if (status != null) transfer.status = status;
    // El progreso se repinta como mucho cada 150 ms; los cambios de estado, siempre
    final now = DateTime.now();
    if (status == null && now.difference(_lastNotify) < const Duration(milliseconds: 150)) return;
    _lastNotify = now;
    _notify();
  }

  void _sendMessage(String message) {
    final channel = _channel;
    if (_filesAllowed && channel?.state == RTCDataChannelState.RTCDataChannelOpen) unawaited(channel!.send(RTCDataChannelMessage(message)));
  }

  Future<TransferMessage?> _wait(int id, Set<String> types) {
    final completer = Completer<TransferMessage?>();
    if (_channel == null) {
      completer.complete(null);
    } else {
      _waiters[id] = (types: types, completer: completer);
    }
    return completer.future;
  }

  void _onMessage(RTCDataChannelMessage message) {
    if (!_filesAllowed) return;
    if (!message.isBinary) {
      final parsed = TransferMessage.parse(message.text);
      final waiter = parsed == null ? null : _waiters[parsed.id];
      if (parsed != null && waiter != null && waiter.types.contains(parsed.type)) {
        _waiters.remove(parsed.id);
        waiter.completer.complete(parsed);
      }
      return;
    }
    final chunk = decodeChunk(message.binary);
    final receiving = chunk == null ? null : _receiving[chunk.id];
    if (chunk == null || receiving == null) return;
    final transfer = transfers.firstWhere((t) => t.id == chunk.id);
    receiving.sink.add(chunk.data);
    receiving.hash.add(chunk.data);
    _update(transfer, bytes: transfer.bytes + chunk.data.length);
  }

  static String _truncate(String name) => name.length <= 255 ? name : name.substring(0, 255);

  /// Nombre de fichero seguro para la carpeta temporal (sin rutas ni caracteres prohibidos).
  static String _safeName(String name) {
    final clean = name.replaceAll(RegExp(r'[\\/:*?"<>|\x00-\x1f]'), '_').trim();
    return clean.isEmpty || clean == '.' || clean == '..' ? 'fichero' : clean;
  }
}

/// Recoge el resumen de `sha256.startChunkedConversion`.
class _Digest implements Sink<crypto.Digest> {
  crypto.Digest? _value;

  String get hex => _value.toString();

  @override
  void add(crypto.Digest data) => _value = data;

  @override
  void close() {}
}
