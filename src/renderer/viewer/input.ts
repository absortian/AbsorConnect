// Ratón y teclado del visor hacia el PC remoto (add-remote-desktop D9/D11). Las posiciones se envían
// normalizadas (0–1) sobre la imagen, descontando las bandas del modo "Ajustar"; las teclas, por su
// posición física (`KeyboardEvent.code`). Al perder el foco se sueltan todas (`release-all`), para que
// ninguna se quede pulsada en el PC.

/** Tiempo quieto tras el que la última posición se reenvía por el canal fiable. */
const SETTLE_MS = 120

export interface InputSink {
  pointer(x: number, y: number): void
  input(message: Record<string, unknown>): void
}

/** Parte del elemento de vídeo que ocupa la imagen (object-fit: contain deja bandas). */
export function contentBox(
  element: { width: number; height: number },
  video: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  if (video.width === 0 || video.height === 0) return { x: 0, y: 0, ...element }
  const scale = Math.min(element.width / video.width, element.height / video.height)
  const width = video.width * scale
  const height = video.height * scale
  return { x: (element.width - width) / 2, y: (element.height - height) / 2, width, height }
}

/** Posición normalizada de un punto del elemento; null si cae en las bandas. */
export function normalize(
  px: number,
  py: number,
  element: { width: number; height: number },
  video: { width: number; height: number }
): { x: number; y: number } | null {
  const box = contentBox(element, video)
  const x = (px - box.x) / box.width
  const y = (py - box.y) / box.height
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x, y }
}

/** Engancha el ratón y el teclado al vídeo. `active` dice si hay sesión y foco en la imagen. */
export function attachInput(
  video: HTMLVideoElement,
  sink: InputSink,
  active: () => boolean
): () => void {
  let frame = 0
  let pending: { x: number; y: number } | null = null
  // El canal `pointer` no reenvía lo que se pierde ni guarda el orden con `input`: la posición de
  // cada clic y la última, cuando el ratón se queda quieto, van también por `input` (fiable y en
  // orden con los botones). Si no, un paquete perdido deja el cursor en otro sitio y el clic cae
  // donde no es.
  let settle: ReturnType<typeof setTimeout> | undefined
  const moveReliably = (at: { x: number; y: number }): void =>
    sink.input({ type: 'move', x: at.x, y: at.y })

  const position = (event: MouseEvent): { x: number; y: number } | null => {
    const rect = video.getBoundingClientRect()
    return normalize(
      event.clientX - rect.left,
      event.clientY - rect.top,
      { width: rect.width, height: rect.height },
      { width: video.videoWidth, height: video.videoHeight }
    )
  }

  // Un movimiento por fotograma de pantalla como mucho: el canal `pointer` solo necesita el último
  const onMove = (event: MouseEvent): void => {
    if (!active()) return
    pending = position(event)
    clearTimeout(settle)
    const last = pending
    if (last) settle = setTimeout(() => moveReliably(last), SETTLE_MS)
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (pending) sink.pointer(pending.x, pending.y)
    })
  }
  const onButton = (event: MouseEvent): void => {
    if (!active()) return
    event.preventDefault()
    const at = position(event)
    if (event.type === 'mousedown' && !at) return
    if (at) moveReliably(at)
    sink.input({ type: 'button', button: event.button, down: event.type === 'mousedown' })
  }
  const onWheel = (event: WheelEvent): void => {
    if (!active()) return
    event.preventDefault()
    sink.input({ type: 'wheel', dx: event.deltaX, dy: event.deltaY, mode: event.deltaMode })
  }
  const onKey = (event: KeyboardEvent): void => {
    if (!active() || !event.code) return
    // Todo va al PC remoto: también Ctrl+R, F12 o Alt+F4 (las ventanas de visor no tienen los
    // atajos de desarrollo, D11)
    event.preventDefault()
    event.stopPropagation()
    sink.input({ type: 'key', code: event.code, down: event.type === 'keydown' })
  }
  const releaseAll = (): void => sink.input({ type: 'release-all' })
  const onVisibility = (): void => {
    if (document.hidden) releaseAll()
  }
  const noMenu = (event: Event): void => {
    if (active()) event.preventDefault()
  }

  video.addEventListener('mousemove', onMove)
  video.addEventListener('mousedown', onButton)
  window.addEventListener('mouseup', onButton)
  video.addEventListener('wheel', onWheel, { passive: false })
  video.addEventListener('contextmenu', noMenu)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('keyup', onKey, true)
  window.addEventListener('blur', releaseAll)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    clearTimeout(settle)
    video.removeEventListener('mousemove', onMove)
    video.removeEventListener('mousedown', onButton)
    window.removeEventListener('mouseup', onButton)
    video.removeEventListener('wheel', onWheel)
    video.removeEventListener('contextmenu', noMenu)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('keyup', onKey, true)
    window.removeEventListener('blur', releaseAll)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

/** Combinaciones del menú: las que el sistema local no deja capturar (o no conviene). */
export const COMBOS: { label: string; codes: string[] }[] = [
  { label: 'Ctrl+Alt+Supr', codes: ['ControlLeft', 'AltLeft', 'Delete'] },
  { label: 'Win / Cmd', codes: ['MetaLeft'] },
  { label: 'Alt+Tab', codes: ['AltLeft', 'Tab'] },
  { label: 'Cmd+Tab', codes: ['MetaLeft', 'Tab'] },
  { label: 'Alt+F4', codes: ['AltLeft', 'F4'] },
  { label: 'Ctrl+Esc', codes: ['ControlLeft', 'Escape'] },
  { label: 'Impr Pant', codes: ['PrintScreen'] }
]

/** Pulsa las teclas en orden y las suelta al revés. */
export function sendCombo(sink: InputSink, codes: string[]): void {
  for (const code of codes) sink.input({ type: 'key', code, down: true })
  for (const code of [...codes].reverse()) sink.input({ type: 'key', code, down: false })
}
