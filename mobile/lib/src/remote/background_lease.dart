import 'dart:async';

import 'monotonic_clock.dart';

/// El reloj continuo incluye suspensión; el Timer solo adelanta el cierre si la app sigue viva.
class BackgroundLease {
  BackgroundLease({required this.onExpired, int? Function()? nowMicros})
    : _now = nowMicros ?? MobileMonotonicClock().nowMicros;
  final void Function() onExpired;
  final int? Function() _now;
  int? _leftAt;
  bool _away = false, expired = false;
  Timer? _timer;
  void pause() {
    if (_away || expired) return;
    _away = true;
    _leftAt = _now();
    if (_leftAt == null) {
      _expire();
      return;
    }
    _timer = Timer(const Duration(seconds: 30), _expire);
  }

  bool resume() {
    _timer?.cancel();
    _timer = null;
    if (_away && !expired) {
      final now = _now();
      if (now == null ||
          _leftAt == null ||
          now < _leftAt! ||
          now - _leftAt! >= 30000000) {
        _expire();
      }
    }
    _away = false;
    return !expired;
  }

  void renew() {
    dispose();
    expired = false;
    _away = false;
    _leftAt = null;
  }

  void _expire() {
    if (expired) return;
    expired = true;
    _timer?.cancel();
    onExpired();
  }

  void dispose() {
    _timer?.cancel();
    _timer = null;
  }
}
