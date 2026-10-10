import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Menu, Settings } from 'lucide-react'
import './assets/main.css'
import ConnectionsSidebar from './components/ConnectionsSidebar'
import S3Explorer from './components/S3Explorer'
import SftpExplorer from './components/SftpExplorer'
import LocalExplorer from './components/LocalExplorer'
import TransferQueueBar from './components/TransferQueueBar'
import SettingsPanel from './components/SettingsPanel'
import { Connection, RemoteLocation } from '../../shared/types'
import logo from './assets/icon.png'

function App(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [activeConnection, setActiveConnection] = useState<Connection | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [remoteLocation, setRemoteLocation] = useState<RemoteLocation | null>(null)
  const [localCurrentPath, setLocalCurrentPath] = useState('')
  const [theme, setTheme] = useState('dark')
  const [showSettings, setShowSettings] = useState(false)
  const [connectionsKey, setConnectionsKey] = useState(0)
  const [splitRatio, setSplitRatio] = useState(0.5)
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

  useEffect(() => {
    window.api.getTheme().then((saved) => {
      setTheme(saved)
      if (saved !== 'dark') {
        document.documentElement.dataset.theme = saved
      }
    })
    window.api.getLanguage().then((lang) => {
      i18n.changeLanguage(lang)
    })
  }, [])

  const handleSelectConnection = (conn: Connection) => {
    setActiveConnection(conn)
    setRemoteLocation(null)
    setSidebarOpen(false) // Auto-hide menu once selected
  }

  return (
    <div className={`app-layout ${!sidebarOpen ? 'sidebar-closed' : ''}`}>
      {/* Sidebar for Connections */}
      <ConnectionsSidebar key={connectionsKey} isOpen={sidebarOpen} onSelectConnection={handleSelectConnection} />

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
          <button className="btn-icon" onClick={() => setShowSettings(true)} title={t('app.settings')}>
            <Settings size={20} />
          </button>
        </header>

        <section className="content-area animate-fade-in" style={{ padding: activeConnection ? 0 : '24px' }}>
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
        </section>
      </main>
      
      {/* Bottom Queue Bar */}
      <TransferQueueBar />

      {/* Settings Panel */}
      {showSettings && (
        <SettingsPanel
          theme={theme}
          onThemeChange={setTheme}
          onClose={() => setShowSettings(false)}
          onConnectionsImported={() => setConnectionsKey((k) => k + 1)}
        />
      )}
    </div>
  )
}

export default App
