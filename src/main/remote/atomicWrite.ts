import * as fs from 'fs/promises'

// Escrituras en curso por fichero: dos a la vez sobre el mismo `.tmp` se pisan (la segunda falla al
// renombrar un `.tmp` que ya no existe) y además podrían dejar el contenido viejo encima del nuevo.
// Se encolan en el orden en que se piden.
const queues = new Map<string, Promise<void>>()

async function write(path: string, contents: string): Promise<void> {
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, contents, { encoding: 'utf-8', mode: 0o600 })
  await fs.rename(tmp, path)
}

/** Escribe un fichero de forma atómica y con permisos 0600 (secretos del control remoto). */
export function writeAtomic(path: string, contents: string): Promise<void> {
  const next = (queues.get(path) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => write(path, contents))
  queues.set(path, next)
  const done = (): void => {
    if (queues.get(path) === next) queues.delete(path)
  }
  next.then(done, done)
  return next
}
