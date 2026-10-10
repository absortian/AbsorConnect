import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getConnections, saveConnections, getTheme, saveTheme, getLanguage, saveLanguage } from './store'
import { listBuckets, listObjects, uploadFile, downloadFile, createFolder, deleteObject, deleteFolder } from './s3'
import { ConnectionEntry, S3Connection, SshConnection } from '../shared/types'
import { normalizeEntry } from '../shared/connections'
import { closeAllSsh, sftpCreateDir, sftpDelete, sftpDownload, sftpHome, sftpListDir, sftpUpload } from './ssh'
import { getLocalHome, listLocalDir, createLocalDir, deleteLocalItem } from './localFs'
import { initUpdater, checkForUpdates, downloadUpdate, quitAndInstall } from './updater'
import * as fs from 'fs/promises'
import * as os from 'os'


function createWindow(): void {
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
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.absor.fileexplorer')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC handlers
  ipcMain.handle('get-connections', async () => {
    return await getConnections()
  })

  ipcMain.handle('save-connections', async (_, connections: ConnectionEntry[]) => {
    await saveConnections(connections)
  })

  // S3 IPC handlers
  ipcMain.handle('s3-list-buckets', async (_, conn: S3Connection) => await listBuckets(conn))
  ipcMain.handle('s3-list-objects', async (_, conn: S3Connection, bucket: string, prefix: string) => await listObjects(conn, bucket, prefix))
  ipcMain.handle('s3-upload-file', async (event, conn: S3Connection, bucket: string, localPath: string, key: string, jobId?: string) => {
    const onProgress = jobId ? (loaded: number, total: number) => {
      event.sender.send('transfer-progress', { jobId, loaded, total })
    } : undefined
    await uploadFile(conn, bucket, localPath, key, onProgress)
  })
  ipcMain.handle('s3-download-file', async (event, conn: S3Connection, bucket: string, key: string, localDestPath: string, jobId?: string) => {
    const onProgress = jobId ? (loaded: number, total: number) => {
      event.sender.send('transfer-progress', { jobId, loaded, total })
    } : undefined
    await downloadFile(conn, bucket, key, localDestPath, onProgress)
  })
  ipcMain.handle('s3-create-folder', async (_, conn: S3Connection, bucket: string, key: string) => await createFolder(conn, bucket, key))
  ipcMain.handle('s3-delete-object', async (_, conn: S3Connection, bucket: string, key: string) => await deleteObject(conn, bucket, key))
  ipcMain.handle('s3-delete-folder', async (_, conn: S3Connection, bucket: string, prefix: string) => await deleteFolder(conn, bucket, prefix))
  
  // SFTP IPC handlers
  ipcMain.handle('sftp-home', async (_, conn: SshConnection) => await sftpHome(conn))
  ipcMain.handle('sftp-list-dir', async (_, conn: SshConnection, dirPath: string) => await sftpListDir(conn, dirPath))
  ipcMain.handle('sftp-create-dir', async (_, conn: SshConnection, dirPath: string, name: string) => await sftpCreateDir(conn, dirPath, name))
  ipcMain.handle('sftp-delete', async (_, conn: SshConnection, itemPath: string) => await sftpDelete(conn, itemPath))
  ipcMain.handle('sftp-upload-file', async (event, conn: SshConnection, localPath: string, remotePath: string, jobId?: string) => {
    const onProgress = jobId ? (loaded: number, total: number) => {
      event.sender.send('transfer-progress', { jobId, loaded, total })
    } : undefined
    await sftpUpload(conn, localPath, remotePath, onProgress)
  })
  ipcMain.handle('sftp-download-file', async (event, conn: SshConnection, remotePath: string, localDestPath: string, jobId?: string) => {
    const onProgress = jobId ? (loaded: number, total: number) => {
      event.sender.send('transfer-progress', { jobId, loaded, total })
    } : undefined
    await sftpDownload(conn, remotePath, localDestPath, onProgress)
  })
  ipcMain.handle('show-open-file-dialog', async (_, defaultPath?: string) => {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      defaultPath: defaultPath || join(os.homedir(), '.ssh'),
      properties: ['openFile', 'showHiddenFiles']
    })
    if (canceled || filePaths.length === 0) return null
    return filePaths[0]
  })

  // Local FS IPC handlers
  ipcMain.handle('local-get-home', async () => await getLocalHome())
  ipcMain.handle('local-list-dir', async (_, dirPath: string) => await listLocalDir(dirPath))
  ipcMain.handle('local-create-dir', async (_, dirPath: string, name: string) => await createLocalDir(dirPath, name))
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
      detail: 'The exported file will contain your credentials (access keys, passwords and passphrases) without encryption. Keep this file secure and do not share it.'
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
    return parsed.map(normalizeEntry)
  })

  initUpdater()
  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => closeAllSsh())

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
