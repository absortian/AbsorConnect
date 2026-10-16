import { describe, it, expect, vi, afterEach } from 'vitest'
import { ClipboardApi, ClipboardWatcher } from '../clipboardSync'

/** Portapapeles de mentira: texto, o una "imagen" con su mapa de bits y su PNG. */
function fakeClipboard(): ClipboardApi & { text: string; image: Buffer | null } {
  const state = {
    text: '',
    image: null as Buffer | null,
    readText: () => state.text,
    readImage: () => ({
      isEmpty: () => state.image === null,
      getSize: () => ({ width: 2, height: 2 }),
      toBitmap: () => state.image ?? Buffer.alloc(0),
      toPNG: () => Buffer.concat([Buffer.from('PNG'), state.image ?? Buffer.alloc(0)])
    }),
    writeText: (text: string) => {
      state.text = text
      state.image = null
    },
    writeImagePng: (png: Uint8Array) => {
      state.text = ''
      state.image = Buffer.from(png).subarray(3)
    }
  }
  return state
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ClipboardWatcher', () => {
  it('no envía lo que ya estaba copiado y sí lo que se copia después', async () => {
    vi.useFakeTimers()
    const clip = fakeClipboard()
    clip.text = 'de antes'
    const changes = vi.fn()
    const watcher = new ClipboardWatcher(changes, clip)
    watcher.start()
    await vi.advanceTimersByTimeAsync(3000)
    expect(changes).not.toHaveBeenCalled()

    clip.text = 'nuevo'
    await vi.advanceTimersByTimeAsync(1000)
    expect(changes).toHaveBeenCalledWith({ kind: 'text', text: 'nuevo' })
    await vi.advanceTimersByTimeAsync(3000)
    expect(changes).toHaveBeenCalledTimes(1)
    watcher.stop()
  })

  it('lo que llega del otro equipo no se reenvía', async () => {
    vi.useFakeTimers()
    const clip = fakeClipboard()
    const changes = vi.fn()
    const watcher = new ClipboardWatcher(changes, clip)
    watcher.start()
    watcher.write({ kind: 'text', text: 'del otro equipo' })
    watcher.write({ kind: 'image', png: new Uint8Array([80, 78, 71, 1, 2, 3]) })
    await vi.advanceTimersByTimeAsync(3000)
    expect(changes).not.toHaveBeenCalled()
    expect(clip.image).toEqual(Buffer.from([1, 2, 3]))
    watcher.stop()
  })

  it('una imagen copiada se envía en PNG; un texto demasiado grande, no', async () => {
    vi.useFakeTimers()
    const clip = fakeClipboard()
    const changes = vi.fn()
    const watcher = new ClipboardWatcher(changes, clip)
    watcher.start()
    clip.image = Buffer.from([9, 9, 9, 9])
    await vi.advanceTimersByTimeAsync(1000)
    expect(changes).toHaveBeenLastCalledWith({
      kind: 'image',
      png: new Uint8Array(Buffer.from('PNG\u0009\u0009\u0009\u0009'))
    })
    clip.text = 'x'.repeat(1024 * 1024 + 1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(changes).toHaveBeenCalledTimes(1)
    watcher.stop()
  })

  it('parado no mira el portapapeles', async () => {
    vi.useFakeTimers()
    const clip = fakeClipboard()
    const changes = vi.fn()
    const watcher = new ClipboardWatcher(changes, clip)
    watcher.start()
    watcher.stop()
    clip.text = 'otro'
    await vi.advanceTimersByTimeAsync(3000)
    expect(changes).not.toHaveBeenCalled()
  })
})
