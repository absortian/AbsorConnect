// Traducción de `KeyboardEvent.code` (W3C UI Events) al código nativo de cada sistema, para
// inyectar teclas por su POSICIÓN física en el PC controlado (add-remote-desktop D10): así manda la
// distribución del teclado del propio PC, como en Chrome Remote Desktop.
//
//   - Linux/X11: `evdev`; XTest usa `evdev + 8` (XTestFakeKeyEvent).
//   - Windows: `win` es el scancode (byte bajo) para SendInput con KEYEVENTF_SCANCODE; `winExtended`
//     pide además KEYEVENTF_EXTENDEDKEY.
//   - macOS: `mac` es el código de tecla virtual (kVK_*) para CGEventCreateKeyboardEvent.
//
// Datos derivados de `ui/events/keycodes/dom/dom_code_data.inc` de Chromium (columnas evdev, win,
// mac), © The Chromium Authors, licencia BSD de 3 cláusulas:
//
//   Redistribution and use in source and binary forms, with or without modification, are permitted
//   provided that the conditions of the BSD-3-Clause license are met. This file reuses the keycode
//   data tables from that source. See https://chromium.googlesource.com/chromium/src/+/HEAD/LICENSE
//
// Regenerado con el parser de la tarea 4.5 (add-remote-desktop); no editar a mano.

export interface KeyCodes {
  /** Código evdev de Linux; el keycode de X11 es evdev + 8. */
  evdev?: number
  /** Scancode de Windows (byte bajo) para KEYEVENTF_SCANCODE. */
  win?: number
  /** La tecla necesita KEYEVENTF_EXTENDEDKEY en Windows (flechas, Ctrl/Alt derechos, etc.). */
  winExtended?: boolean
  /** Código de tecla virtual de macOS (kVK_*). */
  mac?: number
}

/** `KeyboardEvent.code` → códigos nativos. Las teclas sin equivalente no aparecen. */
export const KEY_MAP: Record<string, KeyCodes> = {
  Sleep: { evdev: 142, win: 95, winExtended: true },
  WakeUp: { evdev: 143, win: 99, winExtended: true },
  Fn: { evdev: 464 },
  KeyA: { evdev: 30, win: 30, mac: 0 },
  KeyB: { evdev: 48, win: 48, mac: 11 },
  KeyC: { evdev: 46, win: 46, mac: 8 },
  KeyD: { evdev: 32, win: 32, mac: 2 },
  KeyE: { evdev: 18, win: 18, mac: 14 },
  KeyF: { evdev: 33, win: 33, mac: 3 },
  KeyG: { evdev: 34, win: 34, mac: 5 },
  KeyH: { evdev: 35, win: 35, mac: 4 },
  KeyI: { evdev: 23, win: 23, mac: 34 },
  KeyJ: { evdev: 36, win: 36, mac: 38 },
  KeyK: { evdev: 37, win: 37, mac: 40 },
  KeyL: { evdev: 38, win: 38, mac: 37 },
  KeyM: { evdev: 50, win: 50, mac: 46 },
  KeyN: { evdev: 49, win: 49, mac: 45 },
  KeyO: { evdev: 24, win: 24, mac: 31 },
  KeyP: { evdev: 25, win: 25, mac: 35 },
  KeyQ: { evdev: 16, win: 16, mac: 12 },
  KeyR: { evdev: 19, win: 19, mac: 15 },
  KeyS: { evdev: 31, win: 31, mac: 1 },
  KeyT: { evdev: 20, win: 20, mac: 17 },
  KeyU: { evdev: 22, win: 22, mac: 32 },
  KeyV: { evdev: 47, win: 47, mac: 9 },
  KeyW: { evdev: 17, win: 17, mac: 13 },
  KeyX: { evdev: 45, win: 45, mac: 7 },
  KeyY: { evdev: 21, win: 21, mac: 16 },
  KeyZ: { evdev: 44, win: 44, mac: 6 },
  Digit1: { evdev: 2, win: 2, mac: 18 },
  Digit2: { evdev: 3, win: 3, mac: 19 },
  Digit3: { evdev: 4, win: 4, mac: 20 },
  Digit4: { evdev: 5, win: 5, mac: 21 },
  Digit5: { evdev: 6, win: 6, mac: 23 },
  Digit6: { evdev: 7, win: 7, mac: 22 },
  Digit7: { evdev: 8, win: 8, mac: 26 },
  Digit8: { evdev: 9, win: 9, mac: 28 },
  Digit9: { evdev: 10, win: 10, mac: 25 },
  Digit0: { evdev: 11, win: 11, mac: 29 },
  Enter: { evdev: 28, win: 28, mac: 36 },
  Escape: { evdev: 1, win: 1, mac: 53 },
  Backspace: { evdev: 14, win: 14, mac: 51 },
  Tab: { evdev: 15, win: 15, mac: 48 },
  Space: { evdev: 57, win: 57, mac: 49 },
  Minus: { evdev: 12, win: 12, mac: 27 },
  Equal: { evdev: 13, win: 13, mac: 24 },
  BracketLeft: { evdev: 26, win: 26, mac: 33 },
  BracketRight: { evdev: 27, win: 27, mac: 30 },
  Backslash: { evdev: 43, win: 43, mac: 42 },
  Semicolon: { evdev: 39, win: 39, mac: 41 },
  Quote: { evdev: 40, win: 40, mac: 39 },
  Backquote: { evdev: 41, win: 41, mac: 50 },
  Comma: { evdev: 51, win: 51, mac: 43 },
  Period: { evdev: 52, win: 52, mac: 47 },
  Slash: { evdev: 53, win: 53, mac: 44 },
  CapsLock: { evdev: 58, win: 58, mac: 57 },
  F1: { evdev: 59, win: 59, mac: 122 },
  F2: { evdev: 60, win: 60, mac: 120 },
  F3: { evdev: 61, win: 61, mac: 99 },
  F4: { evdev: 62, win: 62, mac: 118 },
  F5: { evdev: 63, win: 63, mac: 96 },
  F6: { evdev: 64, win: 64, mac: 97 },
  F7: { evdev: 65, win: 65, mac: 98 },
  F8: { evdev: 66, win: 66, mac: 100 },
  F9: { evdev: 67, win: 67, mac: 101 },
  F10: { evdev: 68, win: 68, mac: 109 },
  F11: { evdev: 87, win: 87, mac: 103 },
  F12: { evdev: 88, win: 88, mac: 111 },
  PrintScreen: { evdev: 99, win: 55, winExtended: true },
  ScrollLock: { evdev: 70, win: 70 },
  Pause: { evdev: 119, win: 69 },
  Insert: { evdev: 110, win: 82, winExtended: true, mac: 114 },
  Home: { evdev: 102, win: 71, winExtended: true, mac: 115 },
  PageUp: { evdev: 104, win: 73, winExtended: true, mac: 116 },
  Delete: { evdev: 111, win: 83, winExtended: true, mac: 117 },
  End: { evdev: 107, win: 79, winExtended: true, mac: 119 },
  PageDown: { evdev: 109, win: 81, winExtended: true, mac: 121 },
  ArrowRight: { evdev: 106, win: 77, winExtended: true, mac: 124 },
  ArrowLeft: { evdev: 105, win: 75, winExtended: true, mac: 123 },
  ArrowDown: { evdev: 108, win: 80, winExtended: true, mac: 125 },
  ArrowUp: { evdev: 103, win: 72, winExtended: true, mac: 126 },
  NumLock: { evdev: 69, win: 69, winExtended: true, mac: 71 },
  NumpadDivide: { evdev: 98, win: 53, winExtended: true, mac: 75 },
  NumpadAdd: { evdev: 78, win: 78, mac: 69 },
  NumpadEnter: { evdev: 96, win: 28, winExtended: true, mac: 76 },
  Numpad1: { evdev: 79, win: 79, mac: 83 },
  Numpad2: { evdev: 80, win: 80, mac: 84 },
  Numpad3: { evdev: 81, win: 81, mac: 85 },
  Numpad4: { evdev: 75, win: 75, mac: 86 },
  Numpad5: { evdev: 76, win: 76, mac: 87 },
  Numpad6: { evdev: 77, win: 77, mac: 88 },
  Numpad7: { evdev: 71, win: 71, mac: 89 },
  Numpad8: { evdev: 72, win: 72, mac: 91 },
  Numpad9: { evdev: 73, win: 73, mac: 92 },
  Numpad0: { evdev: 82, win: 82, mac: 82 },
  IntlBackslash: { evdev: 86, win: 86, mac: 10 },
  ContextMenu: { evdev: 127, win: 93, winExtended: true, mac: 110 },
  Power: { evdev: 116, win: 94, winExtended: true },
  NumpadEqual: { evdev: 117, win: 89, mac: 81 },
  F13: { evdev: 183, win: 100, mac: 105 },
  F14: { evdev: 184, win: 101, mac: 107 },
  F15: { evdev: 185, win: 102, mac: 113 },
  F16: { evdev: 186, win: 103, mac: 106 },
  F17: { evdev: 187, win: 104, mac: 64 },
  F18: { evdev: 188, win: 105, mac: 79 },
  F19: { evdev: 189, win: 106, mac: 80 },
  F20: { evdev: 190, win: 107, mac: 90 },
  F21: { evdev: 191, win: 108 },
  F22: { evdev: 192, win: 109 },
  F23: { evdev: 193, win: 110 },
  F24: { evdev: 194, win: 118 },
  Open: { evdev: 134 },
  Help: { evdev: 138, win: 59, winExtended: true },
  Select: { evdev: 132 },
  Again: { evdev: 129 },
  Undo: { evdev: 131, win: 8, winExtended: true },
  Cut: { evdev: 137, win: 23, winExtended: true },
  Copy: { evdev: 133, win: 24, winExtended: true },
  Paste: { evdev: 135, win: 10, winExtended: true },
  Find: { evdev: 136 },
  AudioVolumeMute: { evdev: 113, win: 32, winExtended: true, mac: 74 },
  AudioVolumeUp: { evdev: 115, win: 48, winExtended: true, mac: 72 },
  AudioVolumeDown: { evdev: 114, win: 46, winExtended: true, mac: 73 },
  NumpadComma: { evdev: 121, win: 126, mac: 95 },
  IntlRo: { evdev: 89, win: 115, mac: 94 },
  KanaMode: { evdev: 93, win: 112 },
  IntlYen: { evdev: 124, win: 125, mac: 93 },
  Convert: { evdev: 92, win: 121 },
  NonConvert: { evdev: 94, win: 123 },
  Lang1: { evdev: 122, win: 114, mac: 104 },
  Lang2: { evdev: 123, win: 113, mac: 102 },
  Lang3: { evdev: 90, win: 120 },
  Lang4: { evdev: 91, win: 119 },
  Lang5: { evdev: 85 },
  ControlLeft: { evdev: 29, win: 29, mac: 59 },
  ShiftLeft: { evdev: 42, win: 42, mac: 56 },
  AltLeft: { evdev: 56, win: 56, mac: 58 },
  MetaLeft: { evdev: 125, win: 91, winExtended: true, mac: 55 },
  ControlRight: { evdev: 97, win: 29, winExtended: true, mac: 62 },
  ShiftRight: { evdev: 54, win: 54, mac: 60 },
  AltRight: { evdev: 100, win: 56, winExtended: true, mac: 61 },
  MetaRight: { evdev: 126, win: 92, winExtended: true, mac: 54 },
  BrightnessUp: { evdev: 225 },
  MediaPlay: { evdev: 207 },
  MediaPause: { evdev: 201 },
  MediaRecord: { evdev: 167 },
  MediaFastForward: { evdev: 208 },
  MediaRewind: { evdev: 168 },
  MediaStop: { evdev: 166, win: 36, winExtended: true },
  Eject: { evdev: 161, win: 44, winExtended: true },
  MediaSelect: { evdev: 171, win: 109, winExtended: true },
  LaunchMail: { evdev: 155, win: 108, winExtended: true },
  LaunchApp2: { evdev: 140, win: 33, winExtended: true },
  LaunchApp1: { evdev: 144, win: 107, winExtended: true },
  SelectTask: { evdev: 580 },
  BrowserSearch: { evdev: 217, win: 101, winExtended: true },
  BrowserHome: { evdev: 172, win: 50, winExtended: true },
  BrowserBack: { evdev: 158, win: 106, winExtended: true },
  BrowserStop: { evdev: 128, win: 104, winExtended: true },
  MailReply: { evdev: 232 },
  MailForward: { evdev: 233 },
  MailSend: { evdev: 231 }
}

/** Keycode de X11 (XTest) para un `code`, o undefined si no hay equivalente. */
export function x11Keycode(code: string): number | undefined {
  const evdev = KEY_MAP[code]?.evdev
  return evdev === undefined ? undefined : evdev + 8
}

/** Scancode de Windows y si necesita la marca de tecla extendida. */
export function windowsScancode(code: string): { scancode: number; extended: boolean } | undefined {
  const entry = KEY_MAP[code]
  return entry?.win === undefined
    ? undefined
    : { scancode: entry.win, extended: entry.winExtended === true }
}

/** Código de tecla virtual de macOS para un `code`. */
export function macVirtualKey(code: string): number | undefined {
  return KEY_MAP[code]?.mac
}
