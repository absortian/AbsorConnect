// Prueba de las tareas 4.1 y 4.2 de add-remote-desktop en macOS con la app empaquetada de verdad
// (AbsorCheck.app, que genera `test-mac.sh background`): icono en la barra de menús y su menú, icono
// del Dock, cerrar a la bandeja, instancia única, arranque oculto, abrir al iniciar sesión y aviso
// de versión nueva. La app se maneja con System Events (osascript), que también lee los iconos del
// Dock; lo que no se puede leer desde fuera (notificaciones, Ítems de inicio) se pregunta con un
// diálogo. La salida de la app (con el registro de electron-updater) va a --log.
//
//   node background-check.mjs --app=<AbsorCheck.app> --phase=main|login --out=<fichero.json> --log=<fichero>
//
// El paquete de prueba tiene otro nombre, appId y carpeta de datos que Absor Connect: no toca la app
// instalada. Su versión es 0.0.1, así que la última release de GitHub cuenta como versión nueva.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)])
)
const APP = args.app
const NAME = path.basename(APP, '.app')
const EXE = path.join(APP, 'Contents', 'MacOS', NAME)
const USER_DATA = path.join(os.homedir(), 'Library', 'Application Support', 'absor-connect-check')
const SETTINGS = path.join(USER_DATA, 'settings.json')
const LOGIN_ITEMS_PANE = 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension'
const APP_LOG = args.log ?? path.join(os.tmpdir(), 'absorcheck-app.log')
/** Lo que tarda como mucho en aparecer la versión nueva en la bandeja. */
const UPDATE_TIMEOUT_MS = 120_000
const phase = args.phase === 'login' ? 'login' : 'main'

const report = { phase, app: APP, args, checks: [], notes: [], error: null }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function check(name, ok, detail = {}) {
  report.checks.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${name} ${JSON.stringify(detail)}`)
}

function run(command, argv, timeout = 60_000) {
  const result = spawnSync(command, argv, { encoding: 'utf8', timeout })
  return { status: result.status, out: (result.stdout ?? '').trim(), err: (result.stderr ?? '').trim() }
}

function osa(script, timeout) {
  const result = run('osascript', ['-e', script], timeout)
  if (result.status !== 0) throw new Error(result.err || `osascript terminó con ${result.status}`)
  return result.out
}

/** Procesos principales de la app (no sus ayudantes), con su línea de órdenes. */
function mainProcesses() {
  return run('ps', ['-axo', 'pid=,command='])
    .out.split('\n')
    .map((line) => line.trim())
    .map((line) => ({ pid: Number(line.split(' ')[0]), command: line.slice(line.indexOf(' ') + 1) }))
    .filter(({ command }) => command === EXE || command.startsWith(`${EXE} `))
}
const mainPids = () => mainProcesses().map((p) => p.pid)

/** Si el Dock muestra el icono de la app (lo lee de los elementos del propio Dock). */
function dockHasIcon() {
  try {
    const names = osa(
      [
        'tell application "System Events" to tell process "Dock"',
        '  set dockNames to name of every UI element of list 1',
        'end tell',
        "set AppleScript's text item delimiters to linefeed",
        'return dockNames as text'
      ].join('\n')
    )
    return names.split('\n').includes(NAME)
  } catch {
    return null
  }
}

function windowCount() {
  try {
    return Number(osa(`tell application "System Events" to tell process "${NAME}" to count windows`))
  } catch {
    return -1
  }
}

function trayPresent() {
  try {
    const count = osa(
      `tell application "System Events" to tell process "${NAME}" to count menu bar items of menu bar 2`
    )
    return Number(count) > 0
  } catch {
    return false
  }
}

function state() {
  return { pids: mainPids(), windows: windowCount(), dock: dockHasIcon(), tray: trayPresent() }
}

// Abrir un menú de la barra de menús con System Events se queda esperando unos segundos; el truco
// habitual es no esperar la respuesta y reiniciar System Events
function trayMenu(action) {
  return osa(
    [
      'ignoring application responses',
      `  tell application "System Events" to tell process "${NAME}" to click menu bar item 1 of menu bar 2`,
      'end ignoring',
      'do shell script "killall System\\\\ Events"',
      'delay 0.6',
      `tell application "System Events" to tell process "${NAME}"`,
      `  tell menu 1 of menu bar item 1 of menu bar 2`,
      action,
      '  end tell',
      'end tell'
    ].join('\n')
  )
}

function trayMenuItems() {
  const out = trayMenu(
    [
      '    set itemNames to name of every menu item',
      '    key code 53',
      '    set AppleScript\'s text item delimiters to linefeed',
      '    return itemNames as text'
    ].join('\n')
  )
  return out.split('\n').filter((item) => item && item !== 'missing value')
}

function clickTrayItem(label) {
  trayMenu(`    click menu item "${label}"`)
}

function closeWindow() {
  osa(
    `tell application "System Events" to tell process "${NAME}" to click (first button of window 1 whose subrole is "AXCloseButton")`
  )
}

function ask(question, detail = '') {
  const text = detail ? `${question}\n\n${detail}` : question
  const answer = osa(
    [
      // Sin límite: por defecto un AppleEvent sin respuesta caduca a los 2 minutos
      'with timeout of 86400 seconds',
      '  tell application "System Events"',
      '    activate',
      `    set r to display dialog "${text.replace(/"/g, '\\"')}" buttons {"No", "Sí"} default button "Sí" with title "Prueba de Absor Connect"`,
      '  end tell',
      'end timeout',
      'return button returned of r'
    ].join('\n'),
    0
  )
  return answer === 'Sí'
}

/** Lanza el ejecutable directamente, con su salida en APP_LOG (como `open`, pero con registro). */
function launchLogged(appArgs = []) {
  const fd = fs.openSync(APP_LOG, 'a')
  spawn(EXE, appArgs, { detached: true, stdio: ['ignore', fd, fd] }).unref()
  fs.closeSync(fd)
}

/** Líneas del registro de la app sobre actualizaciones. */
function updateLog() {
  try {
    return fs
      .readFileSync(APP_LOG, 'utf8')
      .split('\n')
      .filter((line) => /update|versi[oó]n|latest|github/i.test(line))
      .slice(-20)
  } catch {
    return []
  }
}

function launch(appArgs = [], newInstance = false) {
  run('open', [
    ...(newInstance ? ['-n'] : []),
    '-a',
    APP,
    ...(appArgs.length > 0 ? ['--args', ...appArgs] : [])
  ])
}

async function waitFor(condition, timeoutMs, stepMs = 500) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = condition()
    if (value || Date.now() > deadline) return value
    await sleep(stepMs)
  }
}

async function quitFromTray() {
  clickTrayItem('Salir')
  return waitFor(() => mainPids().length === 0, 15_000)
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))
  } catch {
    return {}
  }
}

function writeSettings(changes) {
  fs.mkdirSync(USER_DATA, { recursive: true })
  const defaults = { theme: 'dark', language: 'es', keepInBackground: true, openAtLogin: false }
  fs.writeFileSync(SETTINGS, JSON.stringify({ ...defaults, ...readSettings(), ...changes }, null, 2))
}

async function stopRunning() {
  for (const pid of mainPids()) process.kill(pid, 'SIGTERM')
  await waitFor(() => mainPids().length === 0, 10_000)
}

/** Lanza la app oculta, deja que aplique «Abrir al iniciar sesión» y la cierra desde la bandeja. */
async function applyLoginSetting(openAtLogin) {
  writeSettings({ openAtLogin })
  launchLogged(['--hidden'])
  await waitFor(trayPresent, 20_000)
  await sleep(3000)
  await quitFromTray()
  run('open', [LOGIN_ITEMS_PANE])
  await sleep(2500)
}

async function mainPhase() {
  await stopRunning()
  fs.rmSync(USER_DATA, { recursive: true, force: true })
  fs.rmSync(APP_LOG, { force: true })
  // «Mantener abierta en segundo plano» activado, como lo dejaría Ajustes
  writeSettings({})

  // 1. Arranque normal
  const startedAt = Date.now()
  launchLogged()
  await waitFor(() => windowCount() >= 1, 30_000)
  await sleep(1500)
  const pid = mainPids()[0]
  let s = state()
  check(
    'arranca con ventana, icono en el Dock y en la barra de menús',
    s.pids.length === 1 && s.windows >= 1 && s.dock === true && s.tray,
    s
  )

  // 2. Menú de la bandeja y aviso de versión nueva (la búsqueda empieza al arrancar)
  let items = []
  const deadline = startedAt + UPDATE_TIMEOUT_MS
  do {
    await sleep(5000)
    items = trayMenuItems()
  } while (!items.some((item) => item.startsWith('Descargar la versión')) && Date.now() < deadline)
  const updateSeconds = Math.round((Date.now() - startedAt) / 1000)
  check(
    'menú de la bandeja: abrir, estado del control remoto y salir',
    ['Abrir Absor Connect', 'Control remoto: desactivado', 'Salir'].every((l) => items.includes(l)),
    { items }
  )
  const update = items.find((item) => item.startsWith('Descargar la versión')) ?? null
  check('4.2: el menú de la bandeja ofrece descargar la versión nueva', update !== null, {
    item: update,
    secondsSinceStart: updateSeconds,
    log: updateLog()
  })
  // La notificación sale a la vez que la entrada de la bandeja: sin entrada no hay nada que preguntar
  check(
    '4.2: notificación de versión nueva',
    update !== null &&
      ask(
        '¿Ha salido una notificación de AbsorCheck que dice «Hay una versión nueva disponible»?',
        'En la cabecera de la notificación tiene que poner AbsorCheck, no Absor Connect. Puede que macOS haya preguntado antes si AbsorCheck puede enviar notificaciones: responde según si al final la has visto, en pantalla o en el Centro de notificaciones.'
      ),
    update === null ? { skipped: 'no apareció la versión nueva en la bandeja' } : {}
  )

  // 3. Cerrar la ventana con «Mantener abierta en segundo plano»
  closeWindow()
  await sleep(2000)
  s = state()
  check(
    'cerrar la ventana la oculta: sigue en marcha, sin Dock y con icono en la barra de menús',
    s.pids.length === 1 && s.pids[0] === pid && s.windows === 0 && s.dock === false && s.tray,
    s
  )

  // 4. Abrir desde la bandeja
  clickTrayItem('Abrir Absor Connect')
  await waitFor(() => windowCount() >= 1, 10_000)
  await sleep(1000)
  s = state()
  check(
    '«Abrir Absor Connect» en la bandeja muestra la ventana y recupera el Dock',
    s.pids[0] === pid && s.windows >= 1 && s.dock === true,
    s
  )

  // 5. Abrir la app otra vez con la ventana oculta
  closeWindow()
  await sleep(2000)
  launch([], true)
  await sleep(6000)
  s = state()
  check(
    'abrir la app otra vez muestra la ventana de la instancia que ya estaba, sin otro proceso',
    s.pids.length === 1 && s.pids[0] === pid && s.windows >= 1 && s.dock === true,
    s
  )

  // 6. Salir desde la bandeja
  check('«Salir» en la bandeja termina la app', await quitFromTray(), { pids: mainPids() })

  // 7. Arranque oculto, como al iniciar sesión
  launchLogged(['--hidden'])
  await waitFor(trayPresent, 20_000)
  await sleep(3000)
  s = state()
  check(
    'arranque con --hidden: sin ventana ni Dock, con icono en la barra de menús',
    s.pids.length === 1 && s.windows === 0 && s.dock === false && s.tray,
    s
  )
  await quitFromTray()

  // 8. «Abrir al iniciar sesión»: la app se registra al arrancar con el ajuste activado
  await applyLoginSetting(true)
  check(
    '«Abrir al iniciar sesión» añade la app a Ítems de inicio',
    ask(
      '¿Aparece AbsorCheck en Ajustes del Sistema > General > Ítems de inicio, en «Abrir al iniciar sesión»?',
      'Se acaba de abrir ese panel. Si macOS ha avisado de que se han añadido ítems, no hace falta tocar nada.'
    )
  )
  report.notes.push(
    'Siguiente paso: cierra la sesión del Mac (o reinícialo), vuelve a entrar sin abrir nada y lanza «test-mac.sh background-login».'
  )
}

async function loginPhase() {
  // Los ítems de inicio pueden tardar un poco en arrancar después de entrar
  await waitFor(() => mainPids().length > 0, 60_000)
  await sleep(4000)
  const s = state()
  check('arranca sola al iniciar sesión', s.pids.length === 1, {
    commands: mainProcesses().map((p) => p.command)
  })
  check(
    'al iniciar sesión arranca oculta: sin ventana ni Dock, con icono en la barra de menús',
    s.pids.length === 1 && s.windows === 0 && s.dock === false && s.tray,
    s
  )
  if (s.pids.length > 0) await quitFromTray()
  await stopRunning()

  await applyLoginSetting(false)
  check(
    'desactivar «Abrir al iniciar sesión» quita la app de Ítems de inicio',
    ask('¿Ha desaparecido AbsorCheck de «Abrir al iniciar sesión» en Ítems de inicio?')
  )
}

try {
  if (!APP || !fs.existsSync(EXE)) throw new Error(`No existe la app de prueba: ${APP}`)
  // La primera vez macOS pregunta si Terminal puede controlar System Events: sin límite de tiempo
  osa('tell application "System Events" to count processes', 0)
  await (phase === 'login' ? loginPhase() : mainPhase())
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error(error)
}
fs.writeFileSync(args.out, JSON.stringify(report, null, 2))
const failed = report.checks.filter((c) => !c.ok).length
console.log(`\n${report.checks.length - failed}/${report.checks.length} comprobaciones bien.`)
for (const note of report.notes) console.log(note)
process.exit(failed === 0 && report.checks.length > 0 && !report.error ? 0 : 1)
