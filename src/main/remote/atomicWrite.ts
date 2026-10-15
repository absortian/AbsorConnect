import * as fs from 'fs/promises'

/** Escribe un fichero de forma atómica y con permisos 0600 (secretos del control remoto). */
export async function writeAtomic(path: string, contents: string): Promise<void> {
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, contents, { encoding: 'utf-8', mode: 0o600 })
  await fs.rename(tmp, path)
}
