import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { DeviceReadiness } from '../DeviceReadiness'
import type { AccountDevice } from '../../../../shared/remote/viewerBridge'
import es from '../../locales/es.json'
import en from '../../locales/en.json'
const device: AccountDevice = {
  id: '12345678-1234-4abc-8def-123456789abc',
  name: 'VM datos ficticios',
  self: false,
  platform: 'linux',
  online: true,
  appVersion: '0.4.1',
  lastSeenAt: '',
  remote: { state: 'available', features: { clipboard: false, files: false, audio: false } }
}
async function render(value: AccountDevice, lng = 'es'): Promise<string> {
  const i18n = createInstance()
  await i18n.init({ lng, resources: { es: { translation: es }, en: { translation: en } } })
  return renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(DeviceReadiness, { device: value }))
  )
}
describe('preparación factual en Equipos', () => {
  it('muestra el límite de la sesión de usuario y salir de la app', async () => {
    expect(await render(device)).toContain(es.devices.agent.readiness.legacy_session)
    expect(await render(device, 'en')).toContain(en.devices.agent.readiness.legacy_session)
  })
  it('ni todas las capacidades declaradas convierten una VM en preparada', async () => {
    const native: AccountDevice = {
      ...device,
      remote: {
        ...device.remote,
        mode: 'agent',
        agentVersion: '0.1.0+vm',
        capabilities: {
          administration: true,
          login: true,
          secureAttention: true,
          restart: true
        }
      }
    }
    const html = await render(native)
    expect(html).toContain(es.devices.agent.readiness.not_certified)
    expect(html).toContain(es.devices.agent.declared)
    expect(html).toContain('0.1.0+vm')
    expect(await render({ ...native, online: false })).toContain(es.devices.agent.readiness.offline)
  })
  it('metadatos malformados se presentan como desconocidos', async () => {
    expect(await render({ ...device, remote: { ...device.remote, mode: 'agent' } })).toContain(
      es.devices.agent.readiness.unknown
    )
  })
})
