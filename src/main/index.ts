import { app, shell, BrowserWindow, ipcMain, dialog, clipboard } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { isEncryptionAvailable, getTheme, saveTheme, getLanguage, saveLanguage } from './store'
import { getConnections, saveConnections, refreshIfStale } from './cloud/cloudStore'
import {
  changePassword,
  deleteAccount,
  expireSession,
  getSessionState,
  login,
  logout,
  register
} from './cloud/account'
import { getMigrationOffer, migrateLocalConnections } from './cloud/migration'
import { setUnauthorizedHandler } from './cloud/apiClient'
import {
  listBuckets,
  listObjects,
  uploadFile,
  downloadFile,
  createFolder,
  deleteObject,
  deleteFolder
} from './s3'
import { ConnectionEntry, S3Connection, SshConnection } from '../shared/types'
import { normalizeEntry, sanitizeTree } from '../shared/connections'
import {
  closeAllSsh,
  closeTerminal,
  openTerminal,
  resizeTerminal,
  sftpCreateDir,
  sftpDelete,
  sftpDownload,
  sftpHome,
  sftpListDir,
  sftpUpload,
  writeTerminal
} from './ssh'
import { getLocalHome, listLocalDir, createLocalDir, deleteLocalItem } from './localFs'
import {
  initUpdater,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  startBackgroundUpdateChecks
} from './updater'
import {
  acquireSingleInstance,
  attachCloseToTray,
  beginQuitting,
  getBackgroundState,
  initTray,
  setKeepInBackground,
  setOpenAtLogin,
  setupBackground,
  showMainWindow,
  startedHidden,
  syncOpenAtLoginOnStartup,
  hideDockForHiddenStart
} from './background'
import * as fs from 'fs/promises'
import * as os from 'os'
import { startRemoteHost, stopRemoteHost } from './remote/hostRuntime'
import { isViewerWindow, setupControllerIpc } from './remote/controllerRuntime'

// Si la ventana principal se cerró (no ocultó): solo entonces cerrar la última ventana termina la
// app. Las ventanas ocultas de las sesiones de control remoto y su aviso no cuentan: con la app
// arrancada en segundo plano, que terminara una sesión cerraría la app.
let mainWindowClosed = false

function createWindow(): BrowserWindow {
  mainWindowClosed = false
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    if (process.platform === 'darwin') app.dock?.show()
  })

  // Segundo plano: cerrar la ventana la oculta cuando ese ajuste está activado (background-mode)
  attachCloseToTray(mainWindow)
  mainWindow.on('closed', () => {
    mainWindowClosed = true
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// Instancia única: una segunda ejecución termina y hace que la primera muestre su ventana
// (background-mode). Debe resolverse antes de whenReady.
if (!acquireSingleInstance(showMainWindow)) {
  app.quit()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.absor.fileexplorer')

  // Segundo plano: bandeja siempre visible, ajuste de arranque y cómo recrear la ventana
  await setupBackground({ createWindow })
  await initTray()
  await syncOpenAtLoginOnStartup()
  // Control remoto de este PC: registro en la cuenta y solicitudes de sesión (add-remote-desktop)
  void startRemoteHost()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    // Las ventanas de visor quedan fuera: Ctrl+R o F12 deben llegar al PC remoto (D11). El visor se
    // registra justo después de crear su ventana, así que se mira en el siguiente ciclo
    setImmediate(() => {
      if (!window.isDestroyed() && !isViewerWindow(window)) optimizer.watchWindowShortcuts(window)
    })
  })
  // Control remoto de otros PCs: lista de equipos y ventanas de visor (el token no sale de aquí)
  setupControllerIpc()

  // Cuenta en la nube: las conexiones se leen y guardan en la API (src/main/cloud/)
  setUnauthorizedHandler(expireSession)
  ipcMain.handle('get-session', async () => await getSessionState())
  ipcMain.handle(
    'login',
    async (_, email: string, password: string) => await login(email, password)
  )
  ipcMain.handle(
    'register',
    async (_, email: string, password: string) => await register(email, password)
  )
  ipcMain.handle('logout', async () => await logout())
  ipcMain.handle(
    'change-password',
    async (_, currentPassword: string, newPassword: string) =>
      await changePassword(currentPassword, newPassword)
  )
  ipcMain.handle('delete-account', async (_, password: string) => await deleteAccount(password))
  ipcMain.handle('get-migration-offer', async () => await getMigrationOffer())
  ipcMain.handle('migrate-local-connections', async () => await migrateLocalConnections())
  // Cambios desde otros equipos: al volver a la ventana se relee la lista si es antigua
  app.on('browser-window-focus', () => refreshIfStale())

  ipcMain.handle('get-connections', async () => {
    return await getConnections()
  })

  ipcMain.handle('is-encryption-available', () => isEncryptionAvailable())

  ipcMain.handle('save-connections', async (_, connections: ConnectionEntry[]) => {
    await saveConnections(connections)
  })

  // S3 IPC handlers
  ipcMain.handle('s3-list-buckets', async (_, conn: S3Connection) => await listBuckets(conn))
  ipcMain.handle(
    's3-list-objects',
    async (_, conn: S3Connection, bucket: string, prefix: string) =>
      await listObjects(conn, bucket, prefix)
  )
  ipcMain.handle(
    's3-upload-file',
    async (
      event,
      conn: S3Connection,
      bucket: string,
      localPath: string,
      key: string,
      jobId?: string
    ) => {
      const onProgress = jobId
        ? (loaded: number, total: number) => {
            event.sender.send('transfer-progress', { jobId, loaded, total })
          }
        : undefined
      await uploadFile(conn, bucket, localPath, key, onProgress)
    }
  )
  ipcMain.handle(
    's3-download-file',
    async (
      event,
      conn: S3Connection,
      bucket: string,
      key: string,
      localDestPath: string,
      jobId?: string
    ) => {
      const onProgress = jobId
        ? (loaded: number, total: number) => {
            event.sender.send('transfer-progress', { jobId, loaded, total })
          }
        : undefined
      await downloadFile(conn, bucket, key, localDestPath, onProgress)
    }
  )
  ipcMain.handle(
    's3-create-folder',
    async (_, conn: S3Connection, bucket: string, key: string) =>
      await createFolder(conn, bucket, key)
  )
  ipcMain.handle(
    's3-delete-object',
    async (_, conn: S3Connection, bucket: string, key: string) =>
      await deleteObject(conn, bucket, key)
  )
  ipcMain.handle(
    's3-delete-folder',
    async (_, conn: S3Connection, bucket: string, prefix: string) =>
      await deleteFolder(conn, bucket, prefix)
  )

  // SFTP IPC handlers
  ipcMain.handle('sftp-home', async (_, conn: SshConnection) => await sftpHome(conn))
  ipcMain.handle(
    'sftp-list-dir',
    async (_, conn: SshConnection, dirPath: string) => await sftpListDir(conn, dirPath)
  )
  ipcMain.handle(
    'sftp-create-dir',
    async (_, conn: SshConnection, dirPath: string, name: string) =>
      await sftpCreateDir(conn, dirPath, name)
  )
  ipcMain.handle(
    'sftp-delete',
    async (_, conn: SshConnection, itemPath: string) => await sftpDelete(conn, itemPath)
  )
  ipcMain.handle(
    'sftp-upload-file',
    async (event, conn: SshConnection, localPath: string, remotePath: string, jobId?: string) => {
      const onProgress = jobId
        ? (loaded: number, total: number) => {
            event.sender.send('transfer-progress', { jobId, loaded, total })
          }
        : undefined
      await sftpUpload(conn, localPath, remotePath, onProgress)
    }
  )
  ipcMain.handle(
    'sftp-download-file',
    async (
      event,
      conn: SshConnection,
      remotePath: string,
      localDestPath: string,
      jobId?: string
    ) => {
      const onProgress = jobId
        ? (loaded: number, total: number) => {
            event.sender.send('transfer-progress', { jobId, loaded, total })
          }
        : undefined
      await sftpDownload(conn, remotePath, localDestPath, onProgress)
    }
  )
  ipcMain.handle('show-open-file-dialog', async (_, defaultPath?: string) => {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      defaultPath: defaultPath || join(os.homedir(), '.ssh'),
      properties: ['openFile', 'showHiddenFiles']
    })
    if (canceled || filePaths.length === 0) return null
    return filePaths[0]
  })

  // SSH terminal IPC handlers (input y resize son send: sin esperar respuesta por cada tecla)
  ipcMain.handle(
    'ssh-terminal-open',
    async (event, conn: SshConnection, cols: number, rows: number) =>
      await openTerminal(conn, cols, rows, event.sender)
  )
  ipcMain.handle('ssh-terminal-close', (event, sessionId: string) =>
    closeTerminal(sessionId, event.sender)
  )
  ipcMain.on('ssh-terminal-input', (event, sessionId: string, data: string) =>
    writeTerminal(sessionId, data, event.sender)
  )
  ipcMain.on('ssh-terminal-resize', (event, sessionId: string, cols: number, rows: number) =>
    resizeTerminal(sessionId, cols, rows, event.sender)
  )
  ipcMain.handle('clipboard-read-text', () => clipboard.readText())
  ipcMain.handle('clipboard-write-text', (_, text: string) => clipboard.writeText(text))

  // Local FS IPC handlers
  ipcMain.handle('local-get-home', async () => await getLocalHome())
  ipcMain.handle('local-list-dir', async (_, dirPath: string) => await listLocalDir(dirPath))
  ipcMain.handle(
    'local-create-dir',
    async (_, dirPath: string, name: string) => await createLocalDir(dirPath, name)
  )
  ipcMain.handle('local-delete', async (_, itemPath: string) => await deleteLocalItem(itemPath))
  ipcMain.handle('show-save-dialog', async (_, defaultPath: string) => {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath })
    if (canceled) return null
    return filePath
  })

  // Settings IPC handlers
  ipcMain.handle('get-theme', async () => await getTheme())
  ipcMain.handle('save-theme', async (_, theme: string) => await saveTheme(theme))
  ipcMain.handle('get-language', async () => await getLanguage())
  ipcMain.handle('save-language', async (_, language: string) => await saveLanguage(language))

  // Segundo plano (background-mode): mantener abierta al cerrar y abrir al iniciar sesión
  ipcMain.handle('get-background-settings', async () => await getBackgroundState())
  ipcMain.handle(
    'set-keep-in-background',
    async (_, value: boolean) => await setKeepInBackground(value)
  )
  ipcMain.handle('set-open-at-login', async (_, value: boolean) => await setOpenAtLogin(value))

  // Update IPC handlers
  ipcMain.handle('get-app-version', () => app.getVersion())
  ipcMain.handle('check-for-updates', async () => await checkForUpdates())
  ipcMain.handle('download-update', async () => await downloadUpdate())
  ipcMain.handle('install-update', () => quitAndInstall())

  // Export connections: warn user, open save dialog and write decrypted JSON
  ipcMain.handle('export-connections', async () => {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Export', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Export Connections',
      message: 'Credentials will be exported in plain text',
      detail:
        'The exported file will contain your credentials (access keys, passwords and passphrases) without encryption. Keep this file secure and do not share it.'
    })
    if (response !== 0) return false
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: 'connections.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return false
    const connections = await getConnections()
    await fs.writeFile(filePath, JSON.stringify(connections, null, 2), 'utf-8')
    return true
  })

  // Import connections: open file dialog, read and validate JSON
  ipcMain.handle('import-connections', async () => {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    const data = await fs.readFile(filePaths[0], 'utf-8')
    const parsed = JSON.parse(data)
    if (!Array.isArray(parsed)) throw new Error('Invalid format: expected an array of connections')
    // El servicio rechaza padres inexistentes: los huérfanos de ficheros antiguos pasan a la raíz
    return sanitizeTree(parsed.map(normalizeEntry))
  })

  initUpdater()
  // La app puede pasar días abierta: busca actualizaciones al arrancar y cada 6 h (app-updates)
  startBackgroundUpdateChecks()
  // Arrancada por el sistema al iniciar sesión: solo bandeja, sin abrir la ventana (background-mode)
  if (startedHidden()) hideDockForHiddenStart()
  else createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showMainWindow()
  })
})

app.on('before-quit', () => {
  beginQuitting()
  closeAllSsh()
  // Corta la sesión de control remoto en curso (el controlador ve que el PC la cerró)
  void stopRemoteHost('stopped')
})

// Cerrar la última ventana solo termina la app cuando NO se mantiene en segundo plano y la que se
// cerró fue la principal. Con el ajuste activado la ventana se oculta (no se cierra).
app.on('window-all-closed', async () => {
  if (process.platform === 'darwin' || !mainWindowClosed) return
  const { keepInBackground } = await getBackgroundState()
  if (!keepInBackground) app.quit()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
