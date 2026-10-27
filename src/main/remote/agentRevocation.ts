import { isDeviceId, parseAgentDeviceInfo } from '../../shared/remote/agentDevice'
import type { AccountDevice } from '../../shared/remote/viewerBridge'

export type AgentRevocationResult = { ok: true } | { ok: false; code: string }
export interface AgentRevocationDeps {
  devices(): Promise<AccountDevice[]>
  confirm(device: Readonly<AccountDevice>): Promise<boolean>
  revoke(id: string): Promise<void>
  closeViewers(id: string): void
  /** El vínculo se vuelve a comprobar después del diálogo (la cuenta puede cambiar). */
  account(): object | null
}
/** La confirmación pertenece a main; ningún renderer elige rutas, tokens ni el texto del destino. */
export async function revokeAccountAgent(
  id: unknown,
  deps: AgentRevocationDeps
): Promise<AgentRevocationResult> {
  if (!isDeviceId(id)) return { ok: false, code: 'device_not_found' }
  const account = deps.account()
  if (!account) return { ok: false, code: 'unauthenticated' }
  const devices = await deps.devices()
  const device = devices.find((item) => item.id === id)
  if (!device || parseAgentDeviceInfo(device.remote).mode !== 'agent')
    return { ok: false, code: 'device_not_found' }
  if (deps.account() !== account) return { ok: false, code: 'unauthenticated' }
  if (!(await deps.confirm(device))) return { ok: false, code: 'cancelled' }
  if (deps.account() !== account) return { ok: false, code: 'unauthenticated' }
  await deps.revoke(device.id)
  deps.closeViewers(device.id)
  return { ok: true }
}
