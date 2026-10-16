import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash, randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { HostFiles, sanitizeFileName } from '../fileTransfer'

let dir: string
let receive: string
const sha = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'absor-files-'))
  receive = path.join(dir, 'Descargas', 'Absor Connect')
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** Envía un fichero entero en trozos de 64 KB, como haría el visor. */
async function upload(
  files: HostFiles,
  id: number,
  name: string,
  data: Uint8Array,
  hash = sha(data)
): ReturnType<HostFiles['finish']> {
  expect(await files.begin(id, name, data.length)).toEqual({ ok: true })
  for (let offset = 0; offset < data.length; offset += 65_536) {
    files.write(id, data.subarray(offset, offset + 65_536))
  }
  return files.finish(id, name, hash)
}

describe('HostFiles — ficheros recibidos', () => {
  it('se guardan en la carpeta de recepción con su contenido íntegro y sin .part', async () => {
    const files = new HostFiles(receive)
    const data = new Uint8Array(randomBytes(300_000))
    expect(await upload(files, 1, 'informe.pdf', data)).toEqual({ ok: true, name: 'informe.pdf' })
    expect(sha(await fs.readFile(path.join(receive, 'informe.pdf')))).toBe(sha(data))
    expect(await fs.readdir(receive)).toEqual(['informe.pdf'])
  })

  it('nombre repetido: el nuevo se guarda con otro nombre y el existente no cambia', async () => {
    const files = new HostFiles(receive)
    await fs.mkdir(receive, { recursive: true })
    await fs.writeFile(path.join(receive, 'informe.pdf'), 'el de antes')
    const result = await upload(files, 2, 'informe.pdf', new Uint8Array(randomBytes(10)))
    expect(result).toEqual({ ok: true, name: 'informe (1).pdf' })
    expect(await fs.readFile(path.join(receive, 'informe.pdf'), 'utf8')).toBe('el de antes')
    expect((await upload(files, 3, 'informe.pdf', new Uint8Array(1))).ok && 'informe (2).pdf').toBe(
      'informe (2).pdf'
    )
  })

  it('si el resumen no coincide no queda nada', async () => {
    const files = new HostFiles(receive)
    const result = await upload(
      files,
      4,
      'roto.bin',
      new Uint8Array(randomBytes(1000)),
      'b'.repeat(64)
    )
    expect(result).toEqual({ ok: false, reason: 'integrity' })
    expect(await fs.readdir(receive)).toEqual([])
  })

  it('más datos de los anunciados: error y nada guardado', async () => {
    const files = new HostFiles(receive)
    await files.begin(5, 'a.bin', 10)
    files.write(5, new Uint8Array(20))
    expect(await files.finish(5, 'a.bin', sha(new Uint8Array(20)))).toEqual({
      ok: false,
      reason: 'size'
    })
    expect(await fs.readdir(receive)).toEqual([])
  })

  it('cancelar borra el .part', async () => {
    const files = new HostFiles(receive)
    await files.begin(6, 'grande.iso', 1_000_000)
    files.write(6, new Uint8Array(65_536))
    await files.cancel(6)
    expect(await fs.readdir(receive)).toEqual([])
  })

  it('los nombres se limpian para cualquier sistema', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFileName('C:\\Windows\\win.ini')).toBe('win.ini')
    expect(sanitizeFileName('a<b>c:d"e|f?g*h.txt')).toBe('a_b_c_d_e_f_g_h.txt')
    expect(sanitizeFileName('CON')).toBe('_CON')
    expect(sanitizeFileName('nul.txt')).toBe('_nul.txt')
    expect(sanitizeFileName('nombre. . ')).toBe('nombre')
    expect(sanitizeFileName('..')).toBe('fichero')
    expect(sanitizeFileName('x'.repeat(300) + '.pdf')).toHaveLength(200)
    expect(sanitizeFileName('x'.repeat(300) + '.pdf').endsWith('.pdf')).toBe(true)
  })
})

describe('HostFiles — carpetas y descargas', () => {
  it('lista carpetas primero y en orden natural, y sube a la carpeta de arriba', async () => {
    await fs.mkdir(path.join(dir, 'Fotos'))
    await fs.writeFile(path.join(dir, 'b10.txt'), 'x')
    await fs.writeFile(path.join(dir, 'b2.txt'), 'xy')
    const listing = await new HostFiles(receive, dir).list('')
    expect(listing.path).toBe(dir)
    expect(listing.parent).toBe(path.dirname(dir))
    expect(listing.entries.map((e) => e.name)).toEqual(['Fotos', 'b2.txt', 'b10.txt'])
    expect(listing.entries[1]).toMatchObject({ dir: false, size: 2 })
  })

  it('una carpeta que no existe da un error, no una excepción', async () => {
    expect(await new HostFiles(receive, dir).list(path.join(dir, 'no-existe'))).toMatchObject({
      entries: [],
      error: 'not_found'
    })
  })

  it('lee un fichero por trozos y da su resumen', async () => {
    const data = new Uint8Array(randomBytes(200_000))
    await fs.writeFile(path.join(dir, 'datos.bin'), data)
    const files = new HostFiles(receive, dir)
    expect(await files.open(1, path.join(dir, 'datos.bin'))).toEqual({
      ok: true,
      name: 'datos.bin',
      size: data.length
    })
    const parts: Uint8Array[] = []
    for (let chunk = await files.read(1); chunk; chunk = await files.read(1)) parts.push(chunk)
    expect(Buffer.concat(parts).equals(Buffer.from(data))).toBe(true)
    expect(await files.close(1)).toBe(sha(data))
  })

  it('no se puede descargar una carpeta ni algo que no existe', async () => {
    const files = new HostFiles(receive, dir)
    expect(await files.open(1, dir)).toEqual({ ok: false, reason: 'is_directory' })
    expect(await files.open(2, path.join(dir, 'nada'))).toEqual({ ok: false, reason: 'not_found' })
  })
})
