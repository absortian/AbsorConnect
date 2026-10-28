import { isDeviceId } from '../../shared/remote/agentDevice'
import type { ViewerAvailabilityResult } from '../../shared/remote/viewerBridge'
interface Options {
  account(): object | null
  allowed(): boolean
  devices(): Promise<unknown>
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
async function selectedDevice(
  id: string,
  options: Options
): Promise<{ ok: true; device: Record<string, unknown> } | { ok: false; code: string }> {
  if (!isDeviceId(id) || !options.allowed()) return { ok: false, code: 'forbidden' }
  const account = options.account()
  if (!account) return { ok: false, code: 'unauthenticated' }
  const response = await options.devices()
  if (!options.allowed() || options.account() !== account)
    return { ok: false, code: 'unauthenticated' }
  if (!record(response) || !Array.isArray(response.devices))
    return { ok: false, code: 'invalid_presence' }
  const matches = response.devices.filter((item) => record(item) && item.id === id)
  if (matches.length !== 1 || !record(matches[0])) return { ok: false, code: 'device_not_found' }
  return { ok: true, device: matches[0] }
}

/** Nombre e identidad de la cuenta; nunca el nombre propuesto por un renderer. */
export async function viewerTarget(
  id: string,
  options: Options
): Promise<{ id: string; name: string } | null> {
  const selected = await selectedDevice(id, options)
  if (!selected.ok) return null
  const name = selected.device.name
  return typeof name === 'string' && name.trim().length > 0 && [...name].length <= 100
    ? { id, name }
    : null
}

/** Solo devuelve presencia del destino fijado por main; no identidad, K o token. */
export async function viewerAvailability(
  id: string,
  options: Options
): Promise<ViewerAvailabilityResult> {
  const selected = await selectedDevice(id, options)
  if (!selected.ok) return selected
  const device = selected.device
  if (
    !record(device) ||
    typeof device.online !== 'boolean' ||
    typeof device.lastSeenAt !== 'string' ||
    device.lastSeenAt.length > 64 ||
    !Number.isFinite(Date.parse(device.lastSeenAt)) ||
    !record(device.remote)
  )
    return { ok: false, code: 'invalid_presence' }
  return {
    ok: true,
    online: device.online,
    available: device.remote.state === 'available',
    lastSeenAt: device.lastSeenAt
  }
}
