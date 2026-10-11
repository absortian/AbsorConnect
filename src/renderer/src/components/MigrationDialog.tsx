import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CloudUpload, Loader2 } from 'lucide-react'
import { cloudErrorMessage } from '../cloudErrors'

// Diálogo de la app (no window.confirm) para subir las conexiones de connections.json a la
// cuenta. "Ahora no" no toca nada: se vuelve a preguntar en el siguiente inicio de sesión.
export default function MigrationDialog({ count, onClose }: { count: number; onClose: (migrated: boolean) => void }): React.JSX.Element {
  const { t } = useTranslation()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleUpload = async (): Promise<void> => {
    setWorking(true)
    setError(null)
    const result = await window.api.migrateLocalConnections()
    setWorking(false)
    if (result.ok) onClose(true)
    else setError(result.code)
  }

  return (
    <div className="settings-overlay">
      <div className="auth-card animate-fade-in" role="dialog" aria-labelledby="migration-title" style={{ width: '420px' }}>
        <div className="auth-brand">
          <CloudUpload size={36} color="var(--accent-primary)" />
          <h1 id="migration-title" style={{ fontSize: '1.2rem' }}>{t('migration.title')}</h1>
          <p>{t('migration.description', { count })}</p>
        </div>
        {error && (
          <div className="form-error" role="alert" style={{ marginBottom: '16px' }}>
            {t('migration.failed', { reason: cloudErrorMessage(error, t) })}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="btn-secondary" disabled={working} onClick={() => onClose(false)}>
            {t('migration.later')}
          </button>
          <button type="button" className="btn-primary" disabled={working} onClick={handleUpload}>
            {working && <Loader2 size={16} className="spin" />}
            {working ? t('migration.uploading') : t('migration.upload')}
          </button>
        </div>
      </div>
    </div>
  )
}
