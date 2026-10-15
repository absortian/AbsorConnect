import type { AbsorHostApi } from '../shared/remote/hostBridge'

declare global {
  interface Window {
    absorHost: AbsorHostApi
  }
}
