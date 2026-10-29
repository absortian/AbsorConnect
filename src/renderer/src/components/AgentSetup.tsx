import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AgentSetupChoice,
  AgentSetupResult,
  AgentSetupState
} from '../../../shared/remote/agentSetup'
type Action = 'prepare' | 'recover' | 'commit' | 'cancel' | 'retire'
const unavailable: AgentSetupState = {
  phase: 'unavailable',
  providerAvailable: false,
  busy: false,
  canCommit: false,
  freshEnrollmentRequired: false,
  readyForUnattended: false
}
export function AgentSetupView({
  state,
  signedIn,
  hasPassword,
  encrypted,
  pending,
  notice,
  choice,
  onChoice,
  onAction
}: {
  state: AgentSetupState
  signedIn: boolean
  hasPassword: boolean
  encrypted: boolean
  pending: boolean
  notice: string | null
  choice: 'required' | 'unattended' | null
  onChoice(value: 'required' | 'unattended'): void
  onAction(action: Action): void
}): React.JSX.Element {
  const { t } = useTranslation()
  const busy = pending || state.busy
  const mayPrepare =
    state.phase === 'idle' &&
    state.providerAvailable &&
    signedIn &&
    hasPassword &&
    encrypted &&
    !busy &&
    choice !== null
  return (
    <section className="settings-section" aria-label={t('agentSetup.title')}>
      <h3>{t('agentSetup.title')}</h3>
      <p className="settings-warning">{t('agentSetup.notCertified')}</p>
      <p role="status" className="settings-row-hint">
        {t('agentSetup.phase.' + state.phase)}
      </p>
      {!state.providerAvailable && (
        <p className="settings-row-hint">{t('agentSetup.packageUnavailable')}</p>
      )}
      {notice && (
        <p role="status" className="settings-warning">
          {t(notice === 'cancelled' ? 'agentSetup.cancelled' : 'agentSetup.error')}
        </p>
      )}
      {state.phase === 'idle' && (
        <>
          {!signedIn && <p className="settings-warning">{t('agentSetup.signIn')}</p>}
          {!hasPassword && <p className="settings-warning">{t('agentSetup.password')}</p>}
          {!encrypted && <p className="settings-warning">{t('agentSetup.encryption')}</p>}
          <fieldset
            disabled={busy || !state.providerAvailable}
            style={{
              border: '1px solid var(--border-light)',
              borderRadius: 8,
              padding: 12,
              margin: '12px 0'
            }}
          >
            <legend>{t('agentSetup.confirmChoice')}</legend>
            <label style={{ display: 'block', marginBottom: 8 }}>
              <input
                type="radio"
                name="agent-confirm-local"
                checked={choice === 'required'}
                onChange={() => onChoice('required')}
              />{' '}
              {t('agentSetup.confirmRequired')}
            </label>
            <label style={{ display: 'block' }}>
              <input
                type="radio"
                name="agent-confirm-local"
                checked={choice === 'unattended'}
                onChange={() => onChoice('unattended')}
              />{' '}
              {t('agentSetup.confirmUnattended')}
            </label>
          </fieldset>
          <p className="settings-row-hint">{t('agentSetup.adminPermission')}</p>
          <button
            className="btn btn-secondary"
            disabled={!mayPrepare}
            onClick={() => onAction('prepare')}
          >
            {t('agentSetup.prepare')}
          </button>
        </>
      )}
      {state.phase === 'prepared' && (
        <>
          {!state.canCommit && (
            <p className="settings-warning">{t('agentSetup.policyIntervention')}</p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              disabled={busy || !state.canCommit || !signedIn}
              onClick={() => onAction('commit')}
            >
              {t('agentSetup.commit')}
            </button>{' '}
            <button
              className="btn btn-secondary"
              disabled={busy || !state.providerAvailable || !signedIn}
              onClick={() => onAction('cancel')}
            >
              {t('agentSetup.cancel')}
            </button>
          </div>
        </>
      )}
      {['intervention_required', 'compensating'].includes(state.phase) && (
        <>
          <p className="settings-row-hint">{t('agentSetup.recoveryHint')}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary"
              disabled={busy || !state.providerAvailable || !signedIn}
              onClick={() => onAction('recover')}
            >
              {t('agentSetup.recover')}
            </button>{' '}
            <button
              className="btn btn-secondary"
              disabled={busy || !state.providerAvailable || !signedIn}
              onClick={() => onAction('cancel')}
            >
              {t('agentSetup.cancel')}
            </button>
          </div>
        </>
      )}
      {state.phase === 'committed' && (
        <>
          <p className="settings-row-hint">{t('agentSetup.passwordChange')}</p>
          <button
            className="btn btn-secondary"
            disabled={busy || !state.providerAvailable || !signedIn}
            onClick={() => onAction('retire')}
          >
            {t('agentSetup.retire')}
          </button>
        </>
      )}
    </section>
  )
}
export default function AgentSetup({
  signedIn,
  hasPassword,
  encrypted
}: {
  signedIn: boolean
  hasPassword: boolean
  encrypted: boolean
}): React.JSX.Element {
  const [state, setState] = useState(unavailable),
    [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null),
    [choice, setChoice] = useState<'required' | 'unattended' | null>(null)
  const revision = useRef(0)
  useEffect(() => {
    let mounted = true
    const refresh = async (): Promise<void> => {
      const seen = revision.current
      try {
        const value = await window.api.agentSetupState()
        if (mounted && seen === revision.current && value.ok) setState(value.state)
      } catch {
        if (mounted && seen === revision.current)
          setState({ ...unavailable, phase: 'intervention_required' })
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [])
  const action = async (value: Action): Promise<void> => {
    if (pending) return
    revision.current++
    setPending(true)
    setNotice(null)
    try {
      const calls: Record<Exclude<Action, 'prepare'>, () => Promise<AgentSetupResult>> = {
        recover: () => window.api.recoverAgentSetup(),
        commit: () => window.api.commitAgentSetup(),
        cancel: () => window.api.cancelAgentSetup(),
        retire: () => window.api.retireLocalAgent()
      }
      const options: AgentSetupChoice = { confirmLocal: choice === 'required', activate: true }
      const result =
        value === 'prepare' ? await window.api.prepareAgent(options) : await calls[value]()
      if (result.ok) setState(result.state)
      else {
        setNotice(result.code)
        const fresh = await window.api.agentSetupState()
        if (fresh.ok) setState(fresh.state)
      }
    } catch {
      setNotice('error')
    } finally {
      revision.current++
      setPending(false)
    }
  }
  return (
    <AgentSetupView
      state={state}
      signedIn={signedIn}
      hasPassword={hasPassword}
      encrypted={encrypted}
      pending={pending}
      notice={notice}
      choice={choice}
      onChoice={setChoice}
      onAction={(v) => void action(v)}
    />
  )
}
