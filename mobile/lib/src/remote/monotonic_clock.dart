import 'dart:ffi';
import 'dart:io';

import 'package:ffi/ffi.dart';

final class _Timespec extends Struct {
  @IntPtr()
  external int seconds;
  @IntPtr()
  external int nanoseconds;
}

final class _Timebase extends Struct {
  @Uint32()
  external int numerator;
  @Uint32()
  external int denominator;
}

/// Reloj que incluye suspensión. Si no está disponible, el llamador cierra por seguridad.
/// ABI comprobada con mach_time.h y bionic/NDK: no utiliza la hora del calendario.
class MobileMonotonicClock {
  static final int? Function() _read = _reader();
  int? nowMicros() {
    try {
      return _read();
    } on Object {
      return null;
    }
  }

  static int? Function() _reader() {
    try {
      if (Platform.isIOS || Platform.isMacOS) {
        final library = DynamicLibrary.process();
        final time = library.lookupFunction<Uint64 Function(), int Function()>(
          'mach_continuous_time',
        );
        final base = library
            .lookupFunction<
              Int32 Function(Pointer<_Timebase>),
              int Function(Pointer<_Timebase>)
            >('mach_timebase_info');
        final pointer = calloc<_Timebase>();
        late final int numerator, denominator;
        try {
          if (base(pointer) != 0) return () => null;
          numerator = pointer.ref.numerator;
          denominator = pointer.ref.denominator;
        } finally {
          calloc.free(pointer);
        }
        if (numerator <= 0 || denominator <= 0) return () => null;
        return () {
          final ticks = time();
          if (ticks < 0) return null;
          final micros =
              BigInt.from(ticks) *
              BigInt.from(numerator) ~/
              BigInt.from(denominator) ~/
              BigInt.from(1000);
          return micros <= BigInt.from(0x7fffffffffffffff)
              ? micros.toInt()
              : null;
        };
      }
      if (Platform.isAndroid || Platform.isLinux) {
        final library = DynamicLibrary.open(
          Platform.isAndroid ? 'libc.so' : 'libc.so.6',
        );
        final time = library
            .lookupFunction<
              Int32 Function(Int32, Pointer<_Timespec>),
              int Function(int, Pointer<_Timespec>)
            >('clock_gettime');
        return () {
          final pointer = calloc<_Timespec>();
          try {
            if (time(7, pointer) != 0) {
              return null; // CLOCK_BOOTTIME, incluye suspensión.
            }
            final seconds = pointer.ref.seconds,
                nanos = pointer.ref.nanoseconds;
            if (seconds < 0 ||
                nanos < 0 ||
                nanos >= 1000000000 ||
                seconds > 9000000000000) {
              return null;
            }
            return seconds * 1000000 + nanos ~/ 1000;
          } finally {
            calloc.free(pointer);
          }
        };
      }
    } on Object {
      /* Sin fallback al calendario: el límite debe ser conservador. */
    }
    return () => null;
  }
}
