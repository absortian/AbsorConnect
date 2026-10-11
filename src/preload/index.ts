import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { ConnectionEntry, S3Connection, SshConnection } from '../shared/types'

// Custom APIs for renderer
const api = {
  getConnections: () => ipcRenderer.invoke('get-connections'),
  getStoreStatus: () => ipcRenderer.invoke('get-store-status'),
  isEncryptionAvailable: () => ipcRenderer.invoke('is-encryption-available'),
  saveConnections: (connections: ConnectionEntry[]) => ipcRenderer.invoke('save-connections', connections),
  listBuckets: (conn: S3Connection) => ipcRenderer.invoke('s3-list-buckets', conn),
  listObjects: (conn: S3Connection, bucket: string, prefix: string) => ipcRenderer.invoke('s3-list-objects', conn, bucket, prefix),
  uploadFile: (conn: S3Connection, bucket: string, localPath: string, key: string, jobId?: string) => ipcRenderer.invoke('s3-upload-file', conn, bucket, localPath, key, jobId),
  downloadFile: (conn: S3Connection, bucket: string, key: string, localDestPath: string, jobId?: string) => ipcRenderer.invoke('s3-download-file', conn, bucket, key, localDestPath, jobId),
  createFolder: (conn: S3Connection, bucket: string, key: string) => ipcRenderer.invoke('s3-create-folder', conn, bucket, key),
  deleteObject: (conn: S3Connection, bucket: string, key: string) => ipcRenderer.invoke('s3-delete-object', conn, bucket, key),
  deleteFolder: (conn: S3Connection, bucket: string, prefix: string) => ipcRenderer.invoke('s3-delete-folder', conn, bucket, prefix),
  sftpHome: (conn: SshConnection) => ipcRenderer.invoke('sftp-home', conn),
  sftpListDir: (conn: SshConnection, dirPath: string) => ipcRenderer.invoke('sftp-list-dir', conn, dirPath),
  sftpCreateDir: (conn: SshConnection, dirPath: string, name: string) => ipcRenderer.invoke('sftp-create-dir', conn, dirPath, name),
  sftpDelete: (conn: SshConnection, itemPath: string) => ipcRenderer.invoke('sftp-delete', conn, itemPath),
  sftpUpload: (conn: SshConnection, localPath: string, remotePath: string, jobId?: string) => ipcRenderer.invoke('sftp-upload-file', conn, localPath, remotePath, jobId),
  sftpDownload: (conn: SshConnection, remotePath: string, localDestPath: string, jobId?: string) => ipcRenderer.invoke('sftp-download-file', conn, remotePath, localDestPath, jobId),
  showOpenFileDialog: (defaultPath?: string) => ipcRenderer.invoke('show-open-file-dialog', defaultPath),
  openTerminal: (conn: SshConnection, cols: number, rows: number) => ipcRenderer.invoke('ssh-terminal-open', conn, cols, rows),
  closeTerminal: (sessionId: string) => ipcRenderer.invoke('ssh-terminal-close', sessionId),
  terminalInput: (sessionId: string, data: string) => ipcRenderer.send('ssh-terminal-input', sessionId, data),
  terminalResize: (sessionId: string, cols: number, rows: number) => ipcRenderer.send('ssh-terminal-resize', sessionId, cols, rows),
  onTerminalData: (callback: (_event: unknown, data: { sessionId: string; data: Uint8Array }) => void) => {
    ipcRenderer.on('ssh-terminal-data', callback)
    return () => ipcRenderer.removeListener('ssh-terminal-data', callback)
  },
  onTerminalExit: (callback: (_event: unknown, data: { sessionId: string; reason: 'exit' | 'connection-lost'; code?: number }) => void) => {
    ipcRenderer.on('ssh-terminal-exit', callback)
    return () => ipcRenderer.removeListener('ssh-terminal-exit', callback)
  },
  clipboardReadText: () => ipcRenderer.invoke('clipboard-read-text'),
  clipboardWriteText: (text: string) => ipcRenderer.invoke('clipboard-write-text', text),
  platform: process.platform,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  showSaveDialog: (defaultPath: string) => ipcRenderer.invoke('show-save-dialog', defaultPath),
  getLocalHome: () => ipcRenderer.invoke('local-get-home'),
  listLocalDir: (dirPath: string) => ipcRenderer.invoke('local-list-dir', dirPath),
  createLocalDir: (dirPath: string, name: string) => ipcRenderer.invoke('local-create-dir', dirPath, name),
  deleteLocalItem: (itemPath: string) => ipcRenderer.invoke('local-delete', itemPath),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  saveTheme: (theme: string) => ipcRenderer.invoke('save-theme', theme),
  getLanguage: () => ipcRenderer.invoke('get-language'),
  saveLanguage: (language: string) => ipcRenderer.invoke('save-language', language),
  exportConnections: () => ipcRenderer.invoke('export-connections'),
  importConnections: () => ipcRenderer.invoke('import-connections'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (callback: (_event: unknown, data: unknown) => void) => {
    ipcRenderer.on('update-status', callback)
    return () => ipcRenderer.removeListener('update-status', callback)
  },
  onTransferProgress: (callback: (_event: unknown, data: { jobId: string; loaded: number; total: number }) => void) => {
    ipcRenderer.on('transfer-progress', callback)
    return () => ipcRenderer.removeListener('transfer-progress', callback)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
