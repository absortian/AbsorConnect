// La cuenta y X-Device-Key solo se usan en Main; el proveedor recibe únicamente ace + K.
import { apiRequest } from '../cloud/apiClient'
import { isDeviceId } from '../../shared/remote/agentDevice'
import type { MigrationApi } from './migrationCoordinator'
export function accountMigrationApi(): MigrationApi {
  const request = (
    method: string,
    session: { token: string },
    device: { id: string; key: string },
    tx: string
  ): Promise<unknown> => {
    if (!isDeviceId(device.id) || !isDeviceId(tx)) throw Error('agent_migration_identity_invalid')
    return apiRequest(method, `/api/devices/${device.id}/agent-enrollment-transactions/${tx}`, {
      token: session.token,
      headers: { 'X-Device-Key': device.key }
    })
  }
  const status = (value: unknown): { state: string; legacyAllowed: boolean } => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw Error('agent_migration_api_unconfirmed')
    const v = value as Record<string, unknown>
    if (
      Object.keys(v).length !== 2 ||
      typeof v.state !== 'string' ||
      !['absent', 'pending', 'consumed', 'cancelled', 'expired', 'retired'].includes(v.state) ||
      typeof v.legacyAllowed !== 'boolean'
    )
      throw Error('agent_migration_api_unconfirmed')
    return { state: v.state, legacyAllowed: v.legacyAllowed }
  }
  return {
    create: async (session, device, tx) => {
      const value = await request('POST', session, device, tx)
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('agent_migration_api_unconfirmed')
      const v = value as Record<string, unknown>
      if (
        Object.keys(v).length !== 3 ||
        v.transactionId !== tx ||
        typeof v.enrollmentToken !== 'string' ||
        !/^ace_[A-Za-z0-9_-]{43}$/.test(v.enrollmentToken) ||
        typeof v.expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(v.expiresAt)) ||
        Date.parse(v.expiresAt) <= Date.now()
      )
        throw Error('agent_migration_api_unconfirmed')
      return v.enrollmentToken
    },
    cancel: async (session, device, tx) => {
      const v = status(await request('DELETE', session, device, tx))
      return v.state === 'cancelled' && v.legacyAllowed
    },
    consumed: async (session, device, tx) => {
      const v = status(await request('GET', session, device, tx))
      return v.state === 'consumed' && !v.legacyAllowed
    }
  }
}
