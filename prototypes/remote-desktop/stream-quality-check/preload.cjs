const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('lab', {
  config: () => ipcRenderer.invoke('lab-config'),
  result: value => ipcRenderer.send('lab-result', value)
})
