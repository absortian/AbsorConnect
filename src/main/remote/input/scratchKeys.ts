// Escritura de texto en X11 (add-remote-desktop D10): cada carácter se escribe con un keycode
// libre reasignado a su keysym en los dos niveles (sin y con Mayúsculas), como hace xdotool. Así no
// importan la distribución, el grupo activo (p. ej. "us,es"), el Bloq Mayús ni un Mayús pulsado.
//
// Las apps leen el mapa del teclado cuando procesan el aviso de cambio, que puede ser después de
// que el keycode ya tenga otro carácter. Por eso un keycode no se reasigna a otro carácter hasta
// que pasan `SCRATCH_REUSE_MS` desde que se usó, y los caracteres repetidos reutilizan su keycode.

export const SCRATCH_REUSE_MS = 300

/** Cuántos keycodes libres se reservan como mucho. */
export const SCRATCH_MAX_KEYCODES = 10

export type ScratchPlan = { keycode: number; remap: boolean } | { waitMs: number }

/**
 * Keycodes sin ningún keysym en el mapa de `XGetKeyboardMapping` (`perKeycode` keysyms por keycode
 * a partir de `minKeycode`). El 8 se salta: algunas apps lo ignoran.
 */
export function freeKeycodes(
  mapping: ArrayLike<number>,
  perKeycode: number,
  minKeycode: number,
  limit = SCRATCH_MAX_KEYCODES
): number[] {
  const free: number[] = []
  const count = Math.floor(mapping.length / perKeycode)
  for (let i = 0; i < count && free.length < limit; i++) {
    const keycode = minKeycode + i
    if (keycode <= 8) continue
    let empty = true
    for (let j = 0; j < perKeycode; j++) {
      if (mapping[i * perKeycode + j] !== 0) {
        empty = false
        break
      }
    }
    if (empty) free.push(keycode)
  }
  return free
}

export class ScratchKeycodes {
  private readonly slots: { keycode: number; keysym: number; usedAt: number }[]

  constructor(
    keycodes: number[],
    private readonly reuseMs = SCRATCH_REUSE_MS
  ) {
    this.slots = keycodes.map((keycode) => ({ keycode, keysym: 0, usedAt: 0 }))
  }

  get size(): number {
    return this.slots.length
  }

  /**
   * Keycode para escribir `keysym` ahora: el que ya lo tiene, uno libre o el usado hace más tiempo
   * (`remap: true` si hay que reasignarlo). Si todos se usaron hace menos de `reuseMs`, cuánto
   * esperar.
   */
  acquire(keysym: number, now: number): ScratchPlan {
    const hit = this.slots.find((slot) => slot.keysym === keysym)
    if (hit) {
      hit.usedAt = now
      return { keycode: hit.keycode, remap: false }
    }
    let target = this.slots[0]
    if (!target) return { waitMs: this.reuseMs }
    for (const slot of this.slots) {
      if (slot.keysym === 0) {
        target = slot
        break
      }
      if (slot.usedAt < target.usedAt) target = slot
    }
    if (target.keysym !== 0 && now - target.usedAt < this.reuseMs) {
      return { waitMs: this.reuseMs - (now - target.usedAt) }
    }
    target.keysym = keysym
    target.usedAt = now
    return { keycode: target.keycode, remap: true }
  }

  /** Keycodes reasignados ahora mismo, que se marcan libres para devolverlos a NoSymbol. */
  release(): number[] {
    const used = this.slots.filter((slot) => slot.keysym !== 0)
    for (const slot of used) slot.keysym = 0
    return used.map((slot) => slot.keycode)
  }
}
