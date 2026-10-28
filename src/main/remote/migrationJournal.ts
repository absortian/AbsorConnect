// Intención durable de Main: no admite K, tokens, contraseñas ni payloads del instalador.
import { constants } from 'fs'
import * as fs from 'fs/promises'
import { dirname, isAbsolute } from 'path'
import { randomUUID } from 'crypto'
import { isDeviceId } from '../../shared/remote/agentDevice'
import type { AgentStatusSource } from './agentStatusClient'

export type MigrationPhase =
  | 'reserved'
  | 'grant_requested'
  | 'provisioning'
  | 'prepared'
  | 'committed'
  | 'compensating'
  | 'intervention_required'
export interface MigrationRecord {
  v: 1
  transactionId: string
  deviceId: string
  /** Huella de vínculo de sesión, solo en Main. No sirve como credencial API. */
  accountBinding: string
  legacyEnabled: boolean
  phase: MigrationPhase
  revision: number
}
export class MigrationJournalError extends Error {
  constructor() {
    super('agent_migration_journal_unverified')
  }
}
const TRANSITIONS: Record<MigrationPhase, readonly MigrationPhase[]> = {
  reserved: ['grant_requested', 'compensating'],
  grant_requested: ['provisioning', 'compensating'],
  provisioning: ['prepared', 'compensating', 'intervention_required'],
  prepared: ['committed', 'compensating', 'intervention_required'],
  committed: ['compensating', 'intervention_required'],
  compensating: ['intervention_required'],
  intervention_required: ['compensating']
}
const FIELDS = [
  'v',
  'transactionId',
  'deviceId',
  'accountBinding',
  'legacyEnabled',
  'phase',
  'revision'
]
export function parseMigrationRecord(raw: string): MigrationRecord {
  try {
    if (!raw || Buffer.byteLength(raw) > 4096) throw new MigrationJournalError()
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new MigrationJournalError()
    const v = value as Record<string, unknown>
    if (
      JSON.stringify(v) !== raw ||
      Object.keys(v).length !== FIELDS.length ||
      !FIELDS.every((key) => Object.hasOwn(v, key)) ||
      v.v !== 1 ||
      !isDeviceId(v.transactionId) ||
      !isDeviceId(v.deviceId) ||
      typeof v.accountBinding !== 'string' ||
      !/^[0-9a-f]{64}$/.test(v.accountBinding) ||
      typeof v.legacyEnabled !== 'boolean' ||
      typeof v.phase !== 'string' ||
      !Object.hasOwn(TRANSITIONS, v.phase) ||
      typeof v.revision !== 'number' ||
      !Number.isSafeInteger(v.revision) ||
      v.revision < 1
    )
      throw new MigrationJournalError()
    return {
      v: 1,
      transactionId: v.transactionId,
      deviceId: v.deviceId,
      accountBinding: v.accountBinding,
      legacyEnabled: v.legacyEnabled,
      phase: v.phase as MigrationPhase,
      revision: v.revision
    }
  } catch {
    throw new MigrationJournalError()
  }
}

/** La app mantiene una instancia única; cada operación además comprueba transacción/revisión. */
export class MigrationJournal {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly path: string) {
    if (!isAbsolute(path)) throw new MigrationJournalError()
  }
  private async parent(): Promise<void> {
    // El adaptador ACL Windows de 4.4 sigue pendiente; los bits POSIX no lo sustituyen.
    if (process.platform === 'win32') throw new MigrationJournalError()
    const meta = await fs.lstat(dirname(this.path))
    if (
      !meta.isDirectory() ||
      (meta.mode & 0o022) !== 0 ||
      (process.getuid && meta.uid !== process.getuid())
    )
      throw new MigrationJournalError()
  }
  private async syncParent(): Promise<void> {
    const parent = await fs.open(dirname(this.path), constants.O_RDONLY)
    try {
      await parent.sync()
    } finally {
      await parent.close()
    }
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.queue
      .catch(() => undefined)
      .then(action)
      .catch(() => {
        throw new MigrationJournalError()
      })
    this.queue = pending
    return pending
  }
  /** Ausencia inicial comprobada; cualquier archivo parcial/corrupto sigue reservando el host. */
  async intentPresent(): Promise<boolean> {
    try {
      await fs.lstat(this.path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw new MigrationJournalError()
    }
    if (!(await this.read())) throw new MigrationJournalError()
    return true
  }
  async read(): Promise<MigrationRecord | null> {
    try {
      await this.parent()
      let meta: Awaited<ReturnType<typeof fs.lstat>>
      try {
        meta = await fs.lstat(this.path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
      if (
        !meta.isFile() ||
        meta.nlink !== 1 ||
        (meta.mode & 0o7777) !== 0o600 ||
        meta.size < 1 ||
        meta.size > 4096 ||
        (process.getuid && meta.uid !== process.getuid())
      )
        throw new MigrationJournalError()
      const file = await fs.open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const opened = await file.stat()
        if (opened.ino !== meta.ino || opened.dev !== meta.dev) throw new MigrationJournalError()
        const bytes = Buffer.alloc(4097)
        const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
        if (bytesRead !== meta.size) throw new MigrationJournalError()
        return parseMigrationRecord(bytes.subarray(0, bytesRead).toString('utf8'))
      } finally {
        await file.close()
      }
    } catch {
      throw new MigrationJournalError()
    }
  }
  reserve(input: Omit<MigrationRecord, 'v' | 'revision' | 'phase'>): Promise<MigrationRecord> {
    return this.serial(async () => {
      const record = parseMigrationRecord(
        JSON.stringify({ v: 1, ...input, phase: 'reserved', revision: 1 })
      )
      await this.parent()
      const file = await fs.open(
        this.path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
      )
      try {
        await file.writeFile(JSON.stringify(record), 'utf8')
        await file.sync()
      } finally {
        await file.close()
      }
      await this.syncParent()
      return record
    })
  }
  private async expected(previous: MigrationRecord): Promise<MigrationRecord> {
    const current = await this.read()
    if (
      !current ||
      JSON.stringify(current) !== JSON.stringify(parseMigrationRecord(JSON.stringify(previous)))
    )
      throw new MigrationJournalError()
    return current
  }
  advance(previous: MigrationRecord, phase: MigrationPhase): Promise<MigrationRecord> {
    return this.serial(async () => {
      const current = await this.expected(previous)
      if (
        !TRANSITIONS[current.phase].includes(phase) ||
        current.revision === Number.MAX_SAFE_INTEGER
      )
        throw new MigrationJournalError()
      const next = parseMigrationRecord(
        JSON.stringify({ ...current, phase, revision: current.revision + 1 })
      )
      const temp = this.path + '.next-' + randomUUID()
      const file = await fs.open(
        temp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
      )
      try {
        await file.writeFile(JSON.stringify(next), 'utf8')
        await file.sync()
      } finally {
        await file.close()
      }
      await this.expected(previous)
      await fs.rename(temp, this.path)
      await this.syncParent()
      return next
    })
  }
  clearAfterCompensation(
    previous: MigrationRecord,
    proof: { apiRevoked: true; localRemoved: true }
  ): Promise<void> {
    return this.serial(async () => {
      const current = await this.expected(previous)
      if (
        current.phase !== 'compensating' ||
        proof.apiRevoked !== true ||
        proof.localRemoved !== true
      )
        throw new MigrationJournalError()
      await fs.unlink(this.path)
      await this.syncParent()
    })
  }
}

/** La intención se observa antes de cualquier identidad o registro legado, también al reiniciar. */
export function migrationStatusSource(
  journal: MigrationJournal,
  installed: AgentStatusSource
): AgentStatusSource {
  return {
    presence: async () => ((await journal.intentPresent()) ? 'installed' : installed.presence()),
    query: (signal) => installed.query(signal)
  }
}
