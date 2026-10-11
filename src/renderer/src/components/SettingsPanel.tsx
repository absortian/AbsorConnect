import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Sun, Moon, Download, Upload, AlertTriangle, RefreshCw, ExternalLink, RotateCcw, LogOut, KeyRound, Trash2, Loader2 } from 'lucide-react'
import { ConnectionEntry } from '../../../shared/types'
import { RELEASES_URL } from '../../../shared/constants'
import { cloudErrorCode, cloudErrorMessage } from '../cloudErrors'

interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  error?: string
  releasesUrl?: string
  isCodeSignError?: boolean
}

interface SettingsPanelProps {
  email: string
  theme: string
  onThemeChange: (theme: string) => void
  onClose: () => void
  onConnectionsImported: (connections: ConnectionEntry[]) => void
  onSignedOut: () => void
}

export default function SettingsPanel({ email, theme, onThemeChange, onClose, onConnectionsImported, onSignedOut }: SettingsPanelProps) {
  const { t, i18n } = useTranslation()
  const [importError, setImportError] = useState<string | null>(null)
  const [exportSuccess, setExportSuccess] = useState(false)
  const [appVersion, setAppVersion] = useState<string>('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'idle' })
  const [encryptionAvailable, setEncryptionAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    window.api.isEncryptionAvailable().then(setEncryptionAvailable)
  }, [])

  useEffect(() => {
    window.api.getAppVersion().then(setAppVersion)

    const removeListener = window.api.onUpdateStatus((_event, data) => {
      const d = data as UpdateStatus
      setUpdateStatus((prev) => ({ ...prev, ...d }))
    })

    return removeListener
  }, [])

  const handleCheckUpdates = useCallback(async () => {
    setUpdateStatus({ status: 'checking' })
    try {
      await window.api.checkForUpdates()
    } catch {
      setUpdateStatus({
        status: 'error',
        error: t('settings.errorCheckUpdates'),
        releasesUrl: RELEASES_URL
      })
    }
  }, [])

  const handleDownloadUpdate = useCallback(async () => {
    try {
      await window.api.downloadUpdate()
    } catch {
      setUpdateStatus({
        status: 'error',
        error: t('settings.errorDownloadUpdate'),
        releasesUrl: RELEASES_URL
      })
    }
  }, [])

  const handleInstallUpdate = useCallback(() => {
    window.api.installUpdate()
  }, [])

  const handleThemeChange = (newTheme: string) => {
    onThemeChange(newTheme)
    document.documentElement.dataset.theme = newTheme === 'dark' ? '' : newTheme
    window.api.saveTheme(newTheme)
  }

  const handleExport = async () => {
    setExportSuccess(false)
    const result = await window.api.exportConnections()
    if (result) setExportSuccess(true)
  }

  // Importar reemplaza la lista de la cuenta, igual que antes reemplazaba la local
  const handleImport = async () => {
    setImportError(null)
    let imported: ConnectionEntry[] | null
    try {
      imported = await window.api.importConnections()
    } catch {
      setImportError(t('settings.importError'))
      return
    }
    if (imported === null) return // User cancelled
    try {
      await window.api.saveConnections(imported)
      onConnectionsImported(imported)
    } catch (error) {
      setImportError(t('cloud.saveFailed', { reason: cloudErrorMessage(cloudErrorCode(error), t) }))
    }
  }

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang)
    window.api.saveLanguage(lang)
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-panel-header">
          <h2>{t('settings.title')}</h2>
          <button className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <AccountSection email={email} encryptionAvailable={encryptionAvailable} onSignedOut={onSignedOut} />

        {/* Updates section */}
        <div className="settings-section">
          <h3>{t('settings.updates')}</h3>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">{t('settings.currentVersion')}</div>
              <div className="settings-row-hint">v{appVersion}</div>
            </div>
          </div>

          {updateStatus.status === 'idle' && (
            <button className="settings-btn" onClick={handleCheckUpdates}>
              <RefreshCw size={16} /> {t('settings.checkUpdates')}
            </button>
          )}

          {updateStatus.status === 'checking' && (
            <button className="settings-btn" disabled>
              <RefreshCw size={16} className="spin" /> {t('settings.checking')}
            </button>
          )}

          {updateStatus.status === 'up-to-date' && (
            <>
              <div className="update-message update-success">
                {t('settings.upToDate')}
              </div>
              <button className="settings-btn" onClick={handleCheckUpdates}>
                <RefreshCw size={16} /> {t('settings.checkAgain')}
              </button>
            </>
          )}

          {updateStatus.status === 'available' && (
            <>
              <div className="update-message update-info" dangerouslySetInnerHTML={{ __html: t('settings.newVersion', { version: updateStatus.version }) }} />
              <button className="settings-btn" onClick={handleDownloadUpdate}>
                <Download size={16} /> {t('settings.downloadUpdate')}
              </button>
            </>
          )}

          {updateStatus.status === 'downloading' && (
            <>
              <div className="update-message update-info">
                {t('settings.downloading', { percent: updateStatus.percent ?? 0 })}
              </div>
              <div className="update-progress-track">
                <div
                  className="update-progress-bar"
                  style={{ width: `${updateStatus.percent ?? 0}%` }}
                />
              </div>
            </>
          )}

          {updateStatus.status === 'downloaded' && (
            <>
              <div className="update-message update-success">
                {t('settings.downloaded')}
              </div>
              <button className="settings-btn" onClick={handleInstallUpdate}>
                <RotateCcw size={16} /> {t('settings.restartAndUpdate')}
              </button>
            </>
          )}

          {updateStatus.status === 'error' && (
            <>
              <div className="update-message update-error">
                {updateStatus.isCodeSignError
                  ? t('settings.errorCodeSign')
                  : updateStatus.error}
              </div>
              {updateStatus.releasesUrl && (
                <button
                  className="settings-btn"
                  onClick={() => window.open(updateStatus.releasesUrl, '_blank')}
                >
                  <ExternalLink size={16} /> {t('settings.downloadFromGitHub')}
                </button>
              )}
              <button className="settings-btn" onClick={handleCheckUpdates}>
                <RefreshCw size={16} /> {t('settings.retry')}
              </button>
            </>
          )}
        </div>

        {/* Theme section */}
        <div className="settings-section">
          <h3>{t('settings.appearance')}</h3>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">{t('settings.theme')}</div>
              <div className="settings-row-hint">{t('settings.themeHint')}</div>
            </div>
            <div className="theme-toggle">
              <button
                className={theme === 'dark' ? 'active' : ''}
                onClick={() => handleThemeChange('dark')}
              >
                <Moon size={14} /> {t('settings.dark')}
              </button>
              <button
                className={theme === 'light' ? 'active' : ''}
                onClick={() => handleThemeChange('light')}
              >
                <Sun size={14} /> {t('settings.light')}
              </button>
            </div>
          </div>
        </div>

        {/* Language section */}
        <div className="settings-section">
          <h3>{t('settings.language')}</h3>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">{t('settings.languageLabel')}</div>
              <div className="settings-row-hint">{t('settings.languageHint')}</div>
            </div>
            <div className="theme-toggle">
              <button
                className={i18n.language === 'en' ? 'active' : ''}
                onClick={() => handleLanguageChange('en')}
              >
                English
              </button>
              <button
                className={i18n.language === 'es' ? 'active' : ''}
                onClick={() => handleLanguageChange('es')}
              >
                Español
              </button>
            </div>
          </div>
        </div>

        {/* Connections import/export section */}
        <div className="settings-section">
          <h3>{t('settings.connections')}</h3>

          <button className="settings-btn" onClick={handleExport}>
            <Download size={16} /> {t('settings.exportConnections')}
          </button>
          {exportSuccess && (
            <div style={{ fontSize: '0.78rem', color: '#22c55e', marginTop: '6px', textAlign: 'center' }}>
              {t('settings.exportSuccess')}
            </div>
          )}

          <button className="settings-btn" onClick={handleImport}>
            <Upload size={16} /> {t('settings.importConnections')}
          </button>
          {importError && (
            <div style={{ fontSize: '0.78rem', color: '#ef4444', marginTop: '6px', textAlign: 'center' }}>
              {importError}
            </div>
          )}

          <div className="settings-warning">
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px', color: '#eab308' }} />
            <span>
              {t('settings.exportWarning')}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Cuenta: email, cerrar sesión, cambiar contraseña y borrar la cuenta (con aviso y contraseña)
function AccountSection({ email, encryptionAvailable, onSignedOut }: { email: string; encryptionAvailable: boolean | null; onSignedOut: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const [form, setForm] = useState<'password' | 'delete' | null>(null)
  const [passwordChanged, setPasswordChanged] = useState(false)

  const handleLogout = async (): Promise<void> => {
    await window.api.logout()
    onSignedOut()
  }

  return (
    <div className="settings-section">
      <h3>{t('account.title')}</h3>
      <div className="settings-row">
        <div style={{ minWidth: 0 }}>
          <div className="settings-row-label">{t('account.signedInAs')}</div>
          <div className="settings-row-hint account-email">{email}</div>
        </div>
        <button className="btn-secondary" onClick={handleLogout}>
          <LogOut size={14} /> {t('account.logout')}
        </button>
      </div>

      {form === null && (
        <>
          <button className="settings-btn" onClick={() => { setForm('password'); setPasswordChanged(false) }}>
            <KeyRound size={16} /> {t('account.changePassword')}
          </button>
          {passwordChanged && <div className="form-success" style={{ marginTop: '6px' }}>{t('account.passwordChanged')}</div>}
          <button className="settings-btn" onClick={() => { setForm('delete'); setPasswordChanged(false) }}>
            <Trash2 size={16} /> {t('account.deleteAccount')}
          </button>
        </>
      )}
      {form === 'password' && (
        <ChangePasswordForm onCancel={() => setForm(null)} onChanged={() => { setForm(null); setPasswordChanged(true) }} />
      )}
      {form === 'delete' && <DeleteAccountForm onCancel={() => setForm(null)} onDeleted={onSignedOut} />}

      {encryptionAvailable === false && (
        <div className="settings-warning encryption-unavailable">
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px', color: '#eab308' }} />
          <span>{t('store.encryptionUnavailable')}</span>
        </div>
      )}
    </div>
  )
}

function ChangePasswordForm({ onCancel, onChanged }: { onCancel: () => void; onChanged: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (next !== confirmation) {
      setError('password_mismatch')
      return
    }
    setWorking(true)
    setError(null)
    const result = await window.api.changePassword(current, next)
    setWorking(false)
    if (result.ok) onChanged()
    else setError(result.code)
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit} style={{ marginTop: '12px' }}>
      <div className="form-field">
        <label htmlFor="account-current">{t('account.currentPassword')}</label>
        <input id="account-current" className="form-input" type="password" required autoFocus autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="account-new">{t('account.newPassword')}</label>
        <input id="account-new" className="form-input" type="password" required autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <span className="form-hint">{t('auth.passwordHint')}</span>
      </div>
      <div className="form-field">
        <label htmlFor="account-confirmation">{t('account.confirmNewPassword')}</label>
        <input id="account-confirmation" className="form-input" type="password" required autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
      </div>
      {error && <div className="form-error" role="alert">{cloudErrorMessage(error, t)}</div>}
      <div className="form-actions">
        <button type="button" className="btn-secondary" disabled={working} onClick={onCancel}>{t('account.cancel')}</button>
        <button type="submit" className="btn-primary" disabled={working}>
          {working && <Loader2 size={14} className="spin" />} {t('account.save')}
        </button>
      </div>
    </form>
  )
}

function DeleteAccountForm({ onCancel, onDeleted }: { onCancel: () => void; onDeleted: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setWorking(true)
    setError(null)
    const result = await window.api.deleteAccount(password)
    setWorking(false)
    if (result.ok) onDeleted()
    else setError(result.code)
  }

  return (
    <form className="danger-zone" onSubmit={handleSubmit}>
      <p>{t('account.deleteWarning')}</p>
      <div className="form-stack">
        <div className="form-field">
          <label htmlFor="account-delete-password">{t('account.deletePassword')}</label>
          <input id="account-delete-password" className="form-input" type="password" required autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div className="form-error" role="alert">{cloudErrorMessage(error, t)}</div>}
        <div className="form-actions">
          <button type="button" className="btn-secondary" disabled={working} onClick={onCancel}>{t('account.cancel')}</button>
          <button type="submit" className="btn-danger" disabled={working}>
            {working && <Loader2 size={14} className="spin" />} {t('account.deleteConfirm')}
          </button>
        </div>
      </div>
    </form>
  )
}
