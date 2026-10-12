import 'dart:io';

import 'package:flutter/foundation.dart';

enum TransferStatus { running, done, failed }

class Transfer {
  Transfer(this.id, this.name, this.upload);

  final int id;
  final String name;
  final bool upload;
  TransferStatus status = TransferStatus.running;
  int done = 0;
  int? total;
  Object? error;

  /// Fichero local descargado, para compartirlo al terminar.
  File? file;

  double? get fraction => total == null || total == 0 ? null : (done / total!).clamp(0, 1).toDouble();
}

/// Subidas y descargas en curso o recientes, con su progreso y su error.
class TransferManager extends ChangeNotifier {
  final List<Transfer> _items = [];
  int _nextId = 1;

  List<Transfer> get items => List.unmodifiable(_items);

  Future<Transfer> run(String name, {required bool upload, required Future<File?> Function(void Function(int done, int? total)) task}) async {
    final transfer = Transfer(_nextId++, name, upload);
    _items.insert(0, transfer);
    notifyListeners();
    var lastNotified = DateTime.now();
    try {
      transfer.file = await task((done, total) {
        transfer
          ..done = done
          ..total = total;
        final now = DateTime.now();
        if (now.difference(lastNotified).inMilliseconds > 120) {
          lastNotified = now;
          notifyListeners();
        }
      });
      transfer.status = TransferStatus.done;
    } on Object catch (error) {
      transfer
        ..status = TransferStatus.failed
        ..error = error;
    }
    notifyListeners();
    return transfer;
  }

  void dismiss(Transfer transfer) {
    _items.remove(transfer);
    notifyListeners();
  }

  void clearFinished() {
    _items.removeWhere((t) => t.status != TransferStatus.running);
    notifyListeners();
  }

  void clear() {
    _items.clear();
    notifyListeners();
  }
}
