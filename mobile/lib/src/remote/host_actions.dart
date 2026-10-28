import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';

import 'agent_protocol.dart';

enum HostActionStatus {
  accepted,
  rejected,
  failed,
  cancelled,
  unavailable,
  timedOut,
  connectionLost,
}

class HostActionOutcome {
  const HostActionOutcome(this.action, this.status, [this.code]);
  final AgentAction action;
  final HostActionStatus status;
  final AgentError? code;
}

class HostActionState {
  const HostActionState({
    required this.actions,
    required this.confirming,
    required this.pending,
    required this.last,
    required this.blocked,
  });
  final List<AgentAction> actions;
  final bool confirming, blocked;
  final HostOperation? pending;
  final HostActionOutcome? last;
}

/// Una conexión autenticada; no reintenta órdenes ni desaloja el límite de 64 IDs.
class HostActions extends ChangeNotifier {
  HostActions({
    required bool Function() active,
    required Future<void> Function(HostOperation) send,
    String Function()? id,
  }) :
       // ignore: prefer_initializing_formals
       _active = active,
       // ignore: prefer_initializing_formals
       _send = send,
       _id = id ?? _uuid;
  final bool Function() _active;
  final Future<void> Function(HostOperation) _send;
  final String Function() _id;
  List<AgentAction> _actions = [];
  int _revision = 0, _issued = 0;
  bool _confirming = false, _blocked = false, _disposed = false;
  HostOperation? _pending;
  Completer<HostActionOutcome>? _result;
  HostActionOutcome? _last;
  Timer? _timer;
  HostActionState get state => HostActionState(
    actions: List.unmodifiable(_actions),
    confirming: _confirming,
    pending: _pending,
    last: _last,
    blocked: _blocked || _issued >= 64,
  );
  void setActions(List<AgentAction> actions) {
    if (listEquals(_actions, actions)) return;
    _actions = List.of(actions);
    invalidateConfirmation();
  }

  void invalidateConfirmation() {
    _revision++;
    _confirming = false;
    _notify();
  }

  bool _canRun(AgentAction action) =>
      !_disposed &&
      _active() &&
      !_confirming &&
      _pending == null &&
      !_blocked &&
      _issued < 64 &&
      _actions.contains(action);
  Future<HostActionOutcome> run(
    AgentAction action,
    Future<bool> Function() confirm,
  ) async {
    if (!_canRun(action)) {
      return HostActionOutcome(action, HostActionStatus.unavailable);
    }
    final revision = _revision;
    _confirming = true;
    _notify();
    var accepted = false;
    try {
      accepted = await confirm();
    } on Object {
      /* Un diálogo fallido no autoriza. */
    }
    if (_disposed || revision != _revision) {
      return HostActionOutcome(action, HostActionStatus.unavailable);
    }
    _confirming = false;
    if (!accepted) {
      _last = HostActionOutcome(action, HostActionStatus.cancelled);
      _notify();
      return _last!;
    }
    if (!_canRun(action)) {
      _notify();
      return HostActionOutcome(action, HostActionStatus.unavailable);
    }
    final operation = HostOperation(id: _id(), action: action);
    final result = Completer<HostActionOutcome>();
    _issued++;
    _pending = operation;
    _result = result;
    _timer = Timer(const Duration(seconds: 15), () {
      _blocked = true;
      _finish(HostActionOutcome(action, HostActionStatus.timedOut));
    });
    _notify();
    if (_pending != operation) return result.future;
    if (!_active()) {
      _blocked = true;
      _finish(HostActionOutcome(action, HostActionStatus.connectionLost));
      return result.future;
    }
    try {
      unawaited(
        _send(operation).then<void>(
          (_) {},
          onError: (Object _) {
            if (_pending == operation) {
              _blocked = true;
              _finish(
                HostActionOutcome(action, HostActionStatus.connectionLost),
              );
            }
          },
        ),
      );
    } on Object {
      _blocked = true;
      _finish(HostActionOutcome(action, HostActionStatus.connectionLost));
    }
    return result.future;
  }

  bool receive(HostOperationResult result) {
    if (_disposed ||
        !_active() ||
        result.id != _pending?.id ||
        result.action != _pending?.action) {
      return false;
    }
    _finish(
      HostActionOutcome(result.action, switch (result.status) {
        HostOperationStatus.accepted => HostActionStatus.accepted,
        HostOperationStatus.rejected => HostActionStatus.rejected,
        HostOperationStatus.failed => HostActionStatus.failed,
      }, result.code),
    );
    return true;
  }

  void reset() {
    _revision++;
    _confirming = false;
    _actions = [];
    _issued = 0;
    _blocked = false;
    if (_pending != null) {
      _finish(
        HostActionOutcome(_pending!.action, HostActionStatus.connectionLost),
      );
    }
    _last = null;
    _notify();
  }

  void _finish(HostActionOutcome result) {
    final completer = _result;
    _timer?.cancel();
    _timer = null;
    _pending = null;
    _result = null;
    _last = result;
    _notify();
    if (completer != null && !completer.isCompleted) completer.complete(result);
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    reset();
    super.dispose();
  }

  static String _uuid() {
    final random = Random.secure(), bytes = List<int>.filled(16, 0);
    for (var i = 0; i < bytes.length; i++) {
      bytes[i] = random.nextInt(256);
    }
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }
}
