// Prueba entre dos equipos (lan-check), papel de controlador. Se ejecuta con Electron (no como Node:
// usa el portapapeles de este equipo) y maneja la app de verdad de este equipo por DevTools, como
// una persona:
//
//   node_modules/electron/dist/electron prototypes/remote-desktop/lan-check/out/controller.cjs \
//     --api=http://<ip del backend>:8020 --work=<carpeta temporal> --out=<fichero.json> \
//     [--wait=30] [--cut-network=<interfaz Wi-Fi de macOS>] [--relay=1] [--probe=<url de la sonda>] \
//     [--app=<ejecutable de un paquete>]
//
// Espera a que el otro equipo aparezca en la cuenta como "PC de prueba … @ip:puerto" (pc.ts) y
// comprueba con su sonda lo que pasa allí: el ratón, el texto, el aviso, la bandeja, los ficheros,
// el portapapeles, el bloqueo de suspensión y el registro. Con --relay=1 la app solo usa el relé
// (TURN). Con --probe, la sonda del PC está en esa URL y no en la IP de su nombre (un PC tras un
// NAT, como la VM de Windows, con un túnel SSH). Con --app, el controlador es ese paquete instalado
// (tarea 9.3) en vez de la app del repo. Al terminar llama a /done para que el PC acabe también.
import { app as electronApp, clipboard, nativeImage } from 'electron'
import { ChildProcess, execFileSync, spawn } from 'child_process'
import { createHash, randomBytes } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Page, targets, waitTarget } from '../lib/cdp'
import {
  api,
  args,
  API,
  createReport,
  describeError,
  lanAddress,
  login,
  NEW_PC_PASSWORD,
  PC_PASSWORD,
  PC_PREFIX,
  sleep,
  systemName,
  TEST_EMAIL
} from './common'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const ELECTRON =
  process.platform === 'darwin'
    ? path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
const WORK = args.work
const DATA = WORK ? path.join(WORK, 'controlador') : ''
const DEBUG_PORT = 9337
const WAIT_MINUTES = Number(args.wait ?? 30)
const CONTROLLER_NAME = `Controlador ${systemName()} de prueba`
const SAVE_DIR = WORK ? path.join(WORK, 'descargas') : ''
const RELAY = args.relay === '1'
const TAG = randomBytes(3).toString('hex')
const sha = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const { report, check, note } = createReport('controller')

let appProcess: ChildProcess | null = null
let probe = ''

async function pc<T = any>(method: 'GET' | 'POST', pathname: string, body?: unknown): Promise<T> {
  const response = await fetch(`${probe}${pathname}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000)
  })
  const data = await response.json()
  if (!response.ok) throw new Error(`sonda ${pathname}: ${JSON.stringify(data)}`)
  return data as T
}

/** El PC de prueba del otro equipo, disponible y con la sonda respondiendo. */
async function findPc(token: string): Promise<any> {
  const own = lanAddress()
  const deadline = Date.now() + WAIT_MINUTES * 60_000
  let announced = false
  while (Date.now() < deadline) {
    const { data } = await api('GET', '/api/devices', token).catch(() => ({ data: null }))
    // Con --probe se sabe dónde está el PC: no se descarta aunque su nombre lleve la IP de este
    // equipo (dos VM tras su NAT tienen la misma IP interna)
    const candidates = (data?.devices ?? []).filter(
      (d: any) =>
        d.online && d.remote?.state === 'available' && d.name.startsWith(PC_PREFIX) && (args.probe || !d.name.includes(`@${own}:`))
    )
    for (const device of candidates) {
      const address = device.name.match(/@([\d.]+:\d+)$/)?.[1]
      if (!address) continue
      probe = args.probe ?? `http://${address}`
      const ok = await pc('GET', '/state').then(() => true).catch(() => false)
      if (ok) return device
      note(`${device.name} está en la cuenta pero su sonda no responde en ${probe}`)
    }
    if (!announced) {
      console.log(`\n==> Esperando a que el otro equipo aparezca como «${PC_PREFIX} …» (hasta ${WAIT_MINUTES} min)…\n`)
      announced = true
    }
    await sleep(3000)
  }
  throw new Error(`No aparece ningún PC de prueba en ${WAIT_MINUTES} min`)
}

/**
 * El botón Conectar del PC en Equipos. Cada ejecución de pc.ts da de alta un equipo nuevo con el
 * mismo nombre, y los de ejecuciones anteriores siguen en la cuenta sin conexión (botón desactivado).
 */
function connectButton(name: string): string {
  return `[...document.querySelectorAll('.settings-row')].filter((r) => r.innerText.includes(${JSON.stringify(name)})).map((r) => r.querySelector('button')).find((b) => b && !b.disabled)`
}

/** Paso en curso, para ver en la terminal dónde está la prueba si algo se para. */
function step(name: string): void {
  console.log(`→ ${name}…`)
}

async function viewerGone(): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    if (!(await targets(DEBUG_PORT)).some((t) => t.url.includes('viewer.html'))) return true
    await sleep(500)
  }
  return false
}

async function deviceState(token: string, id: string): Promise<string> {
  const { data } = await api('GET', '/api/devices', token)
  return data?.devices?.find((d: any) => d.id === id)?.remote?.state ?? '?'
}

async function waitState(token: string, id: string, wanted: string, ms = 20_000): Promise<string> {
  const deadline = Date.now() + ms
  let last = ''
  while (Date.now() < deadline) {
    last = await deviceState(token, id).catch(() => '?')
    if (last === wanted) return last
    await sleep(1000)
  }
  return last
}

async function run(): Promise<void> {
  if (!WORK) throw new Error('Falta --work')
  fs.rmSync(WORK, { recursive: true, force: true })
  fs.mkdirSync(DATA, { recursive: true })
  const token = await login(CONTROLLER_NAME)
  const observer = await login(`Observador ${systemName()} de prueba`)

  const device = await findPc(observer)
  const first = await pc('GET', '/state')
  check('el otro equipo aparece disponible en la cuenta y su sonda responde', true, { name: device.name, platform: first.platform, displays: first.displays })
  const remoteSystem = systemName(first.platform)
  report.system.peer = first.system

  // La app de verdad de este equipo, como controlador
  fs.writeFileSync(path.join(DATA, 'session.json'), JSON.stringify({ email: TEST_EMAIL, token, encrypted: false }))
  fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'es', keepInBackground: false, openAtLogin: false }))
  const log = fs.openSync(path.join(DATA, 'app.log'), 'a')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ABSOR_CONNECT_API_URL: API,
    // Las descargas van aquí sin diálogo de guardar (controllerRuntime)
    ABSOR_CONNECT_SAVE_DIR: SAVE_DIR,
    ...(RELAY ? { ABSOR_CONNECT_FORCE_RELAY: '1' } : {})
  }
  delete env.ELECTRON_RUN_AS_NODE
  const [command, ...argv] = args.app ? [path.resolve(args.app)] : [ELECTRON, ROOT]
  appProcess = spawn(command, [...argv, `--user-data-dir=${DATA}`, `--remote-debugging-port=${DEBUG_PORT}`], { env, stdio: ['ignore', log, log] })

  const ui = await Page.open(await waitTarget(DEBUG_PORT, (t) => t.url.endsWith('index.html'), 60_000))
  await ui.waitFor<boolean>(`!!document.querySelector('button[title="Equipos"]')`, (v) => v === true)
  await ui.eval(`document.querySelector('button[title="Equipos"]').click()`)
  const rows = await ui.waitFor<string>(`document.querySelector('.settings-panel')?.innerText ?? ''`, (t) => t.includes(device.name) && t.includes('Disponible'), 30_000)
  await ui.waitFor<boolean>(`!!${connectButton(device.name)}`, (v) => v === true, 30_000)
  check(`Equipos muestra el ${remoteSystem} disponible`, rows.includes(device.name) && rows.includes('Disponible'), null)

  // --- Conectar -------------------------------------------------------------------------
  await ui.eval(`${connectButton(device.name)}.click()`)
  const viewerTarget = await waitTarget(DEBUG_PORT, (t) => t.url.includes('viewer.html'), 20_000)
  const viewer = await Page.open(viewerTarget)
  await viewer.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  // Listo cuando se titula con el nombre del PC (antes, enviar la contraseña no hace nada)
  await viewer.waitFor<string>('document.title', (title) => title === device.name, 15_000)
  const overlayText = (): Promise<string> =>
    viewer.eval<string>(`document.getElementById('overlay').hidden ? '' : document.getElementById('message').textContent`)
  const submit = (password: string | null): Promise<unknown> =>
    viewer.eval(`(() => {
      const p = document.getElementById('password')
      if (!p.hidden && ${JSON.stringify(password)} !== null) p.value = ${JSON.stringify(password)}
      document.getElementById('login').requestSubmit()
    })()`)
  const connected = (ms: number): Promise<boolean> =>
    viewer.waitFor<boolean>(`document.getElementById('overlay').hidden && document.getElementById('status').textContent.includes('fps')`, (v) => v === true, ms)
  const failedWith = (ms: number): Promise<string> =>
    viewer.waitFor<string>(`document.getElementById('overlay').hidden ? '' : (document.getElementById('message').classList.contains('error') ? document.getElementById('message').textContent : '')`, (t) => !!t, ms)

  // Con --relay se guarda la conexión del visor para ver después su política y el par elegido
  if (RELAY) {
    await viewer.eval(`(() => {
      const Original = window.RTCPeerConnection
      window.peerConnections = []
      window.RTCPeerConnection = function (...args) { const pc = new Original(...args); window.peerConnections.push(pc); return pc }
      window.RTCPeerConnection.prototype = Original.prototype
    })()`)
  }
  await submit('contraseña-incorrecta')
  const wrong = await failedWith(30_000)
  check('contraseña incorrecta: el visor lo explica', wrong === 'Contraseña incorrecta.', wrong)

  let started = Date.now()
  await submit(PC_PASSWORD)
  const ok = await connected(30_000)
  const seconds = (Date.now() - started) / 1000
  await sleep(4000)
  const view = await viewer.eval<{ w: number; h: number; status: string; displays: string[]; current: string; mute: boolean }>(`(() => {
    const v = document.getElementById('video'), s = document.getElementById('displays')
    return { w: v.videoWidth, h: v.videoHeight, status: document.getElementById('status').textContent,
      displays: [...s.options].map((o) => o.value), current: s.value, mute: !document.getElementById('mute').hidden }
  })()`)
  check('con la contraseña correcta se conecta en menos de 10 s y llega la imagen', ok && seconds < 10 && view.w > 0, { seconds, ...view })
  if (RELAY) {
    const forced = await viewer.eval<boolean>(`window.absorViewer.init().then((init) => init.forceRelay)`)
    const route = await viewer.eval<unknown>(`(async () => {
      const pc = window.peerConnections.at(-1)
      if (!pc) return null
      const report = await pc.getStats()
      let pair = null
      report.forEach((e) => { if (e.type === 'transport' && e.selectedCandidatePairId) pair = report.get(e.selectedCandidatePairId) })
      const local = pair && report.get(pair.localCandidateId), remote = pair && report.get(pair.remoteCandidateId)
      return { policy: pc.getConfiguration().iceTransportPolicy, local: local && [local.candidateType, local.address, local.relayProtocol], remote: remote && [remote.candidateType, remote.address] }
    })()`)
    check('solo por relé: la sesión funciona y el visor dice que va por relé', /Por relé/.test(view.status) && /fps/.test(view.status), { status: view.status, forceRelay: forced, route })
  }
  else check('conexión directa en la red local, con latencia y fps', /Directa/.test(view.status) && /ms/.test(view.status) && /fps/.test(view.status), view.status)
  const rtt = Number(view.status.match(/(\d+) ms/)?.[1] ?? 0)
  // Con la pantalla quieta la captura manda pocos fotogramas: los fps se anotan, sin umbral
  check('latencia de red local por debajo de 50 ms', /\d+ ms/.test(view.status) && rtt < 50, { rtt, idle: view.status })

  // Lo que se ve en el PC durante la sesión
  const during = await pc('GET', '/state')
  check(`el ${remoteSystem} muestra el aviso con el nombre del controlador`, !!during.notice?.text?.includes(CONTROLLER_NAME), during.notice)
  const tray = await pc('GET', '/tray').catch((e) => String(e))
  check(
    `la bandeja del ${remoteSystem} dice quién lo controla`,
    Array.isArray(tray) ? tray.some((item: string) => item.includes(`Controlado ahora desde ${CONTROLLER_NAME}`)) : null,
    tray
  )
  check('mientras dura la sesión, el PC aparece ocupado en la cuenta', (await waitState(observer, device.id, 'busy', 10_000)) === 'busy', null)

  // Un segundo controlador recibe "ocupado" (una sesión a la vez)
  const second = await api('POST', `/api/devices/${device.id}/remote-requests`, observer, { offer: 'v=0' })
  let rejection: any = second.data
  if (second.status === 201 || second.status === 200) {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      const poll = await api('GET', `/api/remote-requests/${second.data.id}`, observer)
      if (poll.data?.status !== 'pending') {
        rejection = poll.data
        break
      }
      await sleep(1000)
    }
  }
  check('un segundo controlador recibe "ocupado"', rejection?.status === 'rejected' && rejection?.rejection?.reason === 'busy', rejection)

  step('ratón y teclado')
  // --- Ratón y teclado ----------------------------------------------------------------------
  const currentDisplay = (state: any): any => state.displays.find((d: any) => d.id === view.current) ?? state.displays.find((d: any) => d.primary)
  const display = currentDisplay(during)
  const at = async (fx: number, fy: number): Promise<{ x: number; y: number }> =>
    viewer.eval<{ x: number; y: number }>(`(() => {
      const v = document.getElementById('video'); const r = v.getBoundingClientRect()
      const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight)
      const w = v.videoWidth * s, h = v.videoHeight * s
      return { x: r.left + (r.width - w) / 2 + w * ${fx}, y: r.top + (r.height - h) / 2 + h * ${fy} }
    })()`)
  const expected = (fx: number, fy: number): { x: number; y: number } => ({
    x: Math.round(display.bounds.x + display.bounds.width * fx),
    y: Math.round(display.bounds.y + display.bounds.height * fy)
  })
  const near = (a: { x: number; y: number }, b: { x: number; y: number }, tolerance = 4): boolean =>
    Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance

  for (const [fx, fy] of [[0.1, 0.1], [0.9, 0.9]]) {
    const point = await at(fx, fy)
    await viewer.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
    await sleep(800)
    const pointer = (await pc('GET', '/state')).pointer
    check(`el ratón va al punto equivalente del ${remoteSystem} (${fx * 100} %, ${fy * 100} %)`, near(pointer, expected(fx, fy)), { pointer, expected: expected(fx, fy), display: display.bounds })
  }

  await pc('POST', '/reset')
  const center = await at(0.2, 0.8)
  await viewer.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y })
  await viewer.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: center.x, y: center.y, button: 'left', clickCount: 1 })
  await viewer.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: center.x, y: center.y, button: 'left', clickCount: 1 })
  await sleep(800)
  const clicked = (await pc('GET', '/state')).target
  const down = clicked.events?.find((e: any) => e.type === 'mousedown')
  check('un clic llega al PC en su sitio y da el foco a la ventana de prueba', !!down && near(down, expected(0.2, 0.8), 6) && clicked.focused === true, { down, expected: expected(0.2, 0.8), focused: clicked.focused })

  const key = async (code: string, key: string, modifiers = 0): Promise<void> => {
    await viewer.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, modifiers })
    await viewer.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, modifiers })
    await sleep(60)
  }
  for (const [code, k] of [['KeyH', 'h'], ['KeyO', 'o'], ['KeyL', 'l'], ['KeyA', 'a'], ['Space', ' '], ['Semicolon', 'ñ'], ['Space', ' '], ['Digit2', '2'], ['Digit0', '0'], ['Digit2', '2'], ['Digit6', '6']]) {
    await key(code, k)
  }
  await viewer.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ShiftLeft', key: 'Shift', modifiers: 8 })
  await key('KeyA', 'A', 8)
  await viewer.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ShiftLeft', key: 'Shift' })
  await sleep(800)
  const typed = (await pc('GET', '/state')).target.text as string
  note(`estado del visor mientras se escribe: ${await viewer.eval<string>(`document.getElementById('status').textContent`)}`)
  check('el teclado escribe en el PC por posición física (Mayúsculas incluidas)', /^hola [ñ;] 2026A$/.test(typed), { typed, note: 'la tecla a la derecha de la L da ñ en español y ; en inglés' })
  await key('Backspace', 'Backspace')
  await sleep(600)
  const erased = (await pc('GET', '/state')).target.text as string
  check('Retroceso borra en el PC', erased === typed.slice(0, -1), { erased })

  await pc('POST', '/reset')
  await viewer.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: center.x, y: center.y, deltaX: 0, deltaY: 240 })
  await sleep(800)
  const wheel = ((await pc('GET', '/state')).target.events ?? []).filter((e: any) => e.type === 'wheel')
  check('la rueda llega al PC', wheel.length > 0, { events: wheel.length, firstDy: wheel[0]?.dy, note: 'el signo puede invertirlo el desplazamiento natural del PC' })

  step('tamaño real, combinaciones y teclas soltadas')
  await viewer.eval(`document.getElementById('scale').click()`)
  await sleep(500)
  const realSize = await viewer.eval<{ real: boolean; css: number; pixels: number; scrollable: boolean; scrolled: number }>(`(() => {
    const stage = document.getElementById('stage'), video = document.getElementById('video')
    stage.scrollLeft = 400
    return { real: stage.classList.contains('real'), css: Math.round(video.getBoundingClientRect().width), pixels: video.videoWidth,
      scrollable: stage.scrollWidth > stage.clientWidth || stage.scrollHeight > stage.clientHeight, scrolled: stage.scrollLeft }
  })()`)
  await viewer.eval(`document.getElementById('scale').click()`)
  check('tamaño real: la pantalla a 1:1 y se puede desplazar', realSize.real && Math.abs(realSize.css - realSize.pixels) <= 1 && realSize.scrollable && realSize.scrolled > 0, realSize)

  // Combinación desde el menú: la tecla Windows / Cmd llega al PC
  await pc('POST', '/reset')
  await viewer.eval(`document.getElementById('combos').click()`)
  await viewer.eval(`[...document.querySelectorAll('#combo-list button')].find((b) => b.textContent === 'Win / Cmd').click()`)
  await sleep(1000)
  const comboEvents = ((await pc('GET', '/state')).target.events ?? []).filter((e: any) => e.type === 'keydown')
  // En Windows la ventana no recibe el keydown de la tecla Windows: el sistema abre Inicio
  const startMenu = first.platform === 'win32' ? await pc<string | null>('GET', '/foreground').catch(() => null) : null
  check(
    'el menú de combinaciones envía la tecla Windows / Cmd al PC',
    comboEvents.some((e: any) => /Meta|OS/.test(`${e.code} ${e.key}`)) || /StartMenuExperienceHost|SearchHost/.test(startMenu ?? ''),
    first.platform === 'win32' ? { keydown: comboEvents, foreground: startMenu } : comboEvents
  )

  // Ctrl pulsado y la ventana pierde el foco: el PC lo suelta (si no, la "x" sería Ctrl+X)
  const textArea = await at(0.2, 0.8)
  await viewer.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: textArea.x, y: textArea.y, button: 'left', clickCount: 1 })
  await viewer.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: textArea.x, y: textArea.y, button: 'left', clickCount: 1 })
  await pc('POST', '/reset')
  await viewer.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ControlLeft', key: 'Control', modifiers: 2 })
  await sleep(300)
  await viewer.eval(`window.dispatchEvent(new Event('blur'))`)
  await sleep(500)
  await key('KeyX', 'x')
  await sleep(800)
  const afterBlur = (await pc('GET', '/state')).target.text as string
  check('al perder el foco se sueltan las teclas: Ctrl no se queda pulsado en el PC', afterBlur === 'x', { afterBlur })

  // Dos PCs a la vez (con --second-pc=1): el PC de prueba de este mismo equipo en otra ventana
  if (args['second-pc'] === '1') {
    step('dos PCs a la vez')
    const own = lanAddress()
    const { data } = await api('GET', '/api/devices', observer)
    const local = (data?.devices ?? []).find(
      (d: any) => d.online && d.remote?.state === 'available' && d.name.startsWith(PC_PREFIX) && d.name.includes(`@${own}:`)
    )
    if (!local) {
      check('dos PCs a la vez, cada uno en su ventana', null, 'no hay un PC de prueba en este equipo')
    } else {
      const localProbe = `http://${local.name.match(/@([\d.]+:\d+)$/)[1]}`
      const probeOf = async (base: string): Promise<any> => (await fetch(`${base}/state`, { signal: AbortSignal.timeout(30_000) })).json()
      await ui.eval(`(document.querySelector('.settings-panel')?.innerText ?? '').includes(${JSON.stringify(local.name)}) || document.querySelector('button[title="Equipos"]').click()`)
      await ui.waitFor<boolean>(`!!${connectButton(local.name)}`, (v) => v === true, 20_000)
      await ui.eval(`${connectButton(local.name)}.click()`)
      const secondTarget = await waitTarget(DEBUG_PORT, (t) => t.url.includes('viewer.html') && t.id !== viewerTarget.id, 20_000)
      const second = await Page.open(secondTarget)
      await second.waitFor<string>('document.title', (title) => title === local.name, 15_000)
      await second.eval(`(() => { document.getElementById('password').value = ${JSON.stringify(PC_PASSWORD)}; document.getElementById('login').requestSubmit() })()`)
      const secondUp = await second.waitFor<boolean>(`document.getElementById('overlay').hidden && document.getElementById('status').textContent.includes('fps')`, (v) => v === true, 30_000)
      // Escribir en la ventana del primer PC no llega al segundo
      await pc('POST', '/reset')
      await fetch(`${localProbe}/reset`, { method: 'POST' })
      for (const [code, k] of [['KeyD', 'd'], ['KeyO', 'o'], ['KeyS', 's']]) await key(code, k)
      await sleep(800)
      const firstText = (await pc('GET', '/state')).target.text
      const secondText = (await probeOf(localProbe)).target.text
      // Cerrar la segunda no corta la primera
      await second.eval(`document.getElementById('disconnect').click()`).catch(() => undefined)
      second.close()
      await sleep(2000)
      const firstStill = await viewer.eval<boolean>(`document.getElementById('overlay').hidden && document.getElementById('status').textContent.includes('fps')`)
      check(
        'dos PCs a la vez: cada uno en su ventana, lo que se hace en una no llega a la otra y cerrar una no corta la otra',
        secondUp === true && firstText === 'dos' && secondText === '' && firstStill === true,
        { second: local.name, secondUp, firstText, secondText, firstStill }
      )
    }
  }

  step('pantallas y pantalla completa')
  // --- Pantallas, pantalla completa y sonido ------------------------------------------------------
  if (during.displays.length > 1) {
    const other = during.displays.find((d: any) => d.id !== view.current)
    await viewer.eval(`(() => { const s = document.getElementById('displays'); s.value = ${JSON.stringify(other.id)}; s.dispatchEvent(new Event('change')) })()`)
    const ratio = other.bounds.width / other.bounds.height
    const size = await viewer.waitFor<{ w: number; h: number }>(`({ w: document.getElementById('video').videoWidth, h: document.getElementById('video').videoHeight })`, (s) => !!s && Math.abs(s.w / s.h - ratio) < 0.02 && s.w !== view.w, 15_000)
    check('el selector cambia a la otra pantalla del PC', !!size && Math.abs(size.w / size.h - ratio) < 0.02, { size, other: other.bounds })
    await viewer.eval(`(() => { const s = document.getElementById('displays'); s.value = ${JSON.stringify(view.current)}; s.dispatchEvent(new Event('change')) })()`)
    await sleep(3000)
  } else {
    check('con una sola pantalla en el PC no hay selector', (await viewer.eval<boolean>(`document.getElementById('displays').hidden`)) === true, null)
  }

  // macOS solo completa la salida de la pantalla completa nativa si la app está delante (como
  // cuando una persona pulsa el botón): se activa como haría Cmd+Tab
  if (process.platform === 'darwin' && appProcess?.pid) {
    try {
      execFileSync('osascript', ['-e', `tell application "System Events" to set frontmost of (first process whose unix id is ${appProcess.pid}) to true`], { stdio: 'pipe', timeout: 10_000 })
    } catch (error) {
      note(`no se ha podido poner la app delante: ${String(error).slice(0, 120)}`)
    }
  }
  const fullscreenButton = await viewer.eval<{ x: number; y: number }>(`(() => { const r = document.getElementById('fullscreen').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await viewer.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fullscreenButton.x, y: fullscreenButton.y, button: 'left', clickCount: 1 })
  await viewer.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: fullscreenButton.x, y: fullscreenButton.y, button: 'left', clickCount: 1 })
  const full = await viewer.waitFor<boolean>(`!!document.fullscreenElement`, (v) => v === true, 5000)
  // En macOS la pantalla completa es la nativa, en su propio Escritorio: si ese Escritorio no es el
  // que se ve (p. ej. se está mirando la Terminal), macOS no hace la animación de salida y la
  // promesa de exitFullscreen() no termina. Se trae el visor al frente y no se espera la promesa
  await viewer.send('Page.bringToFront').catch(() => undefined)
  await viewer.eval(`void document.exitFullscreen().catch(() => undefined)`)
  const back = await viewer.waitFor<boolean>(`!document.fullscreenElement`, (v) => v === true, 15_000)
  await viewer.send('Page.bringToFront').catch(() => undefined)
  check('pantalla completa y vuelta', full === true && back === true, { full, back })

  step('sonido')
  // Sonido: el PC pita y aquí se mide el nivel de lo que llega (con el visor silenciado mientras se
  // mide, para que no suene aquí ni vuelva al PC si los dos papeles están en el mismo equipo)
  // Se muestrea desde aquí y no con temporizadores en la página: en macOS, si la ventana del visor
  // queda tapada, Chromium frena sus temporizadores (el sonido no se frena)
  const level = async (): Promise<number> => {
    const ready = await viewer.eval<boolean>(`(() => {
      const stream = document.getElementById('audio').srcObject
      if (!stream || stream.getAudioTracks().length === 0) return false
      const context = new AudioContext(), analyser = context.createAnalyser()
      analyser.fftSize = 2048
      context.createMediaStreamSource(stream).connect(analyser)
      window.levelProbe = { context, analyser, samples: new Float32Array(analyser.fftSize) }
      return true
    })()`)
    if (!ready) return -1
    let peak = 0
    for (const end = Date.now() + 1500; Date.now() < end; ) {
      const sample = await viewer.eval<number>(`(() => {
        const { analyser, samples } = window.levelProbe
        analyser.getFloatTimeDomainData(samples)
        let peak = 0
        for (const value of samples) peak = Math.max(peak, Math.abs(value))
        return peak
      })()`)
      peak = Math.max(peak, sample)
      await sleep(50)
    }
    await viewer.eval(`(() => { void window.levelProbe.context.close(); window.levelProbe = null })()`)
    return Math.round(peak * 1000) / 1000
  }
  const audio = await viewer.eval<{ button: boolean; noAudio: boolean }>(`({ button: !document.getElementById('mute').hidden, noAudio: !document.getElementById('no-audio').hidden })`)
  const audioSource = (await pc('GET', '/state')).linuxAudioSource
  await viewer.eval(`document.getElementById('audio').muted = true`)
  const silent = await level()
  await pc('POST', '/app', { action: 'tone-on' })
  await sleep(500)
  const tone = await level()
  await pc('POST', '/app', { action: 'tone-off' })
  await viewer.eval(`document.getElementById('audio').muted = false`)
  let muted: boolean | null = null
  if (audio.button) {
    await viewer.eval(`document.getElementById('mute').click()`)
    muted = await viewer.eval<boolean>(`document.getElementById('audio').muted`)
    await viewer.eval(`document.getElementById('mute').click()`)
  }
  check(
    `llega el sonido del ${remoteSystem} (un pitido en el PC) y se puede silenciar`,
    audio.button && tone > 0.02 && muted === true && (first.platform !== 'linux' || audioSource === true),
    { ...audio, peakSilent: silent, peakTone: tone, muted, linuxAudioSource: audioSource }
  )

  step('ficheros')
  await pc('POST', '/app', { action: 'cleanup-received' })
  const offered = await viewer.eval<{ send: boolean; download: boolean; clipboard: boolean }>(`({
    send: !document.getElementById('send-files').hidden,
    download: !document.getElementById('download').hidden,
    clipboard: !document.getElementById('clipboard').hidden
  })`)
  check('el visor ofrece el portapapeles y enviar y descargar ficheros', offered.send && offered.download && offered.clipboard, offered)

  // Dos ficheros con el botón (por el selector de ficheros)
  const outbox = path.join(WORK, 'envios')
  fs.mkdirSync(outbox, { recursive: true })
  const one = path.join(outbox, `absor-prueba-${TAG}-uno.bin`)
  const two = path.join(outbox, `absor-prueba-${TAG}-dos.txt`)
  fs.writeFileSync(one, randomBytes(3 * 1024 * 1024 + 17))
  fs.writeFileSync(two, `Informe de prueba ${TAG}: ñ€\n`.repeat(4000))
  const fileInput = async (files: string[]): Promise<void> => {
    const { root } = (await viewer.send('DOM.getDocument')).result
    const { nodeId } = (await viewer.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-input' })).result
    await viewer.send('DOM.setFileInputFiles', { nodeId, files })
  }
  const waitRows = (count: number, ms = 120_000): Promise<string[]> =>
    viewer.waitFor<string[]>(
      `[...document.querySelectorAll('#transfer-list li')].map((li) => li.className)`,
      (states) => !!states && states.filter((c) => ['done', 'failed', 'cancelled'].includes(c)).length >= count,
      ms
    )
  const receivedOnPc = async (): Promise<{ name: string; size: number; sha256: string | null }[]> => (await pc('GET', '/state')).received
  await fileInput([one, two])
  const afterTwo = await waitRows(2)
  let onPc = await receivedOnPc()
  const shaOf = (file: string): string => sha(fs.readFileSync(file))
  const arrived = (file: string, name = path.basename(file)): boolean => onPc.some((r) => r.name === name && r.sha256 === shaOf(file))
  check('enviar dos ficheros con el botón: llegan íntegros a Descargas/Absor Connect del PC', arrived(one) && arrived(two), { states: afterTwo, onPc })

  // El primero otra vez, soltándolo sobre la ventana: nombre repetido
  const center2 = await at(0.5, 0.5)
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await viewer.send('Input.dispatchDragEvent', { type, x: center2.x, y: center2.y, data: { items: [], files: [one], dragOperationsMask: 1 } })
  }
  const afterDrop = await waitRows(3)
  onPc = await receivedOnPc()
  const repeated = `absor-prueba-${TAG}-uno (1).bin`
  check('soltar sobre la ventana el mismo fichero: se guarda con otro nombre y el primero no cambia', arrived(one) && arrived(one, repeated), { states: afterDrop, onPc })

  // Cancelar un envío grande a medias
  const big = path.join(outbox, `absor-prueba-${TAG}-grande.bin`)
  fs.writeFileSync(big, Buffer.alloc(0))
  fs.truncateSync(big, 400 * 1024 * 1024)
  await fileInput([big])
  const running = await viewer.waitFor<boolean>(`(() => { const li = document.querySelector('#transfer-list li'); return !!li && li.className === 'running' && !li.querySelector('.state').textContent.startsWith('0 %') })()`, (v) => v === true, 30_000)
  await viewer.eval(`document.querySelector('#transfer-list li .actions button').click()`)
  const cancelled = await viewer.waitFor<string>(`document.querySelector('#transfer-list li').className`, (c) => c === 'cancelled', 10_000)
  await sleep(2000)
  onPc = await receivedOnPc()
  check('cancelar un envío a medias no deja nada en el PC', running === true && cancelled === 'cancelled' && !onPc.some((r) => r.name.includes('grande')), { running, cancelled, onPc })
  fs.rmSync(big, { force: true })

  // Descargar desde el explorador de carpetas del PC
  const download = (await pc('GET', '/state')).download as { path: string; name: string; size: number; sha256: string }
  const remoteDir = download.path.slice(0, download.path.length - download.name.length - 1)
  await viewer.eval(`document.getElementById('download').click()`)
  await viewer.waitFor<boolean>(`!document.getElementById('browser').hidden && document.getElementById('browser-message').textContent !== 'Cargando…'`, (v) => v === true, 15_000)
  const home = await viewer.eval<string>(`document.getElementById('browser-path').value`)
  await viewer.eval(`(() => { const input = document.getElementById('browser-path'); input.value = ${JSON.stringify(remoteDir)}; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) })()`)
  const listed = await viewer.waitFor<string[]>(`[...document.querySelectorAll('#browser-list li .name')].map((n) => n.textContent)`, (names) => !!names && names.includes(download.name), 15_000)
  await viewer.eval(`[...document.querySelectorAll('#browser-list li')].find((li) => li.querySelector('.name').textContent === ${JSON.stringify(download.name)}).click()`)
  const afterDownload = await waitRows(5)
  const saved = path.join(SAVE_DIR, download.name)
  const savedSha = fs.existsSync(saved) ? shaOf(saved) : null
  check('descargar del PC desde el explorador: se guarda íntegro', savedSha === download.sha256, { home, listed: listed?.length, states: afterDownload, savedSha })
  await viewer.eval(`document.getElementById('browser-close').click()`)
  await pc('POST', '/app', { action: 'cleanup-received' })

  // Portapapeles: con los dos papeles en el mismo equipo el portapapeles es el mismo
  step('portapapeles')
  const sameMachine = first.system.hostname === os.hostname()
  if (sameMachine) {
    check('portapapeles en los dos sentidos, con imagen y pausa', null, 'los dos papeles están en el mismo equipo y comparten portapapeles')
  } else {
    const waitUntil = async (condition: () => Promise<boolean> | boolean, ms = 8000): Promise<boolean> => {
      for (const end = Date.now() + ms; Date.now() < end; ) {
        if (await condition()) return true
        await sleep(300)
      }
      return false
    }
    const pcClipboard = async (): Promise<{ text: string; image: { width: number; height: number } | null }> => (await pc('GET', '/state')).clipboard
    const fromPc = `Absor: del PC al controlador ${TAG} ñ€`
    await pc('POST', '/app', { action: 'clipboard-set', text: fromPc })
    const gotHere = await waitUntil(() => clipboard.readText() === fromPc)
    check(`copiar en el ${remoteSystem} y pegar aquí`, gotHere, { here: clipboard.readText().slice(0, 80) })

    const toPc = `Absor: del controlador al PC ${TAG} ¿ñ?`
    clipboard.writeText(toPc)
    const gotThere = await waitUntil(async () => (await pcClipboard()).text === toPc)
    check(`copiar aquí y pegar en el ${remoteSystem}`, gotThere, await pcClipboard())

    const image = (width: number, height: number, value: number): Electron.NativeImage =>
      nativeImage.createFromBitmap(Buffer.alloc(width * height * 4, value), { width, height })
    clipboard.writeImage(image(64, 48, 0x7f))
    const imageThere = await waitUntil(async () => (await pcClipboard()).image?.width === 64)
    check(`una imagen copiada aquí se puede pegar en el ${remoteSystem}`, imageThere, await pcClipboard())

    // En pausa: una imagen copiada aquí no llega al PC (sigue la de 64×48), y lo copiado en el PC no
    // llega aquí (sigue la imagen de 32×32)
    await viewer.eval(`document.getElementById('clipboard').click()`)
    const pausedLabel = await viewer.eval<string>(`document.getElementById('clipboard').textContent`)
    clipboard.writeImage(image(32, 32, 0x20))
    await sleep(4000)
    const pcAfterPause = await pcClipboard()
    const pausedText = `Absor: en pausa ${TAG}`
    await pc('POST', '/app', { action: 'clipboard-set', text: pausedText })
    await sleep(4000)
    const here = { text: clipboard.readText().slice(0, 80), image: clipboard.readImage().getSize() }
    check(
      'en pausa, copiar una imagen aquí no cambia el portapapeles del PC (ni al revés)',
      pcAfterPause.image?.width === 64 && here.text !== pausedText && here.image.width === 32,
      { pausedLabel, pc: pcAfterPause, here }
    )
    await viewer.eval(`document.getElementById('clipboard').click()`)
  }

  step('mantener despierto')
  // --- Mantener despierto -------------------------------------------------------------------------
  const before = (await pc('GET', '/state')).keepAwake
  await pc('POST', '/app', { action: 'sleep-on' })
  await sleep(2500)
  const on = (await pc('GET', '/state')).keepAwake
  await pc('POST', '/app', { action: 'sleep-off' })
  await sleep(2500)
  const off = (await pc('GET', '/state')).keepAwake
  const added = on.ids.filter((id: string) => !before.ids.includes(id))
  const kept = added.filter((id: string) => off.ids.includes(id))
  if (on.detail === 'sistema sin comprobación') {
    note(`"Evitar que el PC se suspenda": no se puede comprobar en este PC (${first.platform})`)
  } else {
    check('"Evitar que el PC se suspenda" bloquea la suspensión solo con la opción activada', added.length > 0 && kept.length === 0, { added, kept, before, on, off })
  }

  step('corte de la red')
  // --- Corte de la red ------------------------------------------------------------------------------
  if (args['cut-network'] && process.platform === 'darwin') {
    const device_ = args['cut-network']
    console.log(`\n==> Cortando la Wi-Fi (${device_}) 10 s…`)
    const lostAt = Date.now()
    const timeline: string[] = []
    let cutError: string | null = null
    try {
      execFileSync('networksetup', ['-setairportpower', device_, 'off'], { stdio: 'pipe' })
      await sleep(10_000)
    } catch (error) {
      cutError = String(error instanceof Error ? error.message : error).slice(0, 200)
    } finally {
      execFileSync('networksetup', ['-setairportpower', device_, 'on'], { stdio: 'pipe' })
    }
    if (cutError) check('cortar la red 10 s', null, `networksetup no ha podido apagar la Wi-Fi: ${cutError}`)
    let back = cutError !== null
    let sawReconnecting = false
    while (!cutError && Date.now() - lostAt < 90_000) {
      const text = await viewer.eval<string>(`document.getElementById('overlay').hidden ? 'sesión: ' + document.getElementById('status').textContent : 'aviso: ' + document.getElementById('message').textContent`).catch(() => 'sin respuesta')
      const line = `${Math.round((Date.now() - lostAt) / 1000)} s · ${text}`
      if (timeline.at(-1)?.split(' s · ')[1] !== text) timeline.push(line)
      if (text.includes('Reconectando')) sawReconnecting = true
      if (text.startsWith('sesión:') && text.includes('fps') && Date.now() - lostAt > 12_000) {
        back = true
        break
      }
      await sleep(1000)
    }
    if (!cutError) check('cortar la red 10 s: el visor reconecta solo, sin pedir la contraseña', back, { sawReconnecting, timeline })
    if (!back) await submit(PC_PASSWORD).then(() => connected(30_000))
  } else {
    check('cortar la red 10 s', null, 'solo se prueba desde el Mac (--cut-network)')
  }

  step('cortes desde el PC')
  // --- Cortes desde el PC -------------------------------------------------------------------------------
  await pc('POST', '/app', { action: 'notice-disconnect' })
  const local = await failedWith(15_000)
  check(`"Desconectar" en el aviso del ${remoteSystem} corta la sesión`, local === 'Se ha desconectado desde el PC.', local)
  check('después, el PC vuelve a estar disponible', (await waitState(observer, device.id, 'available')) === 'available', null)

  await submit(null)
  check('"Reconectar" vuelve a entrar sin pedir la contraseña', await connected(30_000), await overlayText())
  await pc('POST', '/app', { action: 'disable' })
  const disabled = await failedWith(15_000)
  check('desactivar el control remoto en el PC corta la sesión', disabled === 'El PC ha desactivado el control remoto.', disabled)
  check('y el PC aparece desactivado en la cuenta', (await waitState(observer, device.id, 'disabled')) === 'disabled', null)
  await pc('POST', '/app', { action: 'enable' })
  await waitState(observer, device.id, 'available')

  await submit(null)
  await connected(30_000)
  await pc('POST', '/app', { action: 'password', password: NEW_PC_PASSWORD })
  const changed = await failedWith(15_000)
  const asks = await viewer.eval<boolean>(`!document.getElementById('password').hidden`)
  check('cambiar la contraseña en el PC corta la sesión y el visor pide la nueva', changed === 'Ha cambiado la contraseña del PC.' && asks, { changed, asks })
  await waitState(observer, device.id, 'available')
  await submit(NEW_PC_PASSWORD)
  check('con la contraseña nueva vuelve a conectar', await connected(30_000), await overlayText())

  step('confirmación local')
  // --- Confirmación local -------------------------------------------------------------------------------
  await viewer.eval(`document.getElementById('disconnect').click()`).catch(() => undefined)
  viewer.close()
  await viewerGone()
  await waitState(observer, device.id, 'available')
  await pc('POST', '/app', { action: 'confirm-on' })
  const human = first.platform === 'darwin'
  const reopen = async (): Promise<Page> => {
    // La ventana principal lleva rato detrás de los visores y Chromium frena sus temporizadores: el
    // panel puede tener datos viejos. Se cierra (si está abierto) y se abre para que los cargue ya
    await ui.eval(`(document.querySelector('.settings-panel')?.innerText ?? '').includes(${JSON.stringify(device.name)}) && document.querySelector('button[title="Equipos"]').click()`)
    await sleep(300)
    await ui.eval(`document.querySelector('button[title="Equipos"]').click()`)
    const found = await ui.waitFor<boolean>(`!!${connectButton(device.name)}`, (v) => v === true, 30_000)
    if (!found) {
      const panel = await ui.eval<string>(`document.querySelector('.settings-panel')?.innerText ?? 'sin panel'`)
      throw new Error(`Equipos no deja conectar con ${device.name} (estado ${await deviceState(observer, device.id)}): ${panel.slice(0, 600)}`)
    }
    await ui.eval(`${connectButton(device.name)}.click()`)
    const page = await Page.open(await waitTarget(DEBUG_PORT, (t) => t.url.includes('viewer.html'), 20_000))
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await page.waitFor<string>('document.title', (title) => title === device.name, 15_000)
    return page
  }
  if (human) await pc('POST', '/say', { text: 'Va a salir una pregunta de control remoto: NO la respondas (se rechaza sola a los 30 s).' })
  let page = await reopen()
  started = Date.now()
  await page.eval(`(() => { document.getElementById('password').value = ${JSON.stringify(NEW_PC_PASSWORD)}; document.getElementById('login').requestSubmit() })()`)
  // La pregunta sale en el PC sin bloquear la app: el PC sigue en línea mientras espera
  let asked = false
  for (let i = 0; i < 30 && !asked; i++) {
    asked = (await pc('GET', '/state').catch(() => ({}))).confirm === true
    if (!asked) await sleep(500)
  }
  const declined = await page.waitFor<string>(`document.getElementById('message').classList.contains('error') ? document.getElementById('message').textContent : ''`, (t) => !!t, 60_000)
  const declinedAfter = Math.round((Date.now() - started) / 1000)
  check('confirmación local: sale la pregunta en el PC y, si nadie responde en 30 s, se rechaza', asked && declined === 'En el PC han rechazado la conexión, o nadie la aceptó a tiempo.' && declinedAfter >= 28 && declinedAfter <= 45, { asked, declined, seconds: declinedAfter })

  // «Permitir»: en el Mac lo pulsa la persona que está delante; en otro PC, la prueba por DevTools
  await waitState(observer, device.id, 'available')
  if (human) await pc('POST', '/say', { text: 'Ahora sí: cuando salga la pregunta de control remoto, pulsa «Permitir».' })
  await page.eval(`document.getElementById('login').requestSubmit()`)
  const pressed = human ? Promise.resolve(true) : pc<boolean>('POST', '/app', { action: 'confirm-allow' }).catch(() => false)
  const allowed = await page.waitFor<boolean>(`document.getElementById('overlay').hidden && document.getElementById('status').textContent.includes('fps')`, (v) => v === true, 60_000)
  check(
    `confirmación local: al pulsar «Permitir»${human ? ' en el Mac' : ''} se conecta`,
    allowed === true && (await pressed) === true,
    { pressedBy: human ? 'persona' : 'la prueba (DevTools)', message: await page.eval('document.getElementById("message").textContent') }
  )
  if (human) await pc('POST', '/say', { text: 'Gracias. Ya casi está: no toques nada.' })
  await pc('POST', '/app', { action: 'confirm-off' })

  // --- Desconectar desde el visor y registro del PC ----------------------------------------------------------
  await page.eval(`document.getElementById('disconnect').click()`).catch(() => undefined)
  page.close()
  const gone = await viewerGone()
  check('"Desconectar" en el visor cierra la ventana y el PC queda disponible', gone && (await waitState(observer, device.id, 'available')) === 'available', { gone })

  step('bloqueo tras intentos fallidos')
  // Los accesos correctos han puesto a cero los fallos: hacen falta 5 seguidos para bloquear
  const lockPage = await reopen()
  const lockMessages: string[] = []
  for (let attempt = 0; attempt < 7; attempt++) {
    // Se borra el mensaje anterior para no leerlo otra vez
    await lockPage.eval(`(() => {
      const m = document.getElementById('message'); m.textContent = ''; m.classList.remove('error')
      const p = document.getElementById('password'); if (!p.hidden) p.value = 'contraseña-incorrecta'
      document.getElementById('login').requestSubmit()
    })()`)
    const text = await lockPage.waitFor<string>(`document.getElementById('message').classList.contains('error') ? document.getElementById('message').textContent : ''`, (t) => !!t, 60_000)
    lockMessages.push(text)
    if (text.startsWith('Demasiados intentos')) break
  }
  // El quinto fallo bloquea; el sexto intento ya recibe "bloqueado" con el tiempo que falta
  const lockedMessage = lockMessages.at(-1) ?? ''
  check(
    '5 contraseñas incorrectas seguidas: el PC se bloquea y el visor dice cuánto falta',
    lockMessages.length === 6 && lockMessages.slice(0, 5).every((m) => m === 'Contraseña incorrecta.') && /^Demasiados intentos fallidos\..* 15 min\.$/.test(lockedMessage),
    lockMessages
  )
  await lockPage.eval(`document.getElementById('disconnect').click()`).catch(() => undefined)
  lockPage.close()
  await viewerGone()

  const final = await pc('GET', '/state')
  if (first.platform === 'linux') {
    check('al terminar la sesión, la fuente de sonido virtual del PC desaparece', final.linuxAudioSource === false, final.linuxAudioSource)
  }
  const types = (final.log ?? []).map((e: any) => e.type)
  check('el registro del PC anota las sesiones y el intento fallido', types.includes('session-start') && types.includes('session-end') && types.includes('auth-failed'), final.log?.slice(0, 12))
  ui.close()
}

electronApp.dock?.hide()
electronApp.on('window-all-closed', () => undefined)
void electronApp.whenReady().then(() =>
  run()
  .catch((error) => {
    report.error = describeError(error)
    console.error(error)
  })
  .finally(async () => {
    if (probe) await pc('POST', '/done', { notes: [`controlador ${systemName()} terminado`] }).catch(() => undefined)
    if (appProcess && appProcess.exitCode === null) {
      const exited = new Promise((resolve) => appProcess!.once('exit', resolve))
      appProcess.kill('SIGTERM')
      await Promise.race([exited, sleep(10_000)])
      if (appProcess.exitCode === null) appProcess.kill('SIGKILL')
    }
    if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2))
    const failed = report.checks.filter((c) => c.ok === false).length
    const skipped = report.checks.filter((c) => c.ok === null).length
    console.log(`\n${report.checks.length - failed - skipped}/${report.checks.length} comprobaciones bien${skipped ? ` (${skipped} sin probar)` : ''}.`)
    electronApp.exit(failed === 0 && !report.error ? 0 : 1)
  })
)
