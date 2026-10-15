import { defineConfig } from 'vitest/config'

// Tests unitarios de los módulos puros del proceso principal (sin Electron): control remoto,
// almacenes con la caja de cifrado inyectada, etc. Se ejecutan con `npm test`.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
})
