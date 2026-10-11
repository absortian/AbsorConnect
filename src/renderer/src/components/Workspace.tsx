import { useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Menu, Settings, SquareTerminal, FolderOpen, X } from 'lucide-react'
import ConnectionsSidebar from './ConnectionsSidebar'
import S3Explorer from './S3Explorer'
import SftpExplorer from './SftpExplorer'
import LocalExplorer from './LocalExplorer'
import TransferQueueBar from './TransferQueueBar'
import SettingsPanel from './SettingsPanel'
import TerminalView from './TerminalView'
import { Connection, RemoteLocation, SshConnection } from '../../../shared/types'
import logo from '../assets/icon.png'

interface TerminalTab {
  id: string
  connection: SshConnection
  title: string
}

interface WorkspaceProps {
  email: string
  theme: string
  onThemeChange: (theme: string) => void
  onSignedOut: () => void
}

// La interfaz de la app con la sesión iniciada (la puerta de sesión está en App.tsx)
export default function Workspace({ email, theme, onThemeChange, onSignedOut }: WorkspaceProps): React.JSX.Element {
  const { t } = useTranslation()
  const [activeConnection, setActiveConnection] = useState<Connection | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [remoteLocation, setRemoteLocation] = useState<RemoteLocation | null>(null)
  const [localCurrentPath, setLocalCurrentPath] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [connectionsKey, setConnectionsKey] = useState(0)
  const [splitRatio, setSplitRatio] = useState(0.5)
  // Pestañas: "files" (doble panel) o el id de una terminal; las terminales siguen vivas al cambiar
  const [terminals, setTerminals] = useState<TerminalTab[]>([])
  const [activeTab, setActiveTab] = useState<string>('files')
  const splitRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (ev: MouseEvent) => {
      if (!draggingRef.current || !splitRef.current) return
      const rect = splitRef.current.getBoundingClientRect()
      const minPx = 200
      const x = Math.max(minPx, Math.min(ev.clientX - rect.left, rect.width - minPx))
      setSplitRatio(x / rect.width)
    }

    const onMouseUp = () => {
      draggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  const handleDividerDoubleClick = useCallback(() => {
    setSplitRatio(0.5)
  }, [])

  const handleSelectConnection = (conn: Connection) => {
    setActiveConnection(conn)
    setRemoteLocation(null)
    setActiveTab('files')
    setSidebarOpen(false) // Auto-hide menu once selected
  }

  const openTerminalTab = (conn: SshConnection): void => {
    const id = crypto.randomUUID()
    setTerminals((prev) => {
      const titles = new Set(prev.map((tab) => tab.title))
      let title = conn.name
      for (let n = 2; titles.has(title); n++) title = `${conn.name} (${n})`
      return [...prev, { id, connection: conn, title }]
    })
    setActiveTab(id)
    setSidebarOpen(false)
  }

  const closeTerminalTab = (id: string): void => {
    setTerminals((prev) => prev.filter((tab) => tab.id !== id))
    setActiveTab((current) => (current === id ? 'files' : current))
  }

  return (
    <div className={`app-layout ${!sidebarOpen ? 'sidebar-closed' : ''}`}>
      {/* Sidebar for Connections */}
      <ConnectionsSidebar key={connectionsKey} isOpen={sidebarOpen} onSelectConnection={handleSelectConnection} onOpenTerminal={openTerminalTab} />

      {/* Main Content Area */}
      <main className="main-content">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
             <button className="btn-icon" onClick={() => setSidebarOpen(!sidebarOpen)} title={t('app.toggleConnections')}>
               <Menu size={20} />
             </button>
             <img src={logo} alt="Absor" style={{ height: '28px', borderRadius: '6px' }} />
             <h2 style={{ fontSize: '1.2rem', fontWeight: 600 }}>{t('app.title')}</h2>
             {activeConnection && (
               <>
                 <span style={{ color: 'var(--text-muted)' }}>/</span>
                 <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{activeConnection.name}</span>
               </>
             )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {activeConnection?.type === 'ssh' && (
              <button className="btn-icon" onClick={() => openTerminalTab(activeConnection)} title={t('terminal.open')}>
                <SquareTerminal size={20} />
              </button>
            )}
            <button className="btn-icon" onClick={() => setShowSettings(true)} title={t('app.settings')}>
              <Settings size={20} />
            </button>
          </div>
        </header>

        <section className="content-area animate-fade-in workspace" style={{ padding: 0 }}>
          {terminals.length > 0 && (
            <div className="workspace-tabs">
              <button className={`workspace-tab ${activeTab === 'files' ? 'active' : ''}`} onClick={() => setActiveTab('files')}>
                <FolderOpen size={14} />
                <span>{t('terminal.files')}</span>
              </button>
              {terminals.map((tab) => (
                <div
                  key={tab.id}
                  className={`workspace-tab ${activeTab === tab.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.title}
                >
                  <SquareTerminal size={14} />
                  <span>{tab.title}</span>
                  <button
                    className="workspace-tab-close"
                    title={t('terminal.close')}
                    onClick={(e) => { e.stopPropagation(); closeTerminalTab(tab.id) }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="workspace-body">
          <div className="workspace-pane" style={{ display: activeTab === 'files' ? 'flex' : 'none', padding: activeConnection ? 0 : '24px' }}>
          {!activeConnection ? (
            <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', marginTop: '10vh' }}>
              <img src={logo} alt="Absor" style={{ height: '64px', borderRadius: '12px', marginBottom: '20px' }} />
              <h1 style={{ fontSize: '1.8rem', marginBottom: '12px' }}>{t('app.welcomeTitle')}</h1>
              <p style={{ color: 'var(--text-secondary)', maxWidth: '500px', margin: '0 auto', lineHeight: '1.6' }}>
                {t('app.welcomeDescription')}
              </p>
            </div>
          ) : (
            <div className="split-view" ref={splitRef} style={{ display: 'flex', height: '100%', width: '100%' }}>
              <div style={{ flexBasis: `${splitRatio * 100}%`, flexShrink: 0, flexGrow: 0, minWidth: 200, overflow: 'hidden' }}>
                <LocalExplorer activeConnection={activeConnection} remoteLocation={remoteLocation} onPathChange={setLocalCurrentPath} />
              </div>
              <div className="split-divider" onMouseDown={handleDividerMouseDown} onDoubleClick={handleDividerDoubleClick} />
              <div style={{ flex: 1, minWidth: 200, overflow: 'hidden' }}>
                {activeConnection.type === 's3' ? (
                  <S3Explorer
                    key={activeConnection.id}
                    connection={activeConnection}
                    localCurrentPath={localCurrentPath}
                    onLocationChange={(bucket, prefix) => setRemoteLocation({ kind: 's3', bucket, prefix })}
                  />
                ) : (
                  <SftpExplorer
                    key={activeConnection.id}
                    connection={activeConnection}
                    localCurrentPath={localCurrentPath}
                    onLocationChange={(path) => setRemoteLocation({ kind: 'sftp', path })}
                  />
                )}
              </div>
            </div>
          )}
          </div>
          {terminals.map((tab) => (
            <TerminalView key={tab.id} connection={tab.connection} active={activeTab === tab.id} theme={theme} />
          ))}
          </div>
        </section>
      </main>
      
      {/* Bottom Queue Bar */}
      <TransferQueueBar />

      {/* Settings Panel */}
      {showSettings && (
        <SettingsPanel
          email={email}
          theme={theme}
          onThemeChange={onThemeChange}
          onClose={() => setShowSettings(false)}
          onConnectionsImported={() => setConnectionsKey((k) => k + 1)}
          onSignedOut={onSignedOut}
        />
      )}
    </div>
  )
}

