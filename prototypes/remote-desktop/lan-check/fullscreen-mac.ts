// Salir de la pantalla completa en macOS, a mano (add-remote-desktop 6.5). La pantalla completa de
// macOS es la nativa, en su propio Escritorio, y la prueba automática no consigue salir si la app no
// está delante. Aquí lo hace una persona. Este Mac controla el PC de prueba de otro equipo (`pc.ts`)
// y unos diálogos piden entrar y salir de tres maneras:
//   1. el botón verde de la ventana (o Ctrl+Cmd+F);
//   2. el botón "Salir de pantalla completa" de la barra del visor (aparece al llevar el ratón arriba);
//   3. la tecla Esc.
// Después de cada salida comprueba que el visor ha vuelto a su ventana, enfocado y con imagen, y
// pregunta si se ve bien. La lanza `fullscreen-mac.sh`, con Node.
import { ChildProcess, execFile, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { Page, waitTarget } from '../lib/cdp'
import { api, args, API, createReport, lanAddress, login, PC_PASSWORD, PC_PREFIX, sleep, TEST_EMAIL } from './common'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
const WORK = args.work ?? ''
const DATA = path.join(WORK, 'controlador')
const DEBUG_PORT = 9337
const { report, check, note } = createReport('fullscreen-mac')

let appProcess: ChildProcess | null = null

function osascript(script: string, timeout = 300_000): Promise<string> {
  return new Promise((resolve) =>
    execFile('osascript', ['-e', script], { timeout, encoding: 'utf8' }, (error, stdout, stderr) =>
      resolve(error ? `ERROR ${(stderr.trim() || error.message).slice(-200)}` : stdout.trim())
    )
  )
}

const dialog = (text: string, buttons: string[]): Promise<string> =>
  osascript(`display dialog ${JSON.stringify(text)} with title "Pantalla completa en macOS" buttons {${buttons.map((b) => JSON.stringify(b)).join(', ')}} default button ${JSON.stringify(buttons.at(-1))}`)

async function ask(question: string): Promise<boolean> {
  return (await dialog(question, ['No', 'Sí'])).includes('Sí')
}

/** Pone la app delante, como haría Cmd+Tab. */
async function front(): Promise<void> {
  if (appProcess?.pid) await osascript(`tell application "System Events" to set frontmost of (first process whose unix id is ${appProcess.pid}) to true`, 10_000)
}

async function findPc(token: string): Promise<string> {
  const own = lanAddress()
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    const { data } = await api('GET', '/api/devices', token).catch(() => ({ data: null }))
    const device = (data?.devices ?? []).find((d: any) => d.online && d.remote?.state === 'available' && d.name.startsWith(PC_PREFIX) && !d.name.includes(`@${own}:`))
    if (device) return device.name
    await sleep(3000)
  }
  throw new Error('No aparece el PC de prueba del otro equipo en 10 min')
}

async function run(): Promise<void> {
  if (!WORK) throw new Error('Falta --work')
  fs.rmSync(WORK, { recursive: true, force: true })
  fs.mkdirSync(DATA, { recursive: true })
  const token = await login('Controlador macOS de prueba')
  console.log(`==> Esperando al PC de prueba del otro equipo («${PC_PREFIX} …»)…`)
  const pcName = await findPc(token)

  fs.writeFileSync(path.join(DATA, 'session.json'), JSON.stringify({ email: TEST_EMAIL, token, encrypted: false }))
  fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'es', keepInBackground: false, openAtLogin: false }))
  const env: NodeJS.ProcessEnv = { ...process.env, ABSOR_CONNECT_API_URL: API }
  delete env.ELECTRON_RUN_AS_NODE
  const log = fs.openSync(path.join(DATA, 'app.log'), 'a')
  appProcess = spawn(ELECTRON, [ROOT, `--user-data-dir=${DATA}`, `--remote-debugging-port=${DEBUG_PORT}`], { env, stdio: ['ignore', log, log] })

  const ui = await Page.open(await waitTarget(DEBUG_PORT, (t) => t.url.endsWith('index.html'), 60_000))
  await ui.waitFor<boolean>(`!!document.querySelector('button[title="Equipos"]')`, (v) => v === true)
  await ui.eval(`document.querySelector('button[title="Equipos"]').click()`)
  const button = `[...document.querySelectorAll('.settings-row')].filter((r) => r.innerText.includes(${JSON.stringify(pcName)})).map((r) => r.querySelector('button')).find((b) => b && !b.disabled)`
  await ui.waitFor<boolean>(`!!${button}`, (v) => v === true, 30_000)
  await ui.eval(`${button}.click()`)
  const viewer = await Page.open(await waitTarget(DEBUG_PORT, (t) => t.url.includes('viewer.html'), 20_000))
  await viewer.waitFor<string>('document.title', (title) => title === pcName, 15_000)
  await viewer.eval(`(() => { document.getElementById('password').value = ${JSON.stringify(PC_PASSWORD)}; document.getElementById('login').requestSubmit() })()`)
  const connected = await viewer.waitFor<boolean>(`document.getElementById('overlay').hidden && document.getElementById('status').textContent.includes('fps')`, (v) => v === true, 30_000)
  check('este Mac controla el PC de prueba', connected === true, { pc: pcName })
  if (connected !== true) return

  const windowState = (): Promise<{ full: boolean; focus: boolean; frames: number; width: number; height: number }> =>
    viewer.eval(`({ full: !!document.fullscreenElement, focus: document.hasFocus(), frames: document.getElementById('video').getVideoPlaybackQuality().totalVideoFrames, width: window.outerWidth, height: window.outerHeight })`)
  const normal = await windowState()

  const ways = [
    { name: 'el botón verde de la ventana', how: 'sal con el botón verde de la ventana (arriba a la izquierda; aparece al llevar el ratón al borde de arriba) o con Ctrl+Cmd+F' },
    { name: 'el botón de la barra del visor', how: 'lleva el ratón arriba del todo y pulsa «Salir de pantalla completa» en la barra del visor' },
    { name: 'la tecla Esc', how: 'pulsa Esc (si no sale con una pulsación, mantenla pulsada unos segundos)' }
  ]
  for (const [index, way] of ways.entries()) {
    await dialog(`Paso ${index + 1} de ${ways.length}.\n\nAl pulsar Continuar, pulsa «Pantalla completa» en la barra del visor y espera a que termine la animación. Después, ${way.how}.\n\nLa prueba espera hasta 2 minutos.`, ['Continuar'])
    await front()
    const entered = await viewer.waitFor<boolean>(`!!document.fullscreenElement`, (v) => v === true, 120_000)
    const exited = entered === true ? await viewer.waitFor<boolean>(`!document.fullscreenElement`, (v) => v === true, 120_000) : false
    await sleep(1500)
    const before = await windowState()
    await sleep(2000)
    const after = await windowState()
    const sameSize = Math.abs(after.width - normal.width) <= 4 && Math.abs(after.height - normal.height) <= 4
    const looksRight = exited === true ? await ask(`¿Ha salido de la pantalla completa con ${way.name}, y el visor ha vuelto a su ventana en el Escritorio de antes, con la imagen del PC moviéndose?`) : false
    check(`salir con ${way.name}`, entered === true && exited === true && after.frames > before.frames && sameSize && looksRight, { entered, exited, focus: after.focus, frames: [before.frames, after.frames], size: [after.width, after.height], normal: [normal.width, normal.height], looksRight })
  }

  const comment = await osascript(`text returned of (display dialog "¿Algo raro que anotar (la barra tapada por la de macOS, parpadeos…)? Déjalo vacío si no." default answer "" with title "Pantalla completa en macOS" buttons {"Terminar"} default button "Terminar")`)
  if (comment && !comment.startsWith('ERROR')) note(`comentario: ${comment}`)
  await viewer.eval(`document.getElementById('disconnect').click()`).catch(() => undefined)
  viewer.close()
  ui.close()
}

run()
  .catch((error) => {
    report.error = String(error instanceof Error ? (error.stack ?? error) : error)
    console.error(error)
  })
  .finally(async () => {
    if (appProcess && appProcess.exitCode === null) {
      const exited = new Promise((resolve) => appProcess!.once('exit', resolve))
      appProcess.kill('SIGTERM')
      await Promise.race([exited, sleep(10_000)])
    }
    if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2))
    const failed = report.checks.filter((c) => c.ok === false).length
    console.log(`\n${report.checks.filter((c) => c.ok).length}/${report.checks.length} comprobaciones bien.`)
    process.exit(failed === 0 && !report.error ? 0 : 1)
  })
