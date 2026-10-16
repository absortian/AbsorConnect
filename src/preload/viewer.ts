// Preload de las ventanas de visor (add-remote-desktop D11, tarea 5.1): solo los canales de la
// negociación. La ventana va con sandbox: aquí solo se puede usar `electron`.
import { contextBridge, ipcRenderer } from 'electron'
import { AbsorViewerApi, VIEWER_IPC } from '../shared/remote/viewerBridge'

const api: AbsorViewerApi = {
  init: () => ipcRenderer.invoke(VIEWER_IPC.init),
  iceServers: () => ipcRenderer.invoke(VIEWER_IPC.iceServers),
  request: (offer) => ipcRenderer.invoke(VIEWER_IPC.request, offer),
  poll: (requestId) => ipcRenderer.invoke(VIEWER_IPC.poll, requestId)
}

contextBridge.exposeInMainWorld('absorViewer', api)
