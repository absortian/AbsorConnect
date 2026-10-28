import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api.dart';
import 'monotonic_clock.dart';
import 'remote_api.dart';

enum RestartWaitState { idle, waiting, ready, expired, cancelled, failed }

/// Consulta solo presencia del mismo equipo; nunca crea ofertas o pruebas por sí sola.
class RestartWait extends ChangeNotifier {
  RestartWait({
    required Future<RemoteAvailability> Function() status,
    int? Function()? nowMicros,
  }) :
       // ignore: prefer_initializing_formals
       _status = status,
       _now = nowMicros ?? MobileMonotonicClock().nowMicros;
  final Future<RemoteAvailability> Function() _status;
  final int? Function() _now;
  RestartWaitState state = RestartWaitState.idle;
  String? code;
  int _generation = 0;
  int? _started;
  DateTime? _baseline;
  bool _away = false, _foreground = true, _polling = false, _disposed = false;
  Timer? _deadline, _next;
  void start(DateTime lastSeenAt) {
    _stopTimers();
    _generation++;
    _started = _now();
    _baseline = lastSeenAt;
    _away = false;
    code = null;
    if (_started == null) {
      _finish(RestartWaitState.failed, 'clock_unavailable');
      return;
    }
    state = RestartWaitState.waiting;
    _notify();
    _deadline = Timer(
      const Duration(minutes: 5),
      () => _finish(RestartWaitState.expired),
    );
    if (_foreground) unawaited(_poll(_generation));
  }

  void setForeground(bool value) {
    _foreground = value;
    _next?.cancel();
    _next = null;
    if (value && state == RestartWaitState.waiting) {
      if (_expired()) {
        _finish(RestartWaitState.expired);
        return;
      }
      unawaited(_poll(_generation));
    }
  }

  bool _expired() {
    final now = _now();
    return now == null ||
        _started == null ||
        now < _started! ||
        now - _started! >= 300000000;
  }

  Future<void> _poll(int generation) async {
    if (_disposed ||
        _polling ||
        !_foreground ||
        state != RestartWaitState.waiting ||
        generation != _generation) {
      return;
    }
    _polling = true;
    var delay = const Duration(seconds: 2);
    try {
      final status = await _status();
      if (_disposed ||
          generation != _generation ||
          state != RestartWaitState.waiting ||
          !_foreground) {
        return;
      }
      if (_expired()) {
        _finish(RestartWaitState.expired);
        return;
      }
      if (!status.online || !status.available) _away = true;
      if (status.online &&
          status.available &&
          (_away || status.lastSeenAt.isAfter(_baseline!))) {
        _finish(RestartWaitState.ready);
        return;
      }
    } on ApiError catch (error) {
      if (_disposed ||
          generation != _generation ||
          state != RestartWaitState.waiting) {
        return;
      }
      if (error.status == 401 ||
          error.status == 403 ||
          error.code == 'device_not_found') {
        _finish(RestartWaitState.failed, error.code);
        return;
      }
      final retry = RemoteApi.retryAfterOf(error);
      if (retry != null) delay = Duration(seconds: retry.clamp(2, 300));
    } on Object {
      /* El temporizador independiente mantiene el plazo durante un fallo de red. */
    } finally {
      _polling = false;
      if (!_disposed && state == RestartWaitState.waiting && _foreground) {
        _next?.cancel();
        _next = Timer(
          generation == _generation ? delay : Duration.zero,
          () => unawaited(_poll(_generation)),
        );
      }
    }
  }

  void cancel() {
    if (state == RestartWaitState.waiting) _finish(RestartWaitState.cancelled);
  }

  void clear() {
    _finish(RestartWaitState.idle);
  }

  void _finish(RestartWaitState value, [String? reason]) {
    _generation++;
    _stopTimers();
    state = value;
    code = reason;
    _notify();
  }

  void _stopTimers() {
    _deadline?.cancel();
    _next?.cancel();
    _deadline = _next = null;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    _stopTimers();
    super.dispose();
  }
}
