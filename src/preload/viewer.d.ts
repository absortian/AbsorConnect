import type { AbsorViewerApi } from '../shared/remote/viewerBridge'

declare global {
  interface Window {
    absorViewer: AbsorViewerApi
  }
}
