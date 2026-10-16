import { describe, it, expect, vi } from 'vitest'
import { ChannelLike, HostTransfers } from '../transfers'
import { decodeChunk, encodeChunk, splitClipboard } from '../../../shared/remote/transfer'

const SHA = 'c'.repeat(64)

/** Canal de mentira: guarda lo enviado y deja simular lo recibido. */
function fakeChannel(): ChannelLike & {
  sent: (string | Uint8Array)[]
  receive(data: unknown): Promise<void>
} {
  const channel = {
    readyState: 'open',
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    binaryType: 'blob',
    sent: [] as (string | Uint8Array)[],
    send: (data: string | Uint8Array) => void channel.sent.push(data),
    onmessage: null as ((event: MessageEvent) => void) | null,
    onbufferedamountlow: null as ((event: Event) => void) | null,
    async receive(data: unknown) {
      channel.onmessage?.({ data } as MessageEvent)
      // Deja terminar las promesas del manejador
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  return channel
}

class FakeHost {
  clipboardWrite = vi.fn()
  fileBegin = vi.fn(async () => ({ ok: true as const }))
  fileChunk = vi.fn()
  fileFinish = vi.fn(async () => ({ ok: true as const, name: 'informe (1).pdf' }))
  fileCancel = vi.fn()
  fsList = vi.fn(async (path: string) => ({ path, parent: null, entries: [] }))
  fileOpen = vi.fn(async () => ({ ok: true as const, name: 'datos.bin', size: 6 }))
  fileRead = vi
    .fn<() => Promise<Uint8Array | null>>()
    .mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
    .mockResolvedValueOnce(new Uint8Array([4, 5, 6]))
    .mockResolvedValue(null)
  fileClose = vi.fn(async () => SHA)
}

type FakeChannel = ReturnType<typeof fakeChannel>

interface Setup {
  host: FakeHost
  channel: FakeChannel
  control: FakeChannel
  transfers: HostTransfers
  state: { authenticated: boolean }
  messages: () => Record<string, unknown>[]
}

function setup(
  options: { authenticated?: boolean; files?: boolean; clipboard?: boolean } = {}
): Setup {
  const host = new FakeHost()
  const channel = fakeChannel()
  const control = fakeChannel()
  const state = { authenticated: options.authenticated ?? true }
  const transfers = new HostTransfers({
    host,
    authenticated: () => state.authenticated,
    features: () => ({ files: options.files ?? true, clipboard: options.clipboard ?? true }),
    control: () => control
  })
  transfers.attach(channel)
  const messages = (): Record<string, unknown>[] =>
    channel.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d))
  return { host, channel, control, transfers, state, messages }
}

describe('HostTransfers (ventana host)', () => {
  it('antes de autenticar descarta ofertas, trozos, listados y portapapeles', async () => {
    const { host, channel, transfers, messages } = setup({ authenticated: false })
    await channel.receive(JSON.stringify({ type: 'file-offer', id: 1, name: 'a.txt', size: 3 }))
    await channel.receive(encodeChunk(1, new Uint8Array(3)).buffer)
    await channel.receive(JSON.stringify({ type: 'fs-list', id: 2, path: '' }))
    await channel.receive(JSON.stringify({ type: 'file-request', id: 3, path: '/etc/hosts' }))
    transfers.onClipboardPiece(splitClipboard(1, { kind: 'text', text: 'hola' })[0])
    expect(host.fileBegin).not.toHaveBeenCalled()
    expect(host.fileChunk).not.toHaveBeenCalled()
    expect(host.fsList).not.toHaveBeenCalled()
    expect(host.fileOpen).not.toHaveBeenCalled()
    expect(host.clipboardWrite).not.toHaveBeenCalled()
    expect(messages()).toEqual([])
  })

  it('un envío completo: aceptar, escribir los trozos y confirmar con el nombre guardado', async () => {
    const { host, channel, messages } = setup()
    await channel.receive(
      JSON.stringify({ type: 'file-offer', id: 1, name: 'informe.pdf', size: 3 })
    )
    await channel.receive(encodeChunk(1, new Uint8Array([7, 8, 9])).buffer)
    // Un trozo de otra transferencia que no existe se ignora
    await channel.receive(encodeChunk(99, new Uint8Array([1])).buffer)
    await channel.receive(JSON.stringify({ type: 'file-end', id: 1, sha256: SHA }))
    expect(host.fileBegin).toHaveBeenCalledWith(1, 'informe.pdf', 3)
    expect(host.fileChunk).toHaveBeenCalledTimes(1)
    expect(host.fileFinish).toHaveBeenCalledWith(1, 'informe.pdf', SHA)
    expect(messages()).toEqual([
      { type: 'file-accept', id: 1 },
      { type: 'file-done', id: 1, name: 'informe (1).pdf' }
    ])
  })

  it('con los ficheros desactivados se rechaza todo y no se toca el disco', async () => {
    const { host, channel, messages } = setup({ files: false })
    await channel.receive(JSON.stringify({ type: 'file-offer', id: 1, name: 'a.txt', size: 1 }))
    await channel.receive(JSON.stringify({ type: 'file-request', id: 2, path: '/x' }))
    await channel.receive(JSON.stringify({ type: 'fs-list', id: 3, path: '' }))
    expect(host.fileBegin).not.toHaveBeenCalled()
    expect(host.fileOpen).not.toHaveBeenCalled()
    expect(host.fsList).not.toHaveBeenCalled()
    expect(messages()).toEqual([
      { type: 'file-reject', id: 1, reason: 'disabled' },
      { type: 'file-reject', id: 2, reason: 'disabled' },
      { type: 'fs-entries', id: 3, path: '', parent: null, entries: [], error: 'disabled' }
    ])
  })

  it('una descarga manda el inicio, los trozos con su id y el resumen al final', async () => {
    const { channel, messages } = setup()
    await channel.receive(
      JSON.stringify({ type: 'file-request', id: 4, path: '/home/ana/datos.bin' })
    )
    await new Promise((resolve) => setTimeout(resolve, 10))
    const chunks = channel.sent
      .filter((d): d is Uint8Array => d instanceof Uint8Array)
      .map((d) => decodeChunk(d))
    expect(chunks.map((c) => [c?.id, Array.from(c!.data)])).toEqual([
      [4, [1, 2, 3]],
      [4, [4, 5, 6]]
    ])
    expect(messages()).toEqual([
      { type: 'file-start', id: 4, name: 'datos.bin', size: 6 },
      { type: 'file-end', id: 4, sha256: SHA }
    ])
  })

  it('cancelar un envío lo quita en el proceso principal', async () => {
    const { host, channel } = setup()
    await channel.receive(JSON.stringify({ type: 'file-offer', id: 1, name: 'a.bin', size: 10 }))
    await channel.receive(JSON.stringify({ type: 'file-cancel', id: 1 }))
    expect(host.fileCancel).toHaveBeenCalledWith(1)
    await channel.receive(encodeChunk(1, new Uint8Array(1)).buffer)
    expect(host.fileChunk).not.toHaveBeenCalled()
  })

  it('el portapapeles va y viene en trozos solo si está permitido', async () => {
    const { host, control, transfers } = setup()
    transfers.onClipboardPiece(splitClipboard(1, { kind: 'text', text: 'hola' })[0])
    expect(host.clipboardWrite).toHaveBeenCalledWith({ kind: 'text', text: 'hola' })
    await transfers.sendClipboard({ kind: 'text', text: 'adiós' })
    expect(JSON.parse(control.sent[0] as string)).toMatchObject({
      type: 'clipboard',
      kind: 'text',
      data: 'adiós'
    })

    const off = setup({ clipboard: false })
    off.transfers.onClipboardPiece(splitClipboard(1, { kind: 'text', text: 'hola' })[0])
    await off.transfers.sendClipboard({ kind: 'text', text: 'adiós' })
    expect(off.host.clipboardWrite).not.toHaveBeenCalled()
    expect(off.control.sent).toEqual([])
  })
})
