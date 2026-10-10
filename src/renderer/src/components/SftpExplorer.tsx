import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, File, ArrowLeft, RefreshCw, Trash2, Server, Download, FolderPlus, FolderDown, RotateCcw } from 'lucide-react'
import { SshConnection } from '../../../shared/types'
import { useTransferQueue } from '../context/TransferQueueContext'
import { formatFileSize } from '../../../shared/utils'
import { remoteErrorMessage } from '../remoteErrors'

interface SftpExplorerProps {
  connection: SshConnection
  localCurrentPath?: string
  onLocationChange?: (path: string) => void
}

interface RemoteFile {
  name: string
  path: string
  size: number
  lastModified: string
}

interface SftpContextMenu {
  x: number
  y: number
  path: string
  isFolder: boolean
}

const CONTEXT_MENU_WIDTH = 200
const CONTEXT_MENU_GUTTER = 4

// Las rutas remotas son siempre POSIX, sea cual sea el sistema local
const joinRemote = (dir: string, name: string): string => (dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`)
const parentRemote = (dir: string): string => dir.replace(/\/[^/]+\/?$/, '') || '/'
const baseName = (p: string): string => p.split(/\\|\//).pop() || 'file'

export default function SftpExplorer({ connection, localCurrentPath, onLocationChange }: SftpExplorerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [currentPath, setCurrentPath] = useState('')
  const [folders, setFolders] = useState<string[]>([])
  const [files, setFiles] = useState<RemoteFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [contextMenu, setContextMenu] = useState<SftpContextMenu | null>(null)
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const newFolderRef = useRef<HTMLInputElement>(null)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [lastClickedItem, setLastClickedItem] = useState<string | null>(null)
  const { addJob, lastJobUpdate } = useTransferQueue()

  const describe = (err: unknown, fallback: string): string =>
    err instanceof Error && err.message ? remoteErrorMessage(err.message, t) : fallback

  // Si falla, se mantiene el listado anterior y se muestra el error
  const loadDirectory = async (dirPath: string): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const result = await window.api.sftpListDir(connection, dirPath)
      setCurrentPath(result.currentPath)
      setFolders(result.folders)
      setFiles(result.files)
      setSelectedItems(new Set())
      setLastClickedItem(null)
      onLocationChange?.(result.currentPath)
    } catch (err) {
      setError(describe(err, t('sftp.failedToList')))
    } finally {
      setLoading(false)
    }
  }

  const openHome = async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const home = await window.api.sftpHome(connection)
      await loadDirectory(home)
    } catch (err) {
      setError(describe(err, t('sftp.failedToConnect')))
      setLoading(false)
    }
  }

  const retry = (): Promise<void> => (currentPath ? loadDirectory(currentPath) : openHome())

  useEffect(() => {
    openHome()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection])

  useEffect(() => {
    if (lastJobUpdate > 0 && currentPath) loadDirectory(currentPath)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastJobUpdate])

  // Close context menu on click or when the other panel opens its menu
  useEffect(() => {
    const handleClick = (): void => setContextMenu(null)
    const handleOther = (e: Event): void => {
      if ((e as CustomEvent).detail !== 'sftp') setContextMenu(null)
    }
    window.addEventListener('click', handleClick)
    window.addEventListener('contextmenu-open', handleOther)
    window.addEventListener('explorer-panel-click', handleOther)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('contextmenu-open', handleOther)
      window.removeEventListener('explorer-panel-click', handleOther)
    }
  }, [])

  useEffect(() => {
    if (showNewFolderInput && newFolderRef.current) newFolderRef.current.focus()
  }, [showNewFolderInput])

  const allItemIds = [...folders.map(f => `folder:${f}`), ...files.map(f => `file:${f.path}`)]

  const handleItemClick = (e: React.MouseEvent, itemId: string): void => {
    e.stopPropagation()
    setContextMenu(null)
    window.dispatchEvent(new CustomEvent('explorer-panel-click', { detail: 'sftp' }))
    if (e.metaKey || e.ctrlKey) {
      setSelectedItems(prev => {
        const next = new Set(prev)
        if (next.has(itemId)) next.delete(itemId)
        else next.add(itemId)
        return next
      })
      setLastClickedItem(itemId)
    } else if (e.shiftKey && lastClickedItem) {
      const startIdx = allItemIds.indexOf(lastClickedItem)
      const endIdx = allItemIds.indexOf(itemId)
      if (startIdx !== -1 && endIdx !== -1) {
        const range = allItemIds.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1)
        setSelectedItems(prev => new Set([...prev, ...range]))
      }
    } else {
      setSelectedItems(new Set([itemId]))
      setLastClickedItem(itemId)
    }
  }

  const handleBackgroundClick = (e: React.MouseEvent): void => {
    setContextMenu(null)
    window.dispatchEvent(new CustomEvent('explorer-panel-click', { detail: 'sftp' }))
    if (e.target === e.currentTarget) {
      setSelectedItems(new Set())
      setLastClickedItem(null)
    }
  }

  const navigateUp = (): void => {
    if (currentPath && currentPath !== '/') loadDirectory(parentRemote(currentPath))
  }

  const uploadLocalPaths = (paths: string[]): void => {
    if (!currentPath) return
    for (const localPath of paths) {
      const fileName = baseName(localPath)
      addJob({
        type: 'upload',
        sourcePath: localPath,
        destPath: joinRemote(currentPath, fileName),
        fileName,
        connectionId: connection.id
      })
    }
  }

  const handleDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (!currentPath) return

    const multiFilePaths = e.dataTransfer.getData('application/x-local-files')
    if (multiFilePaths) {
      try {
        uploadLocalPaths(JSON.parse(multiFilePaths))
      } catch { /* ignore malformed payload */ }
      return
    }
    const localFilePath = e.dataTransfer.getData('application/x-local-file')
    if (localFilePath) {
      uploadLocalPaths([localFilePath])
      return
    }
    // Archivos soltados desde el sistema operativo
    const osPaths = Array.from(e.dataTransfer.files)
      .map(file => window.api.getPathForFile(file))
      .filter(Boolean)
    uploadLocalPaths(osPaths)
  }

  const handleDownload = async (remotePath: string, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    const fileName = baseName(remotePath)
    const savePath = await window.api.showSaveDialog(fileName)
    if (!savePath) return
    addJob({ type: 'download', sourcePath: remotePath, destPath: savePath, fileName, connectionId: connection.id })
  }

  const handleDownloadToLocal = (remotePaths: string[]): void => {
    if (!localCurrentPath) return
    const separator = localCurrentPath.includes('\\') ? '\\' : '/'
    for (const remotePath of remotePaths) {
      const fileName = baseName(remotePath)
      const destPath = localCurrentPath.endsWith(separator)
        ? `${localCurrentPath}${fileName}`
        : `${localCurrentPath}${separator}${fileName}`
      addJob({ type: 'download', sourcePath: remotePath, destPath, fileName, connectionId: connection.id })
    }
  }

  const getSelectedFilePaths = (): string[] =>
    [...selectedItems].filter(id => id.startsWith('file:')).map(id => id.slice(5))

  const getSelectedPaths = (): string[] =>
    [...selectedItems].map(id => (id.startsWith('folder:') ? joinRemote(currentPath, id.slice(7)) : id.slice(5)))

  const handleDelete = async (paths: string[]): Promise<void> => {
    if (paths.length === 0) return
    const msg = paths.length === 1
      ? t('sftp.confirmDelete', { name: baseName(paths[0]) })
      : t('sftp.confirmDeleteMultiple', { count: paths.length })
    if (!window.confirm(msg)) return
    try {
      setLoading(true)
      for (const p of paths) await window.api.sftpDelete(connection, p)
    } catch (err) {
      alert(describe(err, t('sftp.failedToDelete')))
    } finally {
      setLoading(false)
      loadDirectory(currentPath)
    }
  }

  const handleCreateFolder = async (): Promise<void> => {
    if (!newFolderName.trim() || !currentPath) return
    try {
      await window.api.sftpCreateDir(connection, currentPath, newFolderName.trim())
      setNewFolderName('')
      setShowNewFolderInput(false)
      loadDirectory(currentPath)
    } catch (err) {
      alert(describe(err, t('sftp.failedToCreateFolder')))
    }
  }

  const handleContextMenu = (e: React.MouseEvent, itemPath: string, isFolder: boolean): void => {
    e.preventDefault()
    e.stopPropagation()
    const itemId = isFolder ? `folder:${baseName(itemPath)}` : `file:${itemPath}`
    if (!selectedItems.has(itemId)) {
      setSelectedItems(new Set([itemId]))
      setLastClickedItem(itemId)
    }
    const menuHeight = (isFolder ? 1 : 3) * 36 + 12
    const x = Math.min(e.clientX, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_GUTTER)
    const y = Math.min(e.clientY - 60, window.innerHeight - menuHeight - CONTEXT_MENU_GUTTER)
    window.dispatchEvent(new CustomEvent('contextmenu-open', { detail: 'sftp' }))
    setContextMenu({ x, y: Math.max(CONTEXT_MENU_GUTTER, y), path: itemPath, isFolder })
  }

  const handleDragStart = (e: React.DragEvent, filePath: string): void => {
    const selected = getSelectedFilePaths()
    const paths = selected.length > 1 && selected.includes(filePath) ? selected : [filePath]
    e.dataTransfer.setData('application/x-sftp-files', JSON.stringify({ connectionId: connection.id, paths }))
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }} onDragOver={handleDragOver} onDrop={handleDrop}>
      {/* Action Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: '48px', background: 'var(--bg-glass)', borderBottom: '1px solid var(--border-light)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <button className="btn-icon" onClick={navigateUp} disabled={!currentPath || currentPath === '/' || loading}>
            <ArrowLeft size={18} />
          </button>
          <button className="btn-icon" onClick={retry} disabled={loading}>
            <RefreshCw size={18} className={loading ? 'spin' : ''} />
          </button>
          {currentPath && (
            <button className="btn-icon" title={t('sftp.newFolder')} onClick={() => setShowNewFolderInput(true)}>
              <FolderPlus size={18} />
            </button>
          )}
          <span title={currentPath} style={{ marginLeft: '12px', fontSize: '0.9rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <Server size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
            {connection.username}@{connection.host}:<span style={{ opacity: 0.7 }}>{currentPath}</span>
          </span>
        </div>
      </div>

      {error && (
        <div className="sftp-error" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontSize: '0.9rem' }}>
          <span>{error}</span>
          <button className="btn-icon" onClick={retry} disabled={loading} title={t('sftp.retry')} style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#ef4444', flexShrink: 0 }}>
            <RotateCcw size={14} /> {t('sftp.retry')}
          </button>
        </div>
      )}

      <div className="glass-panel" style={{ flex: 1, overflowY: 'auto', padding: '12px', borderRadius: 0, border: 'none' }} onClick={handleBackgroundClick}>
        {loading && !currentPath ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>{t('sftp.connecting')}</div>
        ) : !currentPath ? null : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {showNewFolderInput && (
              <li style={{ ...itemStyle, gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                  <FolderPlus size={18} color="var(--accent-primary)" />
                  <input
                    ref={newFolderRef}
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateFolder()
                      if (e.key === 'Escape') { setShowNewFolderInput(false); setNewFolderName('') }
                    }}
                    onBlur={() => { setShowNewFolderInput(false); setNewFolderName('') }}
                    placeholder={t('sftp.folderNamePlaceholder')}
                    style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--accent-primary)', padding: '4px 8px', borderRadius: '4px', color: 'white', outline: 'none', flex: 1, fontSize: '0.9rem' }}
                  />
                </div>
              </li>
            )}
            {folders.length === 0 && files.length === 0 && !showNewFolderInput && (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>{t('sftp.emptyFolder')}</div>
            )}
            {folders.map(folder => {
              const folderId = `folder:${folder}`
              const isSelected = selectedItems.has(folderId)
              return (
                <li key={folderId}
                    onClick={(e) => handleItemClick(e, folderId)}
                    onDoubleClick={() => loadDirectory(joinRemote(currentPath, folder))}
                    onContextMenu={(e) => handleContextMenu(e, joinRemote(currentPath, folder), true)}
                    style={{ ...itemStyle, ...(isSelected ? selectedStyle : {}) }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Folder size={18} color="var(--accent-primary)" />
                    <span>{folder}/</span>
                  </div>
                </li>
              )
            })}
            {files.map(file => {
              const fileId = `file:${file.path}`
              const isSelected = selectedItems.has(fileId)
              return (
                <li key={fileId}
                    className="file-item"
                    draggable
                    onDragStart={(e) => handleDragStart(e, file.path)}
                    onClick={(e) => handleItemClick(e, fileId)}
                    onContextMenu={(e) => handleContextMenu(e, file.path, false)}
                    style={{ ...itemStyle, ...(isSelected ? selectedStyle : {}) }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    <File size={18} color={isSelected ? 'var(--accent-primary)' : 'var(--text-secondary)'} />
                    <span style={{ cursor: 'grab', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</span>
                  </div>
                  <div className="file-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {formatFileSize(file.size)} · {new Date(file.lastModified).toLocaleDateString()}
                    </span>
                    <button className="btn-icon" title={t('sftp.download')} onClick={(e) => handleDownload(file.path, e)}>
                      <Download size={14} />
                    </button>
                    <button className="btn-icon" title={t('sftp.delete')} onClick={(e) => { e.stopPropagation(); handleDelete([file.path]) }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .file-item .file-actions button { opacity: 0; }
        .file-item:hover .file-actions button { opacity: 1; }
        .sftp-context-menu-item { display: flex; align-items: center; justify-content: flex-start; gap: 8px; width: 100%; padding: 8px 12px; background: transparent; border: none; color: var(--text-primary); cursor: pointer; text-align: left; border-radius: 4px; font-size: 0.85rem; font-weight: 500; transition: background var(--transition-fast); white-space: nowrap; }
        .sftp-context-menu-item:hover:not(:disabled) { background: rgba(255,255,255,0.08); }
        .sftp-context-menu-item:disabled { color: var(--text-muted); opacity: 0.55; cursor: not-allowed; }
        .sftp-context-menu-item.danger:hover:not(:disabled) { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
      `}</style>

      {contextMenu && (
        <div
          style={{
            position: 'fixed', top: `${contextMenu.y}px`, left: `${contextMenu.x}px`,
            background: 'rgba(39, 39, 42, 0.96)', border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: '0 18px 40px rgba(0, 0, 0, 0.35)', borderRadius: 'var(--radius-md)', padding: '6px',
            zIndex: 200, minWidth: '200px', overflow: 'hidden', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {!contextMenu.isFolder && (
            <>
              <button className="sftp-context-menu-item" onClick={(e) => { setContextMenu(null); handleDownload(contextMenu.path, e) }}>
                <Download size={16} />
                {t('sftp.downloadSaveAs')}
              </button>
              <button
                className="sftp-context-menu-item"
                disabled={!localCurrentPath}
                onClick={() => {
                  const paths = getSelectedFilePaths()
                  handleDownloadToLocal(paths.length > 0 ? paths : [contextMenu.path])
                  setContextMenu(null)
                }}
              >
                <FolderDown size={16} />
                {selectedItems.size > 1 ? t('sftp.downloadItemsToLocal', { count: selectedItems.size }) : t('sftp.downloadToLocal')}
              </button>
            </>
          )}
          <button
            className="sftp-context-menu-item danger"
            onClick={() => {
              const paths = getSelectedPaths()
              handleDelete(paths.length > 0 ? paths : [contextMenu.path])
              setContextMenu(null)
            }}
          >
            <Trash2 size={16} />
            {selectedItems.size > 1 ? t('sftp.deleteItems', { count: selectedItems.size }) : t('sftp.delete')}
          </button>
        </div>
      )}
    </div>
  )
}

const itemStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '12px 16px', borderBottom: '1px solid var(--border-light)',
  cursor: 'pointer', transition: 'background var(--transition-fast), border-color var(--transition-fast)',
}

const selectedStyle: React.CSSProperties = {
  background: 'rgba(99, 102, 241, 0.15)',
  borderBottom: '1px solid rgba(99, 102, 241, 0.25)',
}
