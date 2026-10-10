import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, File, ArrowLeft, RefreshCw, HardDrive, Trash2, FolderPlus } from 'lucide-react'
import { useTransferQueue } from '../context/TransferQueueContext'
import { formatFileSize } from '../../../shared/utils'

import { Connection, RemoteLocation } from '../../../shared/types'
import { CloudUpload } from 'lucide-react'

interface LocalExplorerProps {
  activeConnection: Connection | null
  remoteLocation: RemoteLocation | null
  onPathChange?: (path: string) => void
}

interface ContextMenuState {
  x: number
  y: number
  file: any | null      // null = background context menu
  isFolder?: boolean
  folderName?: string
}

const CONTEXT_MENU_WIDTH = 190
const CONTEXT_MENU_GUTTER = 4

const getContextMenuPosition = (mouseX: number, mouseY: number, itemCount: number) => {
  const menuHeight = itemCount * 36 + 12 // 36px per item + padding
  const x = Math.min(mouseX, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_GUTTER)
  const y = Math.min(mouseY - 60, window.innerHeight - menuHeight - CONTEXT_MENU_GUTTER)
  return { x, y: Math.max(CONTEXT_MENU_GUTTER, y) }
}

export default function LocalExplorer({ activeConnection, remoteLocation, onPathChange }: LocalExplorerProps) {
  const { t } = useTranslation()
  const [currentPath, setCurrentPath] = useState<string>('')
  const [folders, setFolders] = useState<string[]>([])
  const [files, setFiles] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const newFolderRef = useRef<HTMLInputElement>(null)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [lastClickedItem, setLastClickedItem] = useState<string | null>(null)
  const { addJob, lastJobUpdate } = useTransferQueue()

  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    const handleOtherMenu = (e: Event) => {
      if ((e as CustomEvent).detail !== 'local') setContextMenu(null)
    }
    const handleOtherClick = (e: Event) => {
      if ((e as CustomEvent).detail !== 'local') setContextMenu(null)
    }
    window.addEventListener('click', handleClick)
    window.addEventListener('contextmenu-open', handleOtherMenu)
    window.addEventListener('explorer-panel-click', handleOtherClick)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('contextmenu-open', handleOtherMenu)
      window.removeEventListener('explorer-panel-click', handleOtherClick)
    }
  }, [])

  // Build a flat ordered list of all item IDs for shift-click range selection
  const allItemIds = [
    ...folders.map(f => `folder:${f}`),
    ...files.map(f => `file:${f.path}`)
  ]

  useEffect(() => {
    // Initial load: get user home directory and list it
    window.api.getLocalHome().then(homePath => {
      loadDirectory(homePath)
    }).catch(err => setError(err.message))
  }, [])

  // Auto-refresh when a transfer job completes (e.g. download from S3)
  useEffect(() => {
    if (lastJobUpdate > 0 && currentPath) {
      loadDirectory(currentPath)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastJobUpdate])

  // Focus new folder input when shown
  useEffect(() => {
    if (showNewFolderInput && newFolderRef.current) {
      newFolderRef.current.focus()
    }
  }, [showNewFolderInput])

  const loadDirectory = async (dirPath: string) => {
    setLoading(true)
    setError('')
    try {
      const result = await window.api.listLocalDir(dirPath)
      setCurrentPath(result.currentPath)
      setFolders(result.folders)
      setFiles(result.files)
      setSelectedItems(new Set())
      setLastClickedItem(null)
      if (onPathChange) onPathChange(result.currentPath)
    } catch (err: any) {
      setError(err.message || t('local.failedToListDirectory'))
    } finally {
      setLoading(false)
    }
  }

  const navigateUp = () => {
    if (!currentPath) return
    // Simple path manipulation for up directory
    const parts = currentPath.split(/\\|\//).filter(Boolean)
    if (parts.length <= 1) {
       // On mac/linux / is root. On windows C:\
       // We'll just do a very simple approach, if Windows it might be drive root
       if (currentPath.includes(':\\') && parts.length === 1) return // Already at root
       loadDirectory('/')
       return
    }
    
    parts.pop()
    const newPath = currentPath.startsWith('/') 
      ? '/' + parts.join('/') 
      : parts.join('/') + (currentPath.includes('\\') ? '\\' : '/')
      
    loadDirectory(newPath)
  }

  const navigateTo = (folderName: string) => {
    // Basic join. Should ideally use proper path join via IPC if things get complex, 
    // but a string concat is usually fine for a simple explorer.
    const separator = currentPath.includes('\\') ? '\\' : '/'
    const newPath = currentPath.endsWith(separator) 
      ? `${currentPath}${folderName}` 
      : `${currentPath}${separator}${folderName}`
    
    loadDirectory(newPath)
  }

  // Set file path as dataTransfer property to upload from here
  const handleDragStart = (e: React.DragEvent, filePath: string) => {
    // If dragging a selected item with multi-selection, drag all selected files
    const selected = getSelectedFiles()
    if (selected.length > 1 && selectedItems.has(`file:${filePath}`)) {
      const paths = selected.map(f => f.path)
      e.dataTransfer.setData('application/x-local-files', JSON.stringify(paths))
      e.dataTransfer.setData('application/x-local-file', paths[0])
      e.dataTransfer.setData('text/plain', paths[0])
    } else {
      e.dataTransfer.setData('text/plain', filePath)
      e.dataTransfer.setData('application/x-local-file', filePath)
    }
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleContextMenu = (e: React.MouseEvent, file: any | null, isFolder?: boolean, folderName?: string) => {
    e.preventDefault()
    e.stopPropagation()
    // If right-clicking on an item, ensure it's selected
    if (file || isFolder) {
      const itemId = isFolder ? `folder:${folderName}` : `file:${file.path}`
      if (!selectedItems.has(itemId)) {
        setSelectedItems(new Set([itemId]))
        setLastClickedItem(itemId)
      }
    }
    // Estimate menu item count for positioning
    const hasItem = !!(file || isFolder)
    const isFile = !!(file && !isFolder)
    const itemCount = hasItem ? (isFile ? 2 : 1) : 1
    const position = getContextMenuPosition(e.clientX, e.clientY, itemCount)
    window.dispatchEvent(new CustomEvent('contextmenu-open', { detail: 'local' }))
    setContextMenu({ ...position, file, isFolder, folderName })
  }

  const canCopyToRemote = !!activeConnection && !!remoteLocation &&
    (remoteLocation.kind === 'sftp' ? !!remoteLocation.path : !!remoteLocation.bucket)

  const handleCopyToRemote = () => {
    if (!activeConnection || !remoteLocation || !canCopyToRemote) return
    // Upload all selected files to the active remote location (S3 bucket/prefix or SFTP directory)
    const selectedFiles = getSelectedFiles()
    for (const file of selectedFiles) {
      if (remoteLocation.kind === 's3') {
        addJob({
          type: 'upload',
          sourcePath: file.path,
          destPath: `${remoteLocation.prefix}${file.name}`,
          fileName: file.name,
          connectionId: activeConnection.id,
          bucket: remoteLocation.bucket
        })
      } else {
        const dir = remoteLocation.path
        addJob({
          type: 'upload',
          sourcePath: file.path,
          destPath: dir.endsWith('/') ? `${dir}${file.name}` : `${dir}/${file.name}`,
          fileName: file.name,
          connectionId: activeConnection.id
        })
      }
    }
    setContextMenu(null)
  }

  const handleDeleteLocal = async () => {
    // Delete all selected items
    const itemsToDelete = getSelectedItemPaths()
    if (itemsToDelete.length === 0) return
    const msg = itemsToDelete.length === 1
      ? t('local.confirmDelete', { name: itemsToDelete[0].name })
      : t('local.confirmDeleteMultiple', { count: itemsToDelete.length })
    if (!window.confirm(msg)) return
    try {
      for (const item of itemsToDelete) {
        await window.api.deleteLocalItem(item.path)
      }
      loadDirectory(currentPath)
    } catch (err: any) {
      alert(err.message || t('local.failedToDelete'))
    }
    setContextMenu(null)
  }

  // Helper: get all selected file objects
  const getSelectedFiles = () => {
    return files.filter(f => selectedItems.has(`file:${f.path}`))
  }

  // Helper: get paths of all selected items (files and folders)
  const getSelectedItemPaths = () => {
    const separator = currentPath.includes('\\') ? '\\' : '/'
    const items: { name: string; path: string }[] = []
    for (const id of selectedItems) {
      if (id.startsWith('file:')) {
        const filePath = id.slice(5)
        const file = files.find(f => f.path === filePath)
        if (file) items.push({ name: file.name, path: file.path })
      } else if (id.startsWith('folder:')) {
        const folderName = id.slice(7)
        const folderPath = currentPath.endsWith(separator)
          ? `${currentPath}${folderName}`
          : `${currentPath}${separator}${folderName}`
        items.push({ name: folderName, path: folderPath })
      }
    }
    return items
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    try {
      await window.api.createLocalDir(currentPath, newFolderName.trim())
      setNewFolderName('')
      setShowNewFolderInput(false)
      loadDirectory(currentPath)
    } catch (err: any) {
      alert(err.message || t('local.failedToCreateFolder'))
    }
  }

  const handleItemClick = (e: React.MouseEvent, itemId: string) => {
    setContextMenu(null)
    window.dispatchEvent(new CustomEvent('explorer-panel-click', { detail: 'local' }))
    if (e.metaKey || e.ctrlKey) {
      // Toggle individual item
      setSelectedItems(prev => {
        const next = new Set(prev)
        if (next.has(itemId)) next.delete(itemId)
        else next.add(itemId)
        return next
      })
      setLastClickedItem(itemId)
    } else if (e.shiftKey && lastClickedItem) {
      // Range select
      const startIdx = allItemIds.indexOf(lastClickedItem)
      const endIdx = allItemIds.indexOf(itemId)
      if (startIdx !== -1 && endIdx !== -1) {
        const from = Math.min(startIdx, endIdx)
        const to = Math.max(startIdx, endIdx)
        const range = allItemIds.slice(from, to + 1)
        setSelectedItems(prev => {
          const next = new Set(prev)
          range.forEach(id => next.add(id))
          return next
        })
      }
    } else {
      // Single select
      setSelectedItems(new Set([itemId]))
      setLastClickedItem(itemId)
    }
  }

  const handleBackgroundClick = (e: React.MouseEvent) => {
    setContextMenu(null)
    window.dispatchEvent(new CustomEvent('explorer-panel-click', { detail: 'local' }))
    // Only clear if clicking on the panel background itself, not on a child item
    if (e.target === e.currentTarget) {
      setSelectedItems(new Set())
      setLastClickedItem(null)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    const separator = currentPath.includes('\\') ? '\\' : '/'
    const localDest = (fileName: string): string =>
      currentPath.endsWith(separator) ? `${currentPath}${fileName}` : `${currentPath}${separator}${fileName}`

    // Files dragged from the SFTP explorer
    const sftpPayload = e.dataTransfer.getData('application/x-sftp-files')
    if (sftpPayload) {
      try {
        const { paths, connectionId } = JSON.parse(sftpPayload)
        for (const remotePath of paths as string[]) {
          const fileName = remotePath.split('/').pop() || 'download'
          addJob({ type: 'download', sourcePath: remotePath, destPath: localDest(fileName), fileName, connectionId })
        }
      } catch {
        console.error('Failed to parse SFTP drop data')
      }
      return
    }

    // Check if it's multi-file from S3
    const s3MultiPayload = e.dataTransfer.getData('application/x-s3-files')
    if (s3MultiPayload) {
      try {
        const { keys, bucket, connectionId } = JSON.parse(s3MultiPayload)
        for (const key of keys as string[]) {
          const fileName = key.split('/').pop() || 'download'
          const separator = currentPath.includes('\\') ? '\\' : '/'
          const destPath = currentPath.endsWith(separator)
            ? `${currentPath}${fileName}`
            : `${currentPath}${separator}${fileName}`
          addJob({ type: 'download', sourcePath: key, destPath, fileName, connectionId, bucket })
        }
      } catch (err) {
        console.error('Failed to parse S3 multi-file drop data')
      }
      return
    }

    // Check if it's single file from S3
    const s3PayloadString = e.dataTransfer.getData('application/x-s3-file')
    if (s3PayloadString) {
       try {
         const { key, bucket, connectionId } = JSON.parse(s3PayloadString)
         const fileName = key.split('/').pop() || 'download'
         const separator = currentPath.includes('\\') ? '\\' : '/'
         const destPath = currentPath.endsWith(separator) 
           ? `${currentPath}${fileName}` 
           : `${currentPath}${separator}${fileName}`
           
         addJob({
           type: 'download',
           sourcePath: key,
           destPath,
           fileName,
           connectionId,
           bucket
         })
       } catch (err) {
         console.error('Failed to parse S3 drop data')
       }
    }
  }

  return (
    <div 
      style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRight: '1px solid var(--border-light)' }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Action Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: '48px', background: 'var(--bg-glass)', borderBottom: '1px solid var(--border-light)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button className="btn-icon" onClick={navigateUp} disabled={loading || currentPath === '/' || currentPath.endsWith(':\\')}>
            <ArrowLeft size={18} />
          </button>
          <button className="btn-icon" onClick={() => loadDirectory(currentPath)} disabled={loading}>
            <RefreshCw size={18} className={loading ? 'spin' : ''} />
          </button>
          <button className="btn-icon" title={t('local.newFolder')} onClick={() => setShowNewFolderInput(true)}>
            <FolderPlus size={18} />
          </button>
          <span style={{ marginLeft: '12px', fontSize: '0.9rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }} title={currentPath}>
            <HardDrive size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
            {currentPath || t('local.loading')}
          </span>
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '4px', marginBottom: '16px', fontSize: '0.9rem' }}>
          {error}
        </div>
      )}

      {/* Grid view */}
      <div className="glass-panel" style={{ flex: 1, overflowY: 'auto', padding: '12px', borderRadius: 0, border: 'none' }}
           onContextMenu={(e) => handleContextMenu(e, null)}
           onClick={handleBackgroundClick}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>{t('local.loading')}</div>
        ) : folders.length === 0 && files.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>{t('local.emptyDirectory')}</div>
        ) : (
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
                    placeholder={t('local.folderNamePlaceholder')}
                    style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--accent-primary)', padding: '4px 8px', borderRadius: '4px', color: 'white', outline: 'none', flex: 1, fontSize: '0.9rem' }}
                  />
                </div>
              </li>
            )}
            {folders.map(folder => {
              const folderId = `folder:${folder}`
              const isSelected = selectedItems.has(folderId)
              return (
                <li key={folder}
                    onClick={(e) => { e.stopPropagation(); handleItemClick(e, folderId) }}
                    onDoubleClick={() => navigateTo(folder)}
                    style={{ ...itemStyle, ...(isSelected ? selectedStyle : {}) }}
                    onContextMenu={(e) => handleContextMenu(e, null, true, folder)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Folder size={18} color="var(--accent-primary)" />
                    <span>{folder}</span>
                  </div>
                </li>
              )
            })}
            {files.map(file => {
              const fileId = `file:${file.path}`
              const isSelected = selectedItems.has(fileId)
              return (
                <li 
                    key={file.name} 
                    style={{ ...itemStyle, ...(isSelected ? selectedStyle : {}) }}
                    className="file-item"
                    draggable
                    onDragStart={(e) => handleDragStart(e, file.path)}
                    onClick={(e) => { e.stopPropagation(); handleItemClick(e, fileId) }}
                    onContextMenu={(e) => handleContextMenu(e, file)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <File size={18} color={isSelected ? 'var(--accent-primary)' : 'var(--text-secondary)'} />
                    <span style={{ cursor: 'grab' }}>{file.name}</span>
                  </div>
                  <div className="file-actions" style={{ display: 'flex', gap: '8px' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {formatFileSize(file.size)}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div 
          style={{ 
            position: 'fixed', 
            top: `${contextMenu.y}px`, 
            left: `${contextMenu.x}px`, 
            background: 'rgba(39, 39, 42, 0.96)', 
            border: '1px solid rgba(255, 255, 255, 0.12)', 
            boxShadow: '0 18px 40px rgba(0, 0, 0, 0.35)', 
            borderRadius: 'var(--radius-md)', 
            padding: '6px',
            zIndex: 200,
            minWidth: '190px',
            overflow: 'hidden',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Copy to S3 - only for files */}
          {contextMenu.file && !contextMenu.isFolder && (
            <button 
              className="context-menu-item"
              onClick={handleCopyToRemote}
              disabled={!canCopyToRemote}
            >
              <CloudUpload size={16} />
              {remoteLocation?.kind === 'sftp'
                ? (selectedItems.size > 1 ? t('local.copyItemsToServer', { count: selectedItems.size }) : t('local.copyToServer'))
                : (selectedItems.size > 1 ? t('local.copyItemsToS3', { count: selectedItems.size }) : t('local.copyToS3'))}
            </button>
          )}
          {/* Delete */}
          {(contextMenu.file || contextMenu.isFolder) && (
            <button 
              className="context-menu-item"
              onClick={handleDeleteLocal}
            >
              <Trash2 size={16} />
              {selectedItems.size > 1 ? t('local.deleteItems', { count: selectedItems.size }) : t('local.delete')}
            </button>
          )}
          {/* New Folder - on background context menu */}
          {!contextMenu.file && !contextMenu.isFolder && (
            <button 
              className="context-menu-item"
              onClick={() => { setContextMenu(null); setShowNewFolderInput(true) }}
            >
              <FolderPlus size={16} />
              {t('local.newFolder')}
            </button>
          )}
        </div>
      )}

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .file-item .file-actions button { opacity: 0; }
        .file-item:hover .file-actions button { opacity: 1; }
        .context-menu-item {
          display: flex; align-items: center; justify-content: flex-start; gap: 8px;
          width: 100%; padding: 8px 12px; background: transparent;
          border: none; color: var(--text-primary); cursor: pointer;
          text-align: left; border-radius: 4px; font-size: 0.85rem;
          font-weight: 500; transition: background 0.15s ease; white-space: nowrap;
        }
        .context-menu-item:hover:not(:disabled) { background: rgba(255,255,255,0.08); }
        .context-menu-item:disabled { color: var(--text-muted); opacity: 0.55; cursor: not-allowed; }
      `}</style>
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
