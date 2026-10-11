import './assets/main.css'
import './i18n'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

window.addEventListener('error', (event) => {
  alert('Global Error: ' + event.error?.message + '\n' + event.error?.stack)
})

window.addEventListener('unhandledrejection', (event) => {
  alert('Unhandled Promise Rejection: ' + event.reason)
})

import App from './App'

// La cola de transferencias la monta App con la sesión iniciada: al cerrarla se vacía
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
