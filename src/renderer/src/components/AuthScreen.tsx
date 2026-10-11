import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { cloudErrorMessage } from '../cloudErrors'
import logo from '../assets/icon.png'

type Mode = 'login' | 'register'

// La misma longitud mínima que exige el servicio (password_too_short)
const MIN_PASSWORD_LENGTH = 10

// Pantalla de acceso: sin sesión no se muestra ni se usa ninguna conexión
export default function AuthScreen({ expired, onSignedIn }: { expired: boolean; onSignedIn: (email: string) => void }): React.JSX.Element {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const switchMode = (next: Mode): void => {
    setMode(next)
    setError(null)
    setConfirmation('')
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    // Comprobaciones locales: no gastan uno de los registros por hora que admite el servicio
    if (mode === 'register' && password.length < MIN_PASSWORD_LENGTH) {
      setError('password_too_short')
      return
    }
    if (mode === 'register' && password !== confirmation) {
      setError('password_mismatch')
      return
    }
    setWorking(true)
    setError(null)
    const result = mode === 'login' ? await window.api.login(email, password) : await window.api.register(email, password)
    setWorking(false)
    if (result.ok) onSignedIn(result.email)
    else setError(result.code)
  }

  return (
    <div className="auth-screen">
      <div className="auth-card animate-fade-in">
        <div className="auth-brand">
          <img src={logo} alt="Absor" />
          <h1>{t('app.title')}</h1>
          <p>{t('auth.subtitle')}</p>
        </div>

        <div className="theme-toggle auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>
            {t('auth.login')}
          </button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>
            {t('auth.register')}
          </button>
        </div>

        {expired && !error && (
          <div className="cloud-notice">
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px', color: '#eab308' }} />
            <span>{t('auth.expired')}</span>
          </div>
        )}

        <form className="form-stack" onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="auth-email">{t('auth.email')}</label>
            <input id="auth-email" className="form-input" type="email" required autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="form-field">
            <label htmlFor="auth-password">{t('auth.password')}</label>
            <input
              id="auth-password"
              className="form-input"
              type="password"
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'register' && <span className="form-hint">{t('auth.passwordHint')}</span>}
          </div>
          {mode === 'register' && (
            <div className="form-field">
              <label htmlFor="auth-confirmation">{t('auth.confirmPassword')}</label>
              <input id="auth-confirmation" className="form-input" type="password" required autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
            </div>
          )}

          {error && <div className="form-error" role="alert">{cloudErrorMessage(error, t)}</div>}

          <button type="submit" className="btn-primary" disabled={working}>
            {working && <Loader2 size={16} className="spin" />}
            {working ? t('auth.working') : mode === 'login' ? t('auth.submitLogin') : t('auth.submitRegister')}
          </button>
        </form>
      </div>
    </div>
  )
}
