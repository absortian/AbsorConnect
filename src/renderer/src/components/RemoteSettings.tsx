import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, KeyRound, Loader2 } from 'lucide-react'
import { LocalTravelReadiness } from './LocalTravelReadiness'
import type { LocalAgentStopResult } from '../../../shared/remote/localAgent'
import {
  MIN_PC_PASSWORD_LENGTH,
  RemoteLogInfo,
  RemoteSettingsChanges,
  RemoteSettingsResult,
  RemoteSettingsState
} from '../../../shared/remote/settings'

// Ajustes de "Segundo plano" y "Control remoto de este PC" (add-remote-desktop, background-mode y
// remote-access-host). Comparten estado: al activar el control remoto se propone activar también
// el segundo plano, porque sin la app en marcha el PC no se puede controlar.
const REFRESH_MS = 3000

interface BackgroundState {
  keepInBackground: boolean
  openAtLogin: boolean
}

function Switch({
  checked,
  disabled,
  onChange,
  label
}: {
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
  label: string
}): React.JSX.Element {
  return (
    <label className="switch" title={label}>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-track" />
    </label>
  )
}

function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <div className="settings-row">
      <div style={{ minWidth: 0, paddingRight: '12px' }}>
        <div className="settings-row-label">{label}</div>
        {hint && <div className="settings-row-hint">{hint}</div>}
      </div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} label={label} />
    </div>
  )
}

export default function RemoteSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const [background, setBackground] = useState<BackgroundState | null>(null)
  const [remote, setRemote] = useState<RemoteSettingsState | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [passwordForm, setPasswordForm] = useState<'create' | 'change' | null>(null)
  const [enableAfterPassword, setEnableAfterPassword] = useState(false)
  const [suggestBackground, setSuggestBackground] = useState(false)
  // Cambios pedidos desde esta ventana: un refresco que salió antes de un cambio llega con el estado
  // viejo y no debe pisar el que devuelve el cambio
  const changeCount = useRef(0)

  const apply = useCallback((result: RemoteSettingsResult | null): boolean => {
    changeCount.current++
    if (!result) return false
    if (result.ok) {
      setRemote(result.state)
      setError(null)
      return true
    }
    if (result.state) setRemote(result.state)
    if (result.code === 'remote_unavailable_here') setUnavailable(true)
    else setError(result.code)
    return false
  }, [])

  useEffect(() => {
    void window.api.getBackgroundSettings().then(setBackground)
    const load = (): void => {
      const seen = changeCount.current
      void window.api
        .remoteSettings()
        .then((result) => {
          if (seen !== changeCount.current) return
          if (result.ok) setRemote(result.state)
          else if (result.code === 'remote_unavailable_here') setUnavailable(true)
        })
        .catch(() => undefined)
    }
    load()
    // Estado del sistema, sesión en curso y registro cambian solos: se refrescan mientras se ve
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  const setKeep = async (value: boolean): Promise<void> => {
    await window.api.setKeepInBackground(value)
    setBackground((b) => (b ? { ...b, keepInBackground: value } : b))
  }
  const setLogin = async (value: boolean): Promise<void> => {
    await window.api.setOpenAtLogin(value)
    setBackground((b) => (b ? { ...b, openAtLogin: value } : b))
  }

  /** `passwordJustSet`: se acaba de crear la contraseña (el estado de este render aún no lo sabe). */
  const enable = async (value: boolean, passwordJustSet = false): Promise<void> => {
    if (value && !passwordJustSet && remote && !remote.hasPassword) {
      // Sin contraseña no se puede activar: primero se crea
      setEnableAfterPassword(true)
      setPasswordForm('create')
      return
    }
    const ok = apply(await window.api.setRemoteEnabled(value).catch(() => null))
    if (ok && value && background && !(background.keepInBackground && background.openAtLogin)) {
      setSuggestBackground(true)
    }
    if (!value) setSuggestBackground(false)
  }

  const update = async (changes: RemoteSettingsChanges): Promise<void> => {
    apply(await window.api.updateRemoteSettings(changes).catch(() => null))
  }

  return (
    <>
      {remote && (
        <LocalTravelReadiness agent={remote.localAgent} agentOwned={remote.agentOwned ?? false} />
      )}
      <div className="settings-section">
        <h3>{t('background.title')}</h3>
        {background && (
          <>
            <SwitchRow
              label={t('background.keep')}
              hint={t('background.keepHint')}
              checked={background.keepInBackground}
              onChange={(v) => void setKeep(v)}
            />
            <SwitchRow
              label={t('background.login')}
              hint={t('background.loginHint')}
              checked={background.openAtLogin}
              onChange={(v) => void setLogin(v)}
            />
          </>
        )}
      </div>

      <div className="settings-section">
        <h3>{t('remoteAccess.title')}</h3>
        {unavailable && <p className="settings-row-hint">{t('remoteAccess.unavailableHere')}</p>}
        {!unavailable && !remote && <Loader2 size={18} className="spin" />}
        {remote && (
          <RemoteAccess
            remote={remote}
            onStopAgent={() => window.api.stopLocalAgent()}
            error={error}
            passwordForm={passwordForm}
            suggestBackground={suggestBackground}
            onEnable={(v) => void enable(v)}
            onUpdate={(c) => void update(c)}
            onPasswordForm={setPasswordForm}
            onPasswordSaved={async (result) => {
              const ok = apply(result)
              if (!ok) return false
              setPasswordForm(null)
              if (enableAfterPassword) {
                setEnableAfterPassword(false)
                await enable(true, true)
              }
              return true
            }}
            onPermission={async (p) => apply(await window.api.openRemotePermission(p))}
            onAcceptBackground={async () => {
              await setKeep(true)
              await setLogin(true)
              setSuggestBackground(false)
            }}
            onDismissBackground={() => setSuggestBackground(false)}
          />
        )}
      </div>
    </>
  )
}

interface RemoteAccessProps {
  onStopAgent: () => Promise<LocalAgentStopResult>
  remote: RemoteSettingsState
  error: string | null
  passwordForm: 'create' | 'change' | null
  suggestBackground: boolean
  onEnable: (value: boolean) => void
  onUpdate: (changes: RemoteSettingsChanges) => void
  onPasswordForm: (form: 'create' | 'change' | null) => void
  onPasswordSaved: (result: RemoteSettingsResult) => Promise<boolean>
  onPermission: (permission: 'screen' | 'accessibility') => void
  onAcceptBackground: () => void
  onDismissBackground: () => void
}

function RemoteAccess(props: RemoteAccessProps): React.JSX.Element {
  const { t } = useTranslation()
  const { remote } = props
  const [stopping, setStopping] = useState(false)
  const [stopReport, setStopReport] = useState<LocalAgentStopResult | null>(null)
  const stopAgent = async (): Promise<void> => {
    if (stopping) return
    setStopping(true)
    try {
      setStopReport(await props.onStopAgent())
    } catch {
      setStopReport({ ok: false, code: 'local_agent_stop_unconfirmed' })
    } finally {
      setStopping(false)
    }
  }
  const wayland = remote.support.state === 'unsupported'
  const [name, setName] = useState(remote.deviceName)
  const [showLog, setShowLog] = useState(false)
  // Si el nombre guardado cambia (al guardarlo o desde otra ventana), el campo lo refleja
  const [savedName, setSavedName] = useState(remote.deviceName)
  if (remote.deviceName !== savedName) {
    setSavedName(remote.deviceName)
    setName(remote.deviceName)
  }

  const saveName = (): void => {
    if (name.trim() && name.trim() !== remote.deviceName) props.onUpdate({ deviceName: name })
    else setName(remote.deviceName)
  }

  if (remote.agentOwned || (remote.localAgent && remote.localAgent.ownership !== 'legacy')) {
    return (
      <div className="settings-warning" role="status" style={{ display: 'block' }}>
        {t(remote.agentOwned ? 'remoteAccess.agentOwned' : 'remoteAccess.localAgentManaged')}
        {remote.localAgent && <p>{t(`remoteAccess.localAgentState.${remote.localAgent.phase}`)}</p>}
        <p>{t('remoteAccess.stop.requireEnrollment')}</p>
        <button
          className="btn-secondary"
          disabled={!remote.localStopAvailable || stopping || (stopReport?.ok ?? false)}
          onClick={() => void stopAgent()}
        >
          {t(stopping ? 'remoteAccess.stop.pending' : 'remoteAccess.stop.action')}
        </button>
        {!remote.localStopAvailable && <p>{t('remoteAccess.stop.unavailable')}</p>}
        {stopReport && (stopReport.ok || stopReport.code !== 'cancelled') && (
          <p role="status">
            {t(
              stopReport.ok
                ? 'remoteAccess.stop.confirmed'
                : `remoteAccess.stop.errors.${stopReport.code}`
            )}
          </p>
        )}
        {remote.agentOwnershipPersistenceFailed && (
          <p>{t('remoteAccess.agentPersistenceFailed')}</p>
        )}
      </div>
    )
  }

  return (
    <>
      {wayland && (
        <div className="settings-warning">
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px', color: '#eab308' }} />
          <span>{t('remoteAccess.wayland')}</span>
        </div>
      )}

      <SwitchRow
        label={t('remoteAccess.enable')}
        hint={t('remoteAccess.enableHint')}
        checked={remote.enabled}
        disabled={wayland || !remote.signedIn}
        onChange={props.onEnable}
      />
      {remote.active && <div className="form-success">{t('remoteAccess.active')}</div>}
      {props.error && (
        <div className="form-error" role="alert">
          {t(`remoteAccess.errors.${props.error}`, t('remoteAccess.errors.generic'))}
        </div>
      )}

      {props.suggestBackground && (
        <div className="settings-warning" style={{ flexDirection: 'column', gap: '8px' }}>
          <span>{t('remoteAccess.suggestBackground')}</span>
          <div className="form-actions">
            <button className="btn-secondary" onClick={props.onDismissBackground}>
              {t('remoteAccess.notNow')}
            </button>
            <button className="btn-primary" onClick={props.onAcceptBackground}>
              {t('remoteAccess.enableBoth')}
            </button>
          </div>
        </div>
      )}
      {remote.enabled && remote.platform === 'win32' && (
        <p className="settings-row-hint">{t('remoteAccess.firewall')}</p>
      )}

      <div className="settings-row">
        <div style={{ minWidth: 0, flex: 1, paddingRight: '12px' }}>
          <div className="settings-row-label">{t('remoteAccess.name')}</div>
          <div className="settings-row-hint">{t('remoteAccess.nameHint')}</div>
        </div>
        <input
          className="form-input"
          style={{ maxWidth: '200px' }}
          value={name}
          maxLength={100}
          aria-label={t('remoteAccess.name')}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>

      <div className="settings-row">
        <div style={{ minWidth: 0, paddingRight: '12px' }}>
          <div className="settings-row-label">{t('remoteAccess.password')}</div>
          <div className="settings-row-hint">
            {remote.hasPassword ? t('remoteAccess.passwordSet') : t('remoteAccess.passwordUnset')}
          </div>
        </div>
        {props.passwordForm === null && (
          <button
            className="btn-secondary"
            style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
            onClick={() => props.onPasswordForm(remote.hasPassword ? 'change' : 'create')}
          >
            <KeyRound size={14} />{' '}
            {remote.hasPassword ? t('remoteAccess.changePassword') : t('remoteAccess.setPassword')}
          </button>
        )}
      </div>
      {props.passwordForm !== null && (
        <PasswordForm onCancel={() => props.onPasswordForm(null)} onSaved={props.onPasswordSaved} />
      )}
      {!remote.encryptionAvailable && remote.hasPassword && (
        <p className="settings-row-hint">{t('remoteAccess.noEncryption')}</p>
      )}

      <div className="settings-row-label" style={{ marginTop: '12px' }}>
        {t('remoteAccess.features')}
      </div>
      {(['clipboard', 'files', 'audio'] as const).map((feature) => (
        <SwitchRow
          key={feature}
          label={t(`remoteAccess.${feature}`)}
          checked={remote.features[feature]}
          onChange={(v) => props.onUpdate({ features: { [feature]: v } })}
        />
      ))}
      <SwitchRow
        label={t('remoteAccess.confirmLocal')}
        hint={t('remoteAccess.confirmLocalHint')}
        checked={remote.confirmLocal}
        onChange={(v) => props.onUpdate({ confirmLocal: v })}
      />
      <SwitchRow
        label={t('remoteAccess.preventSleep')}
        hint={t('remoteAccess.preventSleepHint')}
        checked={remote.preventSleep}
        onChange={(v) => props.onUpdate({ preventSleep: v })}
      />

      {remote.platform === 'darwin' && (
        <>
          <div className="settings-row-label" style={{ marginTop: '12px' }}>
            {t('remoteAccess.permissions')}
          </div>
          {(['screen', 'accessibility'] as const).map((permission) => {
            const missing = remote.support.missing?.includes(permission) ?? false
            return (
              <div className="settings-row" key={permission}>
                <div>
                  <div className="settings-row-label">
                    {t(
                      permission === 'accessibility' && remote.accessibilityRenamed
                        ? 'remoteAccess.accessibility27'
                        : `remoteAccess.${permission}`
                    )}
                  </div>
                  <div
                    className={`settings-row-hint ${missing ? 'permission-missing' : 'permission-granted'}`}
                  >
                    {missing ? t('remoteAccess.missing') : t('remoteAccess.granted')}
                  </div>
                </div>
                <button className="btn-secondary" onClick={() => props.onPermission(permission)}>
                  {t('remoteAccess.openPanel')}
                </button>
              </div>
            )
          })}
          <p className="settings-row-hint">{t('remoteAccess.permissionsHint')}</p>
        </>
      )}

      <div className="settings-row-label" style={{ marginTop: '12px' }}>
        {t('remoteAccess.limits')}
      </div>
      <p className="settings-row-hint" style={{ marginBottom: '12px' }}>
        {t(`remoteAccess.limits_${remote.platform}`, '')}
      </p>

      <button className="settings-btn" onClick={() => setShowLog(!showLog)}>
        {showLog
          ? t('remoteAccess.logHide')
          : t('remoteAccess.logShow', { count: remote.log.length })}
      </button>
      {showLog && <SessionLog log={remote.log} />}
    </>
  )
}

function PasswordForm({
  onCancel,
  onSaved
}: {
  onCancel: () => void
  onSaved: (result: RemoteSettingsResult) => Promise<boolean>
}): React.JSX.Element {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (password.length < MIN_PC_PASSWORD_LENGTH)
      return setError(t('remoteAccess.passwordTooShort'))
    if (password !== confirmation) return setError(t('remoteAccess.passwordMismatch'))
    setWorking(true)
    const result = await window.api.setRemotePassword(password).catch(() => null)
    setWorking(false)
    if (!result || !(await onSaved(result))) setError(t('remoteAccess.errors.generic'))
  }

  return (
    <form className="form-stack" onSubmit={(e) => void submit(e)} style={{ marginTop: '8px' }}>
      <div className="form-field">
        <label htmlFor="remote-password">{t('remoteAccess.newPassword')}</label>
        <input
          id="remote-password"
          className="form-input"
          type="password"
          autoFocus
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <span className="form-hint">{t('remoteAccess.passwordHint')}</span>
      </div>
      <div className="form-field">
        <label htmlFor="remote-password-confirmation">{t('remoteAccess.confirmPassword')}</label>
        <input
          id="remote-password-confirmation"
          className="form-input"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        <button type="button" className="btn-secondary" disabled={working} onClick={onCancel}>
          {t('remoteAccess.cancel')}
        </button>
        <button type="submit" className="btn-primary" disabled={working}>
          {working && <Loader2 size={14} className="spin" />} {t('remoteAccess.save')}
        </button>
      </div>
    </form>
  )
}

function duration(ms: number | undefined): string {
  if (!ms) return '0 s'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

function SessionLog({ log }: { log: RemoteLogInfo[] }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  if (log.length === 0) return <p className="settings-row-hint">{t('remoteAccess.logEmpty')}</p>
  return (
    <ul className="remote-log">
      {log.map((entry, index) => (
        <li key={`${entry.at}-${index}`}>
          <span className="remote-log-date">
            {new Date(entry.at).toLocaleString(i18n.language)}
          </span>
          <span>
            {t(`remoteAccess.logTypes.${entry.type}`, {
              controller: entry.controller ?? '—',
              duration: duration(entry.durationMs)
            })}
          </span>
        </li>
      ))}
    </ul>
  )
}
