import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Sun, Moon, Download, Upload, AlertTriangle, RefreshCw, ExternalLink, RotateCcw } from 'lucide-react'
import { S3Connection } from '../../../shared/types'
import { RELEASES_URL } from '../../../shared/constants'

interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  error?: string
  releasesUrl?: string
  isCodeSignError?: boolean
}

interface SettingsPanelProps {
  theme: string
  onThemeChange: (theme: string) => void
  onClose: () => void
  onConnectionsImported: (connections: S3Connection[]) => void
}

export default function SettingsPanel({ theme, onThemeChange, onClose, onConnectionsImported }: SettingsPanelProps) {
  const { t, i18n } = useTranslation()
  const [importError, setImportError] = useState<string | null>(null)
  const [exportSuccess, setExportSuccess] = useState(false)
  const [appVersion, setAppVersion] = useState<string>('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'idle' })

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

  const handleImport = async () => {
    setImportError(null)
    try {
      const imported = await window.api.importConnections()
      if (imported === null) return // User cancelled
      await window.api.saveConnections(imported)
      onConnectionsImported(imported)
    } catch {
      setImportError(t('settings.importError'))
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
