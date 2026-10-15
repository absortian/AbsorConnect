// Modificadores en macOS: cada evento de CoreGraphics lleva sus propias marcas (`CGEventFlags`), y
// los eventos inyectados no heredan las de las teclas inyectadas antes. Sin ellas, Cmd+C llegaría
// como una "c" y Mayús+clic como un clic normal. Se calculan a partir de las teclas pulsadas.

const kCGEventFlagMaskShift = 0x20000
const kCGEventFlagMaskControl = 0x40000
const kCGEventFlagMaskAlternate = 0x80000
const kCGEventFlagMaskCommand = 0x100000

const MAC_MODIFIER_FLAGS: Record<string, number> = {
  ShiftLeft: kCGEventFlagMaskShift,
  ShiftRight: kCGEventFlagMaskShift,
  ControlLeft: kCGEventFlagMaskControl,
  ControlRight: kCGEventFlagMaskControl,
  AltLeft: kCGEventFlagMaskAlternate,
  AltRight: kCGEventFlagMaskAlternate,
  MetaLeft: kCGEventFlagMaskCommand,
  MetaRight: kCGEventFlagMaskCommand
}

export function isModifierCode(code: string): boolean {
  return code in MAC_MODIFIER_FLAGS
}

/** `CGEventFlags` para las teclas (`KeyboardEvent.code`) pulsadas. */
export function macModifierFlags(pressed: Iterable<string>): number {
  let flags = 0
  for (const code of pressed) flags |= MAC_MODIFIER_FLAGS[code] ?? 0
  return flags
}
