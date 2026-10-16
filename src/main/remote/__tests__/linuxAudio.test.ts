import { describe, it, expect, vi, afterEach } from 'vitest'
import { LINUX_AUDIO_LABEL, LINUX_AUDIO_SOURCE, LinuxAudio, Pactl } from '../linuxAudio'

/** pactl de mentira: anota las órdenes y responde según la salida por defecto de cada momento. */
function fakePactl(initialSink = 'alsa_output.analog'): {
  pactl: Pactl
  calls: string[][]
  setSink: (sink: string) => void
} {
  let sink = initialSink
  let next = 30
  const calls: string[][] = []
  const pactl: Pactl = async (args) => {
    calls.push(args)
    if (args[0] === 'get-default-sink') return `${sink}\n`
    if (args[0] === 'load-module') return `${next++}\n`
    if (args[0] === 'list') {
      return [
        '12\tmodule-null-sink\tsink_name=otra',
        `27\tmodule-remap-source\tmaster=viejo.monitor source_name=${LINUX_AUDIO_SOURCE}`,
        ''
      ].join('\n')
    }
    return ''
  }
  return { pactl, calls, setSink: (value) => (sink = value) }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('LinuxAudio', () => {
  it('crea la fuente sobre el monitor de la salida por defecto y la quita al terminar', async () => {
    const { pactl, calls } = fakePactl()
    const audio = new LinuxAudio(pactl)

    expect(await audio.start(() => undefined)).toBe(LINUX_AUDIO_LABEL)
    expect(calls).toContainEqual([
      'load-module',
      'module-remap-source',
      'master=alsa_output.analog.monitor',
      `source_name=${LINUX_AUDIO_SOURCE}`,
      `source_properties='device.description="${LINUX_AUDIO_LABEL}"'`
    ])

    // Una segunda petición en la misma sesión no crea otra
    await audio.start(() => undefined)
    expect(calls.filter((c) => c[0] === 'load-module')).toHaveLength(1)

    await audio.stop()
    expect(calls.at(-1)).toEqual(['unload-module', '30'])
  })

  it('si cambia la salida por defecto, vuelve a crear la fuente y avisa', async () => {
    vi.useFakeTimers()
    const { pactl, calls, setSink } = fakePactl()
    const audio = new LinuxAudio(pactl)
    const changed = vi.fn()
    await audio.start(changed)

    await vi.advanceTimersByTimeAsync(3000)
    expect(changed).not.toHaveBeenCalled()

    setSink('bluez_output.auriculares')
    await vi.advanceTimersByTimeAsync(3000)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(calls).toContainEqual(['unload-module', '30'])
    expect(calls.filter((c) => c[0] === 'load-module').at(-1)?.[2]).toBe(
      'master=bluez_output.auriculares.monitor'
    )

    // Después de terminar ya no se vigila
    await audio.stop()
    const count = calls.length
    setSink('otra')
    await vi.advanceTimersByTimeAsync(9000)
    expect(calls.length).toBe(count)
  })

  it('al arrancar quita solo las fuentes que quedaron de Absor Connect', async () => {
    const { pactl, calls } = fakePactl()
    await new LinuxAudio(pactl).cleanup()
    expect(calls.filter((c) => c[0] === 'unload-module')).toEqual([['unload-module', '27']])
  })

  it('sin pactl o sin servidor de sonido no hay fuente', async () => {
    const failing: Pactl = async () => {
      throw new Error('pactl: not found')
    }
    const audio = new LinuxAudio(failing)
    expect(await audio.available()).toBe(false)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await audio.start(() => undefined)).toBeNull()
  })

  it('con un pactl antiguo lee la salida por defecto de `pactl info`', async () => {
    const calls: string[][] = []
    const pactl: Pactl = async (args) => {
      calls.push(args)
      if (args[0] === 'get-default-sink') throw new Error('unknown command')
      if (args[0] === 'info') return 'Server Name: pulseaudio\nDefault Sink: alsa_output.viejo\n'
      return '7\n'
    }
    expect(await new LinuxAudio(pactl).start(() => undefined)).toBe(LINUX_AUDIO_LABEL)
    expect(calls.find((c) => c[0] === 'load-module')?.[2]).toBe('master=alsa_output.viejo.monitor')
  })
})
