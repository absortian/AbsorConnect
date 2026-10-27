import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Monitor, X } from 'lucide-react'
import { DeviceReadiness } from './DeviceReadiness'
import { parseAgentDeviceInfo } from '../../../shared/remote/agentDevice'
import type { AccountDevice } from '../../../shared/remote/viewerBridge'

// Equipos de la cuenta (add-remote-desktop, remote-desktop-viewer): estado de cada PC y conexión.
// La lista se actualiza sola mientras el panel está abierto; la contraseña del PC la pide la
// ventana de visor, que es la que guarda K durante la sesión.
const REFRESH_MS = 5000

interface DevicesPanelProps {
  onClose: () => void
}

/** Clave del estado de un equipo: sin conexión manda sobre lo que publicó. */
function stateKey(device: AccountDevice): string {
  if (!device.online) return 'offline'
  return ['available', 'busy', 'disabled', 'missing_permissions', 'unsupported'].includes(
    device.remote.state
  )
    ? device.remote.state
    : 'disabled'
}

export default function DevicesPanel({ onClose }: DevicesPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [devices, setDevices] = useState<AccountDevice[] | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const result = await window.api.remoteDevices().catch(() => null)
      if (cancelled) return
      if (result?.ok) {
        setDevices(result.devices)
        setError(null)
      } else {
        setError(result?.code ?? 'network_error')
      }
    }
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const sorted = [...(devices ?? [])].sort(
    (a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name)
  )

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-panel-header">
          <h2>{t('devices.title')}</h2>
          <button className="btn-icon" onClick={onClose} title={t('devices.close')}>
            <X size={20} />
          </button>
        </div>
        <div className="settings-section">
          <p className="settings-row-hint">{t('devices.hint')}</p>
          {notice && <p role="status">{notice}</p>}
          {error && (
            <p className="devices-error">
              {t(`devices.errors.${error}`, t('devices.errors.generic'))}
            </p>
          )}
          {devices === null && !error && <Loader2 size={20} className="spin" />}
          {devices?.length === 0 && <p className="settings-row-hint">{t('devices.empty')}</p>}
          {sorted.map((device) => {
            const state = stateKey(device)
            const agent = parseAgentDeviceInfo(device.remote)
            return (
              <div
                className="settings-row"
                key={device.id}
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <Monitor size={20} />
                  <div style={{ minWidth: 0 }}>
                    <div className="settings-row-label">
                      {device.name}
                      {device.self && <span className="devices-self"> · {t('devices.self')}</span>}
                    </div>
                    <div className="settings-row-hint">
                      {t(`devices.platform.${device.platform}`)} ·{' '}
                      <span className={`devices-state devices-state-${state}`}>
                        {t(`devices.state.${state}`)}
                      </span>
                    </div>
                    <DeviceReadiness device={device} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {agent.mode === 'agent' && (
                    <button
                      className="settings-btn"
                      disabled={revoking !== null}
                      onClick={() => {
                        setRevoking(device.id)
                        setNotice(null)
                        void window.api
                          .revokeRemoteAgent(device.id)
                          .then(async (result) => {
                            if (result.ok) {
                              setNotice(t('devices.agent.revoked'))
                              const refreshed = await window.api.remoteDevices()
                              if (refreshed.ok) setDevices(refreshed.devices)
                            } else if (result.code !== 'cancelled') setError(result.code)
                          })
                          .catch(() => setError('network_error'))
                          .finally(() => setRevoking(null))
                      }}
                    >
                      {t('devices.agent.revoke')}
                    </button>
                  )}
                  {!device.self && (
                    <button
                      className="settings-btn"
                      disabled={state !== 'available'}
                      onClick={() => void window.api.openViewer(device.id, device.name)}
                    >
                      {t('devices.connect')}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
