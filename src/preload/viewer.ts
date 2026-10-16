// Preload de las ventanas de visor (add-remote-desktop D11, tarea 5.1): solo los canales de la
// negociación. La ventana va con sandbox: aquí solo se puede usar `electron`.
import { contextBridge, ipcRenderer } from 'electron'
import { AbsorViewerApi, VIEWER_IPC } from '../shared/remote/viewerBridge'
import type { ClipboardContent } from '../shared/remote/transfer'

const api: AbsorViewerApi = {
  init: () => ipcRenderer.invoke(VIEWER_IPC.init),
  iceServers: () => ipcRenderer.invoke(VIEWER_IPC.iceServers),
  request: (offer) => ipcRenderer.invoke(VIEWER_IPC.request, offer),
  poll: (requestId) => ipcRenderer.invoke(VIEWER_IPC.poll, requestId),
  clipboardWatch: (on) => ipcRenderer.invoke(VIEWER_IPC.clipboardWatch, on),
  onClipboard: (callback) => {
    ipcRenderer.on(VIEWER_IPC.clipboard, (_event, content: ClipboardContent) => callback(content))
  },
  clipboardWrite: (content) => ipcRenderer.send(VIEWER_IPC.clipboardWrite, content),
  saveBegin: (id, name, size) => ipcRenderer.invoke(VIEWER_IPC.saveBegin, id, name, size),
  saveChunk: (id, chunk) => ipcRenderer.send(VIEWER_IPC.saveChunk, id, chunk),
  saveFinish: (id, sha256) => ipcRenderer.invoke(VIEWER_IPC.saveFinish, id, sha256),
  saveCancel: (id) => ipcRenderer.send(VIEWER_IPC.saveCancel, id),
  showInFolder: (path) => ipcRenderer.send(VIEWER_IPC.showInFolder, path)
}

contextBridge.exposeInMainWorld('absorViewer', api)
