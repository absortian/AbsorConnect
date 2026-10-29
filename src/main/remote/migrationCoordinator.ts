// Traspaso: intención durable → drenaje → snapshot → canje → preparación → commit explícito.
import { createHash, randomUUID } from 'crypto'
import type { Session } from '../cloud/session'
import type { DeviceCredentials } from './deviceApi'
import type { LegacyMigrationMaterial } from './migrationMaterial'
import type { MigrationJournal, MigrationRecord } from './migrationJournal'
import type { MigrationProvider, MigrationReceipt, MigrationTarget } from './migrationProvider'
import type {
  AgentSetupChoice,
  AgentSetupResult,
  AgentSetupState
} from '../../shared/remote/agentSetup'

export interface MigrationApi {
  create(session: Session, device: DeviceCredentials, transactionId: string): Promise<string>
  cancel(session: Session, device: DeviceCredentials, transactionId: string): Promise<boolean>
  consumed(session: Session, device: DeviceCredentials, transactionId: string): Promise<boolean>
}
export interface MigrationDependencies {
  session(): Session | null
  origin(): string
  journal: MigrationJournal
  identity: { readExisting(): Promise<DeviceCredentials> }
  store: {
    isEnabled(): Promise<boolean>
    freezeForMigration(email: string): Promise<LegacyMigrationMaterial>
    releaseMigrationFreeze(): void
  }
  host: { quiesceForMigration(): Promise<void> }
  provider: MigrationProvider
  api: MigrationApi
  /** Solo tras las dos compensaciones y la retirada durable de la intención. */
  compensated(revalidate: () => void): Promise<void>
  stopAfterSourceChange?(target: MigrationTarget): Promise<unknown>
  quiesceTimeoutMs?: number
}
function binding(session: Session): string {
  return createHash('sha256').update(session.email).update('\0').update(session.token).digest('hex')
}
function matches(
  receipt: MigrationReceipt | null,
  target: MigrationTarget
): receipt is MigrationReceipt {
  return (
    !!receipt &&
    receipt.transactionId === target.transactionId &&
    receipt.deviceId === target.deviceId
  )
}
async function deadline<T>(pending: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('agent_migration_drain_timeout')), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
export class MigrationCoordinator {
  private busy = false
  private epoch = 0
  private canCommit = false
  constructor(private readonly d: MigrationDependencies) {}
  /** Logout/cambio de cuenta invalida cada continuación, incluso con la misma dirección. */
  invalidate(): void {
    this.epoch++
    this.canCommit = false
  }
  /** Vínculo privado para revalidar un diálogo de Main, nunca se publica en IPC. */
  async confirmationScope(): Promise<string> {
    const record = await this.d.journal.read()
    if (record) return JSON.stringify(record)
    return (await this.d.identity.readExisting()).id
  }
  private check(session: Session, epoch: number, record?: MigrationRecord): void {
    if (
      epoch !== this.epoch ||
      this.d.session() !== session ||
      (record && record.accountBinding !== binding(session))
    )
      throw Error('agent_migration_source_changed')
  }
  async state(): Promise<AgentSetupState> {
    const providerAvailable = await this.d.provider.available().catch(() => false)
    let phase: AgentSetupState['phase'] = providerAvailable ? 'idle' : 'unavailable'
    let freshEnrollmentRequired = false
    try {
      if (await this.d.journal.intentPresent()) {
        const record = await this.d.journal.read()
        freshEnrollmentRequired = true
        phase =
          record?.phase === 'committed'
            ? 'committed'
            : record?.phase === 'prepared'
              ? 'prepared'
              : record?.phase === 'compensating'
                ? 'compensating'
                : 'intervention_required'
        const session = this.d.session()
        if (!session || !record || record.accountBinding !== binding(session)) {
          phase = 'intervention_required'
          this.canCommit = false
        }
      }
    } catch {
      phase = 'intervention_required'
      freshEnrollmentRequired = true
    }
    if (this.busy && phase !== 'compensating') phase = 'preparing'
    return {
      phase,
      providerAvailable,
      busy: this.busy,
      canCommit: this.canCommit && phase === 'prepared' && providerAvailable && !this.busy,
      freshEnrollmentRequired,
      readyForUnattended: false
    }
  }
  private async operation(
    action: (session: Session, epoch: number) => Promise<void>
  ): Promise<AgentSetupResult> {
    if (this.busy) return { ok: false, code: 'agent_setup_busy' }
    const session = this.d.session()
    if (!session) return { ok: false, code: 'not_signed_in' }
    if (!(await this.d.provider.available().catch(() => false)))
      return { ok: false, code: 'agent_setup_unavailable' }
    // Revalidar después de la consulta; no permitir dos operaciones concurrentes.
    if (this.busy) return { ok: false, code: 'agent_setup_busy' }
    if (this.d.session() !== session) return { ok: false, code: 'cancelled' }
    this.busy = true
    try {
      await action(session, this.epoch)
      if (this.d.session() !== session) throw Error('agent_migration_source_changed')
      return {
        ok: true,
        state: {
          ...(await this.state()),
          busy: false,
          phase:
            (await this.d.journal.read())?.phase === 'committed'
              ? 'committed'
              : (await this.d.journal.read())?.phase === 'prepared'
                ? 'prepared'
                : 'idle',
          canCommit: this.canCommit
        }
      }
    } catch {
      this.canCommit = false
      return { ok: false, code: 'agent_setup_intervention_required' }
    } finally {
      this.busy = false
    }
  }
  begin(choice: AgentSetupChoice): Promise<AgentSetupResult> {
    return this.operation(async (session, epoch) => {
      if (await this.d.journal.intentPresent()) throw Error('agent_migration_existing_intent')
      this.check(session, epoch)
      const device = await this.d.identity.readExisting()
      this.check(session, epoch)
      const legacyEnabled = await this.d.store.isEnabled()
      this.check(session, epoch)
      let record = await this.d.journal.reserve({
        transactionId: randomUUID(),
        deviceId: device.id,
        accountBinding: binding(session),
        legacyEnabled
      })
      this.check(session, epoch, record)
      // El timeout solo abandona la continuación: una respuesta tardía nunca copia K o pide un alta.
      await deadline(this.d.host.quiesceForMigration(), this.d.quiesceTimeoutMs ?? 5000)
      this.check(session, epoch, record)
      let material: LegacyMigrationMaterial | null = null
      let payload: Buffer | null = null
      try {
        material = await this.d.store.freezeForMigration(session.email)
        this.check(session, epoch, record)
        record = await this.d.journal.advance(record, 'grant_requested')
        this.check(session, epoch, record)
        const enrollmentToken = await this.d.api.create(session, device, record.transactionId)
        this.check(session, epoch, record)
        payload = material.provisioningPayload({
          ...record,
          origin: this.d.origin(),
          enrollmentToken,
          enabled: choice.activate,
          confirmLocal: choice.confirmLocal
        })
        record = await this.d.journal.advance(record, 'provisioning')
        this.check(session, epoch, record)
        const receipt = await this.d.provider.prepare(payload)
        this.check(session, epoch, record)
        if (
          !matches(receipt, record) ||
          receipt.phase !== 'prepared' ||
          !receipt.optionsImported ||
          !receipt.lockoutImported
        )
          throw Error('agent_migration_prepare_unconfirmed')
        record = await this.d.journal.advance(record, 'prepared')
        this.check(session, epoch, record)
        this.canCommit = receipt.canActivate
      } finally {
        payload?.fill(0)
        material?.destroy()
      }
    })
  }
  recover(): Promise<AgentSetupResult> {
    return this.operation(async (session, epoch) => {
      let record = await this.d.journal.read()
      if (!record) throw Error('agent_migration_no_intent')
      this.check(session, epoch, record)
      const device = await this.d.identity.readExisting()
      this.check(session, epoch, record)
      if (device.id !== record.deviceId) throw Error('agent_migration_identity_changed')
      const receipt = await this.d.provider.inspect()
      this.check(session, epoch, record)
      if (
        !matches(receipt, record) ||
        !['prepared', 'committed'].includes(receipt.phase) ||
        !receipt.optionsImported ||
        !receipt.lockoutImported
      )
        throw Error('agent_migration_recovery_unconfirmed')
      if (!(await this.d.api.consumed(session, device, record.transactionId)))
        throw Error('agent_migration_not_consumed')
      this.check(session, epoch, record)
      if (record.phase === 'provisioning') record = await this.d.journal.advance(record, 'prepared')
      this.check(session, epoch, record)
      if (receipt.phase === 'committed' && record.phase === 'prepared')
        record = await this.d.journal.advance(record, 'committed')
      this.check(session, epoch, record)
      if (!['prepared', 'committed'].includes(record.phase))
        throw Error('agent_migration_phase_changed')
      this.canCommit = receipt.phase === 'prepared' && receipt.canActivate
    })
  }
  commit(): Promise<AgentSetupResult> {
    return this.operation(async (session, epoch) => {
      const record = await this.d.journal.read()
      if (!record || record.phase !== 'prepared' || !this.canCommit)
        throw Error('agent_migration_not_prepared')
      this.check(session, epoch, record)
      const device = await this.d.identity.readExisting()
      this.check(session, epoch, record)
      if (
        device.id !== record.deviceId ||
        !(await this.d.api.consumed(session, device, record.transactionId))
      )
        throw Error('agent_migration_not_consumed')
      this.check(session, epoch, record)
      try {
        const receipt = await this.d.provider.commit({
          deviceId: record.deviceId,
          transactionId: record.transactionId
        })
        this.check(session, epoch, record)
        if (!matches(receipt, record) || receipt.phase !== 'committed')
          throw Error('agent_migration_commit_unconfirmed')
        await this.d.journal.advance(record, 'committed')
        this.check(session, epoch, record)
        this.canCommit = false
      } finally {
        try {
          this.check(session, epoch, record)
        } catch {
          // También si se perdió la respuesta de commit; nunca pedir elevación al salir.
          await this.d
            .stopAfterSourceChange?.({
              deviceId: record.deviceId,
              transactionId: record.transactionId
            })
            .catch(() => undefined)
        }
      }
    })
  }
  cancel(): Promise<AgentSetupResult> {
    return this.operation(async (session, epoch) => {
      let record = await this.d.journal.read()
      if (!record) throw Error('agent_migration_no_intent')
      this.check(session, epoch, record)
      await deadline(this.d.host.quiesceForMigration(), this.d.quiesceTimeoutMs ?? 5000)
      this.check(session, epoch, record)
      const device = await this.d.identity.readExisting()
      this.check(session, epoch, record)
      if (device.id !== record.deviceId) throw Error('agent_migration_identity_changed')
      if (record.phase !== 'compensating')
        record = await this.d.journal.advance(record, 'compensating')
      this.check(session, epoch, record)
      // DELETE exacto crea una lápida aunque el POST anterior no devolviera respuesta.
      const apiRevoked = await this.d.api.cancel(session, device, record.transactionId)
      this.check(session, epoch, record)
      if (!apiRevoked) throw Error('agent_migration_other_authority')
      const receipt = await this.d.provider.remove({
        deviceId: record.deviceId,
        transactionId: record.transactionId
      })
      this.check(session, epoch, record)
      if (receipt && (!matches(receipt, record) || receipt.phase !== 'removed'))
        throw Error('agent_migration_remove_unconfirmed')
      await this.d.journal.clearAfterCompensation(record, { apiRevoked: true, localRemoved: true })
      this.check(session, epoch, record)
      await this.d.compensated(() => this.check(session, epoch, record))
      this.check(session, epoch, record)
      this.d.store.releaseMigrationFreeze()
      this.canCommit = false
    })
  }
}
