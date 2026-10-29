// Recorrido real de React/preload/IPC, con datos ficticios y sin permisos del SO.
import React from 'react'
import {createRoot} from 'react-dom/client'
import {createInstance} from 'i18next'
import {I18nextProvider} from 'react-i18next'
import AgentSetup from '../../src/renderer/src/components/AgentSetup'
import es from '../../src/renderer/src/locales/es.json'
import '../../src/renderer/src/assets/main.css'
const i18n=createInstance()
void i18n.init({lng:'es',resources:{es:{translation:es}}}).then(()=>{
  createRoot(document.getElementById('root')!).render(<I18nextProvider i18n={i18n}><AgentSetup signedIn hasPassword encrypted/></I18nextProvider>)
})
