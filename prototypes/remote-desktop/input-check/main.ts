// Prueba manual de la inyección de entrada (tarea 4.6 de add-remote-desktop) con el módulo real
// `src/main/remote/input`. Tapa cada pantalla con una ventana, inyecta clics en sus esquinas y en
// el centro, y en la principal prueba teclas, texto, doble clic, botones, arrastre y rueda,
// comprobando lo que llega a la ventana. Ver el README de prototypes/remote-desktop.
//
//   electron prototypes/remote-desktop/input-check [--semicolon=ñ] [--out=fichero.json] [--clave=valor…]
//
// `--semicolon` es el carácter que debe salir con la tecla a la derecha de la L (`Semicolon`) en
// la distribución del equipo: "ñ" (por defecto) en español, ";" en inglés de EE. UU. En Cinnamon
// no se puede cambiar de distribución desde la prueba (vuelve a la de la ventana activa).
// Todos los `--clave=valor` se guardan en el JSON (`args`): test-mac.sh anota así la
// distribución, el desplazamiento natural y la versión de macOS.
import { app, BrowserWindow, clipboard, Display, screen, systemPreferences } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  createInputController,
  InputController,
  nativeDisplayRect
} from '../../../src/main/remote/input'
import { InputEvent, MouseButton } from '../../../src/shared/remote/input'

interface Check {
  name: string
  ok: boolean
  detail: unknown
}

interface RecordedEvent {
  type: string
  target: string
  button: number
  buttons: number
  screenX: number
  screenY: number
}

const args = Object.fromEntries(
  process.argv
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => a.slice(2).split('=') as [string, string])
)

const checks: Check[] = []
const report = {
  platform: process.platform,
  arch: process.arch,
  osRelease: os.release(),
  electron: process.versions.electron,
  sessionType: process.env.XDG_SESSION_TYPE ?? null,
  args,
  displays: [] as unknown[],
  checks,
  error: null as string | null
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function check(name: string, ok: boolean, detail: unknown): void {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${name} ${JSON.stringify(detail)}`)
}

async function openTarget(display: Display, primary: boolean): Promise<BrowserWindow> {
  // Pantalla completa desde el principio: así el gestor de ventanas la pone encima de los paneles
  const mac = process.platform === 'darwin'
  const win = new BrowserWindow({
    ...display.bounds,
    frame: false,
    show: false,
    fullscreen: !mac,
    skipTaskbar: true,
    // macOS: que el primer clic llegue a la página aunque la ventana no estuviera activa
    acceptFirstMouse: true,
    backgroundColor: '#1d2433',
    webPreferences: { contextIsolation: true, sandbox: true }
  })
  await win.loadFile(path.join(__dirname, '..', 'target.html'), {
    query: { primary: primary ? '1' : '0' }
  })
  win.show()
  // macOS: pantalla completa "simple", sin animación ni otro escritorio
  if (mac) win.setSimpleFullScreen(true)
  win.focus()
  return win
}

/** Si la ventana de prueba tapa el punto (DIP): si no, el clic caería en el escritorio de verdad. */
function covers(win: BrowserWindow, x: number, y: number): boolean {
  const b = win.getBounds()
  return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height
}

async function takeEvents(win: BrowserWindow): Promise<RecordedEvent[]> {
  return win.webContents.executeJavaScript('window.__events.splice(0)')
}

async function run(): Promise<void> {
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  report.displays = displays.map((d) => ({
    id: d.id,
    primary: d.id === primary.id,
    bounds: d.bounds,
    workArea: d.workArea,
    scaleFactor: d.scaleFactor,
    nativeRect: nativeDisplayRect(d)
  }))
  console.log(JSON.stringify({ displays: report.displays }))

  if (process.platform === 'darwin') {
    // Sin el permiso, macOS descarta los eventos sin avisar: la prueba no seguiría
    if (!systemPreferences.isTrustedAccessibilityClient(true)) {
      check('permiso de Accesibilidad', false, {
        hint: 'Ajustes del Sistema > Privacidad y seguridad > Accesibilidad: activa la app desde la que lanzas la prueba (Terminal) y vuelve a ejecutarla'
      })
      return
    }
    app.focus({ steal: true })
  }

  const input: InputController = await createInputController()
  try {
    await runChecks(input, displays, primary)
  } finally {
    await input.dispose()
  }
}

async function runChecks(
  input: InputController,
  displays: Display[],
  primary: Display
): Promise<void> {
  const send = (event: InputEvent): Promise<void> => input.apply(event)
  const key = (code: string, down: boolean): Promise<void> => send({ type: 'key', code, down })
  const tap = async (code: string): Promise<void> => {
    await key(code, true)
    await key(code, false)
  }
  const press = (button: MouseButton, down: boolean): Promise<void> =>
    send({ type: 'button', button, down })

  const windows = new Map<number, BrowserWindow>()
  for (const display of displays) {
    windows.set(display.id, await openTarget(display, display.id === primary.id))
  }
  await sleep(1500)

  // 1. Esquinas y centro de cada pantalla: el clic debe llegar al punto equivalente en DIP. Las
  // esquinas son las del área de trabajo: en Cinnamon el panel sigue encima de una ventana a
  // pantalla completa, y un clic ahí abriría su menú
  for (const display of displays) {
    const win = windows.get(display.id)!
    const { bounds, workArea } = display
    input.setDisplayRect(nativeDisplayRect(display))
    const inset = 0.01
    const left = (workArea.x - bounds.x) / bounds.width + inset
    const top = (workArea.y - bounds.y) / bounds.height + inset
    const right = (workArea.x + workArea.width - bounds.x) / bounds.width - inset
    const bottom = (workArea.y + workArea.height - bounds.y) / bounds.height - inset
    const points = [
      [0.5, 0.5],
      [left, top],
      [right, top],
      [left, bottom],
      [right, bottom]
    ]
    const errors: (number | string)[] = []
    for (const [x, y] of points) {
      const expected = { x: bounds.x + x * bounds.width, y: bounds.y + y * bounds.height }
      if (!covers(win, expected.x, expected.y)) {
        errors.push('sin ventana de prueba encima')
        continue
      }
      await send({ type: 'move', x, y })
      await sleep(50)
      await press('left', true)
      await press('left', false)
      await sleep(250)
      const down = (await takeEvents(win)).find((e) => e.type === 'mousedown')
      errors.push(
        down
          ? Math.max(Math.abs(down.screenX - expected.x), Math.abs(down.screenY - expected.y))
          : 'no llegó'
      )
    }
    check(
      `clics en esquinas y centro, pantalla ${display.id} (${bounds.width}×${bounds.height} DIP al ${display.scaleFactor * 100} %)`,
      errors.every((e) => typeof e === 'number' && e <= 2),
      { errorDip: errors }
    )
  }

  const win = windows.get(primary.id)!
  input.setDisplayRect(nativeDisplayRect(primary))
  const content = win.getContentBounds()
  const at = async (id: string, fx = 0.5, fy = 0.5): Promise<{ x: number; y: number }> => {
    const r = await win.webContents.executeJavaScript(
      `(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
         return { x: r.x, y: r.y, width: r.width, height: r.height } })()`
    )
    return {
      x: (content.x + r.x + r.width * fx - primary.bounds.x) / primary.bounds.width,
      y: (content.y + r.y + r.height * fy - primary.bounds.y) / primary.bounds.height
    }
  }
  const moveTo = async (id: string, fx = 0.5, fy = 0.5): Promise<void> => {
    await send({ type: 'move', ...(await at(id, fx, fy)) })
    await sleep(50)
  }

  // 2. Teclado y texto en el área de texto
  await moveTo('text')
  await press('left', true)
  await press('left', false)
  await sleep(300)
  await takeEvents(win)
  const value = (): Promise<string> =>
    win.webContents.executeJavaScript('document.getElementById("text").value')
  const step = async (name: string, action: () => Promise<void>, expected: string): Promise<void> => {
    const before = await value()
    try {
      await action()
    } catch (error) {
      await input.releaseAll()
      check(name, false, { error: String(error) })
      return
    }
    await sleep(400)
    const after = await value()
    const added = after.startsWith(before) ? after.slice(before.length) : after
    check(name, added === expected, { added, expected })
  }

  const semicolon = args.semicolon ?? 'ñ'
  await step(`Semicolon da "${semicolon}" con la distribución del equipo`, () => tap('Semicolon'), semicolon)
  await step(
    'texto "¿Año 2026? €"',
    () => send({ type: 'text', text: '¿Año 2026? €' }),
    '¿Año 2026? €'
  )
  await step(
    'Mayús + A',
    async () => {
      await key('ShiftLeft', true)
      await tap('KeyA')
      await key('ShiftLeft', false)
    },
    'A'
  )
  await step(
    'texto con salto de línea',
    () => send({ type: 'text', text: ' uno\ndos ' }),
    ' uno\ndos '
  )
  await step(
    'tecla mantenida 1,2 s: sin repetición del sistema',
    async () => {
      await key('KeyB', true)
      await sleep(1200)
      await key('KeyB', false)
    },
    'b'
  )
  // Al ritmo de la repetición de un teclado (~30 por segundo): Windows junta en un solo
  // WM_KEYDOWN las repeticiones que llegan a la vez, y Chromium escribe una sola letra
  await step(
    'repetición enviada por el controlador',
    async () => {
      for (let i = 0; i < 3; i++) {
        await key('KeyC', true)
        await sleep(35)
      }
      await key('KeyC', false)
    },
    'ccc'
  )
  await step(
    'release-all suelta Mayús',
    async () => {
      await key('ShiftLeft', true)
      await send({ type: 'release-all' })
      await tap('KeyD')
    },
    'd'
  )
  clipboard.writeText('')
  const shortcut = process.platform === 'darwin' ? 'MetaLeft' : 'ControlLeft'
  await key(shortcut, true)
  await tap('KeyA')
  await tap('KeyC')
  await key(shortcut, false)
  await sleep(400)
  const typed = await value()
  // El portapapeles de Windows guarda los saltos de línea como \r\n
  const copied = clipboard.readText().replace(/\r\n/g, '\n')
  check(`${process.platform === 'darwin' ? 'Cmd' : 'Ctrl'}+A y +C copian el texto`, copied === typed, {
    clipboard: copied,
    typed
  })

  // 3. Ratón: doble clic, otros botones, arrastre y rueda
  // Con las pausas de una persona: unos 80 ms entre pulsar y soltar, y entre los dos clics
  await moveTo('dbl')
  for (let i = 0; i < 2; i++) {
    await press('left', true)
    await sleep(80)
    await press('left', false)
    await sleep(80)
  }
  await sleep(300)
  const dbl = (await takeEvents(win)).filter((e) => e.type === 'dblclick' && e.target === 'dbl')
  check('doble clic', dbl.length === 1, { dblclick: dbl.length })

  await moveTo('buttons')
  for (const button of ['right', 'middle', 'back', 'forward'] as MouseButton[]) {
    await press(button, true)
    await press(button, false)
    await sleep(150)
  }
  await sleep(200)
  const downs = (await takeEvents(win))
    .filter((e) => e.type === 'mousedown' && e.target === 'buttons')
    .map((e) => e.button)
  check('botones derecho, central, atrás y adelante', downs.join() === '2,1,3,4', { buttons: downs })

  const from = await at('drag', 0.1)
  const to = await at('drag', 0.9)
  await send({ type: 'move', ...from })
  await sleep(50)
  await press('left', true)
  for (let i = 1; i <= 10; i++) {
    await send({
      type: 'move',
      x: from.x + ((to.x - from.x) * i) / 10,
      y: from.y + ((to.y - from.y) * i) / 10
    })
    await sleep(20)
  }
  await press('left', false)
  await sleep(300)
  const drag = await takeEvents(win)
  const moves = drag.filter((e) => e.type === 'mousemove' && (e.buttons & 1) === 1)
  const up = drag.find((e) => e.type === 'mouseup')
  const expectedUp = {
    x: primary.bounds.x + to.x * primary.bounds.width,
    y: primary.bounds.y + to.y * primary.bounds.height
  }
  check(
    'arrastre con el botón pulsado',
    moves.length >= 5 && !!up && Math.abs(up.screenX - expectedUp.x) <= 2,
    { movesWithButton: moves.length, mouseupX: up?.screenX, expectedX: expectedUp.x }
  )

  await moveTo('scroll')
  await send({ type: 'wheel', dx: 0, dy: 300, mode: 0 })
  await sleep(500)
  await send({ type: 'wheel', dx: 300, dy: 0, mode: 0 })
  await sleep(500)
  const scroll = await win.webContents.executeJavaScript(
    '(() => { const s = document.getElementById("scroll"); return { top: s.scrollTop, left: s.scrollLeft } })()'
  )
  check('rueda vertical (hacia abajo)', scroll.top > 0, scroll)
  check('rueda horizontal (a la derecha)', scroll.left > 0, scroll)

  for (const w of windows.values()) w.destroy()
}

app.whenReady().then(async () => {
  try {
    await run()
  } catch (error) {
    report.error = String(error instanceof Error ? (error.stack ?? error) : error)
    console.error(error)
  }
  // El JSON se guarda siempre, también si algo falla, para poder revisarlo después
  const file =
    args.out ??
    path.join(app.getPath('downloads'), `absor-input-check-${process.platform}-${process.arch}.json`)
  fs.writeFileSync(file, JSON.stringify(report, null, 2))
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} comprobaciones bien. Resultado en ${file}`)
  app.exit(failed === 0 && checks.length > 0 && !report.error ? 0 : 1)
})
