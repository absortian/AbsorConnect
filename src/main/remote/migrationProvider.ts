// Contrato exclusivo de Main. El proveedor final requiere instalador/ACL propios (11.x).
import { isDeviceId } from '../../shared/remote/agentDevice'
export type NativeMigrationPhase =
  | 'provisioning'
  | 'prepared'
  | 'committing'
  | 'committed'
  | 'intervention_required'
  | 'removed'
export interface MigrationReceipt {
  v: 1
  transactionId: string
  deviceId: string
  phase: NativeMigrationPhase
  canActivate: boolean
  optionsImported: boolean
  lockoutImported: boolean
}
export interface MigrationTarget {
  transactionId: string
  deviceId: string
}
export interface MigrationProvider {
  available(): Promise<boolean>
  inspect(): Promise<MigrationReceipt | null>
  prepare(payload: Buffer): Promise<MigrationReceipt>
  commit(target: MigrationTarget): Promise<MigrationReceipt>
  remove(target: MigrationTarget): Promise<MigrationReceipt | null>
}
const phases = new Set<NativeMigrationPhase>([
  'provisioning',
  'prepared',
  'committing',
  'committed',
  'intervention_required',
  'removed'
])
export function parseMigrationReceipt(raw: string): MigrationReceipt | null {
  if (!raw || Buffer.byteLength(raw) > 512) throw Error('agent_migration_provider_unconfirmed')
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value) !== raw)
    throw Error('agent_migration_provider_unconfirmed')
  const v = value as Record<string, unknown>
  if (Object.keys(v).length === 2 && v.v === 1 && v.absent === true) return null
  if (
    Object.keys(v).length !== 7 ||
    v.v !== 1 ||
    !isDeviceId(v.transactionId) ||
    !isDeviceId(v.deviceId) ||
    !phases.has(v.phase as NativeMigrationPhase) ||
    typeof v.canActivate !== 'boolean' ||
    typeof v.optionsImported !== 'boolean' ||
    typeof v.lockoutImported !== 'boolean'
  )
    throw Error('agent_migration_provider_unconfirmed')
  return {
    v: 1,
    transactionId: v.transactionId,
    deviceId: v.deviceId,
    phase: v.phase as NativeMigrationPhase,
    canActivate: v.canActivate,
    optionsImported: v.optionsImported,
    lockoutImported: v.lockoutImported
  }
}
/** No ejecutar prototipos ni pedir elevación por detectar una ruta o una variable de entorno. */
export function installedMigrationProvider(): MigrationProvider {
  const unavailable = async (): Promise<never> => {
    throw Error('agent_migration_provider_unavailable')
  }
  return {
    available: async () => false,
    inspect: unavailable,
    prepare: unavailable,
    commit: unavailable,
    remove: unavailable
  }
}
