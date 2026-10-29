import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { AgentSetupView } from '../AgentSetup'
import type { AgentSetupState } from '../../../../shared/remote/agentSetup'
import es from '../../locales/es.json'
import en from '../../locales/en.json'
const base: AgentSetupState = {
  phase: 'idle',
  providerAvailable: true,
  busy: false,
  canCommit: false,
  freshEnrollmentRequired: false,
  readyForUnattended: false
}
async function render(
  language: 'es' | 'en',
  state: AgentSetupState,
  choice: 'required' | 'unattended' | null = null,
  notice: string | null = null
): Promise<string> {
  const i18n = createInstance()
  await i18n.init({
    lng: language,
    resources: { es: { translation: es }, en: { translation: en } }
  })
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(AgentSetupView, {
        state,
        signedIn: true,
        hasPassword: true,
        encrypted: true,
        pending: false,
        notice,
        choice,
        onChoice: () => {},
        onAction: () => {}
      })
    )
  )
}
it.each(['es', 'en'] as const)(
  'recorridos factuales de instalación/avería/intervención en %s',
  async (language) => {
    const t = { es, en }[language].agentSetup
    for (const phase of [
      'unavailable',
      'idle',
      'preparing',
      'prepared',
      'committed',
      'compensating',
      'intervention_required'
    ] as const) {
      const html = await render(language, {
        ...base,
        phase,
        providerAvailable: phase !== 'unavailable'
      })
      expect(html).toContain(t.notCertified)
      expect(html).toContain(t.phase[phase])
      expect(html).not.toContain('agentSetup.phase.')
      if (phase === 'unavailable') {
        expect(html).toContain(t.packageUnavailable)
        expect(html).not.toContain('<button')
      }
      if (phase === 'prepared') {
        expect(html).toContain(t.policyIntervention)
        expect(html).toMatch(/disabled="">[^<]*<\/button>/)
      }
      if (phase === 'intervention_required') expect(html).toContain(t.recoveryHint)
      if (phase === 'committed') expect(html).toContain(t.passwordChange)
    }
    expect(await render(language, base, null, 'cancelled')).toContain(t.cancelled)
    expect(await render(language, base, null, 'agent_setup_intervention_required')).toContain(
      t.error
    )
  }
)
it.each(['es', 'en'] as const)(
  'no preselecciona confirmación local y exige una elección explícita en %s',
  async (language) => {
    const empty = await render(language, base)
    expect(empty).not.toContain('checked=""')
    expect(empty).toContain('disabled=""')
    for (const choice of ['required', 'unattended'] as const) {
      const html = await render(language, base, choice)
      expect(html.match(/checked=""/g) || []).toHaveLength(1)
      expect(html).not.toMatch(/<button[^>]*disabled/)
    }
  }
)
