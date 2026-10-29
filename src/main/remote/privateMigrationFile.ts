// Lectura de origen para migración; no repara, crea ni sustituye archivos ilegibles.
import { constants } from 'fs'
import * as fs from 'fs/promises'
export class MigrationSourceError extends Error {
  constructor() {
    super('agent_migration_local_state_unverified')
  }
}
export async function readPrivateMigrationJson(path: string, maximum: number): Promise<unknown> {
  try {
    // Un adaptador ACL final debe verificar Windows; los permisos POSIX no lo acreditan.
    if (process.platform === 'win32') throw new MigrationSourceError()
    const meta = await fs.lstat(path)
    if (
      !meta.isFile() ||
      meta.nlink !== 1 ||
      (meta.mode & 0o7777) !== 0o600 ||
      meta.size < 1 ||
      meta.size > maximum ||
      (process.getuid && meta.uid !== process.getuid())
    )
      throw new MigrationSourceError()
    const file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const opened = await file.stat()
      if (opened.ino !== meta.ino || opened.dev !== meta.dev) throw new MigrationSourceError()
      const bytes = Buffer.alloc(maximum + 1)
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
      if (bytesRead !== meta.size) throw new MigrationSourceError()
      const raw = bytes.subarray(0, bytesRead).toString('utf8').trim()
      const value: unknown = JSON.parse(raw)
      // Los dos formatos escritos por la app; rechaza duplicados y codificaciones ambiguas.
      if (raw !== JSON.stringify(value) && raw !== JSON.stringify(value, null, 2))
        throw new MigrationSourceError()
      return value
    } finally {
      await file.close()
    }
  } catch {
    throw new MigrationSourceError()
  }
}
