// Texto del protocolo (`text {text}`): se escribe tal cual, sin depender de la distribución del
// teclado del PC (add-remote-desktop D10). Los saltos de línea y tabuladores se escriben como
// las teclas Intro y Tab, y el resto de caracteres de control se descartan.

export type TextSegment = { kind: 'text'; text: string } | { kind: 'key'; code: 'Enter' | 'Tab' }

/** Parte el texto en tramos de caracteres y las teclas Intro y Tab. */
export function splitText(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let pending = ''
  const flush = (): void => {
    if (pending) segments.push({ kind: 'text', text: pending })
    pending = ''
  }
  const normalized = text.replace(/\r\n?/g, '\n')
  for (const char of normalized) {
    if (char === '\n' || char === '\t') {
      flush()
      segments.push({ kind: 'key', code: char === '\n' ? 'Enter' : 'Tab' })
      continue
    }
    const cp = char.codePointAt(0) ?? 0
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) continue
    pending += char
  }
  flush()
  return segments
}

/**
 * Trozos de como mucho `max` unidades UTF-16 sin partir un par sustituto (macOS acepta unos 20
 * caracteres por evento con CGEventKeyboardSetUnicodeString).
 */
export function chunkUtf16(text: string, max: number): string[] {
  const chunks: string[] = []
  let current = ''
  for (const char of text) {
    if (current.length + char.length > max) {
      chunks.push(current)
      current = ''
    }
    current += char
  }
  if (current) chunks.push(current)
  return chunks
}

/**
 * Keysym de X11 para un carácter: Latin-1 imprimible tiene el mismo valor y el resto usa el rango
 * Unicode de los keysyms (0x01000000 + punto de código).
 */
export function keysymForCodePoint(cp: number): number {
  if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) return cp
  return 0x01000000 + cp
}
