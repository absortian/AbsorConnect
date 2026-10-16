import { describe, it, expect, vi } from 'vitest'
import { createHash, randomBytes } from 'crypto'
import { ViewerTransfers, TransferView } from '../transfers'
import { ChannelLike } from '../../host/transfers'
import { decodeChunk, encodeChunk, splitClipboard } from '../../../shared/remote/transfer'

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const sha = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

/** Canal con un PC de mentira al otro lado, que responde como HostTransfers. */
function channelWithPc(
  pc: (message: Record<string, unknown> | Uint8Array, reply: (data: unknown) => void) => void
): ChannelLike & { sent: unknown[] } {
  const channel: ChannelLike & { sent: unknown[] } = {
    readyState: 'open',
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    binaryType: 'blob',
    sent: [],
    onmessage: null,
    onbufferedamountlow: null,
    send(data: string | Uint8Array) {
      channel.sent.push(data)
      const reply = (answer: unknown): void =>
        void setTimeout(
          () =>
            channel.onmessage?.({
              data: typeof answer === 'string' ? answer : answer
            } as MessageEvent),
          0
        )
      pc(typeof data === 'string' ? JSON.parse(data) : data, reply)
    }
  }
  return channel
}

class FakeBridge {
  clipboardWatch = vi.fn(async () => undefined)
  clipboardWrite = vi.fn()
  saveBegin = vi.fn(
    async (): Promise<{ ok: true } | { ok: false; reason: 'cancelled' | 'io' }> => ({ ok: true })
  )
  saveChunk = vi.fn()
  saveFinish = vi.fn(async () => ({ ok: true as const, path: '/home/ana/Descargas/datos.bin' }))
  saveCancel = vi.fn()
}

interface Setup {
  b: FakeBridge
  control: ChannelLike & { sent: unknown[] }
  transfers: ViewerTransfers
  last: (id: number) => TransferView | undefined
}

function setup(channel: ChannelLike): Setup {
  const b = new FakeBridge()
  const control = channelWithPc(() => undefined)
  const changes: TransferView[] = []
  const transfers = new ViewerTransfers({
    bridge: b,
    control: () => control,
    onChange: (t) => changes.push(t)
  })
  transfers.attach(channel)
  const last = (id: number): TransferView | undefined => changes.filter((c) => c.id === id).at(-1)
  return { b, control, transfers, last }
}

describe('ViewerTransfers', () => {
  it('envía dos ficheros en orden, con su resumen, y el PC confirma el nombre guardado', async () => {
    const received = new Map<number, Uint8Array[]>()
    const channel = channelWithPc((message, reply) => {
      if (message instanceof Uint8Array) {
        const chunk = decodeChunk(message)!
        received.set(chunk.id, [...(received.get(chunk.id) ?? []), chunk.data])
        return
      }
      if (message.type === 'file-offer')
        reply(JSON.stringify({ type: 'file-accept', id: message.id }))
      if (message.type === 'file-end') {
        const data = Buffer.concat(received.get(message.id as number) ?? [])
        const ok = sha(data) === message.sha256
        reply(
          JSON.stringify(
            ok
              ? { type: 'file-done', id: message.id, name: `guardado-${message.id}` }
              : { type: 'file-error', id: message.id, reason: 'integrity' }
          )
        )
      }
    })
    const { transfers, last } = setup(channel)
    const first = new Uint8Array(randomBytes(200_000))
    const second = new Uint8Array(randomBytes(70_000))
    transfers.upload([new File([first], 'uno.bin'), new File([second], 'dos.bin')])
    await tick(50)
    expect(last(1)).toMatchObject({ status: 'done', result: 'guardado-1', bytes: 200_000 })
    expect(last(2)).toMatchObject({ status: 'done', result: 'guardado-2', bytes: 70_000 })
    expect(Buffer.concat(received.get(1)!).equals(Buffer.from(first))).toBe(true)
    // Nunca un trozo de más de 64 KB
    expect(Math.max(...[...received.values()].flat().map((c) => c.length))).toBeLessThanOrEqual(
      65_536
    )
  })

  it('si el PC rechaza el envío (ficheros desactivados), falla con el motivo', async () => {
    const channel = channelWithPc((message, reply) => {
      if (!(message instanceof Uint8Array) && message.type === 'file-offer') {
        reply(JSON.stringify({ type: 'file-reject', id: message.id, reason: 'disabled' }))
      }
    })
    const { transfers, last } = setup(channel)
    transfers.upload([new File([new Uint8Array(10)], 'a.txt')])
    await tick(20)
    expect(last(1)).toMatchObject({ status: 'failed', error: 'disabled' })
  })

  it('descarga: pide dónde guardar, escribe los trozos y comprueba el resumen al final', async () => {
    const data = new Uint8Array(randomBytes(150_000))
    const channel = channelWithPc((message, reply) => {
      if (message instanceof Uint8Array || message.type !== 'file-request') return
      const id = message.id as number
      reply(JSON.stringify({ type: 'file-start', id, name: 'datos.bin', size: data.length }))
      for (let o = 0; o < data.length; o += 65_536)
        reply(encodeChunk(id, data.subarray(o, o + 65_536)).buffer)
      reply(JSON.stringify({ type: 'file-end', id, sha256: sha(data) }))
    })
    const { b, transfers, last } = setup(channel)
    transfers.download('/home/ana/datos.bin', 'datos.bin', data.length)
    await tick(30)
    expect(b.saveBegin).toHaveBeenCalledWith(1, 'datos.bin', data.length)
    expect(
      Buffer.concat(b.saveChunk.mock.calls.map((c) => Buffer.from(c[1] as Uint8Array))).equals(
        Buffer.from(data)
      )
    ).toBe(true)
    expect(b.saveFinish).toHaveBeenCalledWith(1, sha(data))
    expect(last(1)).toMatchObject({
      status: 'done',
      result: '/home/ana/Descargas/datos.bin',
      bytes: data.length
    })
  })

  it('cancelar en el diálogo de guardar no pide nada al PC', async () => {
    const channel = channelWithPc(() => undefined)
    const { b, transfers, last } = setup(channel)
    b.saveBegin.mockResolvedValueOnce({ ok: false, reason: 'cancelled' })
    transfers.download('/x', 'x', 1)
    await tick(10)
    expect(last(1)?.status).toBe('cancelled')
    expect((channel as unknown as { sent: unknown[] }).sent).toEqual([])
  })

  it('al perder la conexión, lo que estaba en marcha falla y la descarga a medias se borra', async () => {
    const channel = channelWithPc(() => undefined)
    const { b, transfers, last } = setup(channel)
    transfers.download('/x', 'x.bin', 10)
    await tick(10)
    transfers.detach()
    expect(last(1)).toMatchObject({ status: 'failed', error: 'connection_lost' })
    expect(b.saveCancel).toHaveBeenCalledWith(1)
  })

  it('el portapapeles en pausa ni se envía ni se recibe', async () => {
    const { b, control, transfers } = setup(channelWithPc(() => undefined))
    transfers.setClipboardEnabled(true)
    expect(b.clipboardWatch).toHaveBeenLastCalledWith(true)
    transfers.setClipboardPaused(true)
    expect(b.clipboardWatch).toHaveBeenLastCalledWith(false)
    transfers.onClipboardPiece(splitClipboard(1, { kind: 'text', text: 'del PC' })[0])
    await transfers.sendClipboard({ kind: 'image', png: new Uint8Array([1, 2, 3]) })
    expect(b.clipboardWrite).not.toHaveBeenCalled()
    expect(control.sent).toEqual([])

    transfers.setClipboardPaused(false)
    transfers.onClipboardPiece(splitClipboard(2, { kind: 'text', text: 'del PC' })[0])
    await transfers.sendClipboard({ kind: 'text', text: 'de aquí' })
    expect(b.clipboardWrite).toHaveBeenCalledWith({ kind: 'text', text: 'del PC' })
    expect(JSON.parse(control.sent[0] as string)).toMatchObject({
      type: 'clipboard',
      data: 'de aquí'
    })
  })
})
