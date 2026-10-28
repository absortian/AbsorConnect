import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { LocalTravelReadiness } from '../LocalTravelReadiness'
import { DeviceReadiness } from '../DeviceReadiness'
import { absentLocalAgent, type LocalAgentSnapshot } from '../../../../shared/remote/localAgent'
import type { AccountDevice } from '../../../../shared/remote/viewerBridge'
import es from '../../locales/es.json'
import en from '../../locales/en.json'

async function render(element: React.ReactElement, language: 'es' | 'en'): Promise<string> {
  const i18n = createInstance()
  await i18n.init({
    lng: language,
    resources: { es: { translation: es }, en: { translation: en } }
  })
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element))
}

it.each(['es', 'en'] as const)(
  'estado local y salida de la app siguen siendo factuales en %s',
  async (language) => {
    const t = { es, en }[language].travel
    for (const state of ['idle', 'active', 'validation_required', 'revoked'] as const) {
      const agent: LocalAgentSnapshot = {
        ...absentLocalAgent(),
        ownership: 'agent',
        phase: 'responding',
        state,
        active: state === 'active'
      }
      const html = await render(
        createElement(LocalTravelReadiness, { agent, agentOwned: true }),
        language
      )
      for (const text of [
        t.notCertified,
        t.certifiedNone,
        t.exit.interface_only,
        t.state[state],
        t.recovery
      ])
        expect(html).toContain(text)
      expect(html).not.toContain('travel.state.')
    }
    for (const agent of [undefined, absentLocalAgent()]) {
      const html = await render(
        createElement(LocalTravelReadiness, { agent, agentOwned: false }),
        language
      )
      expect(html).toContain(t.exit.user_session)
      expect(html).toContain(t.certifiedNone)
    }
    for (const agent of [
      undefined,
      { ...absentLocalAgent(), ownership: 'unknown', phase: 'unverified' } as const
    ]) {
      const html = await render(
        createElement(LocalTravelReadiness, { agent, agentOwned: true }),
        language
      )
      expect(html).toContain(t.exit.unverified)
      expect(html).not.toContain(t.exit.interface_only)
    }
  }
)

it.each(['es', 'en'] as const)(
  'las 16 declaraciones de capacidades no producen certificación en %s',
  async (language) => {
    const t = { es, en }[language]
    const base: AccountDevice = {
      id: '12345678-1234-4abc-8def-123456789abc',
      name: 'VM ficticia',
      self: false,
      platform: 'linux',
      online: true,
      appVersion: 'test',
      lastSeenAt: '',
      remote: { state: 'available', features: { clipboard: false, files: false, audio: false } }
    }
    const keys = ['administration', 'login', 'secureAttention', 'restart'] as const
    for (let mask = 0; mask < 16; mask++) {
      const capabilities = Object.fromEntries(
        keys.map((key, index) => [key, !!(mask & (1 << index))])
      )
      const device = {
        ...base,
        remote: { ...base.remote, mode: 'agent', agentVersion: '0.1.0+lab', capabilities }
      }
      const html = await render(createElement(DeviceReadiness, { device }), language)
      expect(html).toContain(t.travel.certifiedNone)
      expect(html).toContain(t.devices.agent.readiness.not_certified)
      for (const [index, key] of keys.entries()) {
        expect(html).toContain(
          `${t.travel.capability[key]}: ${mask & (1 << index) ? t.travel.declaredYes : t.travel.declaredNo}`
        )
      }
      const offline = await render(
        createElement(DeviceReadiness, { device: { ...device, online: false } }),
        language
      )
      expect(offline).toContain(t.devices.agent.readiness.offline)
      expect(offline).toContain(t.travel.certifiedNone)
    }
    const malformed = await render(
      createElement(DeviceReadiness, {
        device: {
          ...base,
          remote: { ...base.remote, mode: 'agent', agentVersion: '<script>', capabilities: {} }
        }
      }),
      language
    )
    expect(malformed).toContain(t.devices.agent.readiness.unknown)
    expect(malformed).not.toContain('<script>')
    expect(malformed).toContain(t.travel.certifiedNone)
  }
)
