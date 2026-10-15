import { describe, it, expect } from 'vitest'
import { InputBackend, InputController } from '../controller'

/** Backend que apunta las llamadas. `Fn` no existe en este "sistema". */
function fakeBackend(textDelayMs = 0): InputBackend & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    move: (p) => calls.push(`move ${p.x},${p.y}`),
    button: (b, down) => calls.push(`button ${b} ${down ? 'down' : 'up'}`),
    wheel: (dx, dy) => calls.push(`wheel ${dx},${dy}`),
    key: (code, down) => {
      if (code === 'Fn') return false
      calls.push(`key ${code} ${down ? 'down' : 'up'}`)
      return true
    },
    text: async (text) => {
      if (textDelayMs) await new Promise((resolve) => setTimeout(resolve, textDelayMs))
      calls.push(`text ${text}`)
    },
    dispose: () => calls.push('dispose')
  }
}

describe('InputController', () => {
  it('las posiciones caen en la pantalla elegida; sin pantalla no se mueve nada', async () => {
    const backend = fakeBackend()
    const input = new InputController(backend)
    await input.apply({ type: 'move', x: 0.5, y: 0.5 })
    input.setDisplayRect({ x: 1920, y: 0, width: 1920, height: 1080 })
    await input.apply({ type: 'move', x: 0.5, y: 1 })
    expect(backend.calls).toEqual(['move 2880,1079'])
  })

  it('la rueda llega en píxeles', async () => {
    const backend = fakeBackend()
    const input = new InputController(backend)
    await input.apply({ type: 'wheel', dx: 0, dy: 3, mode: 1 })
    expect(backend.calls).toEqual(['wheel 0,100'])
  })

  it('release-all suelta solo lo que sigue pulsado', async () => {
    const backend = fakeBackend()
    const input = new InputController(backend)
    await input.apply({ type: 'key', code: 'ControlLeft', down: true })
    await input.apply({ type: 'key', code: 'KeyC', down: true })
    await input.apply({ type: 'key', code: 'KeyC', down: false })
    await input.apply({ type: 'button', button: 'left', down: true })
    backend.calls.length = 0
    await input.apply({ type: 'release-all' })
    expect(backend.calls).toEqual(['key ControlLeft up', 'button left up'])
    // Lo que llegue después para esas teclas ya no se envía
    backend.calls.length = 0
    await input.apply({ type: 'key', code: 'ControlLeft', down: false })
    await input.apply({ type: 'button', button: 'left', down: false })
    expect(backend.calls).toEqual([])
  })

  it('una tecla que no existe en el sistema no queda como pulsada', async () => {
    const backend = fakeBackend()
    const input = new InputController(backend)
    await input.apply({ type: 'key', code: 'Fn', down: true })
    await input.releaseAll()
    expect(backend.calls).toEqual([])
  })

  it('el texto respeta el orden aunque tarde, con Intro como tecla', async () => {
    const backend = fakeBackend(20)
    const input = new InputController(backend)
    const pending = [
      input.apply({ type: 'text', text: 'hola\nadiós' }),
      input.apply({ type: 'key', code: 'Enter', down: true }),
      input.apply({ type: 'key', code: 'Enter', down: false })
    ]
    await Promise.all(pending)
    expect(backend.calls).toEqual([
      'text hola',
      'key Enter down',
      'key Enter up',
      'text adiós',
      'key Enter down',
      'key Enter up'
    ])
  })

  it('dispose suelta lo pulsado, libera el backend y luego ignora todo', async () => {
    const backend = fakeBackend()
    const input = new InputController(backend)
    await input.apply({ type: 'key', code: 'ShiftLeft', down: true })
    await input.dispose()
    await input.apply({ type: 'key', code: 'KeyA', down: true })
    expect(backend.calls).toEqual(['key ShiftLeft down', 'key ShiftLeft up', 'dispose'])
  })

  it('un error del backend no bloquea los eventos siguientes', async () => {
    const backend = fakeBackend()
    backend.text = async () => {
      throw new Error('No free X11 keycode to type text')
    }
    const input = new InputController(backend)
    await expect(input.apply({ type: 'text', text: 'x' })).rejects.toThrow('No free')
    input.setDisplayRect({ x: 0, y: 0, width: 100, height: 100 })
    await input.apply({ type: 'move', x: 0, y: 0 })
    expect(backend.calls).toEqual(['move 0,0'])
  })
})
