import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal, ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { RotateCcw } from 'lucide-react'
import { SshConnection } from '../../../shared/types'
import { remoteErrorMessage } from '../remoteErrors'

export type TerminalStatus = 'connecting' | 'open' | 'ended' | 'error'

interface TerminalViewProps {
  connection: SshConnection
  active: boolean
  theme: string
  onStatusChange?: (status: TerminalStatus) => void
}

const FONT_FAMILY: Record<string, string> = {
  darwin: '"SF Mono", Menlo, monospace',
  win32: '"Cascadia Mono", Consolas, monospace',
  linux: '"DejaVu Sans Mono", "Ubuntu Mono", monospace'
}

// Colores de la terminal a partir de las variables del tema de la app
function terminalTheme(): ITheme {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string): string => css.getPropertyValue(name).trim()
  return {
    background: v('--bg-base'),
    foreground: v('--text-primary'),
    cursor: v('--accent-primary'),
    selectionBackground: v('--accent-glow')
  }
}

export default function TerminalView({ connection, active, theme, onStatusChange }: TerminalViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionRef = useRef<string | null>(null)
  const openingRef = useRef(false)
  // Salida que llega antes de conocer el id de la sesión (el prompt puede adelantarse a la respuesta)
  const pendingRef = useRef(new Map<string, Uint8Array[]>())
  const disposedRef = useRef(false)
  const [status, setStatus] = useState<TerminalStatus>('connecting')
  const [message, setMessage] = useState('')

  const updateStatus = (next: TerminalStatus, text = ''): void => {
    setStatus(next)
    setMessage(text)
    onStatusChange?.(next)
  }

  // Ajusta la terminal al contenedor; el servidor se entera por term.onResize, que salta cuando
  // xterm aplica el tamaño nuevo (no es inmediato tras fit())
  const fitAndSync = (): void => {
    const fit = fitRef.current
    if (!fit || !containerRef.current?.offsetParent) return // oculta: no se puede medir
    try {
      fit.fit()
    } catch {
      // contenedor sin medidas todavía
    }
  }

  const connect = async (): Promise<void> => {
    const term = termRef.current
    if (!term || openingRef.current) return
    openingRef.current = true
    updateStatus('connecting')
    fitAndSync()
    try {
      // Usa la versión guardada más reciente: si el usuario corrigió credenciales, el reintento las aplica
      const saved = (await window.api.getConnections()).find((c) => c.id === connection.id)
      const latest = saved && !saved.isFolder && saved.type === 'ssh' ? saved : connection
      const sessionId = await window.api.openTerminal(latest, term.cols, term.rows)
      if (disposedRef.current) {
        window.api.closeTerminal(sessionId)
        return
      }
      sessionRef.current = sessionId
      // El tamaño pudo cambiar mientras se abría la sesión
      window.api.terminalResize(sessionId, term.cols, term.rows)
      for (const chunk of pendingRef.current.get(sessionId) ?? []) term.write(chunk)
      updateStatus('open')
      term.focus()
    } catch (err) {
      updateStatus('error', err instanceof Error ? remoteErrorMessage(err.message, t) : String(err))
    } finally {
      pendingRef.current.clear()
      openingRef.current = false
    }
  }

  useEffect(() => {
    disposedRef.current = false
    const term = new Terminal({
      fontFamily: FONT_FAMILY[window.api.platform] ?? 'monospace',
      fontSize: 13,
      scrollback: 5000,
      cursorBlink: true,
      theme: terminalTheme()
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current!)
    termRef.current = term
    fitRef.current = fit

    term.onData((data) => {
      if (sessionRef.current) window.api.terminalInput(sessionRef.current, data)
    })
    term.onResize(({ cols, rows }) => {
      if (sessionRef.current) window.api.terminalResize(sessionRef.current, cols, rows)
    })

    // Copiar y pegar: Cmd+C/V en macOS; Ctrl+Shift+C/V en Windows y Linux (Ctrl+C sigue siendo interrupción)
    const isMac = window.api.platform === 'darwin'
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const key = e.key.toLowerCase()
      const combo = isMac ? e.metaKey && !e.ctrlKey && !e.altKey : e.ctrlKey && e.shiftKey && !e.altKey
      if (combo && key === 'c') {
        const selection = term.getSelection()
        if (selection) window.api.clipboardWriteText(selection)
        e.preventDefault()
        return false
      }
      if (combo && key === 'v') {
        window.api.clipboardReadText().then((text) => text && term.paste(text))
        e.preventDefault()
        return false
      }
      return true
    })

    const offData = window.api.onTerminalData((_event, { sessionId, data }) => {
      if (sessionId === sessionRef.current) term.write(data)
      else if (openingRef.current) {
        const chunks = pendingRef.current.get(sessionId) ?? []
        chunks.push(data)
        pendingRef.current.set(sessionId, chunks)
      }
    })
    const offExit = window.api.onTerminalExit((_event, { sessionId, reason }) => {
      if (sessionId !== sessionRef.current) return
      sessionRef.current = null
      updateStatus('ended', reason === 'connection-lost' ? t('terminal.connectionLost') : t('terminal.sessionEnded'))
    })

    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(fitAndSync)
    })
    observer.observe(containerRef.current!)
    requestAnimationFrame(() => connect())

    return () => {
      disposedRef.current = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      offData()
      offExit()
      if (sessionRef.current) window.api.closeTerminal(sessionRef.current)
      sessionRef.current = null
      term.dispose()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Al volver a mostrarse, recalcular el tamaño y recuperar el foco
  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => {
      fitAndSync()
      termRef.current?.focus()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = terminalTheme()
  }, [theme])

  const reconnect = (): void => {
    termRef.current?.write(`\r\n\x1b[2m── ${t('terminal.reconnecting')} ──\x1b[0m\r\n`)
    connect()
  }

  return (
    <div className="terminal-view" style={{ display: active ? 'flex' : 'none' }}>
      {(status === 'ended' || status === 'error') && (
        <div className={`terminal-banner ${status}`}>
          <span>{message}</span>
          <button className="btn-icon" onClick={status === 'error' ? connect : reconnect}>
            <RotateCcw size={14} /> {status === 'error' ? t('terminal.retry') : t('terminal.reconnect')}
          </button>
        </div>
      )}
      {status === 'connecting' && <div className="terminal-banner connecting">{t('terminal.connecting')}</div>}
      <div ref={containerRef} className="terminal-container" />
    </div>
  )
}
