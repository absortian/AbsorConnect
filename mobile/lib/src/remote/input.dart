import 'dart:convert';

import 'protocol.dart';

/// Eventos de entrada del protocolo v1 (add-remote-desktop D9), los mismos que
/// `src/shared/remote/input.ts`: `move` va por el canal `pointer` y el resto por `input`.
///
/// Las teclas viajan por su posición física (`KeyboardEvent.code`); el texto escrito con el teclado
/// del teléfono va como `text`, y el PC lo escribe tal cual, sea cual sea su distribución.
abstract final class RemoteInput {
  /// Texto máximo por mensaje `text`.
  static const maxTextLength = 4096;

  static String move(double x, double y) =>
      jsonEncode({'v': protocolVersion, 'type': 'move', 'x': x.clamp(0.0, 1.0), 'y': y.clamp(0.0, 1.0)});

  /// `button`: 0 izquierdo, 1 central, 2 derecho (como `MouseEvent.button`).
  static String button(int button, {required bool down}) =>
      jsonEncode({'v': protocolVersion, 'type': 'button', 'button': button, 'down': down});

  /// Desplazamiento en píxeles (`mode` 0): `dy > 0` baja.
  static String wheel(double dx, double dy) =>
      jsonEncode({'v': protocolVersion, 'type': 'wheel', 'dx': dx, 'dy': dy, 'mode': 0});

  static String key(String code, {required bool down}) =>
      jsonEncode({'v': protocolVersion, 'type': 'key', 'code': code, 'down': down});

  /// Texto en mensajes de como mucho [maxTextLength] unidades, sin partir caracteres.
  static List<String> text(String text) {
    final messages = <String>[];
    var start = 0;
    while (start < text.length) {
      var end = (start + maxTextLength).clamp(0, text.length);
      // Sin separar los dos medios de un emoji (par sustituto)
      if (end < text.length && _isHighSurrogate(text.codeUnitAt(end - 1))) end--;
      messages.add(jsonEncode({'v': protocolVersion, 'type': 'text', 'text': text.substring(start, end)}));
      start = end;
    }
    return messages;
  }

  static String releaseAll() => jsonEncode({'v': protocolVersion, 'type': 'release-all'});

  /// Pulsa una combinación: las teclas en orden y se sueltan al revés (Ctrl+Alt+Supr…).
  static List<String> combo(List<String> codes) => [
        for (final code in codes) key(code, down: true),
        for (final code in codes.reversed) key(code, down: false),
      ];

  static bool _isHighSurrogate(int unit) => unit >= 0xD800 && unit <= 0xDBFF;
}

/// Teclas especiales de la barra del visor, por su `code`.
abstract final class RemoteKeys {
  static const escape = 'Escape';
  static const tab = 'Tab';
  static const control = 'ControlLeft';
  static const alt = 'AltLeft';
  static const shift = 'ShiftLeft';
  static const meta = 'MetaLeft';
  static const delete = 'Delete';
  static const backspace = 'Backspace';
  static const enter = 'Enter';
  static const arrowLeft = 'ArrowLeft';
  static const arrowRight = 'ArrowRight';
  static const arrowUp = 'ArrowUp';
  static const arrowDown = 'ArrowDown';
  static const home = 'Home';
  static const end = 'End';
  static const pageUp = 'PageUp';
  static const pageDown = 'PageDown';
  static const functionKeys = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];
  static const modifiers = {control, alt, shift, meta};

  /// Tecla por posición para un carácter, para combinaciones con modificadores (Ctrl+C, Alt+F4…).
  /// Con la posición de un teclado estadounidense, como hace el escritorio con `KeyboardEvent.code`:
  /// en la distribución española, Ctrl+C sigue siendo la misma tecla. null si no tiene una tecla
  /// propia (entonces se envía como texto).
  static String? codeFor(String character) {
    if (character.length != 1) return null;
    final c = character.toLowerCase();
    final unit = c.codeUnitAt(0);
    if (unit >= 0x61 && unit <= 0x7A) return 'Key${c.toUpperCase()}';
    if (unit >= 0x30 && unit <= 0x39) return 'Digit$c';
    return _punctuation[c];
  }

  static const _punctuation = {
    ' ': 'Space',
    '-': 'Minus',
    '=': 'Equal',
    '[': 'BracketLeft',
    ']': 'BracketRight',
    '\\': 'Backslash',
    ';': 'Semicolon',
    "'": 'Quote',
    ',': 'Comma',
    '.': 'Period',
    '/': 'Slash',
    '`': 'Backquote',
    '\n': 'Enter',
    '\t': 'Tab',
  };
}
