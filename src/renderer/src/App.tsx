import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle, Loader2, RefreshCw, X } from 'lucide-react'
import './assets/main.css'
import AuthScreen from './components/AuthScreen'
import MigrationDialog from './components/MigrationDialog'
import Workspace from './components/Workspace'
import { TransferQueueProvider } from './context/TransferQueueContext'
import { MigrationOffer, SessionState } from '../../shared/types'
import logo from './assets/icon.png'

// Puerta de sesión: sin una sesión válida solo se ve la pantalla de acceso
type Gate =
  | { view: 'loading' }
  | { view: 'auth'; expired: boolean }
  | { view: 'unreachable' }
  | { view: 'app'; email: string }

function App(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [gate, setGate] = useState<Gate>({ view: 'loading' })
  const [theme, setTheme] = useState('dark')
  const [migration, setMigration] = useState<MigrationOffer | null>(null)
  const [migrated, setMigrated] = useState(false)

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

  const applySession = useCallback((session: SessionState) => {
    if (session.state === 'signed-in') setGate({ view: 'app', email: session.email })
    else if (session.state === 'unreachable') setGate({ view: 'unreachable' })
    else setGate({ view: 'auth', expired: session.expired === true })
  }, [])

  const fetchSession = (): Promise<SessionState> => window.api.getSession().catch((): SessionState => ({ state: 'unreachable' }))

  const retry = (): void => {
    setGate({ view: 'loading' })
    fetchSession().then(applySession)
  }

  useEffect(() => {
    fetchSession().then(applySession)
    // Sesión revocada o caducada en mitad del uso: el proceso principal ya ha cerrado las
    // conexiones SSH; al desmontar el espacio de trabajo se cierran terminales y cola
    return window.api.onSessionExpired(() => {
      setMigration(null)
      setGate({ view: 'auth', expired: true })
    })
  }, [])

  // Tras iniciar sesión se ofrece subir las conexiones de connections.json, si las hay
  const handleSignedIn = async (email: string): Promise<void> => {
    setGate({ view: 'app', email })
    const offer = await window.api.getMigrationOffer().catch(() => null)
    if (offer && (offer.count > 0 || offer.recoveredFile)) setMigration(offer)
  }

  const handleSignedOut = (): void => {
    setMigration(null)
    setMigrated(false)
    setGate({ view: 'auth', expired: false })
  }

  if (gate.view === 'loading') {
    return (
      <div className="auth-screen">
        <Loader2 size={28} className="spin" color="var(--text-muted)" />
      </div>
    )
  }

  if (gate.view === 'auth') {
    return <AuthScreen expired={gate.expired} onSignedIn={handleSignedIn} />
  }

  if (gate.view === 'unreachable') {
    return (
      <div className="auth-screen">
        <div className="auth-card animate-fade-in">
          <div className="auth-brand">
            <img src={logo} alt="Absor" />
            <h1>{t('unreachable.title')}</h1>
            <p>{t('unreachable.description')}</p>
          </div>
          <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={retry}>
            <RefreshCw size={16} /> {t('unreachable.retry')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <TransferQueueProvider key={gate.email}>
      <Workspace email={gate.email} theme={theme} onThemeChange={setTheme} onSignedOut={handleSignedOut} />
      {migration && migration.count > 0 && (
        <MigrationDialog
          count={migration.count}
          onClose={(done) => {
            setMigration(migration.recoveredFile ? { count: 0, recoveredFile: migration.recoveredFile } : null)
            setMigrated(done)
          }}
        />
      )}
      {migration && migration.count === 0 && migration.recoveredFile && (
        <div className="cloud-notice app-toast" role="status">
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px', color: '#eab308' }} />
          <span style={{ wordBreak: 'break-all' }}>{t('store.corruptRecovered', { path: migration.recoveredFile })}</span>
          <button title={t('cloud.dismiss')} onClick={() => setMigration(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {migrated && !migration && (
        <div className="cloud-notice success app-toast" role="status">
          <CheckCircle size={14} style={{ flexShrink: 0, marginTop: '1px', color: '#22c55e' }} />
          <span>{t('migration.done')}</span>
          <button title={t('cloud.dismiss')} onClick={() => setMigrated(false)}>
            <X size={14} />
          </button>
        </div>
      )}
    </TransferQueueProvider>
  )
}

export default App
