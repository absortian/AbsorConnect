// Preload de la ventana oculta `host` (add-remote-desktop D7, tarea 5.1): solo los canales de su
// sesión remota. La ventana va con sandbox: aquí solo se puede usar `electron`.
import { contextBridge, ipcRenderer } from 'electron'
import { AbsorHostApi, HOST_IPC, HostInit } from '../shared/remote/hostBridge'
import type { ClipboardContent } from '../shared/remote/transfer'

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
  onClipboard: (callback) => {
    ipcRenderer.on(HOST_IPC.clipboard, (_event, content: ClipboardContent) => callback(content))
  },
  clipboardWrite: (content) => ipcRenderer.send(HOST_IPC.clipboardWrite, content),
  fileBegin: (id, name, size) => ipcRenderer.invoke(HOST_IPC.fileBegin, id, name, size),
  fileChunk: (id, chunk) => ipcRenderer.send(HOST_IPC.fileChunk, id, chunk),
  fileFinish: (id, name, sha256) => ipcRenderer.invoke(HOST_IPC.fileFinish, id, name, sha256),
  fileCancel: (id) => ipcRenderer.send(HOST_IPC.fileCancel, id),
  fsList: (path) => ipcRenderer.invoke(HOST_IPC.fsList, path),
  fileOpen: (id, path) => ipcRenderer.invoke(HOST_IPC.fileOpen, id, path),
  fileRead: (id) => ipcRenderer.invoke(HOST_IPC.fileRead, id),
  fileClose: (id) => ipcRenderer.invoke(HOST_IPC.fileClose, id),
  log: (message) => ipcRenderer.send(HOST_IPC.log, message)
}

contextBridge.exposeInMainWorld('absorHost', api)
