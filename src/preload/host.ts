// Preload de la ventana oculta `host` (add-remote-desktop D7, tarea 5.1): solo los canales de su
// sesión remota. La ventana va con sandbox: aquí solo se puede usar `electron`.
import { contextBridge, ipcRenderer } from 'electron'
import { AbsorHostApi, HOST_IPC, HostInit } from '../shared/remote/hostBridge'

const api: AbsorHostApi = {
  onStart: (callback) => {
    ipcRenderer.on(HOST_IPC.start, (_event, init: HostInit) => callback(init))
  },
  onClose: (callback) => {
    ipcRenderer.on(HOST_IPC.close, (_event, reason: string) => callback(reason))
  },
  answer: (sdp) => ipcRenderer.send(HOST_IPC.answer, sdp),
  hello: () => ipcRenderer.invoke(HOST_IPC.hello),
  auth: (proof) => ipcRenderer.invoke(HOST_IPC.auth, proof),
  displays: () => ipcRenderer.invoke(HOST_IPC.displays),
  selectDisplay: (id) => ipcRenderer.invoke(HOST_IPC.selectDisplay, id),
  captureStarted: () => ipcRenderer.send(HOST_IPC.captureStarted),
  input: (message) => ipcRenderer.send(HOST_IPC.input, message),
  ended: (reason) => ipcRenderer.send(HOST_IPC.ended, reason),
  alive: () => ipcRenderer.send(HOST_IPC.alive),
  audioSource: () => ipcRenderer.invoke(HOST_IPC.audioSource),
  onAudioChanged: (callback) => {
    ipcRenderer.on(HOST_IPC.audioChanged, () => callback())
  },
  log: (message) => ipcRenderer.send(HOST_IPC.log, message)
}

contextBridge.exposeInMainWorld('absorHost', api)
