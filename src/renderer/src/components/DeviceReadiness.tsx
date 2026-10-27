import { useTranslation } from 'react-i18next'
import { parseAgentDeviceInfo, travelReadiness } from '../../../shared/remote/agentDevice'
import type { AccountDevice } from '../../../shared/remote/viewerBridge'

/** Una declaración de capacidades, incluso completa, no equivale al piloto aprobado. */
export function DeviceReadiness({ device }: { device: AccountDevice }): React.JSX.Element {
  const { t } = useTranslation()
  const agent = parseAgentDeviceInfo(device.remote)
  return (
    <div>
      <div className="settings-row-hint">
        {t(`devices.agent.readiness.${travelReadiness(agent, device.online)}`)}
      </div>
      {agent.mode === 'agent' && (
        <div className="settings-row-hint">
          {t('devices.agent.declared')} ({agent.agentVersion})
        </div>
      )}
    </div>
  )
}
