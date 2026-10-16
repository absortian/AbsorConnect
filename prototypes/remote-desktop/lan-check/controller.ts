// Prueba entre dos equipos (lan-check), papel de controlador. Se ejecuta con Node (o Electron como
// Node) y maneja la app de verdad de este equipo por DevTools, como una persona:
//
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron prototypes/remote-desktop/lan-check/out/controller.cjs \
//     --api=http://<ip del backend>:8020 --work=<carpeta temporal> --out=<fichero.json> \
//     [--wait=30] [--cut-network=<interfaz Wi-Fi de macOS>]
//
// Espera a que el otro equipo aparezca en la cuenta como "PC de prueba … @ip:puerto" (pc.ts) y
// comprueba con su sonda lo que pasa allí: el ratón, el texto, el aviso, la bandeja, el bloqueo de
// suspensión y el registro. Al terminar llama a /done para que el PC acabe también.
import { ChildProcess, execFileSync, spawn } from 'child_process'
import * as fs from 'fs'
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
const { report, check, note } = createReport('controller')

let app: ChildProcess | null = null
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
    const candidates = (data?.devices ?? []).filter(
      (d: any) => d.online && d.remote?.state === 'available' && d.name.startsWith(PC_PREFIX) && !d.name.includes(`@${own}:`)
    )
    for (const device of candidates) {
      const address = device.name.match(/@([\d.]+:\d+)$/)?.[1]
      if (!address) continue
      probe = `http://${address}`
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
  const env: NodeJS.ProcessEnv = { ...process.env, ABSOR_CONNECT_API_URL: API }
  delete env.ELECTRON_RUN_AS_NODE
  app = spawn(ELECTRON, [ROOT, `--user-data-dir=${DATA}`, `--remote-debugging-port=${DEBUG_PORT}`], { env, stdio: ['ignore', log, log] })

  const ui = await Page.open(await waitTarget(DEBUG_PORT, (t) => t.url.endsWith('index.html'), 60_000))
  await ui.waitFor<boolean>(`!!document.querySelector('button[title="Equipos"]')`, (v) => v === true)
  await ui.eval(`document.querySelector('button[title="Equipos"]').click()`)
  const rows = await ui.waitFor<string>(`document.querySelector('.settings-panel')?.innerText ?? ''`, (t) => t.includes(device.name) && t.includes('Disponible'), 30_000)
  await ui.waitFor<boolean>(`!!${connectButton(device.name)}`, (v) => v === true, 30_000)
  check(`Equipos muestra el ${remoteSystem} disponible`, rows.includes(device.name) && rows.includes('Disponible'), null)

  // --- Conectar -------------------------------------------------------------------------
  await ui.eval(`${connectButton(device.name)}.click()`)
  const viewer = await Page.open(await waitTarget(DEBUG_PORT, (t) => t.url.includes('viewer.html'), 20_000))
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
  check('conexión directa en la red local, con latencia y fps', /Directa/.test(view.status) && /ms/.test(view.status) && /fps/.test(view.status), view.status)
  const rtt = Number(view.status.match(/(\d+) ms/)?.[1] ?? 0)
  // Con la pantalla quieta la captura manda pocos fotogramas: los fps se anotan, sin umbral
  check('latencia de red local por debajo de 50 ms', rtt > 0 && rtt < 50, { rtt, idle: view.status })

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

  const fullscreenButton = await viewer.eval<{ x: number; y: number }>(`(() => { const r = document.getElementById('fullscreen').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await viewer.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fullscreenButton.x, y: fullscreenButton.y, button: 'left', clickCount: 1 })
  await viewer.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: fullscreenButton.x, y: fullscreenButton.y, button: 'left', clickCount: 1 })
  const full = await viewer.waitFor<boolean>(`!!document.fullscreenElement`, (v) => v === true, 5000)
  await viewer.eval(`document.exitFullscreen().catch(() => undefined)`)
  const back = await viewer.waitFor<boolean>(`!document.fullscreenElement`, (v) => v === true, 5000)
  check('pantalla completa y vuelta', full === true && back === true, { full, back })

  const audio = await viewer.eval<{ button: boolean; tracks: number; flowing: boolean }>(`(() => {
    const [track] = document.getElementById('audio').srcObject?.getAudioTracks?.() ?? []
    return { button: !document.getElementById('mute').hidden, tracks: track ? 1 : 0, flowing: !!track && !track.muted && track.readyState === 'live' }
  })()`)
  if (first.platform === 'linux') {
    check(`llega el sonido del ${remoteSystem} y se puede silenciar`, null, { ...audio, note: 'en Linux el PC aún no envía sonido (fuente virtual con pactl pendiente, 4.8)' })
  } else {
    let muted: boolean | null = null
    if (audio.button) {
      await viewer.eval(`document.getElementById('mute').click()`)
      muted = await viewer.eval<boolean>(`document.getElementById('audio').muted`)
      await viewer.eval(`document.getElementById('mute').click()`)
    }
    check(`llega el sonido del ${remoteSystem} y se puede silenciar`, audio.button && audio.flowing && muted === true, { ...audio, muted })
  }

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
  check('"Evitar que el PC se suspenda" bloquea la suspensión solo con la opción activada', added.length > 0 && kept.length === 0, { added, kept, before, on, off })

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

  // --- Confirmación local -------------------------------------------------------------------------------
  await viewer.eval(`document.getElementById('disconnect').click()`).catch(() => undefined)
  viewer.close()
  await viewerGone()
  await waitState(observer, device.id, 'available')
  await pc('POST', '/app', { action: 'confirm-on' })
  const human = first.platform === 'darwin'
  const reopen = async (): Promise<Page> => {
    // El botón Equipos abre y cierra el panel: solo se pulsa si no está abierto
    await ui.eval(`(document.querySelector('.settings-panel')?.innerText ?? '').includes(${JSON.stringify(device.name)}) || document.querySelector('button[title="Equipos"]').click()`)
    await ui.waitFor<boolean>(`!!${connectButton(device.name)}`, (v) => v === true, 20_000)
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

  const final = await pc('GET', '/state')
  const types = (final.log ?? []).map((e: any) => e.type)
  check('el registro del PC anota las sesiones y el intento fallido', types.includes('session-start') && types.includes('session-end') && types.includes('auth-failed'), final.log?.slice(0, 12))
  ui.close()
}

run()
  .catch((error) => {
    report.error = describeError(error)
    console.error(error)
  })
  .finally(async () => {
    if (probe) await pc('POST', '/done', { notes: [`controlador ${systemName()} terminado`] }).catch(() => undefined)
    if (app && app.exitCode === null) {
      const exited = new Promise((resolve) => app!.once('exit', resolve))
      app.kill('SIGTERM')
      await Promise.race([exited, sleep(10_000)])
      if (app.exitCode === null) app.kill('SIGKILL')
    }
    if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2))
    const failed = report.checks.filter((c) => c.ok === false).length
    const skipped = report.checks.filter((c) => c.ok === null).length
    console.log(`\n${report.checks.length - failed - skipped}/${report.checks.length} comprobaciones bien${skipped ? ` (${skipped} sin probar)` : ''}.`)
    process.exit(failed === 0 && !report.error ? 0 : 1)
  })
