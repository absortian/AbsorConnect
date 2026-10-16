// Ventana de visor (add-remote-desktop D11, tarea 6.5): pide la contraseña del PC, abre la sesión y
// muestra su pantalla con el teclado, el ratón, las pantallas, el sonido y el estado de la conexión.
// Una ventana por PC; cerrarla termina la sesión.
import './viewer.css'
import type { DisplayInfo } from '../../shared/remote/protocol'
import { FilesUi, setupFilesUi } from './filesUi'
import { attachInput, COMBOS, InputSink, sendCombo } from './input'
import { Phase, Stats, ViewerSession } from './session'
import { viewerTexts } from './texts'
import { TransferView, ViewerTransfers } from './transfers'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const video = $<HTMLVideoElement>('video')
const audio = $<HTMLAudioElement>('audio')
const stage = $('stage')
const overlay = $('overlay')
const login = $<HTMLFormElement>('login')
const message = $('message')
const password = $<HTMLInputElement>('password')
const connectButton = $<HTMLButtonElement>('connect')
const status = $('status')
const displaysSelect = $<HTMLSelectElement>('displays')
const scaleButton = $<HTMLButtonElement>('scale')
const fullscreenButton = $<HTMLButtonElement>('fullscreen')
const combosButton = $<HTMLButtonElement>('combos')
const comboList = $('combo-list')
const muteButton = $<HTMLButtonElement>('mute')
const noAudio = $('no-audio')
const disconnectButton = $<HTMLButtonElement>('disconnect')

async function main(): Promise<void> {
  const init = await window.absorViewer.init()
  const t = viewerTexts(init.language)
  if (init.theme !== 'dark') document.documentElement.dataset.theme = init.theme
  document.title = init.deviceName
  $('pc-name').textContent = init.deviceName
  $('login-title').textContent = t.passwordTitle(init.deviceName)
  password.placeholder = t.password
  scaleButton.textContent = t.realSize
  fullscreenButton.textContent = t.fullscreen
  combosButton.textContent = `${t.combos} ▾`
  muteButton.textContent = t.mute
  noAudio.textContent = t.noAudio
  disconnectButton.textContent = t.disconnect

  let phase: Phase = 'idle'
  let stats: Stats = { route: null, rttMs: null, fps: null }
  let files: FilesUi | null = null
  let renderTransfer: (view: TransferView) => void = () => undefined

  // Ficheros y portapapeles (D9): el canal `file` y el `control` de la conexión en marcha
  const transfers = new ViewerTransfers({
    bridge: window.absorViewer,
    control: () => session.controlChannel,
    onChange: (view) => renderTransfer(view)
  })
  window.absorViewer.onClipboard((content) => void transfers.sendClipboard(content))

  const session = new ViewerSession(
    window.absorViewer,
    {
      phase: (next, detail) => {
        phase = next
        renderPhase(next, detail)
      },
      video: (stream) => {
        video.srcObject = stream
        void video.play().catch(() => undefined)
      },
      audio: (stream) => {
        audio.srcObject = stream
        void audio.play().catch(() => undefined)
      },
      displays: renderDisplays,
      features: (features) => {
        muteButton.hidden = !features.audio
        noAudio.hidden = features.audio
        files?.setFeatures(features)
      },
      stats: (next) => {
        stats = next
        renderStatus()
      },
      fileChannel: (channel) => (channel ? transfers.attach(channel) : transfers.detach()),
      clipboard: (piece) => transfers.onClipboardPiece(piece)
    },
    { forceRelay: init.forceRelay }
  )

  const filesUi = setupFilesUi({
    t,
    pcName: init.deviceName,
    transfers,
    connected: () => phase === 'connected',
    focusVideo: () => video.focus()
  })
  files = filesUi.ui
  renderTransfer = filesUi.render

  const sink: InputSink = {
    pointer: (x, y) => session.sendPointer(x, y),
    input: (m) => session.sendInput(m)
  }
  // El teclado va al PC salvo mientras se usa el selector de pantallas o el explorador de carpetas
  attachInput(
    video,
    sink,
    () =>
      phase === 'connected' &&
      overlay.hidden &&
      !files?.browsing &&
      document.activeElement?.tagName !== 'SELECT' &&
      document.activeElement?.tagName !== 'INPUT'
  )

  function renderStatus(): void {
    if (phase !== 'connected') return
    const parts = [stats.route === 'relay' ? t.relay : stats.route === 'direct' ? t.direct : '']
    if (stats.rttMs !== null) parts.push(`${stats.rttMs} ms`)
    if (stats.fps !== null) parts.push(`${stats.fps} fps`)
    status.textContent = parts.filter(Boolean).join(' · ')
  }

  function renderPhase(
    next: Phase,
    detail?: { code?: string; retryAfter?: number; reason?: string }
  ): void {
    message.classList.remove('error')
    switch (next) {
      case 'connecting':
      case 'waiting':
      case 'authenticating':
        overlay.hidden = false
        password.hidden = true
        connectButton.hidden = true
        message.textContent =
          next === 'connecting' ? t.connecting : next === 'waiting' ? t.waitingPc : t.authenticating
        status.textContent = message.textContent
        break
      case 'reconnecting':
        overlay.hidden = false
        password.hidden = true
        connectButton.hidden = true
        message.textContent = t.reconnecting
        status.textContent = t.reconnecting
        break
      case 'connected':
        overlay.hidden = true
        status.textContent = ''
        video.focus()
        break
      case 'failed':
      case 'closed': {
        files?.disable()
        overlay.hidden = false
        message.classList.add('error')
        message.textContent =
          next === 'closed'
            ? t.closedBy(detail?.reason ?? '')
            : t.error(detail?.code ?? 'connection_failed', detail?.retryAfter)
        // Con K en memoria se reconecta sin pedir la contraseña; si no, se vuelve a pedir
        password.hidden = session.hasKey
        password.value = ''
        connectButton.hidden = false
        connectButton.textContent = session.hasKey ? t.reconnect : t.connect
        status.textContent = ''
        if (!password.hidden) password.focus()
        break
      }
    }
  }

  function renderDisplays(displays: DisplayInfo[], current: string): void {
    displaysSelect.replaceChildren(
      ...displays.map((display, index) => {
        const option = document.createElement('option')
        option.value = display.id
        option.textContent = `${t.display(index + 1)} (${display.bounds.width}×${display.bounds.height})`
        option.selected = display.id === current
        return option
      })
    )
    displaysSelect.hidden = displays.length < 2
  }

  login.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!session.hasKey && password.value.length === 0) return
    void session.connect(session.hasKey ? undefined : password.value)
  })

  displaysSelect.addEventListener('change', () => {
    session.selectDisplay(displaysSelect.value)
    video.focus()
  })

  scaleButton.addEventListener('click', () => {
    const real = stage.classList.toggle('real')
    stage.classList.toggle('fit', !real)
    scaleButton.textContent = real ? t.fit : t.realSize
    video.focus()
  })

  fullscreenButton.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen()
  })
  // En pantalla completa, Alt+Tab y la tecla Windows van al PC remoto donde el sistema lo permite
  // (Windows y Linux); Cmd+Tab en macOS no se puede capturar: está en el menú de combinaciones
  document.addEventListener('fullscreenchange', () => {
    const keyboard = (
      navigator as Navigator & { keyboard?: { lock(): Promise<void>; unlock(): void } }
    ).keyboard
    if (document.fullscreenElement) void keyboard?.lock().catch(() => undefined)
    else keyboard?.unlock()
    fullscreenButton.textContent = document.fullscreenElement ? t.exitFullscreen : t.fullscreen
    video.focus()
  })

  comboList.replaceChildren(
    ...COMBOS.map((combo) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = combo.label
      button.addEventListener('click', () => {
        sendCombo(sink, combo.codes)
        comboList.hidden = true
        video.focus()
      })
      return button
    })
  )
  combosButton.addEventListener('click', () => {
    comboList.hidden = !comboList.hidden
  })
  document.addEventListener('click', (event) => {
    if (!combosButton.contains(event.target as Node) && !comboList.contains(event.target as Node)) {
      comboList.hidden = true
    }
  })

  muteButton.addEventListener('click', () => {
    audio.muted = !audio.muted
    muteButton.textContent = audio.muted ? t.unmute : t.mute
  })

  disconnectButton.addEventListener('click', () => window.close())
  window.addEventListener('beforeunload', () => session.close())

  // La primera vez se pide la contraseña
  renderPhase('failed', undefined)
  message.classList.remove('error')
  message.textContent = t.passwordHint
}

void main()
