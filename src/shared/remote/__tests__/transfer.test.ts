import { describe, it, expect } from 'vitest'
import { randomBytes } from 'crypto'
import {
  CHUNK_BYTES,
  CLIPBOARD_PIECE_CHARS,
  ClipboardAssembler,
  decodeChunk,
  encodeChunk,
  parseClipboardPiece,
  parseTransferMessage,
  splitClipboard
} from '../transfer'

const SHA = 'a'.repeat(64)

describe('mensajes del canal de ficheros', () => {
  it('acepta los mensajes válidos', () => {
    expect(
      parseTransferMessage(
        JSON.stringify({ type: 'file-offer', id: 1, name: 'informe.pdf', size: 10 })
      )
    ).toEqual({
      type: 'file-offer',
      id: 1,
      name: 'informe.pdf',
      size: 10
    })
    expect(parseTransferMessage(JSON.stringify({ type: 'file-end', id: 7, sha256: SHA }))).toEqual({
      type: 'file-end',
      id: 7,
      sha256: SHA
    })
    expect(
      parseTransferMessage(
        JSON.stringify({
          type: 'fs-entries',
          id: 3,
          path: '/home/ana',
          parent: '/home',
          entries: [{ name: 'a.txt', dir: false, size: 3, mtime: 1 }]
        })
      )
    ).toMatchObject({ type: 'fs-entries', parent: '/home', entries: [{ name: 'a.txt' }] })
  })

  it('rechaza ids, tamaños, resúmenes y motivos no válidos', () => {
    const bad = [
      'no es json',
      JSON.stringify([1]),
      JSON.stringify({ type: 'file-offer', id: 0, name: 'a', size: 1 }),
      JSON.stringify({ type: 'file-offer', id: 1.5, name: 'a', size: 1 }),
      JSON.stringify({ type: 'file-offer', id: 1, name: '', size: 1 }),
      JSON.stringify({ type: 'file-offer', id: 1, name: 'x'.repeat(256), size: 1 }),
      JSON.stringify({ type: 'file-offer', id: 1, name: 'a', size: -1 }),
      JSON.stringify({ type: 'file-end', id: 1, sha256: 'ABC' }),
      JSON.stringify({ type: 'file-reject', id: 1, reason: 'porque sí' }),
      JSON.stringify({ type: 'fs-list', id: 1, path: 'x'.repeat(5000) }),
      JSON.stringify({ type: 'desconocido', id: 1 })
    ]
    for (const raw of bad) expect(parseTransferMessage(raw)).toBeNull()
  })
})

describe('trozos binarios', () => {
  it('llevan el id delante y se recuperan igual', () => {
    const data = new Uint8Array(randomBytes(1000))
    const frame = encodeChunk(0xdeadbeef, data)
    const decoded = decodeChunk(frame.buffer as ArrayBuffer)
    expect(decoded?.id).toBe(0xdeadbeef)
    expect(Array.from(decoded!.data)).toEqual(Array.from(data))
  })

  it('rechaza trozos demasiado grandes o sin id', () => {
    expect(decodeChunk(new Uint8Array(3))).toBeNull()
    expect(decodeChunk(new Uint8Array(4))).toBeNull()
    expect(decodeChunk(encodeChunk(1, new Uint8Array(CHUNK_BYTES + 1)))).toBeNull()
  })
})

describe('portapapeles en trozos', () => {
  it('un texto largo se parte y se vuelve a juntar', () => {
    const text = 'ñ€'.repeat(100_000)
    const pieces = splitClipboard(5, { kind: 'text', text })
    expect(pieces.length).toBe(Math.ceil(text.length / CLIPBOARD_PIECE_CHARS))
    const assembler = new ClipboardAssembler()
    let result = null
    for (const piece of pieces)
      result = assembler.add(parseClipboardPiece(JSON.parse(JSON.stringify(piece)))!)
    expect(result).toEqual({ kind: 'text', text })
  })

  it('una imagen PNG va en base64 y llega con los mismos bytes', () => {
    const png = new Uint8Array(randomBytes(300_000))
    const assembler = new ClipboardAssembler()
    let result = null
    for (const piece of splitClipboard(9, { kind: 'image', png })) result = assembler.add(piece)
    expect(result?.kind).toBe('image')
    expect(Array.from((result as { png: Uint8Array }).png)).toEqual(Array.from(png))
  })

  it('no envía lo que pasa de los límites', () => {
    expect(splitClipboard(1, { kind: 'text', text: 'a'.repeat(1024 * 1024 + 1) })).toEqual([])
    expect(splitClipboard(1, { kind: 'image', png: new Uint8Array(10 * 1024 * 1024 + 1) })).toEqual(
      []
    )
    expect(splitClipboard(1, { kind: 'text', text: '' })).toEqual([])
  })

  it('un envío nuevo descarta el que quedó a medias', () => {
    const assembler = new ClipboardAssembler()
    const first = splitClipboard(1, { kind: 'text', text: 'x'.repeat(CLIPBOARD_PIECE_CHARS * 2) })
    assembler.add(first[0])
    expect(assembler.add({ ...splitClipboard(2, { kind: 'text', text: 'hola' })[0] })).toEqual({
      kind: 'text',
      text: 'hola'
    })
    expect(assembler.add(first[1])).toBeNull()
  })

  it('rechaza trozos mal formados', () => {
    expect(
      parseClipboardPiece({ type: 'clipboard', id: 1, kind: 'text', index: 1, count: 1, data: 'a' })
    ).toBeNull()
    expect(
      parseClipboardPiece({ type: 'clipboard', id: 1, kind: 'pdf', index: 0, count: 1, data: 'a' })
    ).toBeNull()
    expect(
      parseClipboardPiece({
        type: 'clipboard',
        id: 1,
        kind: 'text',
        index: 0,
        count: 1,
        data: 'a'.repeat(CLIPBOARD_PIECE_CHARS + 1)
      })
    ).toBeNull()
  })
})
