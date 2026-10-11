/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  // URL de la API de cuentas, incrustada al compilar desde .env.production / .env.development
  readonly MAIN_VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
