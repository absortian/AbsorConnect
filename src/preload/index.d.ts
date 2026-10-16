import { ElectronAPI } from '@electron-toolkit/preload'
import {
  CloudResult,
  ConnectionEntry,
  ConnectionsChangedEvent,
  MigrationOffer,
  S3Connection,
  SessionState,
  SignInResult,
  SshConnection
} from '../shared/types'
import { AccountDevicesResult } from '../shared/remote/viewerBridge'

interface UpdateStatusEvent {
  status: 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'error'
  version?: string
  releaseDate?: string
  percent?: number
  error?: string
  releasesUrl?: string
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getSession: () => Promise<SessionState>
      remoteDevices: () => Promise<AccountDevicesResult>
      openViewer: (deviceId: string, deviceName: string) => Promise<boolean>
      login: (email: string, password: string) => Promise<SignInResult>
      register: (email: string, password: string) => Promise<SignInResult>
      logout: () => Promise<CloudResult>
      changePassword: (currentPassword: string, newPassword: string) => Promise<CloudResult>
      deleteAccount: (password: string) => Promise<CloudResult>
      getMigrationOffer: () => Promise<MigrationOffer>
      migrateLocalConnections: () => Promise<CloudResult>
      onSessionExpired: (callback: () => void) => () => void
      onConnectionsChanged: (callback: (event: ConnectionsChangedEvent) => void) => () => void
      getConnections: () => Promise<ConnectionEntry[]>
      isEncryptionAvailable: () => Promise<boolean>
      saveConnections: (connections: ConnectionEntry[]) => Promise<void>
      listBuckets: (conn: S3Connection) => Promise<string[]>
      listObjects: (
        conn: S3Connection,
        bucket: string,
        prefix: string
      ) => Promise<{
        folders: string[]
        files: Array<{ key: string; size: number; lastModified: string }>
      }>
      uploadFile: (
        conn: S3Connection,
        bucket: string,
        localPath: string,
        key: string,
        jobId?: string
      ) => Promise<void>
      downloadFile: (
        conn: S3Connection,
        bucket: string,
        key: string,
        localDestPath: string,
        jobId?: string
      ) => Promise<void>
      createFolder: (conn: S3Connection, bucket: string, key: string) => Promise<void>
      deleteObject: (conn: S3Connection, bucket: string, key: string) => Promise<void>
      deleteFolder: (conn: S3Connection, bucket: string, prefix: string) => Promise<void>
      sftpHome: (conn: SshConnection) => Promise<string>
      sftpListDir: (
        conn: SshConnection,
        dirPath: string
      ) => Promise<{
        currentPath: string
        folders: string[]
        files: Array<{ name: string; path: string; size: number; lastModified: string }>
      }>
      sftpCreateDir: (conn: SshConnection, dirPath: string, name: string) => Promise<string>
      sftpDelete: (conn: SshConnection, itemPath: string) => Promise<void>
      sftpUpload: (
        conn: SshConnection,
        localPath: string,
        remotePath: string,
        jobId?: string
      ) => Promise<void>
      sftpDownload: (
        conn: SshConnection,
        remotePath: string,
        localDestPath: string,
        jobId?: string
      ) => Promise<void>
      showOpenFileDialog: (defaultPath?: string) => Promise<string | null>
      openTerminal: (conn: SshConnection, cols: number, rows: number) => Promise<string>
      closeTerminal: (sessionId: string) => Promise<void>
      terminalInput: (sessionId: string, data: string) => void
      terminalResize: (sessionId: string, cols: number, rows: number) => void
      onTerminalData: (
        callback: (_event: unknown, data: { sessionId: string; data: Uint8Array }) => void
      ) => () => void
      onTerminalExit: (
        callback: (
          _event: unknown,
          data: { sessionId: string; reason: 'exit' | 'connection-lost'; code?: number }
        ) => void
      ) => () => void
      clipboardReadText: () => Promise<string>
      clipboardWriteText: (text: string) => Promise<void>
      platform: string
      getPathForFile: (file: File) => string
      showSaveDialog: (defaultPath: string) => Promise<string | null>
      getLocalHome: () => Promise<string>
      listLocalDir: (dirPath: string) => Promise<{
        currentPath: string
        folders: string[]
        files: Array<{ name: string; path: string; size: number; lastModified: string }>
      }>
      createLocalDir: (dirPath: string, name: string) => Promise<string>
      deleteLocalItem: (itemPath: string) => Promise<void>
      getTheme: () => Promise<string>
      saveTheme: (theme: string) => Promise<void>
      getLanguage: () => Promise<string>
      saveLanguage: (language: string) => Promise<void>
      getBackgroundSettings: () => Promise<{ keepInBackground: boolean; openAtLogin: boolean }>
      setKeepInBackground: (value: boolean) => Promise<void>
      setOpenAtLogin: (value: boolean) => Promise<void>
      exportConnections: () => Promise<boolean>
      importConnections: () => Promise<ConnectionEntry[] | null>
      getAppVersion: () => Promise<string>
      checkForUpdates: () => Promise<void>
      downloadUpdate: () => Promise<void>
      installUpdate: () => Promise<boolean>
      onUpdateStatus: (callback: (_event: unknown, data: UpdateStatusEvent) => void) => () => void
      onTransferProgress: (
        callback: (_event: unknown, data: { jobId: string; loaded: number; total: number }) => void
      ) => () => void
    }
  }
}
