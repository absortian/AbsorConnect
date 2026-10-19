import { describe, it, expect } from 'vitest'
import {
  parsePrivilegedRequest,
  parsePrivilegedResponse,
  MAX_NOTICE_NAME_LENGTH
} from '../privilegedHost'

const TOKEN = 'token-efimero'

describe('privilegedHost — peticiones de la app', () => {
  it('acepta attach con pantalla y nombre del controlador', () => {
    expect(
      parsePrivilegedRequest({
        type: 'attach',
        token: TOKEN,
        display: '1',
        controllerName: 'Portátil'
      })
    ).toEqual({
      type: 'attach',
      token: TOKEN,
      display: '1',
      controllerName: 'Portátil'
    })
  })

  it('acepta detach, select-display, input y notice', () => {
    expect(parsePrivilegedRequest({ type: 'detach', token: TOKEN })).toEqual({
      type: 'detach',
      token: TOKEN
    })
    expect(parsePrivilegedRequest({ type: 'select-display', token: TOKEN, display: '2' })).toEqual({
      type: 'select-display',
      token: TOKEN,
      display: '2'
    })
    const input = {
      type: 'input',
      token: TOKEN,
      event: { type: 'button', button: 'left', down: true }
    }
    expect(parsePrivilegedRequest(input)).toEqual(input)
    expect(
      parsePrivilegedRequest({ type: 'notice', token: TOKEN, show: true, controllerName: 'Pat' })
    ).toEqual({
      type: 'notice',
      token: TOKEN,
      show: true,
      controllerName: 'Pat'
    })
  })

  it('rechaza una petición sin token o con token vacío', () => {
    expect(parsePrivilegedRequest({ type: 'detach' })).toBeNull()
    expect(parsePrivilegedRequest({ type: 'detach', token: '' })).toBeNull()
  })

  it('rechaza tipos desconocidos y campos inválidos', () => {
    expect(parsePrivilegedRequest({ type: 'capturar-todo', token: TOKEN })).toBeNull()
    expect(
      parsePrivilegedRequest({ type: 'attach', token: TOKEN, display: '', controllerName: 'x' })
    ).toBeNull()
    expect(parsePrivilegedRequest({ type: 'input', token: TOKEN, event: 42 })).toBeNull()
    expect(
      parsePrivilegedRequest({ type: 'notice', token: TOKEN, show: 'sí', controllerName: 'x' })
    ).toBeNull()
  })

  it('rechaza un nombre de controlador demasiado largo', () => {
    const name = 'a'.repeat(MAX_NOTICE_NAME_LENGTH + 1)
    expect(
      parsePrivilegedRequest({ type: 'attach', token: TOKEN, display: '1', controllerName: name })
    ).toBeNull()
  })

  it('no es ni null ni un objeto', () => {
    expect(parsePrivilegedRequest(null)).toBeNull()
    expect(parsePrivilegedRequest('attach')).toBeNull()
    expect(parsePrivilegedRequest([{ type: 'detach', token: TOKEN }])).toBeNull()
  })
})

describe('privilegedHost — respuestas del servicio', () => {
  it('acepta un resultado correcto y uno con motivo estable', () => {
    expect(parsePrivilegedResponse({ type: 'result', ok: true })).toEqual({
      type: 'result',
      ok: true
    })
    expect(parsePrivilegedResponse({ type: 'result', ok: false, reason: 'busy' })).toEqual({
      type: 'result',
      ok: false,
      reason: 'busy'
    })
  })

  it('rechaza un error con motivo desconocido', () => {
    expect(parsePrivilegedResponse({ type: 'result', ok: false, reason: 'lo-que-sea' })).toBeNull()
  })

  it('acepta frame con dimensiones enteras positivas y el flag del escritorio seguro', () => {
    expect(
      parsePrivilegedResponse({ type: 'frame', width: 1920, height: 1080, secureDesktop: true })
    ).toEqual({
      type: 'frame',
      width: 1920,
      height: 1080,
      secureDesktop: true
    })
    expect(
      parsePrivilegedResponse({ type: 'frame', width: 0, height: 1080, secureDesktop: false })
    ).toBeNull()
    expect(
      parsePrivilegedResponse({ type: 'frame', width: 1920.5, height: 1080, secureDesktop: false })
    ).toBeNull()
  })

  it('acepta desktop-changed', () => {
    expect(parsePrivilegedResponse({ type: 'desktop-changed', secureDesktop: true })).toEqual({
      type: 'desktop-changed',
      secureDesktop: true
    })
    expect(parsePrivilegedResponse({ type: 'desktop-changed' })).toBeNull()
  })
})
