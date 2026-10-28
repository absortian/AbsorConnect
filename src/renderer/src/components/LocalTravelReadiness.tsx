import { useTranslation } from 'react-i18next'
import type { LocalAgentSnapshot } from '../../../shared/remote/localAgent'

/** La lista de configuraciones certificadas sigue vacía; ninguna respuesta local la amplía. */
export function LocalTravelReadiness({
  agent,
  agentOwned
}: {
  agent?: LocalAgentSnapshot
  agentOwned: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const managed = agentOwned || (agent && agent.ownership !== 'legacy')
  const responding = managed && agent?.phase === 'responding'
  const continuity = responding ? 'interface_only' : managed ? 'unverified' : 'user_session'
  return (
    <section className="settings-section" aria-label={t('travel.title')}>
      <h3>{t('travel.title')}</h3>
      <p className="settings-warning" role="status">
        {t('travel.notCertified')}
      </p>
      <p className="settings-row-hint">{t('travel.certifiedNone')}</p>
      <p className="settings-row-hint">{t(`travel.exit.${continuity}`)}</p>
      {responding && (
        <p className="settings-row-hint">{t(`travel.state.${agent.state ?? 'unknown'}`)}</p>
      )}
      <p className="settings-row-hint">{t('travel.recovery')}</p>
    </section>
  )
}
