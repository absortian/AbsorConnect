import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  // Un preload y una página por tipo de ventana: la principal, la oculta `host` del PC controlado y
  // la de visor (una por sesión con otro PC)
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          host: resolve('src/preload/host.ts'),
          viewer: resolve('src/preload/viewer.ts')
        }
      }
    }
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          host: resolve('src/renderer/host.html'),
          viewer: resolve('src/renderer/viewer.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
